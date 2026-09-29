"""Validate and render the bundled offline single-factor template, without a backtest."""
import argparse
import copy
import hashlib
import json
import shutil
from pathlib import Path
from urllib.parse import unquote, urlsplit

VERSION = '2026-09-29.llm-reference-single-v9'
PAYLOAD_PREFIX = 'window.SINGLE_FACTOR_PAYLOADS=window.SINGLE_FACTOR_PAYLOADS||{};'


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).replace('<', r'\u003c')


def write_payload(path, key, payload):
    """Write only JSON in a script wrapper, supporting offline file:// reports."""
    validate_series(payload)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(PAYLOAD_PREFIX + 'window.SINGLE_FACTOR_PAYLOADS[' + encode(key) + ']=' + encode(payload) + ';', encoding='utf-8')


def read_payload(path, key):
    text = Path(path).read_text(encoding='utf-8-sig')
    prefix = PAYLOAD_PREFIX + 'window.SINGLE_FACTOR_PAYLOADS[' + encode(key) + ']='
    if not text.startswith(prefix) or not text.endswith(';'):
        raise ValueError('Invalid series wrapper: ' + str(path))
    payload = json.loads(text[len(prefix):-1])
    encode(payload)  # Reject NaN / Infinity, including unused fields.
    validate_series(payload)
    return payload


def validate_series(row):
    dates = row.get('dates', [])
    if dates != sorted(set(dates)):
        raise ValueError('Dates must be unique and ascending')
    for field in ['ic_series', 'pearson_ic', 'cumulative_ic', 'drawdown']:
        if row.get(field) and len(row[field]) != len(dates):
            raise ValueError('Date/' + field + ' lengths differ')
    for kind in ['portfolios', 'groups']:
        ids = [p['id'] for p in row.get(kind, [])]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate portfolio/group id')
        for portfolio in row.get(kind, []):
            if portfolio.get('nav') and len(portfolio['nav']) != len(dates):
                raise ValueError('Date/nav lengths differ')


def local_file(base, href):
    url = urlsplit(href)
    if url.scheme or url.netloc:
        raise ValueError('Report assets and downloads must be local: ' + href)
    path = (base / unquote(url.path)).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        raise ValueError('Missing or out-of-report file: ' + href)
    return path


def all_downloads(data):
    yield from data.get('downloads', [])
    for kind in ['factors', 'results', 'experiments', 'method']:
        for row in data.get(kind, []):
            yield from row.get('downloads', [])


def prepare(data, base):
    data = copy.deepcopy(data)
    for key in ['meta', 'factors', 'contexts', 'results', 'correlations', 'experiments', 'method', 'downloads']:
        if key not in data:
            raise ValueError('Missing field: ' + key)
    encode(data)
    ids = [f['id'] for f in data['factors']]
    contexts = [c['id'] for c in data['contexts']]
    if len(set(ids)) != len(ids) or len(set(contexts)) != len(contexts):
        raise ValueError('Duplicate factor/context ids')
    if data['meta'].get('default_context') and data['meta']['default_context'] not in contexts:
        raise ValueError('Unknown default context')
    dimensions = [d['key'] for d in data['meta'].get('dimensions', [])]
    if dimensions:
        signatures = []
        for context in data['contexts']:
            signature = tuple(context.get('dimensions', {}).get(k) for k in dimensions)
            if any(not isinstance(v, str) or not v for v in signature):
                raise ValueError('Each context needs every named dimension as text')
            signatures.append(signature)
        if len(set(signatures)) != len(signatures):
            raise ValueError('Ambiguous context dimensions')
    result_ids, combinations, payload_files = set(), set(), []
    for row in data['results']:
        row.setdefault('id', row['factor_id'] + '__' + row['context_id'])
        identity = (row['factor_id'], row['context_id'], row.get('variant', ''))
        if row['id'] in result_ids or identity in combinations:
            raise ValueError('Duplicate result id or factor/context/variant')
        result_ids.add(row['id']); combinations.add(identity)
        if row['factor_id'] not in ids or row['context_id'] not in contexts:
            raise ValueError('Unresolved result id')
        validate_series(row)
        if row.get('payload'):
            path = local_file(base, row['payload'])
            payload = read_payload(path, row['payload_key'])
            for kind in ['portfolios', 'groups']:
                known = {p['id'] for p in row.get(kind, [])}
                if any(p['id'] not in known for p in payload.get(kind, [])):
                    raise ValueError('Payload has unresolved portfolio/group id')
            payload_files.append((row['payload'], path))
    correlation_ids = set()
    for i, corr in enumerate(data['correlations']):
        corr.setdefault('id', corr['context_id'] + '__matrix_' + str(i))
        if corr['id'] in correlation_ids or corr['context_id'] not in contexts:
            raise ValueError('Invalid correlation reference')
        correlation_ids.add(corr['id'])
        n = len(corr['ids'])
        for field in ['values', 'days', 'overlap']:
            if corr.get(field) is not None and (len(corr[field]) != n or any(len(row) != n for row in corr[field])):
                raise ValueError('Correlation matrix must be square: ' + field)
    downloads = [(d['href'], local_file(base, d['href'])) for d in all_downloads(data)]
    return data, dict(payload_files + downloads)


def render(data_path, output):
    data_path, output = Path(data_path), Path(output)
    data, files = prepare(json.loads(data_path.read_text(encoding='utf-8-sig')), data_path.parent)
    output.mkdir(parents=True, exist_ok=True)
    for href, source in files.items():
        destination = output / unquote(urlsplit(href).path)
        if source.resolve() != destination.resolve():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    template = Path(__file__).resolve().parents[1] / 'assets/single-factor-generic'
    shutil.copytree(template / 'assets', output / 'assets', dirs_exist_ok=True)
    shutil.copy2(template / 'dashboard.html', output / 'dashboard.html')
    (output / 'report-data.js').write_text('window.SINGLE_FACTOR_REPORT=' + encode(data) + ';', encoding='utf-8')
    receipt = {'template_version': VERSION, 'factors': len(data['factors']), 'settings': len(data['results']),
               'contexts': len(data['contexts']), 'series_files': sum(bool(r.get('payload')) for r in data['results']),
               'validated_local_files': len(files), 'input_sha256': hashlib.sha256(data_path.read_bytes()).hexdigest(),
               'backtest_rerun': False, 'scope': 'Presentation schema, local references and series alignment; not backtest certification'}
    (output / 'template-render-verification.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return output / 'dashboard.html'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(render(args.data, args.output))
