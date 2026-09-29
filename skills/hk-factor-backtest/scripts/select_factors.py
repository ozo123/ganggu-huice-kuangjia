"""Cardinality-first greedy independent sets, followed by the IC threshold."""
from itertools import combinations
import math
import numpy as np


def finite(x): return x is not None and math.isfinite(float(x))


def greedy_independent_set(ids, adjacency):
    """Minimum residual degree, multiple deterministic starts, 1-for-2 improvements.

    Produces a maximal independent set, not a guaranteed maximum independent set.
    No IC or portfolio return is used when choosing among equal-cardinality sets.
    """
    ids = set(ids)
    if not ids: return []
    components = []; unseen = set(ids)
    while unseen:
        todo = [min(unseen)]; component = set()
        while todo:
            node = todo.pop()
            if node not in unseen: continue
            unseen.remove(node); component.add(node)
            todo.extend(adjacency[node] & unseen)
        components.append(component)

    def fill(kept, nodes):
        remaining = nodes - kept - set().union(*(adjacency[i] for i in kept)) if kept else set(nodes)
        while remaining:
            v = min(remaining, key=lambda i: (len(adjacency[i] & remaining), i))
            kept.add(v); remaining -= {v} | adjacency[v]
        return kept

    chosen = set()
    for nodes in components:
        best = fill(set(), nodes)
        starts = sorted(nodes, key=lambda i: (len(adjacency[i] & nodes), i))[:64]
        for first in starts:
            candidate = fill({first}, nodes)
            if (-len(candidate), sorted(candidate)) < (-len(best), sorted(best)): best = candidate
        changed = True
        while changed:
            changed = False
            for old in sorted(best):
                candidates = sorted(i for i in nodes - best if adjacency[i] & best == {old})
                swap = next(((a, b) for a, b in combinations(candidates, 2) if b not in adjacency[a]), None)
                if swap:
                    best = fill((best - {old}) | set(swap), nodes); changed = True; break
        chosen |= best
    assert all(not (adjacency[i] & chosen) for i in chosen)
    assert all(adjacency[i] & chosen for i in ids - chosen)
    return sorted(chosen)


def select_slice(records, mode, hold, corr, threshold=.8, min_ic=.01, min_months=1):
    keys = corr['ids']; lookup = {fid: i for i, fid in enumerate(keys)}
    cm = corr['modes'].get(mode, {})
    matrix = cm.get('matrix', []); months = cm.get('days', [])
    ready = {}; decisions = {}
    for rec in records:
        fid = rec['id']; result = rec.get('settings', {}).get(f'{mode}__{hold}')
        if not result or result['status'] != 'completed':
            decisions[fid] = {'status': 'not_evaluable', 'reason': (result or rec).get('reason', '此设置未完成或缺少数据')}
            continue
        i = lookup.get(fid)
        if len(keys) > 1 and (i is None or not matrix or not finite(matrix[i][i]) or months[i][i] < min_months):
            decisions[fid] = {'status': 'insufficient_correlation', 'reason': '因子常数或相关性有效截面不足'}
        else: ready[fid] = result
    adjacency = {fid: set() for fid in ready}
    for a, b in combinations(sorted(ready), 2):
        i, j = lookup[a], lookup[b]; rho = matrix[i][j]
        unknown = not finite(rho) or months[i][j] < min_months
        if unknown or abs(rho) > threshold:
            adjacency[a].add(b); adjacency[b].add(a)
    retained = set(greedy_independent_set(ready, adjacency))
    for fid, result in ready.items():
        if fid not in retained:
            conflicts = sorted(adjacency[fid] & retained)
            pairs = [{'factor_id': other, 'rho': matrix[lookup[fid]][lookup[other]], 'months': months[lookup[fid]][lookup[other]]} for other in conflicts]
            high = any(finite(p['rho']) and abs(p['rho']) > threshold and p['months'] >= min_months for p in pairs)
            decisions[fid] = {'status': 'correlated' if high else 'insufficient_correlation', 'reason': '贪心去重：与保留因子 |ρ| > 0.8' if high else '共同样本不足，无法确认非冗余', 'blocked_by': pairs}
        elif not result.get('active_entries'):
            decisions[fid] = {'status': 'no_entries', 'reason': '无有效双边开仓'}
        elif not finite(result.get('ic_mean')):
            decisions[fid] = {'status': 'insufficient_ic', 'reason': '有效 IC 观测不足'}
        elif result['ic_mean'] < min_ic:
            decisions[fid] = {'status': 'low_ic', 'reason': '定向后平均 Rank IC < 0.01'}
        else: decisions[fid] = {'status': 'selected', 'reason': '通过相关性去重及定向后 IC ≥ 0.01'}
    rows = []
    for rec in records:
        result = rec.get('settings', {}).get(f'{mode}__{hold}', {})
        rows.append({'factor_id': rec['id'], 'name': rec['name'], **result, **decisions[rec['id']]})
    selected = [r['factor_id'] for r in rows if r['status'] == 'selected']
    return dict(rows=rows, retained=selected, correlation_retained=sorted(retained),
                n_input=len(records), n_retained=len(selected), n_after_correlation=len(retained),
                algorithm='minimum-degree multistart greedy + 1-for-2 local improvement; maximal, not guaranteed maximum',
                order='correlation_then_oriented_ic; no refill after IC filtering', min_ic=min_ic, correlation_threshold=threshold)
