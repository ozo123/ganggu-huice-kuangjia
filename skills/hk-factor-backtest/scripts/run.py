"""Independent HK daily factor backtest, selection and offline HTML report."""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
import os
import shutil
import sys
import traceback

for key in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
    os.environ.setdefault(key, '2')

import numpy as np
import pandas as pd
from standalone_utils import ROOT, MODES, HOLDS, read, write, clean, digest, file_hash, lock, atomic_text
from factor_contract import load_specs, admit, compute, causality_check
from daily_data import discover, columns, prepare, factor_fields
from backtest_core import compute_ic, oriented_ic, grouping, cohort_paths, setting
from engine.ic import exact_correlations, target_context, IC_WINSORIZE
from select_factors import select_slice


def configuration(args):
    cfg = read(args.config) if args.config else {}
    for k in ('data_root', 'factors', 'output', 'start', 'end', 'ipo_dates_csv', 'data_manifest'):
        value = getattr(args, k, None)
        if value: cfg[k] = str(value)
    cfg.setdefault('output', str(Path.cwd() / 'outputs/hk-factor-validation'))
    base = Path(args.config).resolve().parent if args.config else Path.cwd()
    for k in ('data_root', 'factors', 'output', 'ipo_dates_csv', 'event_overrides'):
        if cfg.get(k): cfg[k] = str((base / cfg[k]).resolve())
    fixed = dict(holds=list(HOLDS), modes=list(MODES), groups=20, fee_one_way=.002, listing_age_months=6,
                 adv_days=5, min_adv_hkd=3000000, amount_comparison='>', ic_orientation='full_sample_per_setting',
                 correlation_threshold=.8, min_ic=.01, capital_model='gross_cap_1x_postclose_v4')
    for key, value in fixed.items():
        if key in cfg and cfg[key] != value: raise ValueError(f'This skill requires {key}={value!r}')
        cfg[key] = value
    if cfg.get('ic_winsorize', IC_WINSORIZE) != IC_WINSORIZE:
        raise ValueError('This skill requires daily paired IC winsorization at 1%/99%')
    cfg['ic_winsorize'] = dict(IC_WINSORIZE)
    cfg.setdefault('min_correlation_months', 1)
    cfg.setdefault('allow_observed_age_proxy', True)
    if cfg.get('start') and cfg.get('end') and cfg['start'] > cfg['end']: raise ValueError('start is after end')
    return cfg


def inspection(cfg, specs):
    sources, profile = discover(cfg)
    raw = set().union(*(set(columns(p)) for p in sources['raw']))
    available = (raw & {'volume', 'amount', 'preClose', 'turnoverRatio'}) | {'raw_open', 'raw_high', 'raw_low', 'raw_close'}
    if {'amount', 'volume'} <= raw: available.add('vwap')
    records = []
    for spec in specs:
        per_mode = {}
        for mode in MODES:
            if not sources[mode]: per_mode[mode] = {'status': 'blocked_data', 'reasons': [profile.get('mode_errors', {}).get(mode, '缺少' + mode + '日线')]}; continue
            adj = set().union(*(set(columns(p)) for p in sources[mode])) & {'open', 'high', 'low', 'close'}
            per_mode[mode] = admit(spec, available | adj)
        records.append({'id': spec['id'], 'name': spec['name'], 'modes': per_mode})
    return {'profile': profile, 'factors': records, 'scope': 'given_factors_only; mining_not_invoked'}


