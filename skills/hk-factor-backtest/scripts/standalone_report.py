"""Offline report built from the user's existing TA-Lib SVG visualization assets."""
from pathlib import Path
import html
import json
import os
import shutil
import numpy as np
from standalone_utils import ROOT, MODES, HOLDS, read, write, clean, atomic_text


def esc(x): return html.escape(str(x), quote=True)


def calculation_details(spec, display=None):
    """Display metadata only; never replace frozen numerical definitions."""
    display = display or {}
    formula = display.get('display_formula') or spec.get('display_formula') or spec.get('expression') or spec.get('definition') or spec.get('source_formula')
    return dict(formula=formula or '未提供完整公式；请查看定义缺口。',
                method=display.get('calculation_method', spec.get('calculation_method', spec.get('definition', ''))),
                parameters=display.get('display_parameters', spec.get('display_parameters', spec.get('parameters', {}))),
                notes=display.get('calculation_notes', spec.get('calculation_notes', [])),
                fields=spec.get('required_fields', []), prior_direction=spec.get('direction', 1))


def overview(records):
    slices = {}; series = []
    for mode in MODES:
        for h in HOLDS:
            valid = [dict(r['settings'][f'{mode}__{h}'], name=r['name']) for r in records if r['settings'].get(f'{mode}__{h}', {}).get('annualized_return') is not None and r['settings'].get(f'{mode}__{h}', {}).get('ic_mean') is not None]
            def median(k):
                a = [r[k] for r in valid if r.get(k) is not None]
                return float(np.median(a)) if a else None
            def ranked(r): return {'factor_id': r['factor_id'], 'function': esc(r['name']), 'output': 'IC 定向', 'group': '给定因子', 'alpha': r['annualized_return'], 'ic': r['ic_mean'], 'nav': r['final_nav']}
            ordered = sorted(valid, key=lambda r: r['annualized_return'], reverse=True)
            s = dict(mode=mode, hold_days=h, n_factors=len(records), n_valid=len(valid), positive_count=sum(r['annualized_return'] > 0 for r in valid),
                     positive_share=sum(r['annualized_return'] > 0 for r in valid) / len(valid) if valid else None,
                     median_alpha=median('annualized_return'), gross_median_alpha=median('gross_annualized_return'), median_ic=median('ic_mean'),
                     median_abs_t=median('ic_tstat'), median_nav=median('final_nav'), fee_annualized=median('annualized_fee_rate'), nonpositive_count=sum(r.get('bankrupt', False) for r in valid),
                     points=[{'id': r['factor_id'], 'g': 0, 'a': r['annualized_return'], 'i': r['ic_mean'], 't': r['ic_tstat'], 'n': r['final_nav']} for r in valid],
                     top=[ranked(r) for r in ordered[:10]], bottom=[ranked(r) for r in reversed(ordered[-10:])])
            slices[f'{mode}__{h}'] = s
            series.append({k: s[k] for k in ('mode', 'hold_days', 'median_alpha', 'gross_median_alpha', 'fee_annualized', 'n_valid')})
    return {'groups': ['给定因子'], 'slices': slices, 'series': series, 'strategies_total': len(records) * 6, 'nonpositive_total': sum(s['nonpositive_count'] for s in slices.values())}


def js_assignment(key, value):
    return 'window.' + key + '=' + json.dumps(clean(value), ensure_ascii=False, allow_nan=False, separators=(',', ':')).replace('<', '\\u003c') + ';'


