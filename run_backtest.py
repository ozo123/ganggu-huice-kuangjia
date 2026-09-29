"""Run a user-selected backtest entry with explicit inputs and a managed result folder."""
from pathlib import Path
from datetime import datetime
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['inspect', 'run', 'report', 'verify'])
    p.add_argument('--entry', type=Path, required=True, help='Selected Python entry compatible with hk-factor-backtest run.py')
    p.add_argument('--python', type=Path, default=Path(sys.executable))
    p.add_argument('--source', help='Source label, including a batch label when needed')
    p.add_argument('--date', default=datetime.now().strftime('%Y-%m%d'))
    p.add_argument('--factors', type=Path)
    p.add_argument('--data-root', type=Path)
    p.add_argument('--config', type=Path)
    p.add_argument('--result-dir', type=Path, help='Existing folder for report/verify')
    p.add_argument('--start'); p.add_argument('--end')
    p.add_argument('--resume', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args(argv)
    entry=a.entry.resolve(); interpreter=a.python.resolve()
    if not entry.is_file() or not interpreter.is_file(): p.error('Entry and Python must be existing files')
    if a.action in ('inspect','run'):
        if not a.source or not a.factors or not a.data_root: p.error('--source, --factors and --data-root are required')
        if not a.factors.is_file() or not a.data_root.is_dir(): p.error('Factor file or data directory does not exist')
        if re.search(r'[<>:"/\\|?*\x00-\x1f]',a.source) or a.source.rstrip(' .') != a.source: p.error('Invalid source label')
        if not re.fullmatch(r'\d{4}-\d{4}',a.date): p.error('--date must be YYYY-MMDD')
        try: datetime.strptime(a.date,'%Y-%m%d')
        except ValueError: p.error('--date must be YYYY-MMDD')
        out=ROOT/'output'/f'{a.source}-{a.date}-回测结果'
    else:
        if not a.result_dir: p.error('--result-dir is required for report/verify')
        out=a.result_dir.resolve()
        if not out.is_dir(): p.error('Result directory does not exist')
    output_root=(ROOT/'output').resolve(); out=out.resolve()
    if not out.is_relative_to(output_root) or out == output_root: p.error('All results must stay inside this project/output')
    args=[str(interpreter),str(entry),a.action,'--output',str(out)]
    for option in ['factors','data_root','config']:
        val=getattr(a,option)
        if val:
            if not val.exists(): p.error(f'{option} does not exist')
            args += ['--'+option.replace('_','-'),str(val.resolve())]
    for option in ['start','end']:
        if getattr(a,option): args += ['--'+option,getattr(a,option)]
    if a.dry_run:
        print(json.dumps({'command':args,'cwd':str(ROOT),'output':str(out),'execution':'not_started'},ensure_ascii=False,indent=2)); return 0
    if a.action in ('inspect','run'):
        if out.exists() and not a.resume: p.error('Result exists; choose another source/batch or explicitly use --resume')
        request={'entry':str(entry),'entry_sha256':hashlib.sha256(entry.read_bytes()).hexdigest(),'data_root':str(a.data_root.resolve()),'factors':str(a.factors.resolve()),'factors_sha256':hashlib.sha256(a.factors.read_bytes()).hexdigest(),'config_sha256':hashlib.sha256(a.config.read_bytes()).hexdigest() if a.config else None,'start':a.start,'end':a.end,'source':a.source,'date':a.date}
        receipt=out/'request.json'
        if out.exists() and a.resume and not receipt.exists(): p.error('Existing historical result has no matching request; choose a new batch name')
        if a.resume and receipt.exists():
            prev=json.loads(receipt.read_text(encoding='utf-8'))
            if prev != request: p.error('Resume inputs differ from the stored request')
        out.mkdir(parents=True,exist_ok=True)
        receipt.write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding='utf-8')
        (out/'input').mkdir(exist_ok=True)
        (out/'input/factors.original.json').write_bytes(a.factors.read_bytes())
        if a.config: (out/'input/config.original.json').write_bytes(a.config.read_bytes())
    result=subprocess.run(args,cwd=ROOT,env={**os.environ,'PYTHONIOENCODING':'utf-8'})
    return result.returncode

if __name__ == '__main__': raise SystemExit(main())
