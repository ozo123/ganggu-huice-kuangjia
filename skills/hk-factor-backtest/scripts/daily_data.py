"""Build immutable daily panels from a user-supplied root, without old project caches."""
from pathlib import Path
import gc
import numpy as np
import pandas as pd
from standalone_utils import MODES, read, write, digest, file_hash

PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume', 'preClose']
MODE_DIRS = {'raw': '不复权', 'cash': '后复权_现金分红', 'reinvest': '后复权_分红再投'}


def resolve_native(root, stored):
    normalized = str(stored).replace('\\', '/')
    direct = root / normalized
    if direct.is_file(): return direct.resolve()
    # iFind catalog embeds the former archive root; relocate by the mode directory.
    for folder in MODE_DIRS.values():
        marker = folder + '/'
        if marker in normalized:
            candidate = root / folder / normalized.split(marker, 1)[1]
            if candidate.is_file(): return candidate.resolve()
    raise FileNotFoundError(f'Manifest file not found under {root}: {stored}')


def discover(cfg):
    root = Path(cfg['data_root']).resolve()
    if not root.is_dir(): raise ValueError('data_root must be an existing directory supplied by the user')
    manifests = sorted((root / 'metadata').glob('eleven_current_*.json'))
    explicit = cfg.get('data_manifest')
    sources = {m: [] for m in ('raw', *MODES)}
    profile = {'root': str(root), 'currency': cfg.get('currency'), 'amount_unit': cfg.get('amount_unit'),
               'excluded_codes': cfg.get('excluded_codes', []), 'manifest': None, 'mode_errors': {}}
    if explicit:
        p = Path(explicit); p = p if p.is_absolute() else root / p
        m = read(p)
        profile.update(currency=m.get('currency', profile['currency']), amount_unit=m.get('amount_unit', profile['amount_unit']), manifest=str(p))
        for mode in sources:
            try: sources[mode] = [resolve_native(root, v) for v in m.get('files', {}).get(mode, [])]
            except FileNotFoundError as exc:
                if mode == 'raw': raise
                profile['mode_errors'][mode] = str(exc)
    elif manifests:
        p = manifests[-1]; m = read(p)
        profile.update(manifest=str(p), currency='HKD', amount_unit='HKD', profile='ifind_eleven')
        profile['excluded_codes'] = sorted(set(profile['excluded_codes']) | {'80737.HK'})
        mode_ids = {'1': 'raw', '7': 'cash', '3': 'reinvest'}
        for item in m['outputs']:
            if str(item['mode']) in mode_ids:
                mode = mode_ids[str(item['mode'])]
                try: sources[mode].append(resolve_native(root, item['path']))
                except FileNotFoundError as exc:
                    if mode == 'raw': raise
                    profile['mode_errors'][mode] = str(exc)
    else:
        for mode in sources:
            for suffix in ('.parquet', '.csv'):
                p = root / (mode + suffix)
                if p.exists(): sources[mode].append(p)
    if not sources['raw']: raise ValueError('Missing raw daily data; provide data_manifest or raw.parquet / raw.csv')
    for mode in profile['mode_errors']: sources[mode] = []
    if profile['currency'] != 'HKD' or profile['amount_unit'] != 'HKD':
        raise ValueError('Confirm raw amount is in HKD via currency=HKD and amount_unit=HKD (never assume shares or thousands)')
    for mode, paths in sources.items():
        if len(paths) != len(set(paths)): raise ValueError('Duplicate file in manifest: ' + mode)
    return sources, profile


def columns(path):
    if path.suffix.lower() == '.parquet':
        import pyarrow.parquet as pq
        return pq.read_schema(path).names
    return pd.read_csv(path, nrows=0).columns.tolist()


def load_frame(path, requested=None, codes=None):
    cols = columns(path)
    use = [c for c in (requested or cols) if c in cols]
    if 'code' not in cols or 'date' not in cols: raise ValueError(f'Missing code/date: {path}')
    if path.suffix.lower() == '.parquet':
        f = pd.read_parquet(path, columns=use, filters=[('code', 'in', codes)] if codes else None)
    else:
        f = pd.read_csv(path, usecols=use, dtype={'code': str})
        if codes: f = f[f.code.isin(codes)]
    f['code'] = f.code.astype(str)
    f['date'] = pd.to_datetime(f.date, errors='raise').dt.strftime('%Y-%m-%d')
    if f[['code', 'date']].isna().any().any() or f.duplicated(['code', 'date']).any():
        raise ValueError(f'Missing or duplicate daily key: {path}')
    return f


