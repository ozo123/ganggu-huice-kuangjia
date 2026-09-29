"""Behavioral regression tests for financial and selection invariants."""
import tempfile
from pathlib import Path
import unittest
import json
import subprocess
import sys
import numpy as np
import pandas as pd
from daily_data import eligibility, build_marks
from factor_contract import admit, compute, causality_check
from backtest_core import grouping, compute_ic, oriented_ic, cohort_paths, setting
from select_factors import greedy_independent_set, select_slice


class Regression(unittest.TestCase):
    def test_winsorized_ic_against_scipy_and_pairwise_sample(self):
        from engine.ic import winsorized_pair_ic
        from scipy.stats import pearsonr, spearmanr
        rng = np.random.default_rng(42)
        x = rng.normal(size=120); y = .2*x + rng.normal(size=120)
        x[0] = 1e12; y[1] = -1e14
        x[2] = np.nan; y[3] = np.inf
        before_x=x.copy(); before_y=y.copy()
        ok = np.isfinite(x) & np.isfinite(y)
        xx=np.clip(x[ok], *np.quantile(x[ok],[.01,.99]))
        yy=np.clip(y[ok], *np.quantile(y[ok],[.01,.99]))
        p,r,n=winsorized_pair_ic(x,y)
        self.assertEqual(n,118)
        self.assertAlmostEqual(p,pearsonr(xx,yy).statistic,places=12)
        self.assertAlmostEqual(r,spearmanr(xx,yy).statistic,places=12)
        np.testing.assert_equal(x,before_x); np.testing.assert_equal(y,before_y)
        self.assertTrue(np.isnan(winsorized_pair_ic(x[:19],y[:19])[0]))
        self.assertTrue(np.isnan(winsorized_pair_ic(np.ones(120),y)[1]))
        p2,r2,_=winsorized_pair_ic(-x,y)
        self.assertAlmostEqual(p2,-p,places=12); self.assertAlmostEqual(r2,-r,places=12)


    def test_standalone_cli_partial_mode_and_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'source'; source.mkdir()
            T, N = 70, 40
            dates = pd.bdate_range('2024-01-01', periods=T).strftime('%Y-%m-%d')
            codes = [f'{i:04d}.HK' for i in range(N)]
            price = 100*np.exp(np.arange(T)[:, None]*np.linspace(-.005, .005, N)[None, :])
            frame = pd.DataFrame({'date': np.repeat(dates, N), 'code': np.tile(codes, T), 'open': price.ravel(),
                                  'high': price.ravel()*1.01, 'low': price.ravel()*.99, 'close': price.ravel(),
                                  'volume': 1_000_000., 'amount': 50_000_000.})
            frame.to_parquet(source / 'raw.parquet', index=False); frame.to_parquet(source / 'reinvest.parquet', index=False)
            (source / 'manifest.json').write_text(json.dumps({'currency': 'HKD', 'amount_unit': 'HKD', 'files': {'raw': ['raw.parquet'], 'cash': ['missing_cash.parquet'], 'reinvest': ['reinvest.parquet']}}))
            pd.DataFrame({'code': codes, 'listing_date': '2000-01-01'}).to_csv(root / 'ipo.csv', index=False)
            (root / 'future.py').write_text('import numpy as np\ndef compute(fields, parameters):\n    return np.roll(fields["close"], -1, axis=0)\n')
            factors = [
                {'id': 'negative', 'definition': 'Negative price', 'expression': '-close'},
                {'id': 'future', 'definition': 'Intentionally invalid future field', 'python': 'future.py', 'required_fields': ['close']},
                {'id': 'constant', 'definition': 'Constant signal', 'expression': 'close*0+1'},
                {'id': 'missing', 'definition': 'Missing minute data', 'expression': 'minute_price'}]
            (root / 'factors.json').write_text(json.dumps(factors))
            config = {'data_root': str(source), 'data_manifest': 'manifest.json', 'factors': str(root / 'factors.json'),
                      'output': str(root / 'out'), 'ipo_dates_csv': str(root / 'ipo.csv'), 'allow_observed_age_proxy': False}
            (root / 'config.json').write_text(json.dumps(config))
            cmd = [sys.executable, '-X', 'utf8', str(Path(__file__).with_name('run.py')), 'run', '--config', str(root / 'config.json')]
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', cwd=root)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads((root / 'out/latest-run.json').read_text(encoding='utf-8'))
            self.assertEqual(len(state['records']), 4)
            self.assertEqual(state['config']['correlation_method'], 'spearman')
            self.assertEqual(state['correlation']['method_spec'], state['config']['factor_correlation'])
            self.assertEqual(state['selection']['factor_correlation'], state['config']['factor_correlation'])
            report = json.loads((root / 'out/report-input.json').read_text(encoding='utf-8'))
            self.assertTrue(report['correlations'])
            for matrix in report['correlations']:
                self.assertEqual(matrix['method'], state['correlation']['method'])
            for rec in state['records']: self.assertEqual(len(rec['settings']), 6)
            rec = state['records'][0]
            payload = json.loads((Path(rec['path']) / 'payload_reinvest.json').read_text(encoding='utf-8'))
            self.assertEqual(payload['factor_correlation'], state['config']['factor_correlation'])
            for h in (1, 5, 21):
                self.assertEqual(rec['settings'][f'cash__{h}']['status'], 'blocked_data')
                self.assertEqual(rec['settings'][f'reinvest__{h}']['direction_multiplier'], -1)
                self.assertGreater(rec['settings'][f'reinvest__{h}']['ic_mean'], .99)
            self.assertEqual(state['records'][1]['settings']['reinvest__1']['status'], 'failed')
            self.assertIn('prefix', state['records'][1]['settings']['reinvest__1']['reason'])
            self.assertEqual(state['records'][3]['settings']['reinvest__1']['status'], 'blocked_data')
            series = Path(rec['path']) / 'series_reinvest_1.parquet'; original_time = series.stat().st_mtime_ns
            second = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', cwd=root)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(series.stat().st_mtime_ns, original_time)
            verification = json.loads((root / 'out/verification.json').read_text(encoding='utf-8'))
            self.assertTrue(verification['passed'])

    def test_pool_boundary_and_calendar_months(self):
        dates = pd.bdate_range('2024-07-22', '2024-08-02')
        amount = np.full((len(dates), 4), 4_000_000.)
        amount[:, 0] = 3_000_000
        amount[-1, 1] = np.nan
        amount[-1, 2] = 0  # average 3.2m, known zero remains in the denominator
        pool, _ = eligibility(amount, np.ones_like(amount, bool), dates, ['2024-01-31'] * 4, {}, ['a', 'b', 'c', 'd'], [])
        self.assertFalse(pool[dates < '2024-07-31'].any())
        self.assertFalse(pool[:, 0].any())
        self.assertFalse(pool[-1, 1]); self.assertTrue(pool[-1, 2]); self.assertTrue(pool[-1, 3])

    def test_ties_not_arbitrarily_split(self):
        g = grouping(np.ones((2, 40)))
        self.assertEqual(len(np.unique(g)), 1)
        self.assertNotIn(20, np.unique(g))

    def test_fields_and_future_dependence(self):
        self.assertEqual(admit({'definition': 'flow', 'expression': 'flow', 'required_fields': ['flow']}, {'close'})['status'], 'blocked_data')
        fields = {'close': np.arange(200.).reshape(50, 4) + 1}
        causal = {'id': 'x', 'expression': 'close / lag(close, 3) - 1'}
        causality_check(causal, fields, compute(causal, fields))
        with self.assertRaises(ValueError): compute({'expression': 'lag(close, -1)'}, fields)
        with self.assertRaises(ValueError): causality_check({'expression': 'close'}, fields, fields['close'] / fields['close'].mean())

    def test_greedy_prefers_more_factors_than_a_hub(self):
        graph = {'a': {'b', 'c', 'd'}, 'b': {'a'}, 'c': {'a'}, 'd': {'a'}}
        self.assertEqual(greedy_independent_set(graph, graph), ['b', 'c', 'd'])

    def test_threshold_order_and_no_backfill(self):
        records = [{'id': i, 'name': i, 'settings': {'cash__1': {'status': 'completed', 'ic_mean': ic, 'active_entries': 5}}} for i, ic in [('a', .009), ('b', .2), ('c', .01)]]
        corr = {'ids': ['a', 'b', 'c'], 'modes': {'cash': {'matrix': [[1, .99, .8], [.99, 1, .8], [.8, .8, 1]], 'days': [[10]*3]*3}}}
        result = select_slice(records, 'cash', 1, corr)
        self.assertEqual(result['correlation_retained'], ['a', 'c'])
        self.assertEqual(result['retained'], ['c'])
        self.assertEqual(result['rows'][1]['status'], 'correlated')

    def test_negative_and_missing_correlations(self):
        records = [{'id': i, 'name': i, 'settings': {'cash__1': {'status': 'completed', 'ic_mean': .1, 'active_entries': 5}}} for i in ['a', 'b']]
        for rho, months in [(-.9, 5), (None, 0)]:
            corr = {'ids': ['a', 'b'], 'modes': {'cash': {'matrix': [[1, rho], [rho, 1]], 'days': [[5, months], [months, 5]]}}}
            result = select_slice(records, 'cash', 1, corr)
            self.assertEqual(len(result['retained']), 1)
            self.assertEqual(result['rows'][1]['status'], 'correlated' if rho is not None else 'insufficient_correlation')

    def test_cash_dividend_and_split_ledger(self):
        close = np.array([100., 98., 50., 51.])
        raw = np.zeros((1, 4, 6))
        for i in range(4): raw[0, i] = [close[i], close[i]*1.01, close[i]*.99, close[i], 1000, close[i]]
        cash = raw.copy()
        cash[0, 1, :4] = raw[0, 1, :4] + 2
        cash[0, 2:, :4] = 2*raw[0, 2:, :4] + 2
        reinvest = raw.copy()
        dates = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']
        with tempfile.TemporaryDirectory() as tmp:
            result = build_marks(raw, cash, reinvest, dates, ['x'], Path(tmp), {})
            marks = np.load(result['cash'])
            np.testing.assert_allclose(marks[:, 0, 1], [100, 98, 100, 102])
            np.testing.assert_allclose(marks[:, 0, 4], [0, 2, 0, 0], atol=1e-10)
            self.assertAlmostEqual((marks[1, 0, 1]-marks[0, 0, 1]+marks[1, 0, 4])/100, 0)

    def test_actual_fee_cash_identity_and_rolling_holds(self):
        T, N = 48, 40
        marks = np.ones((T, N, 4)); marks[:, :, 3] = 0
        groups = grouping(np.tile(np.arange(N), (T, 1)))
        ctx = cohort_paths(groups, marks)
        from engine.groups import simulate_groups
        for h in (1, 5, 21):
            nv, _, _, _, _ = simulate_groups(*ctx[:4], h, .002)
            self.assertAlmostEqual(nv[1, 0], (h-1)/h + 1/h/(1+.002), places=12)
        nv, _, _, _, _ = simulate_groups(*ctx[:4], 1, .002)
        self.assertAlmostEqual(nv[2, 0], (1-.002)/(1+.002)**2, places=12)

    def test_ic_flip_recomputes_the_portfolio(self):
        T, N = 65, 40; dates = pd.bdate_range('2024-01-01', periods=T).strftime('%Y-%m-%d').tolist()
        prices = np.exp(np.arange(T)[:, None] * np.linspace(-.01, .01, N)[None, :])
        marks = np.ones((T, N, 4)); marks[:, :, 0] = prices; marks[:, :, 1] = prices; marks[:, :, 3] = 0
        signal = np.tile(-np.arange(N, dtype=float), (T, 1))
        sums, frame = compute_ic(signal, marks)
        for h in (1, 5, 21):
            sign, before, ic, part = oriented_ic(sums, frame, h)
            self.assertEqual(sign, -1); self.assertLess(before, -.99); self.assertGreater(ic['rank']['mean'], .99)
            groups = grouping(sign * signal)
            np.testing.assert_array_equal(groups[:, -1], np.full(T, 20))
            entry, _, daily = setting('test', 'reinvest', h, dates, groups, cohort_paths(groups, marks), ic, part, sign, before)
            self.assertGreater(entry['ls']['annualized_return'], 0)
            self.assertNotEqual(entry['ls']['sharpe'], entry['gross_ls']['sharpe'])
            self.assertEqual(entry['capital_review']['post_cap_over100_days'], 0)
            self.assertTrue(np.all(daily.ls_fee >= 0))


if __name__ == '__main__': unittest.main(verbosity=2)
