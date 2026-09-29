"""Reviewed signal implementations. Arrays returned are date x instrument."""
import numpy as np
import pandas as pd
from scipy.stats import rankdata
from numba import njit


@njit(cache=True)
def stable_rolling_corr(x, y, window):
    """Recenter each complete window; avoid accumulated rolling covariance error."""
    T,N=x.shape;out=np.full((T,N),np.nan)
    for c in range(N):
        for t in range(window-1,T):
            sx=0.;sy=0.;valid=True
            for k in range(t-window+1,t+1):
                if not np.isfinite(x[k,c]) or not np.isfinite(y[k,c]):valid=False;break
                sx=max(sx,abs(x[k,c]));sy=max(sy,abs(y[k,c]))
            if not valid or sx==0 or sy==0:continue
            mx=0.;my=0.
            for k in range(t-window+1,t+1):mx+=x[k,c]/sx;my+=y[k,c]/sy
            mx/=window;my/=window;xx=0.;yy=0.;xy=0.
            for k in range(t-window+1,t+1):
                dx=x[k,c]/sx-mx;dy=y[k,c]/sy-my
                xx+=dx*dx;yy+=dy*dy;xy+=dx*dy
            if np.sqrt(xx/(window-1))*sx>1e-14 and np.sqrt(yy/(window-1))*sy>1e-14:
                out[t,c]=min(1.,max(-1.,xy/np.sqrt(xx*yy)))
    return out


def price_frame(context, field=3):
    adjusted, raw = context['adjusted'], context['raw']
    good = (np.isfinite(adjusted[:, :, :4]).all(2)
            & np.isfinite(raw[:, :, :5]).all(2)
            & (raw[:, :, :4] > 0).all(2)
            & (raw[:, :, 1] >= raw[:, :, 2])
            & (adjusted[:, :, 1] >= adjusted[:, :, 2]))
    return pd.DataFrame(np.where(good, adjusted[:, :, field], np.nan).T)


def ma_ratio(context, parameters):
    close = price_frame(context)
    return (close.rolling(parameters['window'], min_periods=parameters['window']).mean() / close).to_numpy()


def quantile_ratio(context, parameters):
    close = price_frame(context)
    return (close.rolling(parameters['window'], min_periods=parameters['window']).quantile(
        parameters['quantile'], interpolation='linear') / close).to_numpy()


def cord(context, parameters):
    close = price_frame(context)
    volume = pd.DataFrame(np.asarray(context['raw'][:, :, 4]).T).where(close.notna())
    px = close / close.shift(1)
    denominator = volume.shift(1).where(volume.shift(1) > 0)
    vr = np.log1p(volume.where(volume >= 0) / denominator)
    n = parameters['window']
    return stable_rolling_corr(px.to_numpy(), vr.to_numpy(), n)


def alpha4(context, parameters):
    low = price_frame(context, 2).to_numpy(copy=True)
    low[~context['pool']] = np.nan
    ranks = rankdata(low, axis=1, method='average', nan_policy='omit')
    n = np.isfinite(low).sum(1)
    cs = (ranks - .5) / np.maximum(n[:, None], 1)
    window = parameters['window']
    result = np.full(cs.shape, np.nan)
    for t in range(window - 1, len(cs)):
        x = cs[t - window + 1:t + 1]
        valid = np.isfinite(x).all(0)
        value = -((x < x[-1]).sum(0) + .5 * (x == x[-1]).sum(0)) / window
        result[t, valid] = value[valid]
    return result


def momentum_calendar(context, parameters):
    dates = pd.DatetimeIndex(context['dates'])
    marks = context['marks']
    left = dates.searchsorted(dates - pd.DateOffset(months=parameters['lookback_months']), side='right') - 1
    right = dates.searchsorted(dates - pd.DateOffset(months=parameters['skip_months']), side='right') - 1
    result = np.full(marks.shape[:2], np.nan)
    # The cash account collects distributions without reinvesting them.
    distributions = np.nan_to_num(marks[:, :, 4], nan=0.).cumsum(0) if marks.shape[2] > 4 else None
    for t, (a, b) in enumerate(zip(left, right)):
        if a < 0 or b <= a:
            continue
        base = marks[a, :, 1]
        if distributions is not None:
            gain = marks[b, :, 1] - base + distributions[b] - distributions[a]
        else:
            gain = marks[b, :, 0] - marks[a, :, 0]
        valid = (marks[a, :, 2] > 0) & (marks[b, :, 2] > 0) & (base > 0)
        result[t] = np.divide(gain, base, out=np.full(len(base), np.nan), where=valid)
    return result


IMPLEMENTATIONS = {f.__name__: f for f in [ma_ratio, quantile_ratio, cord, alpha4, momentum_calendar]}