def source_receipt(sources, profile, cfg, output):
    cache_path = output / 'source_hash_cache.json'
    cache = read(cache_path) if cache_path.exists() else {}
    paths = list(dict.fromkeys(p for seq in sources.values() for p in seq))
    paths += [Path(cfg[k]) for k in ('ipo_dates_csv', 'event_overrides') if cfg.get(k)]
    if profile['manifest']: paths.append(Path(profile['manifest']))
    receipt = {}
    for p in paths:
        stat = p.stat(); key = str(p.resolve()); old = cache.get(key, {})
        if old.get('size') != stat.st_size or old.get('mtime_ns') != stat.st_mtime_ns:
            old = {'sha256': file_hash(p), 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns}
            cache[key] = old
        receipt[key] = old['sha256']
    write(cache_path, cache)
    return receipt


def eligibility(amount, tradable, dates, first_dates, cfg, codes, excluded):
    dates = pd.DatetimeIndex(dates)
    first = pd.Series(pd.to_datetime(first_dates), index=codes)
    basis = pd.Series('observed_trade_proxy', index=codes)
    if cfg.get('ipo_dates_csv'):
        ipo = pd.read_csv(cfg['ipo_dates_csv'], dtype={'code': str})
        if ipo.code.duplicated().any(): raise ValueError('Duplicate listing date')
        official = pd.to_datetime(ipo.set_index('code').listing_date, errors='raise').reindex(codes)
        first = official.combine_first(first) if cfg.get('allow_observed_age_proxy', True) else official
        basis.loc[official.notna()] = 'official_ipo'
    elif not cfg.get('allow_observed_age_proxy', True): first[:] = pd.NaT
    basis.loc[first.isna()] = 'missing_excluded'
    anniversary = pd.DatetimeIndex(first) + pd.DateOffset(months=6)
    age = dates.to_numpy()[:, None] >= anniversary.to_numpy()[None, :]
    adv = pd.DataFrame(amount).rolling(5, min_periods=5).mean().to_numpy()
    allowed = ~np.isin(codes, excluded)
    pool = tradable & age & (adv > 3_000_000) & allowed[None, :]
    return pool, {'age_sources': basis.value_counts().to_dict(), 'excluded_codes': list(excluded),
                  'first_observed_trade': {c: str(d)[:10] for c, d in first.items()},
                  'daily_eligible': pool.sum(1).tolist(), 'amount_comparison': '> 3000000',
                  'listing_age': 'six calendar months', 'window': 't-4 through t, five market trading days'}


