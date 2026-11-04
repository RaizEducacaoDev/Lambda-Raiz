"""Read-only incident 226455: no invoke, reservation changes, RM or Zeev writes."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import time

spec = importlib.util.spec_from_file_location('incident_base', Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
a.TICKET, a.COMPANY, a.BRANCH, a.PK = '226455', '9', '2', 'prod#PG#9#226455'
deadline = time.monotonic() + 300
assert a.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == a.ACCOUNT
cfg = a.aws('lambda', 'get-function-configuration', '--function-name', a.FUNCTION, deadline=deadline)
assert cfg.get('Environment', {}).get('Variables', {}).get('PAGAMENTO_IDPGTO_TABLE') == a.TABLE
item = a.aws('dynamodb', 'get-item', '--table-name', a.TABLE, '--consistent-read', '--key',
             json.dumps({'pk': {'S': a.PK}}), deadline=deadline).get('Item', {})
now = dt.datetime.now(dt.timezone.utc)
start = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
events, coverage = a.read_log_window('"226455"', int(start.timestamp()*1000), int(now.timestamp()*1000), deadline)
safe = [value for event in events if (value := a.sanitize(event)) is not None]
requests = sorted({row['requestId'] for row in safe if row.get('requestId')})
assert len(requests) <= 40, 'Too many requests; narrow the audit before continuing'
contexts = []
for request in requests:
    own = [row for row in safe if row.get('requestId') == request]
    begin, end = min(row['timestamp'] for row in own)-120000, max(row['timestamp'] for row in own)+120000
    raw, covered = a.read_log_window('"'+request+'"', begin, min(end, int(now.timestamp()*1000)), deadline)
    contexts.append({'requestId': request, 'coverage': covered,
                     'events': [value for event in raw if (value := a.sanitize(event)) is not None]})
record = a.safe_reservation(item)
for name in ('protocolVersion',):
    value = item.get(name, {}).get('N')
    if value and value.isdigit(): record[name] = int(value)
record['hasPgAttribute'] = 'pg' in item
record['hasReconciliationEvidence'] = 'reconciliationEvidenceKey' in item
out = {'observedUtc': now.isoformat(), 'ticket': 226455, 'businessWrites': False, 'configurationWrites': False,
       'function': {k: cfg.get(k) for k in ('FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus','Timeout','Runtime')},
       'reservation': record, 'coverage': coverage, 'events': safe, 'requests': contexts}
directory = Path('.payment-226455-audit'); directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print(json.dumps(out, indent=2))
assert coverage['complete'] and all(row['coverage']['complete'] for row in contexts), 'Incomplete log coverage'
