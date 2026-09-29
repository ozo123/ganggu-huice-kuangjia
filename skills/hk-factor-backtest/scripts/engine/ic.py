import numpy as np
import pandas as pd
from scipy.stats import rankdata
from numba import njit
HOLDS=(1,5,21)
log=lambda *args: None

def pearson_rows(x,y):
    ok=np.isfinite(x)&np.isfinite(y); n=ok.sum(1)
    xx=np.where(ok,x,0.); yy=np.where(ok,y,0.)
    # Scale BEFORE squaring: EXP/SINH outputs can be finite but enormous.
    sx=np.max(abs(xx),axis=1,keepdims=True); sy=np.max(abs(yy),axis=1,keepdims=True)
    xx/=np.where(sx>0,sx,1); yy/=np.where(sy>0,sy,1)
    xx=np.where(ok,xx-xx.sum(1,keepdims=True)/np.maximum(n[:,None],1),0)
    yy=np.where(ok,yy-yy.sum(1,keepdims=True)/np.maximum(n[:,None],1),0)
    den=np.sqrt((xx*xx).sum(1)*(yy*yy).sum(1))
    r=np.divide((xx*yy).sum(1),den,out=np.full(len(n),np.nan),where=(n>=20)&(den>1e-15))
    return np.clip(r,-1,1),n


def ic_summary(x,h):
    ok=np.isfinite(x); n=int(ok.sum())
    if n<2: return {'mean':None,'std':None,'ir':None,'tstat':None,'n':n,'positive_share':None,'cum':None,'hac_lags':None}
    mean=float(x[ok].mean()); sd=float(x[ok].std(ddof=1))
    lag=max(h-1,int(np.floor(4*(n/100)**(2/9))))
    z=np.where(ok,x-mean,0); lrv=float(z@z/n)
    for k in range(1,lag+1): lrv+=2*(1-k/(lag+1))*float(z[k:]@z[:-k])/n
    se=np.sqrt(max(lrv,0)/n)
    return {'mean':mean,'std':sd,'ir':mean/sd if sd>0 else None,'tstat':mean/se if se>0 else None,
            'naive_tstat':mean/(sd/np.sqrt(n)) if sd>0 else None,'n':n,'positive_share':float((x[ok]>0).mean()),
            'cum':float(np.sum(x[ok])),'hac_lags':lag}


@njit(cache=True)
def ic_fast(signal,targets,sorted_x,sorted_y):
    T,N=signal.shape; pear=np.full((3,T),np.nan); ric=pear.copy(); counts=np.zeros((3,T),np.int32)
    for k in range(3):
        for t in range(T):
            good=np.zeros(N,np.bool_); rx=np.zeros(N); ry=np.zeros(N)
            n=0; xmax=0.; ymax=0.
            for c in range(N):
                if np.isfinite(signal[t,c]) and np.isfinite(targets[k,t,c]):
                    good[c]=True;n+=1;xmax=max(xmax,abs(signal[t,c]));ymax=max(ymax,abs(targets[k,t,c]))
            counts[k,t]=n
            if n<20: continue
            for side in range(2):
                order=sorted_x[t] if side==0 else sorted_y[k,t]
                indices=np.empty(n,np.int32); at=0
                for j in range(N):
                    c=order[j]
                    if good[c]: indices[at]=c;at+=1
                start=0
                while start<n:
                    stop=start+1
                    vv=signal[t,indices[start]] if side==0 else targets[k,t,indices[start]]
                    while stop<n:
                        vv2=signal[t,indices[stop]] if side==0 else targets[k,t,indices[stop]]
                        if vv2!=vv: break
                        stop+=1
                    rank=(start+stop+1)*.5
                    for j in range(start,stop):
                        if side==0:rx[indices[j]]=rank
                        else:ry[indices[j]]=rank
                    start=stop
            mx=0.;my=0.
            if xmax==0:xmax=1.
            if ymax==0:ymax=1.
            for c in range(N):
                if good[c]:mx+=signal[t,c]/xmax;my+=targets[k,t,c]/ymax
            mx/=n;my/=n
            sx=0.;sy=0.;sxy=0.;srx=0.;sry=0.;srxy=0.;mr=(n+1)*.5
            for c in range(N):
                if good[c]:
                    xx=signal[t,c]/xmax-mx;yy=targets[k,t,c]/ymax-my
                    sx+=xx*xx;sy+=yy*yy;sxy+=xx*yy
                    xx=rx[c]-mr;yy=ry[c]-mr
                    srx+=xx*xx;sry+=yy*yy;srxy+=xx*yy
            if sx>1e-28 and sy>1e-28:pear[k,t]=min(1.,max(-1.,sxy/np.sqrt(sx*sy)))
            if srx>0 and sry>0:ric[k,t]=min(1.,max(-1.,srxy/np.sqrt(srx*sry)))
    return pear,ric,counts


