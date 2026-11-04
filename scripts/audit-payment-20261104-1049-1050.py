"""Read-only correlation of the two newly reported Zeev errors. Never invoke RM."""
import datetime
import importlib.util
import json
import pathlib
import time

source = pathlib.Path(__file__).with_name('audit-payment-conflict-20261103-0609.py')
spec = importlib.util.spec_from_file_location('readonly_payment_audit', source)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
deadline = time.monotonic() + 180
assert audit.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == audit.ACCOUNT
cfg = audit.aws('lambda', 'get-function-configuration', '--function-name', audit.FUNCTION, deadline=deadline)
observed = datetime.datetime.now(datetime.timezone.utc)
out = {
    'observedUtc': observed.isoformat(),
    'localizers': ['202611041049-73', '202611041050-34'],
    'businessWrites': False, 'configurationWrites': False,
    'allowedAwsOperations': sorted('/'.join(v) for v in audit.AWS_READS),
    'function': {k: cfg.get(k) for k in ['FunctionName', 'CodeSha256', 'RevisionId', 'State', 'LastUpdateStatus', 'LastModified']},
    'windows': [],
}
for hour in [10, 13]:
    center = datetime.datetime(2026, 11, 4, hour, 49, tzinfo=datetime.timezone.utc)
    start = int((center - datetime.timedelta(minutes=2)).timestamp() * 1000)
    intended_end = center + datetime.timedelta(minutes=5)
    effective_end = min(intended_end, observed)
    end = int(effective_end.timestamp() * 1000)
    events, coverage = audit.read_log_window('"[RM-IDPGTO]"', start, end, deadline)
    safe = [v for event in events if (v := audit.sanitize(event)) is not None]
    out['windows'].append({'centerUtc': center.isoformat(), 'effectiveEndUtc': effective_end.isoformat(),
                           'coverage': coverage, 'events': safe})
item = audit.aws('dynamodb', 'get-item', '--table-name', audit.TABLE, '--consistent-read',
                 '--key', json.dumps({'pk': {'S': 'prod#PG#9#226374'}}), deadline=deadline).get('Item', {})
out['contextTicketReservation'] = audit.safe_reservation(item)
out['contextTicketOriginalDigestMatches'] = item.get('digest', {}).get('S') == 'f6d5bff690ca5fe785705ea08e586f3f4fb4454f9c191ccb77ca450ed1ed3932'
directory = pathlib.Path('.payment-20261104-1049-1050')
directory.mkdir(exist_ok=True)
(directory / 'readback.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print(json.dumps(out, indent=2))
assert all(w['coverage']['complete'] for w in out['windows']), 'Incomplete log coverage'
