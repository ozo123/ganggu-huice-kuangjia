"""Six rolling settings, including explicit full-sample IC orientation."""
import numpy as np
import pandas as pd
from scipy.stats import rankdata
from engine.rolling import cohort_paths, performance
from engine.capped_engine import simulate_capped
from engine.groups import simulate_groups
from engine.ic import compute_ic, ic_summary, IC_WINSORIZE
from standalone_utils import HOLDS, clean

FIELDS = {0: 'ls_nav', 1: 'ls_gross_exposure', 2: 'ls_long_exposure', 3: 'ls_short_exposure',
          4: 'ls_own_cash', 5: 'ls_sealed_proceeds', 6: 'ls_fee', 7: 'ls_pre_cap_gross',
          8: 'ls_pre_cap_nav', 9: 'ls_cap_turnover', 10: 'ls_settlement_turnover',
          11: 'ls_cross_transfers', 12: 'ls_min_sleeve_cash', 13: 'ls_holding_count',
          14: 'ls_forced_sleeves', 15: 'ls_before_trade_gross'}


def grouping(signal):
    ranks = rankdata(signal, axis=1, method='average', nan_policy='omit')
    count = np.isfinite(signal).sum(1)
    return np.where(np.isfinite(ranks), np.clip(np.floor(20 * (ranks - .5) / np.maximum(count[:, None], 1)) + 1, 1, 20), 0).astype('int8')


def oriented_ic(summary, frame, h):
    part = frame[frame.hold_days == h].sort_values('date_index').copy()
    pre = summary[str(h)]['rank']['mean']
    sign = -1 if pre is not None and pre < 0 else 1
    part['rank_ic'] *= sign; part['pearson_ic'] *= sign
    result = {'rank': ic_summary(part.rank_ic.to_numpy(), h), 'pearson': ic_summary(part.pearson_ic.to_numpy(), h)}
    return sign, pre, result, part


