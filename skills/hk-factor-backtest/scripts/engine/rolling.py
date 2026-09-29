import numpy as np
from numba import njit
CAPITAL_MODEL="gross_cap_1x_postclose_v4"

@njit(cache=True)
def cohort_paths(groups, marks):
    T,N=groups.shape
    pnl=np.zeros((T,22,20)); notion=np.zeros_like(pnl)
    fill=np.zeros((T,20)); entered=np.zeros((T,20),np.int32); selected=np.zeros_like(entered)
    stale=np.zeros((T,22,20),np.int32)
    for s in range(T-1):
        for c in range(N):
            g=int(groups[s,c])-1
            if g>=0:
                selected[s,g]+=1
                if marks[s+1,c,2]>0: entered[s,g]+=1
        for g in range(20):
            if selected[s,g]>0: fill[s,g]=entered[s,g]/selected[s,g]
            notion[s,0,g]=fill[s,g]
        cashgain=np.zeros(N)
        for age in range(1,min(22,T-s-1)):
            d=s+1+age
            for c in range(N):
                g=int(groups[s,c])-1
                if g<0 or marks[s+1,c,2]<=0: continue
                base=marks[s+1,c,1]
                # Both conventions: wealth increment divided by entry security basis.
                if marks.shape[2]>4:
                    cashgain[c]+=marks[d,c,4]/base
                    pnl[s,age,g]+=(marks[d,c,1]-base)/base+cashgain[c]
                else:
                    pnl[s,age,g]+=(marks[d,c,0]-marks[s+1,c,0])/base
                notion[s,age,g]+=marks[d,c,1]/base
                if marks[d,c,2]<=0: stale[s,age,g]+=1
            for g in range(20):
                if selected[s,g]>0:
                    pnl[s,age,g]/=selected[s,g]
                    notion[s,age,g]/=selected[s,g]
    return pnl,notion,fill,entered,selected,stale


def performance(nav,fees,active):
    if active==0:
        return {k:None for k in ('mean_return','annualized_return','volatility','sharpe','cumulative_return','max_drawdown','win_rate','final_nav','cagr','annualized_fee_rate')}|{'n_periods':0,'active_entries':0,'bankrupt':False}
    r=np.divide(np.diff(nav),nav[:-1],out=np.full(len(nav)-1,np.nan),where=nav[:-1]>0)
    valid=np.isfinite(r); rr=r[valid]
    std=float(rr.std(ddof=1)) if len(rr)>1 else np.nan
    dd=nav/np.maximum.accumulate(nav)-1
    return {'n_periods':int(valid.sum()),'active_entries':int(active),'mean_return':float(rr.mean()),
            'annualized_return':float(rr.mean()*252),'volatility':std*np.sqrt(252),
            'sharpe':float(rr.mean()/std*np.sqrt(252)) if std>0 else None,
            'cumulative_return':float(nav[-1]-1),'max_drawdown':float(dd.min()) if np.all(nav>0) else None,
            'win_rate':float((rr>0).mean()),'final_nav':float(nav[-1]),
            'cagr':float(nav[-1]**(252/(len(nav)-1))-1) if np.all(nav>0) else None,
            'annualized_fee_rate':float(np.mean(np.divide(fees[1:],nav[:-1],out=np.zeros_like(fees[1:]),where=nav[:-1]>0))*252),
            'bankrupt':bool(np.any(nav<=0))}
