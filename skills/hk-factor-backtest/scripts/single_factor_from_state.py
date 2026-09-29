"""Map saved standalone engine results to the shared template; never run the engine."""
import csv
import hashlib
import json
import math
import shutil
from pathlib import Path

from render_single_factor import render, write_payload, VERSION


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def annual_from_nav(dates, nav, active=True):
    """Calendar returns include each year's first session, with initial capital 1."""
    if not active or not nav:
        return {}
    endpoints = {}
    for date, value in zip(dates, nav):
        if value is not None and math.isfinite(value):
            endpoints[str(date)[:4]] = value
    previous, result = 1.0, {}
    for year, value in endpoints.items():
        result[year] = value / previous - 1 if previous > 0 else None
        previous = value
    return result


def publish(state, output):
    from standalone_report import calculation_details
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    records = state['records']
    data = {key:[] for key in ['factors','contexts','results','correlations','experiments','method','downloads']}
    dates = state.get('dates', [])
    period = (str(dates[0]) + ' 至 ' + str(dates[-1])) if dates else '区间见保存结果'
    data['meta'] = {'title':'单因子回测与检验', 'source':state['config'].get('source', '港股单因子研究'),
        'description':period + '；阶段、复权、持有期和定向均按实际保存的结果展示。',
        'dimensions':[{'key':'mode','label':'分红口径'}, {'key':'hold','label':'持有日数'}]}
    context_map, annual_rows = {}, []
    descriptions = read(output / 'factor_descriptions.json') if (output / 'factor_descriptions.json').is_file() else {}

    def download(path, label):
        path = Path(path).resolve()
        if not path.is_file(): return None
        if not path.is_relative_to(output):
            destination = output / 'evidence' / (hashlib.sha256(str(path).encode()).hexdigest()[:12] + '-' + path.name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
            path = destination
        return {'label':label, 'href':path.relative_to(output).as_posix()}

    for record in records:
        spec = record.get('spec', {})
        calculation = calculation_details(spec, descriptions.get(record['id']))
        done = any(s.get('status') == 'completed' for s in record.get('settings', {}).values())
        data['factors'].append({'id':record['id'], 'name':record['name'], 'status':'completed' if done else 'blocked',
            'formula':calculation['formula'], 'parameters':calculation['parameters'], 'calculation_method':calculation['method'],
            'economic_meaning':descriptions.get(record['id'], {}).get('economic_meaning') or spec.get('economic_meaning') or '尚未提供机制假设。',
            'missing_details':[record['reason']] if record.get('reason') else []})
        payload_cache = {}
        for key, summary in record.get('settings', {}).items():
            mode, hold = key.rsplit('__', 1)
            mode_label = {'cash':'现金分红','reinvest':'红利再投'}.get(mode, mode)
            context_map[key] = {'id':key, 'label':f'{period} / {mode_label} / {hold}日',
                'dimensions':{'mode':mode_label,'hold':str(hold) + '日'},
                'description':f'{period}，持有{hold}日。执行和定向口径以本批保存配置、指标及账本为准。'}
            decisions = state.get('selection', {}).get('slices', {}).get(key, {}).get('rows', [])
            decision = next((s for s in decisions if s['factor_id'] == record['id']), {})
            row = {'id':record['id'] + '__' + key, 'factor_id':record['id'], 'context_id':key,
                'status':decision.get('status', summary.get('status')), 'selected':decision.get('status') == 'selected',
                'description':decision.get('reason') or summary.get('reason') or '原设置保存结果',
                'parameters':calculation['parameters'], 'ic_mean':summary.get('ic_mean'), 'raw_ic':summary.get('preorientation_rank_ic'),
                'direction_multiplier':summary.get('direction_multiplier'), 'portfolios':[], 'groups':[], 'downloads':[]}
            if any(summary.get(k) is not None for k in ['cagr','sharpe','net_sharpe','max_drawdown']):
                row['portfolios'] = [{'id':'LS','label':'多空','role':'LS','active':summary.get('active_entries') != 0,
                    'cagr':summary.get('cagr'),'sharpe':summary.get('net_sharpe', summary.get('sharpe')),
                    'drawdown':summary.get('max_drawdown'),'annual':{},
                    **{k:summary.get(k) for k in ['annualized_return','final_nav','cumulative_return','volatility','gross_sharpe','annualized_fee_rate','win_rate']}}]
            directory = Path(record['path'])
            saved = directory / f'payload_{mode}.json'
            if summary.get('status') == 'completed' and saved.is_file():
                if mode not in payload_cache: payload_cache[mode] = read(saved)
                entry = payload_cache[mode]['modes'].get(mode, {}).get(str(hold))
                if entry:
                    ds, series = entry['dates'], entry['series']
                    def portfolio(metric, gross, pid, role):
                        nav = series.get('ls_nav' if pid == 'LS' else pid.lower() + '_nav', [])
                        active = metric.get('active_entries') != 0
                        annual = annual_from_nav(ds, nav, active)
                        annual_rows.extend({'setting_id':row['id'],'portfolio':pid,'year':y,'net_return':v} for y,v in annual.items())
                        return {'id':pid,'label':'多空' if pid == 'LS' else pid,'role':role,'active':active,
                            'cagr':metric.get('cagr'),'sharpe':metric.get('net_sharpe', metric.get('sharpe')),
                            'drawdown':metric.get('max_drawdown'),'gross_sharpe':gross.get('sharpe'), 'annual':annual,
                            **{k:metric.get(k) for k in ['annualized_return','final_nav','cumulative_return','volatility','annualized_fee_rate','win_rate']}}
                    row['portfolios'] = [portfolio(entry['ls'], entry.get('gross_ls', {}), 'LS', 'LS')]
                    gross_groups = entry.get('group_gross_metrics', [])
                    row['groups'] = [portfolio(m, gross_groups[i] if i < len(gross_groups) else {}, f'Q{i+1:02d}', 'long') for i,m in enumerate(entry.get('group_metrics', []))]
                    if row['groups']: row['portfolios'].append(dict(row['groups'][-1]))
                    payload = {'dates':ds, 'ic_series':series.get('ic', []), 'pearson_ic':series.get('pearson_ic', []),
                        'cumulative_ic':series.get('cum_ic', []), 'drawdown':series.get('ls_drawdown', [])}
                    for kind in ['portfolios','groups']:
                        payload[kind] = [{'id':p['id'],'nav':series.get('ls_nav' if p['id']=='LS' else p['id'].lower()+'_nav', [])} for p in row[kind]]
                    relative = 'visualization-series/' + hashlib.sha256(row['id'].encode()).hexdigest()[:24] + '.js'
                    write_payload(output / relative, row['id'], payload)
                    row.update(payload=relative, payload_key=row['id'])
                    for path, label in [(saved,'原始指标、IC与分组证据'), (directory/f'series_{mode}_{hold}.parquet','完整逐日账本 Parquet'),
                                        (directory/f'summary_{mode}.csv','完整分组指标 CSV')]:
                        link = download(path, label)
                        if link: row['downloads'].append(link)
            data['results'].append(row)
    data['contexts'] = list(context_map.values())
    correlation = state.get('correlation', {})
    for cid in context_map:
        mode = cid.rsplit('__', 1)[0]
        matrix = correlation.get('slices', {}).get(cid) or correlation.get('modes', {}).get(mode)
        if matrix and matrix.get('matrix'):
            data['correlations'].append({'id':cid, 'context_id':cid, 'ids':matrix.get('ids', correlation.get('ids', [])),
                'values':matrix['matrix'], 'days':matrix.get('days'), 'overlap':matrix.get('overlap'),
                'method':matrix.get('method') or correlation.get('method') or '原始已保存因子相关性；计算方法以本批 correlation.json 及原方法说明为准。'})
    annual_path = output / 'visualization_annual_returns.csv'
    with annual_path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['setting_id','portfolio','year','net_return'])
        writer.writeheader(); writer.writerows(annual_rows)
    for name,label in [('summary.csv','全部分组及多空指标'),('factor_selection.csv','筛选明细'),('correlation.json','原始相关性矩阵'),
        ('admission.json','日线可回测性'),('verification.json','原数值检验'),('methodology.md','本批方法说明'),
        ('latest-run.json','原始运行配置与记录'),('visualization_annual_returns.csv','按完整净值导出的逐年收益')]:
        link = download(output / name, label)
        if link: data['downloads'].append(link)
    data['experiments'] = [{'title':'本批输入与设置', 'text':f'{len(records)} 个输入因子，{len(data["results"])} 条保存设置。实际周期和组数来自本批数据。'}]
    data['method'] = [{'title':'保存结果的可视化', 'text':'报告只映射已保存结果，不重算因子、方向、IC、筛选或交易账本。年度收益由完整净值逐年末与上年末之比得出，初始资金为1，包含每年首个交易日。缺失数据保持缺失。'}]
    if (output / 'methodology.md').is_file():
        data['method'].append({'title':'本批方法说明', 'text':(output/'methodology.md').read_text(encoding='utf-8-sig')})
    input_path = output / 'report-input.json'
    input_path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    result = render(input_path, output)
    (output/'publication.json').write_text(json.dumps({'records':len(records),'settings':len(data['results']),
        'template':VERSION,'tabs':['overview','factor','all'],
        'updated_at':state.get('updated_at'),'backtest_rerun':False}, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