def setting(fid, mode, h, dates, groups, ctx, ic, icframe, sign, pre_ic):
    T = len(dates)
    nv, fees, exposure, counts, active = simulate_groups(*ctx[:4], h, .002)
    gv, _, _, _, ga = simulate_groups(*ctx[:4], h, 0.)
    ls, la, dead, stopped = simulate_capped(*ctx[:4], h, .002)
    gross, gla, _, _ = simulate_capped(*ctx[:4], h, 0.)
    gm = [performance(gv[:, g], np.zeros(T), ga[g]) for g in range(20)]
    metrics = [performance(nv[:, g], fees[:, g], active[g]) for g in range(20)]
    net = performance(ls[:, 0], ls[:, 6], la); gross_metrics = performance(gross[:, 0], gross[:, 6], gla)
    positive = ls[:, 0] > 0
    ratio = np.divide(ls[:, 1], ls[:, 0], out=np.full(T, np.nan), where=positive)
    identity = ls[:, 4] + ls[:, 5] + ls[:, 2] - ls[:, 3] - ls[:, 0]
    assert np.isfinite(ls).all() and np.isfinite(nv).all()
    assert not (positive & (ratio > 1 + 1e-10)).any(), 'Gross exposure cap breached'
    assert not ((ls[:, 12] < -1e-10 * np.maximum(abs(ls[:, 0]), 1e-300)) & positive).any()
    assert np.allclose(identity, 0., atol=1e-10, rtol=0), 'Cash/share identity failed'
    assert (exposure <= nv + 1e-10 * np.maximum(abs(nv), 1e-300)).all(), 'Group leverage'
    check = dict(post_cap_over100_days=int((positive & (ratio > 1 + 1e-10)).sum()),
                 identity_max_abs_error=float(abs(identity).max()), post_cap_max=float(np.nanmax(ratio)),
                 pre_cap_max=float(np.max(np.divide(ls[:, 7], ls[:, 8], out=np.zeros(T), where=ls[:, 8] > 0))),
                 cap_reduction_days=int((ls[:, 9] > 1e-12 * np.maximum(abs(ls[:, 0]), 1e-300)).sum()),
                 risk_turnover=float(ls[:, 9].sum()), min_sleeve_cash=float(ls[positive, 12].min()) if positive.any() else None,
                 stopped_sleeves=int(dead), stopped_portfolio=bool(stopped))
    serial = {name: ls[:, k] for k, name in FIELDS.items()}
    serial.update(ls_gross_nav=gross[:, 0], ls_gross_return=np.r_[np.nan, np.divide(np.diff(gross[:, 0]), gross[:-1, 0], out=np.full(T-1, np.nan), where=gross[:-1, 0] > 0)],
                  ls_return=np.r_[np.nan, np.divide(np.diff(ls[:, 0]), ls[:-1, 0], out=np.full(T-1, np.nan), where=ls[:-1, 0] > 0)],
                  ls_drawdown=ls[:, 0] / np.maximum.accumulate(ls[:, 0]) - 1,
                  ic=icframe.rank_ic.to_numpy(), pearson_ic=icframe.pearson_ic.to_numpy(),
                  ic_n_stocks=icframe.n_stocks.to_numpy(), cum_ic=icframe.rank_ic.fillna(0).cumsum().to_numpy())
    for g in range(20):
        serial[f'q{g+1:02d}_nav'] = nv[:, g]
        serial[f'q{g+1:02d}_gross_nav'] = gv[:, g]
        serial[f'q{g+1:02d}_count'] = counts[:, g]
        serial[f'q{g+1:02d}_fee'] = fees[:, g]
        serial[f'q{g+1:02d}_gross_exposure'] = exposure[:, g]
    frame = pd.DataFrame({'date': dates, **serial})
    nonempty = np.array([(groups == q).any(1) for q in range(1, 21)]).sum(0)
    chosen, entered, stale = ctx[4], ctx[3], ctx[5]
    entry = dict(dates=dates, ic_dates=dates, series=clean(serial), ls=net, gross_ls=gross_metrics,
                 ic=ic['rank'], pearson_ic=ic['pearson'], preorientation_rank_ic=pre_ic,
                 direction_multiplier=sign, direction_policy='full_sample_per_setting', ic_winsorize=dict(IC_WINSORIZE),
                 group_average_return=[m['mean_return'] for m in metrics], group_annualized_return=[m['annualized_return'] for m in metrics],
                 group_volatility=[m['volatility'] for m in metrics], group_final_nav=[m['final_nav'] for m in metrics],
                 group_metrics=metrics, group_gross_metrics=gm, signal_count=int(la), count_dates=dates, counts=counts.tolist(),
                 nonpositive_nav=net['bankrupt'], bankrupt_sleeves=int(dead), periods_le_minus_one=int((frame.ls_return <= -1).sum()),
                 nonempty_groups_median=float(np.median(nonempty)), selected_slots=int(chosen[:-h-1].sum()),
                 entry_unfilled_slots=int((chosen[:-h-1] - entered[:-h-1]).sum()), stale_exit_slots=int(stale[:-h-1, h].sum()),
                 completed_entry_slots=int(entered[:-h-1].sum()), mean_ls_exposure=float(np.nanmean(ratio)), capital_review=check)
    if not la:
        entry['series']['ls_nav'] = [None] * T; entry['series']['ls_return'] = [None] * T
        entry['series']['ls_gross_nav'] = [None] * T
    rows = []
    for g, m in enumerate(metrics + [net]):
        gross_m = (gm + [gross_metrics])[g]
        rows.append(dict(factor_id=fid, mode=mode, hold_days=h, portfolio='LS(Q20-Q01)' if g == 20 else f'Q{g+1:02d}',
                         **m, net_sharpe=m['sharpe'], gross_sharpe=gross_m['sharpe'], gross_annualized_return=gross_m['annualized_return'],
                         ic_mean=ic['rank']['mean'], ic_tstat=ic['rank']['tstat'], preorientation_rank_ic=pre_ic,
                         direction_multiplier=sign, direction_policy='full_sample_per_setting',
                         ic_winsorize_lower=.01, ic_winsorize_upper=.99, ic_winsorize_scope='factor_and_forward_return_on_common_valid_pairs'))
    return clean(entry), clean(rows), frame