def build_marks(raw, cash, reinvest, dates, codes, folder, cfg):
    from engine.cash_coefficients import coefficients
    T = len(dates); N = len(codes)
    events = []; overrides = {}
    if cfg.get('event_overrides'):
        for row in read(cfg['event_overrides']):
            overrides[row['code'], row['date']] = row
    outputs = {}
    for mode, adjusted in (('cash', cash), ('reinvest', reinvest)):
        if adjusted is None: continue
        marks = np.lib.format.open_memmap(folder / (mode + '_marks.npy'), mode='w+', dtype='float64', shape=(T, N, 5 if mode == 'cash' else 4))
        marks[:] = np.nan
        for c, code in enumerate(codes):
            x = np.asarray(raw[c]); y = np.asarray(adjusted[c])
            trade = (x[:, 3] > 0) & np.isfinite(x[:, 3]) & (x[:, 4] > 0)
            if mode == 'reinvest':
                good = np.isfinite(y[:, 3]) & (y[:, 3] > 0) & np.isfinite(x[:, 3]) & (x[:, 3] > 0)
                marks[good, c, 0] = y[good, 3]; marks[good, c, 1] = y[good, 3]
                marks[:, c, 2] = trade & good; marks[:, c, 3] = ~(trade & good)
            else:
                z = np.asarray(reinvest[c]) if reinvest is not None else np.full_like(x, np.nan)
                a, b, kinds = coefficients(x, y, z)
                shares = 1.; total = 0.; previous = None
                marks[:, c, 4] = 0.
                for t in np.flatnonzero(np.isfinite(a)):
                    paid = 0.
                    if previous is not None:
                        q = a[t] / a[previous]; distribution = (b[t] - b[previous]) / a[previous]
                        original_q = q; original_d = distribution
                        tol = 1e-5 * max(x[previous, 3], q * x[t, 3]); category = 'vendor_inference'
                        override = overrides.get((code, dates[t]))
                        if override:
                            q, distribution = override['share_ratio'], override['cash_per_old_share']; category = 'provided_event_override'
                        elif distribution < -tol:
                            if q > 1.00001: q = 1.
                            distribution = 0.; category = 'declined_subscription_or_unfunded_debit'
                        else:
                            if abs(q - 1) < 1e-5: q = 1.
                            if abs(distribution) <= tol: distribution = 0.
                        if q <= 0 or distribution < 0: raise ValueError('Invalid share/cash event override')
                        paid = shares * distribution; total += paid; shares *= q
                        if abs(original_q - 1) > 1e-5 or abs(original_d) > tol or override:
                            events.append(dict(code=code, date=dates[t], vendor_q=original_q, vendor_cash=original_d,
                                               share_ratio=q, cash_per_old_share=distribution, category=category, coefficient_source=kinds[t]))
                    security = shares * x[t, 3]
                    marks[t, c] = [security + total, security, float(trade[t]), float(not trade[t]), paid]
                    previous = t
                marks[:, c, 2] = np.nan_to_num(marks[:, c, 2], nan=0.)
                marks[:, c, 3] = 1 - marks[:, c, 2]
            marks[:, c, :2] = pd.DataFrame(marks[:, c, :2]).ffill().to_numpy()
        marks.flush(); outputs[mode] = str(folder / (mode + '_marks.npy'))
    pd.DataFrame(events, columns=['code', 'date', 'vendor_q', 'vendor_cash', 'share_ratio', 'cash_per_old_share', 'category', 'coefficient_source']).to_csv(folder / 'cash_action_ledger.csv', index=False, encoding='utf-8-sig')
    return outputs


