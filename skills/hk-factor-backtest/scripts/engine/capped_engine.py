"""Post-close, post-fee 100% gross cap with real proportional reductions.

Sleeves are accounting buckets within one cash-funded account, not separate
limited-liability legal entities. Short sale proceeds are sealed. Negative own
cash is paid from other buckets; donors' capital falls by the same amount.
"""
import numpy as np
from numba import njit

@njit(cache=True)
def amounts(notion,start,scale,cash,locked,d):
    h=len(start);L=np.zeros(h);S=np.zeros(h)
    for j in range(h):
        if start[j]>=0 and scale[j]>0:
            age=d-start[j]-1
            L[j]=.5*scale[j]*notion[start[j],age,19]
            S[j]=.5*scale[j]*notion[start[j],age,0]
    return L,S,cash+locked+L-S

@njit(cache=True)
def sell(notion,start,scale,cash,locked,d,fee,mask,fraction):
    L,S,E=amounts(notion,start,scale,cash,locked,d);turn=0.
    for j in range(len(start)):
        if not mask[j]:continue
        g=L[j]+S[j];tr=fraction*g
        cash[j]+=fraction*(L[j]-S[j]+locked[j])-fee*tr
        locked[j]*=1-fraction;scale[j]*=1-fraction;turn+=tr
        if fraction>=1:start[j]=-1
    return turn

@njit(cache=True)
def settle(notion,start,scale,cash,locked,dead,d,fee):
    """Pay negative own cash; returns fees, turnover, transfers, failures, stop."""
    h=len(start);ft=0.;tt=0.;trans=0.;fail=0;allslots=np.ones(h,np.bool_)
    for _ in range(4*h+12):
        L,S,E=amounts(notion,start,scale,cash,locked,d)
        total=E.sum();tol=max(abs(total),1e-300)*1e-12
        if total<=0:
            tr=sell(notion,start,scale,cash,locked,d,fee,allslots,1.)
            ft+=fee*tr;tt+=tr;dead[:]=True
            return ft,tt,trans,fail,True
        failed=(E<=0)&(~dead)
        if failed.any():
            tr=sell(notion,start,scale,cash,locked,d,fee,failed,1.)
            ft+=fee*tr;tt+=tr;fail+=int(failed.sum());dead[failed]=True
            continue
        deficits=cash < -tol
        if not deficits.any():return ft,tt,trans,fail,False
        need=-cash[deficits].sum()
        av=np.minimum(np.maximum(cash,0),np.maximum(E,0))
        donors=av>tol;avail=av[donors].sum();paid=min(need,avail)
        if paid>tol:
            cash[donors]-=paid*av[donors]/avail
            cash[deficits]+=paid*(-cash[deficits])/need
            trans+=paid
            continue
        g=(L+S).sum();release=(L-S+locked).sum()-fee*g
        if g<=tol or release<=0:
            tr=sell(notion,start,scale,cash,locked,d,fee,allslots,1.)
            ft+=fee*tr;tt+=tr;dead[:]=True
            return ft,tt,trans,fail,True
        fraction=min(1.,max(0.,-cash.sum()/release))
        tr=sell(notion,start,scale,cash,locked,d,fee,allslots,fraction)
        ft+=fee*tr;tt+=tr
    raise ValueError('Cash settlement did not converge')