def execute(cfg, specs, output, retry=False):
    preflight = inspection(cfg, specs); write(output / 'admission.json', preflight)
    dataset = prepare(cfg, output)
    all_dates = dataset['axes']['dates']; codes = dataset['axes']['codes']
    keep = np.array([i for i, date in enumerate(all_dates) if (not cfg.get('start') or date >= cfg['start']) and (not cfg.get('end') or date <= cfg['end'])])
    if len(keep) < 24: raise ValueError('Backtest interval needs at least 24 trading dates')
    dates = [all_dates[i] for i in keep]
    pool = np.load(Path(dataset['folder']) / 'pool.npy', mmap_mode='r')[keep]
    month = np.array([d[:7] for d in dates]); midx = np.r_[np.flatnonzero(month[1:] != month[:-1]), len(dates)-1]
    code_receipt = {str(p.relative_to(ROOT)): file_hash(p) for p in (ROOT / 'scripts').rglob('*.py') if '__pycache__' not in str(p)}
    runtime = {k: importlib.metadata.version(k) for k in ('numpy', 'pandas', 'scipy', 'numba', 'pyarrow')}
    records = []; run_index = {}
    for spec in specs:
        extra = file_hash(spec['python']) if spec.get('python') and Path(spec['python']).exists() else None
        fp = digest({'spec': spec, 'data': dataset['fingerprint'], 'config': cfg, 'code': code_receipt, 'python': sys.version, 'runtime': runtime, 'implementation': extra})[:24]
        directory = output / 'runs' / spec['id'] / fp
        old = read(directory / 'record.json') if (directory / 'record.json').exists() else None
        rec = old or {'id': spec['id'], 'name': spec['name'], 'fingerprint': fp, 'path': str(directory), 'settings': {}, 'spec': spec}
        records.append(rec); run_index[spec['id']] = directory
        write(directory / 'factor.json', spec); write(directory / 'config.json', cfg)
        write(directory / 'provenance.json', {'dataset': dataset['fingerprint'], 'data_root': cfg['data_root'], 'source_sha256': dataset['receipt'], 'code_sha256': code_receipt, 'runtime': runtime, 'python': sys.version, 'implementation_sha256': extra})
        if spec.get('python') and Path(spec['python']).exists(): shutil.copyfile(spec['python'], directory / 'implementation.py')
    for mode in MODES:
        if mode not in dataset['marks']:
            for rec in records:
                for h in HOLDS: rec['settings'][f'{mode}__{h}'] = {'status': 'blocked_data', 'reason': dataset['mode_errors'].get(mode, '缺少此口径')}
            continue
        fields = factor_fields(dataset, mode)
        marks = np.load(dataset['marks'][mode], mmap_mode='r')[keep]
        target = None
        for rec in records:
            spec = rec['spec']; fid = rec['id']; directory = run_index[fid]
            if all(f'{mode}__{h}' in rec['settings'] for h in HOLDS) and not retry: continue
            admission = admit(spec, fields)
            if admission['status'] != 'ready':
                for h in HOLDS: rec['settings'][f'{mode}__{h}'] = {'status': admission['status'], 'reason': '；'.join(admission['reasons'])}
                write(directory / 'record.json', rec); continue
            try:
                print(f'Calculate {fid} / {mode}', flush=True)
                full = compute(spec, fields)
                causality_check(spec, fields, full)
                signal = full[keep].copy(); del full
                signal[~pool | (marks[:, :, 2] <= 0)] = np.nan
                np.save(directory / f'monthly_{mode}.npy', signal[midx])
                if target is None: target = target_context(marks)
                ic_summary_raw, raw_ic = compute_ic(signal, marks, target)
                raw_ic.to_parquet(directory / f'raw_ic_{mode}.parquet', index=False)
                payload = {'factor_id': fid, 'function': fid, 'output_name': 'IC 定向值', 'group': '给定因子', 'modes': {mode: {}}, 'audit_path': '.'}
                summary_rows = []; paths_by_sign = {}; groups_by_sign = {}
                for h in HOLDS:
                    try:
                        sign, pre_ic, ic, icframe = oriented_ic(ic_summary_raw, raw_ic, h)
                        if sign not in paths_by_sign:
                            groups_by_sign[sign] = grouping(sign * signal)
                            paths_by_sign[sign] = cohort_paths(groups_by_sign[sign], marks)
                            np.savez_compressed(directory / f'groups_{mode}_{sign}.npz', groups=groups_by_sign[sign])
                        entry, rows, frame = setting(fid, mode, h, dates, groups_by_sign[sign], paths_by_sign[sign], ic, icframe, sign, pre_ic)
                        payload['modes'][mode][str(h)] = entry; summary_rows.extend(rows)
                        frame.to_parquet(directory / f'series_{mode}_{h}.parquet', index=False, compression='zstd')
                        rec['settings'][f'{mode}__{h}'] = {'status': 'completed', **next(r for r in rows if r['portfolio'].startswith('LS'))}
                        print(f'Complete {fid} / {mode} / {h}d, IC {pre_ic} -> {ic["rank"]["mean"]}, sign {sign}', flush=True)
                    except Exception as exc:
                        atomic_text(directory / f'error_{mode}_{h}.log', traceback.format_exc())
                        rec['settings'][f'{mode}__{h}'] = {'status': 'failed', 'reason': f'{type(exc).__name__}: {exc}'}
                write(directory / f'payload_{mode}.json', payload)
                pd.DataFrame(summary_rows).to_csv(directory / f'summary_{mode}.csv', index=False, encoding='utf-8-sig')
                del signal, paths_by_sign, groups_by_sign
            except Exception as exc:
                atomic_text(directory / f'error_{mode}.log', traceback.format_exc())
                for h in HOLDS: rec['settings'][f'{mode}__{h}'] = {'status': 'failed', 'reason': f'{type(exc).__name__}: {exc}'}
            write(directory / 'record.json', rec)
        del fields, marks, target
    corr = {'ids': [r['id'] for r in records], 'sample_dates': [dates[i] for i in midx], 'modes': {}, 'slices': {}}
    for mode in MODES:
        values = []
        for rec in records:
            p = run_index[rec['id']] / f'monthly_{mode}.npy'
            values.append(np.load(p) if p.exists() else np.full((len(midx), len(codes)), np.nan))
        matrix, months, overlap = exact_correlations(np.asarray(values))
        corr['modes'][mode] = clean({'matrix': matrix, 'days': months, 'overlap': overlap})
        for h in HOLDS:
            signs = np.array([r['settings'].get(f'{mode}__{h}', {}).get('direction_multiplier', 1) for r in records])
            oriented = matrix * signs[:, None] * signs[None, :]
            corr['slices'][f'{mode}__{h}'] = clean({'matrix': oriented, 'days': months, 'overlap': overlap})
            pd.DataFrame(oriented, index=corr['ids'], columns=corr['ids']).to_csv(output / f'correlation_{mode}_{h}.csv', encoding='utf-8-sig')
    selection = {'slices': {f'{m}__{h}': select_slice(records, m, h, corr, min_months=cfg['min_correlation_months']) for m in MODES for h in HOLDS},
                 'orientation': 'full-sample mean Rank IC; negative => -factor, then recompute portfolios', 'in_sample': True}
    rows = []
    for rec in records:
        directory = run_index[rec['id']]
        write(directory / 'record.json', rec)
        for mode in MODES:
            p = directory / f'summary_{mode}.csv'
            if p.exists() and p.stat().st_size > 4:
                rows.extend(r for r in pd.read_csv(p).to_dict('records') if rec['settings'].get(f'{mode}__{int(r["hold_days"])}', {}).get('status') == 'completed')
    pd.DataFrame(rows).to_csv(output / 'summary.csv', index=False, encoding='utf-8-sig')
    pd.DataFrame([{'mode': m, 'hold_days': h, **row} for m in MODES for h in HOLDS for row in selection['slices'][f'{m}__{h}']['rows']]).to_csv(output / 'factor_selection.csv', index=False, encoding='utf-8-sig')
    write(output / 'correlation.json', corr); write(output / 'factor_selection.json', selection)
    state = {'schema_version': 'hk-factor-validation/2.0', 'updated_at': datetime.now(timezone.utc).isoformat(),
             'config': cfg, 'dataset': dataset, 'dates': dates, 'records': records, 'correlation': corr, 'selection': selection}
    write(output / 'latest-run.json', state)
    return state