def prepare(cfg, output):
    sources, profile = discover(cfg)
    receipt = source_receipt(sources, profile, cfg, output)
    preparation_code = [Path(__file__), Path(__file__).parent / 'engine/cash_coefficients.py', Path(__file__).parent / 'standalone_utils.py']
    code_hash = {str(p.relative_to(Path(__file__).parent)): file_hash(p) for p in preparation_code}
    fingerprint = digest({'source': receipt, 'profile': profile, 'config': {k: cfg.get(k) for k in ('codes', 'end', 'ipo_dates_csv', 'allow_observed_age_proxy', 'event_overrides')}, 'engine': code_hash})[:24]
    folder = output / 'datasets' / fingerprint
    if (folder / 'complete.json').exists():
        result = read(folder / 'complete.json')
        for name, sha in result['prepared_sha256'].items():
            if file_hash(folder / name) != sha: raise ValueError('Prepared data changed: ' + name)
        return result
    folder.mkdir(parents=True, exist_ok=True)
    codes = set(); dates = set()
    for p in sources['raw']:
        f = load_frame(p, ['code', 'date'])
        codes.update(f.code.unique()); dates.update(f.date.unique())
    if cfg.get('codes'): codes &= set(cfg['codes'])
    if not codes: raise ValueError('No requested securities in raw data')
    codes = sorted(codes); dates = sorted(d for d in dates if not cfg.get('end') or d <= cfg['end'])
    if len(dates) < 24: raise ValueError('At least 24 market dates required')
    N, T = len(codes), len(dates); ci = {c: i for i, c in enumerate(codes)}; di = {d: i for i, d in enumerate(dates)}
    arrays = {}; mode_errors = dict(profile.get('mode_errors', {})); available = {}
    amount = np.lib.format.open_memmap(folder / 'amount.npy', mode='w+', dtype='float64', shape=(T, N)); amount[:] = np.nan
    turnover = np.lib.format.open_memmap(folder / 'turnoverRatio.npy', mode='w+', dtype='float64', shape=(T, N)); turnover[:] = np.nan
    for mode, paths in sources.items():
        if not paths: mode_errors.setdefault(mode, '缺少此复权口径日线'); continue
        try:
            target = np.lib.format.open_memmap(folder / (mode + '_inputs.npy'), mode='w+', dtype='float64', shape=(N, T, 6)); target[:] = np.nan
            seen = np.zeros((N, T), bool); fields_present = set()
            for p in paths:
                if not set(['code', 'date', 'open', 'high', 'low', 'close']).issubset(columns(p)):
                    raise ValueError('Missing OHLC columns in ' + str(p))
                if mode == 'raw' and not {'amount', 'volume'}.issubset(columns(p)):
                    raise ValueError('Raw amount and volume are required: ' + str(p))
                f = load_frame(p, ['code', 'date', *PRICE_FIELDS, 'amount', 'turnoverRatio'], codes)
                f = f[f.date.isin(di)]
                rows = f.code.map(ci).to_numpy(dtype=int); cols = f.date.map(di).to_numpy(dtype=int)
                if seen[rows, cols].any(): raise ValueError('Duplicate code/date across input shards')
                seen[rows, cols] = True
                for k, field in enumerate(PRICE_FIELDS):
                    if field not in f: continue
                    vals = pd.to_numeric(f[field], errors='raise').to_numpy(dtype=float, copy=True)
                    vals[~np.isfinite(vals) | (vals < 0 if field == 'volume' else vals <= 0)] = np.nan
                    target[rows, cols, k] = vals
                    if np.isfinite(vals).any(): fields_present.add(field)
                if mode == 'raw':
                    for name, dst in [('amount', amount), ('turnoverRatio', turnover)]:
                        if name in f:
                            vals = pd.to_numeric(f[name], errors='raise').to_numpy(dtype=float, copy=True)
                            vals[~np.isfinite(vals) | (vals < 0)] = np.nan
                            dst[cols, rows] = vals
                            if np.isfinite(vals).any(): fields_present.add(name)
                print(f'Loaded {mode}: {p.name}, {len(f):,} rows', flush=True)
            target.flush(); arrays[mode] = target; available[mode] = sorted(fields_present)
        except Exception as exc:
            if mode == 'raw': raise
            mode_errors[mode] = f'{type(exc).__name__}: {exc}'
        gc.collect()
    amount.flush(); turnover.flush()
    raw = arrays['raw']; tradable = (raw[:, :, 3].T > 0) & np.isfinite(raw[:, :, 3].T) & (raw[:, :, 4].T > 0)
    first = [dates[int(np.flatnonzero(tradable[:, c])[0])] if tradable[:, c].any() else None for c in range(N)]
    pool, pool_info = eligibility(amount, tradable, dates, first, cfg, codes, profile['excluded_codes'])
    np.save(folder / 'pool.npy', pool)
    marks = build_marks(raw, arrays.get('cash'), arrays.get('reinvest'), dates, codes, folder, cfg)
    write(folder / 'axes.json', {'dates': dates, 'codes': codes}); write(folder / 'pool.json', pool_info)
    result = dict(folder=str(folder), fingerprint=fingerprint, axes={'dates': dates, 'codes': codes},
                  receipt=receipt, profile=profile, available_fields=available, mode_errors=mode_errors, marks=marks,
                  pool=pool_info, cash_policy='causal_daily_affine_inference_no_subscription',
                  prepared_sha256={p.name: file_hash(p) for p in folder.glob('*.npy')})
    write(folder / 'complete.json', result)
    return result


def factor_fields(dataset, mode):
    folder = Path(dataset['folder'])
    raw = np.load(folder / 'raw_inputs.npy', mmap_mode='r')
    adj = np.load(folder / (mode + '_inputs.npy'), mmap_mode='r')
    fields = {k: adj[:, :, i].T for i, k in enumerate(PRICE_FIELDS[:4])}
    raw_fields = dataset['available_fields']['raw']
    for k, i in [('volume', 4), ('preClose', 5)]:
        if k in raw_fields: fields[k] = raw[:, :, i].T
    for k in ('amount', 'turnoverRatio'):
        if k in raw_fields: fields[k] = np.load(folder / (k + '.npy'), mmap_mode='r')
    for i, k in enumerate(PRICE_FIELDS[:4]): fields['raw_' + k] = raw[:, :, i].T
    with np.errstate(all='ignore'):
        fields['vwap'] = np.divide(fields['amount'], fields['volume'], out=np.full(fields['amount'].shape, np.nan), where=fields['volume'] > 0)
    return fields
