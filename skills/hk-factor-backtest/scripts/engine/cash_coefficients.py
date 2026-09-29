"""Daily OHLC affine units. No reconstruction from future rows."""
import numpy as np

def coefficients(x,y,z):
    T=len(x); a=np.full(T,np.nan); b=np.full(T,np.nan); kinds=['missing']*T
    obs=np.isfinite(x[:,:4]).all(1)&(x[:,:4]>0).all(1)&np.isfinite(y[:,:4]).all(1)
    lo=np.argmin(x[:,:4],axis=1); hi=np.argmax(x[:,:4],axis=1); ii=np.arange(T)
    dx=x[ii,hi]-x[ii,lo]
    with np.errstate(all='ignore'):
        slopes=(y[ii,hi]-y[ii,lo])/dx
        intercepts=y[:,3]-slopes*x[:,3]
        tol=1e-5*np.maximum(np.max(abs(y[:,:4]),axis=1),abs(slopes*x[:,3]))
        knowns=obs&(dx>1e-10*np.max(x[:,:4],axis=1))&np.isfinite(slopes)&(slopes>0)&(np.max(abs(slopes[:,None]*x[:,:4]+intercepts[:,None]-y[:,:4]),axis=1)<=tol)
    reconstructed=np.zeros(T,bool)
    # Causal variant: flat bars may carry only a previously identified map.
    last_a=last_b=last_z=np.nan
    for t in np.flatnonzero(obs):
        zz=z[t,3]/x[t,3]
        slope=slopes[t]; inter=intercepts[t];known=knowns[t]
        kind=('regime_affine_reconstruction' if reconstructed[t] else 'OHLC') if known else 'past_carry'
        if not known:
            slope=last_a
            # A reinvestment factor decrease cannot be caused by a positive cash
            # dividend. Accept a flat-bar consolidation only if b is preserved.
            if np.isfinite(last_z) and last_z>0 and np.isfinite(last_a) and zz/last_z<.9999:
                proposal=last_a*zz/last_z
                candidate=y[t,3]-proposal*x[t,3]
                if abs(candidate-last_b)<=1e-5*max(abs(y[t,3]),abs(proposal*x[t,3]),1e-15):
                    slope=proposal;kind='flat_consolidation_same_intercept'
            inter=y[t,3]-slope*x[t,3]
        if np.isfinite(slope) and slope>0:
            a[t]=last_a=slope;b[t]=last_b=inter;kinds[t]=kind
        if np.isfinite(zz) and zz>0: last_z=zz
    return a,b,kinds
