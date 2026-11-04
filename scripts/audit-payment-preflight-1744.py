"""Read-only correlation of localizer 202611040544-66; never invokes a payment."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import time

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

INDICATORS = {
    'PRE_CREATE_TIME_BUDGET': 'Tempo insuficiente antes de enviar a criação ao RM',
    'TIME_BUDGET': 'Tempo insuficiente; operação mantida pendente',
    'SOAP_FAULT': 'SOAP RM inválido ou Fault',
    'SOAP_RESULT_MISSING': 'Resultado SOAP RM ausente ou ambíguo',
    'XML_INVALID': 'XML RM inválido',
    'BANK_RECORD_MISSING': 'Esperado exatamente um FDadosPgto',
    'IMMUTABLE_HISTORY_CONFLICT': 'Histórico imutável da reserva não corresponde ao snapshot',
}


def safe_event(event):
    row = a.sanitize(event)
    message, request = a.unwrap(event)
    hits = [code for code, literal in INDICATORS.items() if literal in message]
    if hits:
        row = row or {'timestamp': event['timestamp'], 'requestId': request, 'kind': 'fixed_exception_indicator'}
        row['indicators'] = hits
    if row and row.get('kind') == 'payment_pending':
        value = a.scalar(message.split('[RM-IDPGTO] Integração pendente', 1)[-1], 'creationStage')
        if value in a.STAGES:
            row['creationStage'] = value
    return row


def main(minute=44):
    assert minute in (44, 53)
    deadline = time.monotonic() + 240
    assert a.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == a.ACCOUNT
    cfg = a.aws('lambda', 'get-function-configuration', '--function-name', a.FUNCTION, deadline=deadline)
    env = cfg.get('Environment', {}).get('Variables', {})
    assert env.get('STAGE') == 'prod' and env.get('PAGAMENTO_IDPGTO_TABLE') == a.TABLE
    now = dt.datetime.now(dt.timezone.utc)
    out = {'observedUtc': now.isoformat(), 'localizer': {44:'202611040544-66',53:'202611040553-42'}[minute], 'businessWrites': False,
           'function': {k: cfg.get(k) for k in ['FunctionName', 'CodeSha256', 'RevisionId', 'State', 'LastUpdateStatus', 'Timeout', 'MemorySize']},
           'windows': [], 'requests': [], 'namedReservation': {}}
    requests = {}
    for hour in [20, 8]:
        center = dt.datetime(2026, 11, 4, hour, minute, tzinfo=dt.timezone.utc)
        start, end = center - dt.timedelta(minutes=3), min(center + dt.timedelta(minutes=3), now)
        if end <= start:
            continue
        events, coverage = a.read_log_window('"[RM-IDPGTO]" "Integração pendente"', int(start.timestamp()*1000), int(end.timestamp()*1000), deadline)
        rows = [r for event in events if (r := safe_event(event)) and r.get('status') == 503]
        out['windows'].append({'hypothesisCenterUtc': center.isoformat(), 'coverage': coverage, 'events': rows})
        for row in rows:
            if row.get('requestId'):
                requests.setdefault(row['requestId'], []).append(row['timestamp'])
    assert len(requests) <= 20, 'Narrow the incident window'
    for request, times in requests.items():
        events, coverage = a.read_log_window('"' + request + '"', min(times)-90000, max(times)+90000, deadline)
        out['requests'].append({'requestId': request, 'coverage': coverage,
            'events': [r for event in events if (r := safe_event(event))]})
    a.PK = 'prod#PG#1#225136'
    item = a.aws('dynamodb', 'get-item', '--table-name', a.TABLE, '--consistent-read',
                 '--key', json.dumps({'pk': {'S': a.PK}}), deadline=deadline).get('Item', {})
    out['namedReservation'] = {'ticket': 225136, 'company': 1, 'record': a.safe_reservation(item),
                               'hasPgAttribute': 'pg' in item, 'protocolVersion': item.get('protocolVersion', {}).get('N')}
    directory = Path(f'.preflight-17{minute}-audit')
    directory.mkdir(exist_ok=True)
    (directory/'readback.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(json.dumps(out, indent=2))
    assert all(w['coverage']['complete'] for w in out['windows']+out['requests'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--minute',type=int,choices=[44,53],default=44)
    main(parser.parse_args().minute)