@njit(cache=True)
def simulate_capped(pnl,notion,fill,entered,h,fee):
    T=pnl.shape[0];cash=np.ones(h)/h;locked=np.zeros(h);scale=np.zeros(h)
    start=np.full(h,-1,np.int32);dead=np.zeros(h,np.bool_);allslots=np.ones(h,np.bool_)
    # nav, gross, long, short, cash, sealed, fees, pre-cap gross, pre-cap nav,
    # risk turnover, settlement turnover, cross transfers, minimum slot cash,
    # held stock/cohort count, forced sleeves, before-trade gross.
    out=np.zeros((T,16));out[:,0]=1.;out[0,4]=1.;out[0,12]=1/h
    active=0;stopped=False
    for d in range(1,T):
        if stopped:
            out[d,0]=cash.sum();out[d,4]=cash.sum();out[d,12]=cash.min()
            continue
        for j in range(h):
            s=start[j]
            if s<0 or scale[j]<=0:continue
            a=d-s-1
            divlong=(pnl[s,a,19]-pnl[s,a-1,19])-(notion[s,a,19]-notion[s,a-1,19])
            divshort=(pnl[s,a,0]-pnl[s,a-1,0])-(notion[s,a,0]-notion[s,a-1,0])
            cash[j]+=.5*scale[j]*(divlong-divshort)
        L,S,E=amounts(notion,start,scale,cash,locked,d);out[d,15]=(L+S).sum()
        if E.sum()<=0:
            tr=sell(notion,start,scale,cash,locked,d,fee,allslots,1.)
            out[d,6]+=fee*tr;out[d,10]+=tr;dead[:]=True;stopped=True
        else:
            failed=(E<=0)&(~dead)
            if failed.any():
                tr=sell(notion,start,scale,cash,locked,d,fee,failed,1.)
                out[d,6]+=fee*tr;out[d,10]+=tr;out[d,14]+=failed.sum();dead[failed]=True
            matured=np.zeros(h,np.bool_)
            for j in range(h):
                if start[j]>=0 and d-start[j]-1==h and not dead[j]:matured[j]=True
            tr=sell(notion,start,scale,cash,locked,d,fee,matured,1.);out[d,6]+=fee*tr
            f,t,x,k,stop=settle(notion,start,scale,cash,locked,dead,d,fee)
            out[d,6]+=f;out[d,10]+=t;out[d,11]+=x;out[d,14]+=k;stopped=stop
        slot=(d-1)%h;s=d-1
        if not stopped and not dead[slot]:
            if start[slot]>=0:raise ValueError('Matured slot still holds positions')
            if entered[s,0]>0 and entered[s,19]>0 and cash[slot]>0:
                fraction=.5*(fill[s,0]+fill[s,19]);budget=cash[slot]/(1+fee*fraction)
                lo=.5*budget*fill[s,19];sh=.5*budget*fill[s,0]
                cash[slot]-=lo+fee*(lo+sh);locked[slot]=sh
                scale[slot]=budget;start[slot]=s;out[d,6]+=fee*(lo+sh);active+=1
        if not stopped:
            L,S,E=amounts(notion,start,scale,cash,locked,d);g=(L+S).sum();total=E.sum()
            out[d,7]=g;out[d,8]=total
            if total<=0:
                tr=sell(notion,start,scale,cash,locked,d,fee,allslots,1.)
                out[d,6]+=fee*tr;out[d,10]+=tr;dead[:]=True;stopped=True
            elif g>total:
                retained=min(1.,max(0.,(total-fee*g)/(g*(1-fee))))
                tr=sell(notion,start,scale,cash,locked,d,fee,allslots,1-retained)
                out[d,6]+=fee*tr;out[d,9]+=tr
                f,t,x,k,stop=settle(notion,start,scale,cash,locked,dead,d,fee)
                out[d,6]+=f;out[d,10]+=t;out[d,11]+=x;out[d,14]+=k;stopped=stop
        L,S,E=amounts(notion,start,scale,cash,locked,d)
        out[d,0]=E.sum();out[d,1]=(L+S).sum();out[d,2]=L.sum();out[d,3]=S.sum()
        out[d,4]=cash.sum();out[d,5]=locked.sum();out[d,12]=cash.min()
        for j in range(h):
            if start[j]>=0 and scale[j]>0:out[d,13]+=entered[start[j],0]+entered[start[j],19]
        if not stopped:
            tol=max(abs(out[d,0]),1e-300)*1e-10
            if out[d,12]<-tol:raise ValueError('Negative own cash after settlement')
            if out[d,1]>out[d,0]+tol:raise ValueError('Post-fee gross cap breached')
    return out,active,int(dead.sum()),stopped