def verify(state, output):
    checks = []; expected = set(f'{m}__{h}' for m in MODES for h in HOLDS)
    def check(name, ok):
        checks.append({'check': name, 'passed': bool(ok)})
    for rec in state['records']:
        check(rec['id'] + ' six settings accounted', set(rec['settings']) == expected)
        for key, result in rec['settings'].items():
            if result['status'] != 'completed': continue
            mode, h = key.split('__'); h = int(h)
            entry = read(Path(rec['path']) / f'payload_{mode}.json')['modes'][mode][str(h)]
            check(rec['id'] + key + ' post fee exposure', entry['capital_review']['post_cap_over100_days'] == 0)
            check(rec['id'] + key + ' cash identity', entry['capital_review']['identity_max_abs_error'] < 1e-9)
            original = entry['preorientation_rank_ic']; oriented = entry['ic']['mean']
            check(rec['id'] + key + ' IC orientation', original is None or abs(abs(original) - oriented) < 1e-12)
            frame = pd.read_parquet(Path(rec['path']) / f'series_{mode}_{h}.parquet')
            if result.get('active_entries'):
                daily = frame.ls_nav.pct_change(fill_method=None).iloc[1:]
                expected_sharpe = daily.mean() / daily.std(ddof=1) * np.sqrt(252) if daily.std(ddof=1) > 0 else None
                check(rec['id'] + key + ' independent Sharpe', expected_sharpe is None or abs(expected_sharpe - result['net_sharpe']) < 1e-8)
                gross_daily = frame.ls_gross_nav.pct_change(fill_method=None).iloc[1:]
                gross_sharpe = gross_daily.mean() / gross_daily.std(ddof=1) * np.sqrt(252) if gross_daily.std(ddof=1) > 0 else None
                check(rec['id'] + key + ' independent gross Sharpe', gross_sharpe is None or abs(gross_sharpe - result['gross_sharpe']) < 1e-8)
                check(rec['id'] + key + ' reported NAV', abs(frame.ls_nav.iloc[-1] - entry['ls']['final_nav']) < 1e-12)
    for key, selected in state['selection']['slices'].items():
        mode, _ = key.split('__'); corr = state['correlation']; ids = corr['ids']; cm = corr['modes'][mode]
        retained = selected['retained']
        check(key + ' selected IC', all(r['ic_mean'] >= .01 for r in selected['rows'] if r['status'] == 'selected'))
        for i, a in enumerate(retained):
            for b in retained[i+1:]:
                rho = cm['matrix'][ids.index(a)][ids.index(b)]
                check(key + a + b + ' decorrelation', rho is not None and abs(rho) <= .8)
    result = {'passed': all(c['passed'] for c in checks), 'checks': checks,
              'settings_total': len(state['records']) * 6,
              'settings_completed': sum(r['status'] == 'completed' for f in state['records'] for r in f['settings'].values()),
              'scope': 'ledger and pipeline invariants; not independent verification of vendor corporate actions'}
    write(output / 'verification.json', result)
    if not result['passed']: raise RuntimeError('Verification failed; see verification.json')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'run', 'report', 'verify'])
    for name in ('config', 'data-root', 'data-manifest', 'factors', 'output', 'ipo-dates-csv'): parser.add_argument('--' + name, type=Path)
    parser.add_argument('--start'); parser.add_argument('--end'); parser.add_argument('--retry-failed', action='store_true')
    args = parser.parse_args(argv); cfg = configuration(args); output = Path(cfg['output'])
    with lock(output / '.standalone.lock'):
        if args.command in ('report', 'verify'):
            state = read(output / 'latest-run.json')
        else:
            if not cfg.get('data_root') or not cfg.get('factors'): parser.error('--data-root and --factors (or their config fields) are required')
            specs = load_specs(cfg['factors'])
            if args.command == 'inspect':
                result = inspection(cfg, specs); write(output / 'admission.json', result)
                print(json.dumps(result, ensure_ascii=False)); return
            state = execute(cfg, specs, output, args.retry_failed)
        if args.command in ('run', 'verify'): verify(state, output)
        if args.command in ('run', 'report'):
            from standalone_report import publish
            publish(state, output)
        print(json.dumps({'output': str(output), 'report': str(output / 'dashboard.html'), 'settings': len(state['records']) * 6}, ensure_ascii=False))


if __name__ == '__main__': main()
