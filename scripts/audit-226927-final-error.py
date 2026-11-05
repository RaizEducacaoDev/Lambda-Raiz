"""Read only: exact ticket logs and reservation, without invoking the Lambda."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import time

spec = importlib.util.spec_from_file_location('readonly', Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
a.PK = 'prod#PG#11#226927'
OUT = Path('.226927-final-error-readonly')
OUT.mkdir(exist_ok=True)
deadline = time.monotonic() + 210
assert a.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == a.ACCOUNT
cfg = a.aws('lambda', 'get-function-configuration', '--function-name', a.FUNCTION, deadline=deadline)
assert cfg.get('Environment', {}).get('Variables', {}).get('STAGE') == 'prod'
assert cfg.get('Environment', {}).get('Variables', {}).get('PAGAMENTO_IDPGTO_TABLE') == a.TABLE
now = dt.datetime.now(dt.timezone.utc)
start = dt.datetime(2026, 11, 5, 18, 0, tzinfo=dt.timezone.utc)
assert start < now < start + dt.timedelta(days=1)
events, coverage = a.read_log_window('"226927"', int(start.timestamp()*1000), int(now.timestamp()*1000), deadline)
request_times = {}
for event in events:
    _, request = a.unwrap(event)
    if request:
        request_times.setdefault(request, []).append(event['timestamp'])
assert len(request_times) <= 12, 'Narrow the log window'
EXTRA = {
    '[RM-IDPGTO] Operação existente confirmada': 'existing_confirmed',
    '[RM-IDPGTO] Retomada confirmada': 'retry_confirmed',
    '[RM-IDPGTO] Rejeição encerrada para correção no formulário': 'rejection_closed',
}
EVENTS = {'corrected_for_native_submission', 'existing_payment_confirmed_readonly', 'native_rejection_closed'}
def project(event):
    row = a.sanitize(event)
    message, request = a.unwrap(event)
    if row is None:
        for marker, kind in EXTRA.items():
            if marker in message:
                row = {'timestamp': event['timestamp'], 'utc': dt.datetime.fromtimestamp(event['timestamp']/1000,dt.timezone.utc).isoformat(),
                       'requestId': request, 'kind': kind, **a.safe_fields(message.split(marker, 1)[1])}
                value = a.scalar(message, 'event')
                if value in EVENTS:
                    row['event'] = value
                break
    if row and row.get('kind') in ['existing_confirmed', 'bank_confirmed']:
        match = re.search(r'\bidLans\s*:\s*\[\s*([\d\s,\'\"]+)\]', message)
        if match:
            row['idLans'] = [int(v) for v in re.findall(r'\d+', match[1])]
    return row
result = {'ticket':226927, 'observedUtc':now.isoformat(), 'windowStartUtc':start.isoformat(),
          'readOnly':True, 'lambdaInvoked':False, 'awsWrites':False, 'ticketCoverage':coverage,
          'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus']},
          'requests':[]}
for request, timestamps in sorted(request_times.items(), key=lambda x:min(x[1])):
    full, cov = a.read_log_window('"'+request+'"', min(timestamps)-30000, max(timestamps)+30000, deadline)
    rows = [row for event in full if (row:=project(event)) is not None]
    result['requests'].append({'requestId':request, 'coverage':cov, 'events':rows,
                              'creationDispatchSeen':any(row.get('event')=='transport_call_started' for row in rows),
                              'bankConfirmationSeen':any(row.get('kind') in ['bank_confirmed','existing_confirmed'] for row in rows)})
    (OUT/'readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
item = a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':a.PK}}),deadline=deadline).get('Item',{})
result['reservation'] = a.safe_reservation(item)
result['coverageComplete'] = coverage['complete'] and all(r['coverage']['complete'] for r in result['requests'])
(OUT/'readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
assert result['coverageComplete'], 'Incomplete log coverage'
