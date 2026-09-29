"""Daily-data admission and a small causal expression evaluator.

Reviewed Python modules implement compute(fields, parameters) -> date x code.
They are trusted local code, never generated/executed directly from a web page.
"""
import ast
import importlib.util
from pathlib import Path
import re
import numpy as np
import pandas as pd

FIELDS = {'open', 'high', 'low', 'close', 'volume', 'amount', 'preClose',
          'turnoverRatio', 'vwap', 'raw_open', 'raw_high', 'raw_low', 'raw_close'}


def window(n):
    if not isinstance(n, (int, float)) or not float(n).is_integer() or n < 1:
        raise ValueError('Windows and lags must be positive integers; no future shifts')
    return int(n)


def frame(x): return pd.DataFrame(x)


FUNCTIONS = {
    'lag': lambda x, n: frame(x).shift(window(n)).to_numpy(),
    'delta': lambda x, n: frame(x).diff(window(n)).to_numpy(),
    'mean': lambda x, n: frame(x).rolling(window(n), min_periods=window(n)).mean().to_numpy(),
    'std': lambda x, n: frame(x).rolling(window(n), min_periods=window(n)).std(ddof=1).to_numpy(),
    'sum': lambda x, n: frame(x).rolling(window(n), min_periods=window(n)).sum().to_numpy(),
    'min': lambda x, n: frame(x).rolling(window(n), min_periods=window(n)).min().to_numpy(),
    'max': lambda x, n: frame(x).rolling(window(n), min_periods=window(n)).max().to_numpy(),
    'corr': lambda x, y, n: frame(x).rolling(window(n), min_periods=window(n)).corr(frame(y)).to_numpy(),
    'rank': lambda x: frame(x).rank(axis=1, method='average', pct=True).to_numpy(),
    'abs': np.abs, 'log': np.log, 'sqrt': np.sqrt, 'sign': np.sign,
}
OPS = {ast.Add: np.add, ast.Sub: np.subtract, ast.Mult: np.multiply,
       ast.Div: np.divide, ast.Pow: np.power}


def expression_names(expression):
    tree = ast.parse(expression, mode='eval')
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id not in FUNCTIONS: names.add(node.id)
        if isinstance(node, (ast.Attribute, ast.Subscript, ast.Lambda, ast.ListComp, ast.NamedExpr)):
            raise ValueError('Expression supports only fields, arithmetic and documented functions')
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS or node.keywords):
            raise ValueError('Unknown function or keyword argument')
    return names


def evaluate(expression, fields):
    tree = ast.parse(expression, mode='eval')
    def run(node):
        if isinstance(node, ast.Expression): return run(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float): return node.value
        if isinstance(node, ast.Name) and node.id in fields: return fields[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in OPS: return OPS[type(node.op)](run(node.left), run(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return run(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords:
            return FUNCTIONS[node.func.id](*(run(a) for a in node.args))
        raise ValueError(f'Unsupported expression: {ast.dump(node)}')
    with np.errstate(all='ignore'): return run(tree)


def admit(spec, available):
    missing = []
    if not spec.get('definition'): missing.append('缺少完整因子定义 definition')
    if spec.get('frequency', 'daily') != 'daily': missing.append('需要非日线频率的数据')
    needs = set(spec.get('required_fields', []))
    implementation_issue = None
    if spec.get('expression'):
        try: needs |= expression_names(spec['expression'])
        except (SyntaxError, ValueError) as exc:
            implementation_issue = str(exc)
    elif not spec.get('python'):
        implementation_issue = '定义尚未转为可执行表达式或本地 Python 模块'
    if spec.get('python') and not spec.get('required_fields'):
        missing.append('Python 实现必须声明 required_fields')
    unknown = sorted(needs - set(available))
    if unknown: missing.append('本地日线不能提供：' + ', '.join(unknown))
    if spec.get('required_external_data'): missing.append('需要额外数据：' + ', '.join(spec['required_external_data']))
    if implementation_issue: missing.append(implementation_issue)
    if spec.get('direction', 1) not in (-1, 1): missing.append('direction 必须预先指定为 1 或 -1')
    return {'status': 'blocked_data' if unknown or spec.get('required_external_data') or spec.get('frequency', 'daily') != 'daily' else ('pending_implementation' if implementation_issue else ('blocked_definition' if missing else 'ready')),
            'reasons': missing, 'required_fields': sorted(needs), 'direction': spec.get('direction', 1)}


def load_specs(path):
    from standalone_utils import read
    source = read(path)
    specs = source if isinstance(source, list) else source['factors']
    if not specs: raise ValueError('At least one factor definition is required')
    ids = set()
    for s in specs:
        fid = s.get('id', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', fid) or fid in ids:
            raise ValueError('Factor id must be unique, filename-safe ASCII: ' + fid)
        ids.add(fid)
        s.setdefault('name', fid)
        if s.get('python'):
            s['python'] = str((Path(path).resolve().parent / s['python']).resolve())
    return specs


def compute(spec, fields):
    if spec.get('expression'):
        result = evaluate(spec['expression'], fields)
    else:
        module_spec = importlib.util.spec_from_file_location('factor_' + spec['id'], spec['python'])
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        result = module.compute(fields, spec.get('parameters', {}))
    expected = next(iter(fields.values())).shape
    result = np.array(result, dtype=float, copy=True)
    if result.shape != expected: raise ValueError(f'Expected date x code {expected}, got {result.shape}')
    result *= spec.get('direction', 1)
    result[~np.isfinite(result)] = np.nan
    return result


def causality_check(spec, fields, full):
    """Prefix invariance detects centered windows, negative shifts and full-sample fits."""
    for fraction in (.43, .67, .83):
        stop = int(len(full) * fraction)
        if stop < 2: continue
        prefix = compute(spec, {k: v[:stop] for k, v in fields.items()})
        if not np.allclose(prefix, full[:stop], rtol=1e-9, atol=1e-12, equal_nan=True):
            raise ValueError(f'Factor changes historical values when future rows are removed (prefix {stop})')
