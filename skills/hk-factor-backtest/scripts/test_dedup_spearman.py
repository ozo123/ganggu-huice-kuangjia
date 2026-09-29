"""Behavioral checks for rank-based factor deduplication and its saved method."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from scipy.stats import pearsonr, spearmanr

from engine.ic import exact_correlations, FACTOR_CORRELATION
from run import configuration
from select_factors import select_slice
from single_factor_from_state import publish


class SpearmanDedup(unittest.TestCase):
    def select_pair(self, matrix, counts):
        records = [{'id': fid, 'name': fid, 'settings': {'cash__20': {
            'status': 'completed', 'ic_mean': .1, 'active_entries': 5,
        }}} for fid in ['a', 'b']]
        corr = {'ids': ['a', 'b'], 'modes': {'cash': {
            'matrix': matrix.tolist(), 'days': counts.tolist(),
        }}}
        return select_slice(records, 'cash', 20, corr)

    def test_nonlinear_duplicates_are_removed_in_both_directions(self):
        x = np.linspace(0, 1, 100)
        y = np.exp(10*x)
        self.assertLess(abs(pearsonr(x, y).statistic), .8)
        for sign in [1, -1]:
            values = np.stack([x, sign*y])[:, None, :]
            original = values.copy()
            matrix, counts, overlap = exact_correlations(values)
            self.assertAlmostEqual(matrix[0, 1], sign, places=12)
            self.assertEqual(counts[0, 1], 1)
            self.assertEqual(overlap[0, 1], 100)
            result = self.select_pair(matrix, counts)
            self.assertEqual(result['correlation_retained'], ['a'])
            self.assertEqual(result['rows'][1]['status'], 'correlated')
            np.testing.assert_equal(values, original)

    def test_pairwise_ties_missing_and_extreme_values_match_scipy(self):
        rng = np.random.default_rng(528)
        values = rng.normal(size=(6, 3, 200))
        values[0] = np.round(values[0], 0)
        values[1, :, :30] = np.nan
        values[2, :, 40:75] = np.inf
        values[3, :, 40:75] = np.inf  # Exercise shared finite-mask buckets.
        values[3, :, -5:] *= 1e200
        values[4] = 1.0
        values[5, 0] = np.nan
        original = values.copy()
        matrix, counts, overlap = exact_correlations(values)
        for i in range(len(values)):
            for j in range(len(values)):
                rhos, sizes = [], []
                for d in range(values.shape[1]):
                    valid = np.isfinite(values[i, d]) & np.isfinite(values[j, d])
                    x, y = values[i, d, valid], values[j, d, valid]
                    if len(x) < 20 or np.unique(x).size < 2 or np.unique(y).size < 2:
                        continue
                    rhos.append(spearmanr(x, y).statistic)
                    sizes.append(len(x))
                self.assertEqual(counts[i, j], len(rhos))
                if rhos:
                    self.assertAlmostEqual(matrix[i, j], np.mean(rhos), places=12)
                    self.assertAlmostEqual(overlap[i, j], np.mean(sizes), places=12)
                else:
                    self.assertTrue(np.isnan(matrix[i, j]))
                    self.assertTrue(np.isnan(overlap[i, j]))
        np.testing.assert_equal(values, original)

    def test_average_signed_months_equally_before_absolute_threshold(self):
        x = np.arange(40, dtype=float)
        values = np.stack([np.stack([x, x, x]), np.stack([x, -x, x])])
        values[1, 0, 20:] = np.nan  # 20 stocks in month one; 40 in month two.
        values[1, 2] = np.nan
        matrix, counts, overlap = exact_correlations(values)
        self.assertAlmostEqual(matrix[0, 1], 0, places=12)
        self.assertEqual(counts[0, 1], 2)
        self.assertEqual(overlap[0, 1], 30)
        self.assertEqual(self.select_pair(matrix, counts)['retained'], ['a', 'b'])

    def test_twenty_stock_boundary_and_constant_intersection(self):
        x = np.arange(40, dtype=float)
        y = x.copy()
        y[19:] = np.nan
        matrix, counts, _ = exact_correlations(np.stack([x, y])[:, None, :])
        self.assertTrue(np.isnan(matrix[0, 1]))
        self.assertEqual(counts[0, 1], 0)
        y[19] = x[19]
        matrix, counts, _ = exact_correlations(np.stack([x, y])[:, None, :])
        self.assertAlmostEqual(matrix[0, 1], 1)
        self.assertEqual(counts[0, 1], 1)
        x[:20] = 1  # The factor varies globally, but is constant on this pair.
        matrix, counts, _ = exact_correlations(np.stack([x, y])[:, None, :])
        self.assertTrue(np.isnan(matrix[0, 1]))
        self.assertEqual(counts[0, 1], 0)

    def test_configuration_defaults_and_rejects_other_methods(self):
        cfg = configuration(argparse.Namespace(config=None))
        self.assertEqual(cfg['correlation_method'], 'spearman')
        self.assertEqual(cfg['factor_correlation'], FACTOR_CORRELATION)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'config.json'
            for override in [
                {'correlation_method': 'pearson'},
                {'factor_correlation': {**FACTOR_CORRELATION, 'method': 'pearson'}},
                {'factor_correlation': {**FACTOR_CORRELATION, 'rank_method': 'ordinal'}},
                {'factor_correlation': {**FACTOR_CORRELATION, 'winsorize': True}},
            ]:
                path.write_text(json.dumps(override), encoding='utf-8')
                with self.assertRaises(ValueError):
                    configuration(argparse.Namespace(config=path))

    def test_report_preserves_historical_and_unknown_correlation_methods(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            for method in ['Historical raw Pearson', 'Saved Spearman', None]:
                state = {'config': {}, 'records': [{
                    'id': 'a', 'name': 'a', 'path': str(base/'missing'),
                    'settings': {'cash__20': {'status': 'completed'}},
                }], 'correlation': {'ids': ['a'], 'modes': {'cash': {'matrix': [[1.0]]}}}}
                if method is not None:
                    state['correlation']['method'] = method
                original = copy.deepcopy(state)
                publish(state, base)
                data = json.loads((base/'report-input.json').read_text(encoding='utf-8'))
                reported = data['correlations'][0]['method']
                if method is not None:
                    self.assertEqual(reported, method)
                else:
                    self.assertNotIn('Spearman', reported)
                    self.assertNotIn('Pearson', reported)
                self.assertEqual(state, original)


if __name__ == '__main__':
    unittest.main(verbosity=2)