def publish(state, output):
    assets = output / 'assets'; data = output / 'data'; assets.mkdir(exist_ok=True); data.mkdir(exist_ok=True)
    catalog = []
    descriptions_path = output / 'factor_descriptions.json'
    descriptions = read(descriptions_path) if descriptions_path.exists() else {}
    for rec in state['records']:
        payload = {'factor_id': rec['id'], 'function': esc(rec['name']), 'output_name': '定向因子', 'group': '给定因子', 'modes': {},
                   'assumptions': [esc(rec['spec']['definition'])] if rec['spec'].get('definition') else [],
                   'audit_path': Path(os.path.relpath(rec['path'], output)).as_posix()}
        for mode in MODES:
            p = Path(rec['path']) / f'payload_{mode}.json'
            if p.exists():
                valid = {h: entry for h, entry in read(p)['modes'].get(mode, {}).items() if rec['settings'].get(f'{mode}__{h}', {}).get('status') == 'completed'}
                if valid: payload['modes'][mode] = valid
        catalog.append({'id': rec['id'], 'name': esc(rec['name']), 'function': esc(rec['name']), 'group': '给定因子', 'output': 'IC 定向',
                        'modes': list(payload['modes']), 'settings': [f'{m}__{h}' for m, rows in payload['modes'].items() for h in rows],
                        'parameters': rec['spec'].get('parameters', {}), 'lookback': rec['spec'].get('lookback'),
                        'calculation': calculation_details(rec['spec'], descriptions.get(rec['id']))})
        if payload['modes']: atomic_text(data / ('v2_' + rec['id'] + '.js'), js_assignment('HK_V2_FACTOR', payload))
    dates = state['dates']; ds = state['dataset']
    meta = {'dateStart': dates[0], 'dateEnd': dates[-1], 'nSymbols': len(ds['axes']['codes']), 'nDates': len(dates), 'feeOneWay': .002,
            'modeLabels': {'cash': '后复权现金分红', 'reinvest': '后复权分红再投'}}
    inline = ''.join('<script>' + js_assignment(key, value) + '</script>' for key, value in (
        ('HK_INDEX', {'factors': catalog, 'meta': meta}), ('HK_OVERVIEW_V2', overview(state['records'])),
        ('HK_CORR_V2', state['correlation']), ('HK_FILTER', state['selection']), ('HK_AUDIT', {})))
    charts = (ROOT / 'assets/standalone-charts.html').read_text(encoding='utf-8')
    proxy = ds['pool']['age_sources'].get('observed_trade_proxy', 0)
    ipo_text = f'{proxy} 只使用首次有效成交日起六个月代理，正式上市日未提供。' if proxy else '上市日依据见股票池数据回执。'
    ic_note = ('IC：因子与未来收益在每日共同有效截面分别按1%/99%缩尾；Rank IC在缩尾后取平均秩。原IC表示定向前IC。' if state['config'].get('ic_winsorize') else '历史结果：未记录IC缩尾口径，需重新运行回测才能使用新规则。')
    head = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>港股因子回测与检验</title><link rel="stylesheet" href="assets/dashboard.css"><link rel="stylesheet" href="assets/standalone.css"></head><body><div class="page">
<header class="masthead"><div class="eyebrow"><span>HK FACTOR RESEARCH</span><span id="eyebrow-range"></span></div><div class="head"><div><h1>因子回测与检验</h1><p class="standfirst">全部结果 → 相关性去重 → IC 筛选。六种设置独立定向、回测与归类。</p></div><details><summary>实验设定与数据</summary><dl class="specs" id="specs"></dl><p>{esc(ipo_text)}</p><p>数据目录：{esc(state['config']['data_root'])}</p></details></div></header>
<nav class="viewbar" aria-label="报告三部分"><div role="tablist" aria-label="报告章节"><button type="button" role="tab" data-view="overview" aria-selected="true">01 总览</button><button type="button" role="tab" data-view="selected" aria-selected="false">02 好因子</button><button type="button" role="tab" data-view="rejected" aria-selected="false">03 无效因子</button></div><div class="controls"><label class="field">复权口径<select id="view-mode"><option value="reinvest">后复权分红再投</option><option value="cash">后复权现金分红</option></select></label><label class="field">滚动持仓<select id="view-hold"><option>1</option><option>5</option><option selected>21</option></select></label></div></nav>
<p class="orientation-note">{ic_note}</p>
<p class="orientation-note">全样本 IC 定向：平均 IC 为负时翻转信号并重跑分组及多空组合。以下为事后定向、样本内筛选结果。</p>
<main><section id="screening" class="section" hidden><div class="section-head"><div><h2 id="screening-title"></h2><p id="screening-sub"></p></div></div><p id="screening-count"></p><div class="scroll"><table><thead><tr><th>因子</th><th>年化净收益</th><th>净夏普</th><th>毛夏普</th><th>原 IC</th><th>定向 IC</th><th>方向</th><th>筛选结果</th></tr></thead><tbody id="screening-rows"></tbody></table></div></section>'''
    tail = '''</main><nav class="audit-links"><a href="summary.csv">全部分组及多空指标 CSV</a><a href="factor_selection.csv">筛选明细 CSV</a><a href="factor_selection.json">贪心筛选证据</a><a href="correlation.json">全部相关性矩阵</a><a href="admission.json">日线可回测性</a><a href="verification.json">检验回执</a><a href="methodology.md">完整方法</a></nav><footer class="colophon" id="colophon"></footer></div>'''
    for name in ('dashboard.css', 'standalone.css', 'standalone-dashboard.js'):
        shutil.copyfile(ROOT / 'assets' / name, assets / name)
    atomic_text(output / 'methodology.md', (ROOT / 'references/standalone-methodology.md').read_text(encoding='utf-8'))
    atomic_text(output / 'dashboard.html', head + charts + tail + inline + '<script src="assets/standalone-dashboard.js"></script></body></html>')
    write(output / 'publication.json', {'records': len(catalog), 'settings': len(catalog) * 6, 'tabs': ['overview', 'selected', 'rejected'], 'template': 'bundled existing TA-Lib SVG/CSS', 'updated_at': state['updated_at']})