def target_context(v,path=None):
    T,N=v.shape[:2]
    targets=np.full((3,T,N),np.nan); order=np.zeros((3,T,N),dtype="int32")
    for k,h in enumerate(HOLDS):
        size=T-h-1
        for start in range(0,size,128):
            end=min(size,start+128);entry=v[start+1:end+1];ex=v[start+1+h:end+1+h]
            if v.shape[2]>4:
                distributions=np.zeros_like(entry[:,:,1])
                for age in range(1,h+1):distributions+=v[start+1+age:end+1+age,:,4]
                y=(ex[:,:,1]-entry[:,:,1]+distributions)/entry[:,:,1]
            else:y=(ex[:,:,0]-entry[:,:,0])/entry[:,:,1]
            good=(v[start:end,:,2]>0)&(entry[:,:,2]>0)&(ex[:,:,2]>0)&np.isfinite(y)
            y[~good]=np.nan;targets[k,start:end]=y
        order[k]=np.argsort(targets[k],axis=1).astype('int32')
    return targets,order


IC_WINSORIZE = {'method': 'cross_section_quantile', 'lower': 0.01, 'upper': 0.99,
                'scope': 'factor_and_forward_return_on_common_valid_pairs',
                'quantile_method': 'linear', 'min_stocks': 20}


def winsorized_pair_ic(x, y):
    """One date/horizon: pairwise finite sample, clip both tails, then rank."""
    valid = np.isfinite(x) & np.isfinite(y)
    n = int(valid.sum())
    if n < 20:
        return np.nan, np.nan, n
    xx = np.asarray(x[valid], dtype=float).copy()
    yy = np.asarray(y[valid], dtype=float).copy()
    # Scale before quantiles to avoid overflow in interpolation for huge factors.
    for values in (xx, yy):
        scale = np.max(np.abs(values))
        if scale > 0: values /= scale
        lo, hi = np.quantile(values, [.01, .99], method='linear')
        np.clip(values, lo, hi, out=values)
    pear = pearson_rows(xx[None, :], yy[None, :])[0][0]
    rx = rankdata(xx, method='average'); ry = rankdata(yy, method='average')
    rank = pearson_rows(rx[None, :], ry[None, :])[0][0]
    return pear, rank, n


def compute_ic(signal,v,context=None):
    targets,_=context if context is not None else target_context(v)
    summary={};frames=[];T=len(signal)
    for k,h in enumerate(HOLDS):
        pear=np.full(T,np.nan); rank=np.full(T,np.nan); count=np.zeros(T,dtype=int)
        for t in range(T):
            pear[t],rank[t],count[t]=winsorized_pair_ic(signal[t],targets[k,t])
        nn=count; summary[str(h)]={'rank':ic_summary(rank,h),'pearson':ic_summary(pear,h),
            'winsorize':dict(IC_WINSORIZE),
            'mean_cross_section':float(nn[nn>0].mean()) if (nn>0).any() else None,'min_cross_section':int(nn[nn>0].min()) if (nn[nn>0]).size else 0}
        frames.append(pd.DataFrame({'hold_days':h,'date_index':np.arange(T),'rank_ic':rank,'pearson_ic':pear,'n_stocks':count}))
    return summary,pd.concat(frames,ignore_index=True)


def exact_correlations(values):
    F,D,N=values.shape; sums=np.zeros((F,F)); counts=np.zeros((F,F),dtype=int); overlaps=np.zeros((F,F))
    for d in range(D):
        x=np.asarray(values[:,d,:],float); finite=np.isfinite(x)
        masks={}
        for i in range(F): masks.setdefault(np.packbits(finite[i]).tobytes(),[]).append(i)
        buckets=list(masks.values())
        for a,ia in enumerate(buckets):
            for ib in buckets[a:]:
                common=finite[ia[0]]&finite[ib[0]]; n=int(common.sum())
                if n<20: continue
                xa=rankdata(x[np.ix_(ia,common)],axis=1); xb=rankdata(x[np.ix_(ib,common)],axis=1)
                xa-=xa.mean(1,keepdims=True); xb-=xb.mean(1,keepdims=True)
                sa=np.sqrt((xa*xa).sum(1)); sb=np.sqrt((xb*xb).sum(1)); denom=sa[:,None]*sb[None,:]
                corr=np.divide(xa@xb.T,denom,out=np.full(denom.shape,np.nan),where=denom>0)
                valid=np.isfinite(corr); loc=np.ix_(ia,ib)
                sums[loc]+=np.where(valid,corr,0); counts[loc]+=valid; overlaps[loc]+=valid*n
                if ia is not ib:
                    loc=np.ix_(ib,ia); sums[loc]+=np.where(valid,corr,0).T; counts[loc]+=valid.T; overlaps[loc]+=(valid*n).T
        if d%25==0: log('correlations %d/%d; validity groups %d'%(d,D,len(buckets)))
    corr=np.divide(sums,counts,out=np.full_like(sums,np.nan),where=counts>0)
    overlap=np.divide(overlaps,counts,out=np.full_like(sums,np.nan),where=counts>0)
    return np.clip(corr,-1,1),counts,overlap
