"""Only AWS metadata, ZIP hashes and bounded CloudTrail reads. Never rollback."""
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import urllib.request

spec = importlib.util.spec_from_file_location('systemic_failure_readonly', Path(__file__).with_name('deploy-payment-systemic.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
EXPECTED = 'U8MIHNjNZ2iEeyt02SWx4q5TztrmrcpehRqBlf86OY8='
DIRECTORY = Path('.systemic-failure-readonly')


def aws(*args):
    assert args[:2] in {('sts', 'get-caller-identity'), ('lambda', 'get-function'),
                        ('lambda', 'get-function-configuration'), ('cloudtrail', 'lookup-events')}
    if args[0] == 'lambda':
        assert args[args.index('--function-name') + 1] == m.FUNCTION
    return m.aws(*args)


def value_hash(value):
    return hashlib.sha256(m.canonical(value).encode()).hexdigest()


def main():
    assert aws('sts', 'get-caller-identity')['Account'] == m.ACCOUNT
    evidence = Path('.failed-systemic-attempt')
    baseline_files = list(evidence.rglob('baseline.json'))
    failed_files = list(evidence.rglob('failed-release.json'))
    assert len(baseline_files) == len(failed_files) == 1
    baseline = json.loads(baseline_files[0].read_text())
    failed = json.loads(failed_files[0].read_text())
    assert baseline['codeSha256'] == 'oHgRl53dlYR3Z/98HuB1GRelxAvWFUIKth0WHagkRnc='
    assert failed['candidateCodeSha256'] == EXPECTED
    active = aws('lambda', 'get-function', '--function-name', m.FUNCTION)
    first = active['Configuration']
    second = aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
    assert (first['CodeSha256'], first['RevisionId']) == (second['CodeSha256'], second['RevisionId']), 'Configuration changed during read'
    with urllib.request.urlopen(active['Code']['Location'], timeout=30) as response:
        blob = response.read()
    assert m.sha(blob) == first['CodeSha256']
    entries = m.package_entries(blob)
    backup_files = list(evidence.rglob('active-before.zip'))
    assert len(backup_files) == 1
    old_blob = backup_files[0].read_bytes()
    assert m.sha(old_blob) == baseline['codeSha256']
    old = m.package_entries(old_blob)
    differences = []
    for key in sorted(set(first) | set(second)):
        if (key in first) != (key in second) or first.get(key) != second.get(key):
            differences.append({'field': key, 'presentInGetFunction': key in first,
                                'presentInGetFunctionConfiguration': key in second,
                                'getFunctionValueSha256': value_hash(first.get(key)),
                                'configurationValueSha256': value_hash(second.get(key))})
    result = {'observedUtc': m.now(), 'readOnly': True, 'function': m.FUNCTION, 'account': m.ACCOUNT,
              'activeCodeSha256': first['CodeSha256'], 'revisionId': first['RevisionId'],
              'state': first.get('State'), 'lastUpdateStatus': first.get('LastUpdateStatus'),
              'lastModified': first.get('LastModified'), 'candidateIsActive': first['CodeSha256'] == EXPECTED,
              'baselineIsActive': first['CodeSha256'] == baseline['codeSha256'],
              'getFunctionConfigHash': m.config_hash(first), 'getFunctionConfigurationHash': m.config_hash(second),
              'recordedBaselineConfigHash': baseline['configurationSha256'], 'apiFieldDifferences': differences,
              'activeZipHashConfirmed': True, 'activeBundleSha256': hashlib.sha256(entries[m.ENTRY]).hexdigest(),
              'activeCoreSha256': hashlib.sha256(entries[m.CORE_ENTRY]).hexdigest(),
              'allOtherEntriesPreserved': set(old) == set(entries) and all(old[k] == entries[k] for k in old if k != m.ENTRY),
              'systemicMarkers': {marker.decode(): marker in entries[m.ENTRY] for marker in m.MARKERS},
              'cloudTrail': []}
    center = dt.datetime.fromisoformat(failed['observedUtc'])
    for operation in ['UpdateFunctionCode', 'UpdateFunctionConfiguration']:
        try:
            events = aws('cloudtrail', 'lookup-events', '--lookup-attributes', 'AttributeKey=EventName,AttributeValue=' + operation,
                         '--start-time', (center - dt.timedelta(minutes=15)).isoformat(),
                         '--end-time', min(center + dt.timedelta(minutes=15), dt.datetime.now(dt.timezone.utc)).isoformat(),
                         '--max-results', '50', '--max-items', '100')
            for event in events.get('Events', []):
                data = json.loads(event['CloudTrailEvent'])
                request, response = data.get('requestParameters') or {}, data.get('responseElements') or {}
                if request.get('functionName') not in [m.FUNCTION, f'arn:aws:lambda:{m.REGION}:{m.ACCOUNT}:function:{m.FUNCTION}']:
                    continue
                result['cloudTrail'].append({'eventTime': data.get('eventTime'), 'eventName': data.get('eventName'),
                    'eventId': data.get('eventID'), 'errorCode': data.get('errorCode'),
                    'requestRevisionId': request.get('revisionId'), 'responseRevisionId': response.get('revisionId'),
                    'responseCodeSha256': response.get('codeSha256'),
                    'principalSha256': value_hash((data.get('userIdentity') or {}).get('arn'))})
        except Exception as error:
            result['cloudTrail'].append({'operation': operation, 'readErrorType': type(error).__name__})
    final = aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
    assert final['CodeSha256'] == second['CodeSha256'] and final['RevisionId'] == second['RevisionId']
    result['stableAcrossReadback'] = True
    DIRECTORY.mkdir(exist_ok=True)
    (DIRECTORY / 'readback.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ['activeCodeSha256', 'revisionId', 'candidateIsActive', 'baselineIsActive',
        'getFunctionConfigHash', 'getFunctionConfigurationHash', 'recordedBaselineConfigHash', 'apiFieldDifferences',
        'allOtherEntriesPreserved', 'activeCoreSha256']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        DIRECTORY.mkdir(exist_ok=True)
        (DIRECTORY / 'failure.json').write_text(json.dumps({'readOnly': True, 'errorType': type(error).__name__}), encoding='utf-8')
        raise SystemExit('Read-only failure diagnostic stopped; inspect sanitized evidence') from None
