"""Render a generic single-factor report from normalized JSON; no backtest execution."""
import argparse,json,shutil
from pathlib import Path

def render(data_path,output):
    data=json.loads(Path(data_path).read_text(encoding='utf-8-sig'))
    for key in ['meta','factors','contexts','results','correlations','experiments','method','downloads']:
        if key not in data:raise ValueError('Missing field: '+key)
    ids=[f['id'] for f in data['factors']];contexts=[c['id'] for c in data['contexts']]
    if len(set(ids))!=len(ids) or len(set(contexts))!=len(contexts):raise ValueError('Duplicate factor/context ids')
    for row in data['results']:
        if row['factor_id'] not in ids or row['context_id'] not in contexts:raise ValueError('Unresolved result id')
        for p in row.get('portfolios',[])+row.get('groups',[]):
            if p.get('nav') and len(p['nav'])!=len(row.get('dates',[])):raise ValueError('Date/nav lengths differ')
        if row.get('ic_series') and len(row['ic_series'])!=len(row.get('dates',[])):raise ValueError('Date/IC lengths differ')
    encoded=json.dumps(data,ensure_ascii=False,allow_nan=False).replace('</',r'<\/')
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    template=Path(__file__).resolve().parents[1]/'assets/single-factor-generic'
    shutil.copytree(template/'assets',output/'assets',dirs_exist_ok=True)
    shutil.copy2(template/'dashboard.html',output/'dashboard.html')
    (output/'report-data.js').write_text('window.SINGLE_FACTOR_REPORT='+encoded+';',encoding='utf-8')
    return output/'dashboard.html'

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    print(render(args.data,args.output))
