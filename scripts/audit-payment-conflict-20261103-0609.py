"""Bounded, read-only AWS correlation for candidate 9/226374; no payment invoke.

Only fixed enums, identifiers, numeric metrics and diagnostic fingerprints leave
memory. Raw CloudWatch messages, Lambda environment and AWS errors never do.
Run --self-test to check parsers and the AWS operation allowlist without AWS.
"""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time

ACCOUNT = '757843862365'
REGION = 'sa-east-1'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
GROUP = '/aws/lambda/' + FUNCTION
TICKET, COMPANY, BRANCH, CODTMV = '226374', '9', '3', '1.2.03'
PK = 'prod#PG#9#226374'
EXPECTED_DIGEST = None  # No expected digest was known before this read-only collection.
REFERENCE_REQUEST = 'b032cc53-ab5e-4075-9892-99b02fd7093e'
START = datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc)
LOCALIZER_DAY = datetime.datetime(2026, 11, 3, tzinfo=datetime.timezone.utc)
OUT = pathlib.Path('.payment-conflict-20261103-0609')
AWS_READS = frozenset({('sts', 'get-caller-identity'), ('lambda', 'get-function-configuration'),
    ('dynamodb', 'get-item'), ('logs', 'filter-log-events')})
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
STATES = {'RESERVED', 'CREATING', 'CREATED', 'UPDATING', 'COMPLETE'}
ERROR_TYPES = {'Error', 'TypeError', 'RangeError', 'SyntaxError', 'AxiosError', 'CanceledError',
    'TimeoutError', 'AbortError', 'ConditionalCheckFailedException', 'ProvisionedThroughputExceededException',
    'ThrottlingException', 'UnknownError'}
ERROR_CODES = {'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ERR_CANCELED', 'ERR_BAD_REQUEST',
    'ERR_BAD_RESPONSE', 'ERR_NETWORK', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNREFUSED'}
REASONS = {'RM_INVALID_FISCAL_NATURE', 'RM_INVALID_REFERENCE', 'RM_DUPLICATE_RECORD', 'RM_REQUIRED_FIELD', 'RM_PERIOD_CLOSED',
    'RM_PERMISSION_DENIED', 'RM_INVALID_DATE', 'RM_INVALID_FORMAT', 'RM_SQL_EXCEPTION',
    'RM_PRIMARY_KEY_COMPANY_MISMATCH', 'RM_UNCLASSIFIED_REJECTION', 'RM_UNEXPECTED_RESULT'}
MENTIONED_FIELDS = {'CODTRB', 'CODTRBBASE', 'CODIGOIRRF', 'IDNAT', 'CODTMV', 'IDPRD', 'CODCCUSTO',
    'SERIE', 'DATAEMISSAO', 'DATASAIDA', 'DATAVENCIMENTO', 'NUMEROMOV', 'IDPGTO', 'CODCOLPGTO'}
NATIVE_TYPES = {'SqlException', 'ConstraintException', 'NoNullAllowedException', 'FormatException',
    'InvalidCastException', 'NullReferenceException', 'InvalidOperationException', 'ArgumentException'}
CHECKPOINTS = {'creating_checkpoint_started', 'creating_checkpoint_confirmed', 'transport_call_started',
    'transport_call_returned', 'primary_key_received', 'created_checkpoint_started', 'created_checkpoint_confirmed'}
STAGES = {'preflight', 'checkpoint_creating', 'transport_call', 'transport_result', 'checkpoint_created'}
ENUMS = {'state': STATES, 'event': CHECKPOINTS, 'creationStage': STAGES,
    'errorType': ERROR_TYPES, 'errorCode': ERROR_CODES, 'reasonCode': REASONS,
    'reasonSource': {'allowlist_v1'}, 'category': {'rm_rejection_or_diagnostic', 'unexpected_result'}}
NUMBERS = {'ticket', 'coligada', 'filial', 'pg', 'idMov', 'receivedPg', 'idPgto', 'status',
    'durationMs', 'duracaoMs', 'length', 'lineCount'}
LABELS = {'[RM-IDPGTO] Etapa de criação': 'creation_checkpoint',
    '[RM-IDPGTO] Retorno de criação sem chave confirmada': 'non_key_result',
    '[RM-IDPGTO] Integração pendente': 'payment_pending',
    '[RM-IDPGTO] Vínculo financeiro confirmado': 'bank_confirmed',
    '[RM-ERRO] Falha no caminho seguro': 'safe_core_error'}


class AuditError(Exception):
    pass


def scalar(message, name):
    # Node util.inspect multiline and JSON keys; no eval, free-text captures or
    # permissive prefix matching (e.g. 123private must not become numeric123).
    match = re.search(r'(?:^|[,{\n])\s*[\'\"]?' + re.escape(name) +
        r'[\'\"]?\s*:\s*(?:\'([^\'\r\n]*)\'|"([^"\r\n]*)"|([A-Za-z0-9_.-]+))(?=\s*[,}\r\n]|\s*$)', message)
    return next((v for v in match.groups() if v is not None), None) if match else None


def safe_fields(message):
    safe = {}
    for name, choices in ENUMS.items():
        value = scalar(message, name)
        if value in choices:
            safe[name] = value
    for name in NUMBERS:
        value = scalar(message, name)
        if value and re.fullmatch(r'\d{1,16}(?:\.\d{1,6})?', value):
            number = float(value) if '.' in value else int(value)
            if 0 <= number <= 9007199254740991:
                safe[name] = number
    for name in ['state', 'pg', 'creationStage', 'receivedPg']:
        if scalar(message, name) == 'undefined':
            safe[name + 'Undefined'] = True
    digest = scalar(message, 'responseSha256')
    if digest and re.fullmatch(r'[0-9a-f]{64}', digest):
        safe['responseSha256'] = digest
    for name, choices in [('mentionedFields', MENTIONED_FIELDS), ('nativeErrorTypes', NATIVE_TYPES)]:
        match = re.search(r'[\'\"]?' + name + r'[\'\"]?\s*:\s*\[([^\]]*)\]', message, re.S)
        if not match:
            continue
        inside = match.group(1)
        values = re.findall(r'[\'\"]([A-Za-z0-9_]+)[\'\"]', inside)
        residue = re.sub(r'[\'\"][A-Za-z0-9_]+[\'\"]|[\s,]', '', inside)
        if not residue and all(v in choices for v in values):
            safe[name] = values
        else:
            safe[name + 'Valid'] = False
    return safe


def unwrap(event):
    message = event.get('message', '')
    request = None
    if not isinstance(message, str):
        return '', None
    if message.lstrip().startswith('{'):
        try:
            wrapper = json.loads(message)
            if isinstance(wrapper, dict) and isinstance(wrapper.get('message'), str):
                candidate = wrapper.get('requestId')
                request = candidate if isinstance(candidate, str) and re.fullmatch(UUID, candidate, re.I) else None
                message = wrapper['message']
        except ValueError:
            pass
    match = re.search(r'\b' + UUID + r'\b', message, re.I)
    return message, request or (match.group(0).lower() if match else None)


def sanitize(event):
    message, request = unwrap(event)
    timestamp = event.get('timestamp')
    if not isinstance(timestamp, int):
        return None
    row = {'timestamp': timestamp, 'utc': datetime.datetime.fromtimestamp(timestamp / 1000,
        datetime.timezone.utc).isoformat(), 'requestId': request}
    for label, kind in LABELS.items():
        if label in message:
            body = message.split(label, 1)[1].strip()
            row.update({'kind': kind, **safe_fields(body)})
            if kind == 'non_key_result':
                row['nonKeyResult'] = True
            return row
    if '[RM-DIAG]' in message:
        try:
            data = json.loads(message.split('[RM-DIAG]', 1)[1].strip())
            if not isinstance(data, dict):
                return None
        except ValueError:
            return {**row, 'kind': 'legacy_diagnostic', 'parseable': False}
        row.update({'kind': 'legacy_diagnostic', **safe_fields(json.dumps(data))})
        for name, choices in {'etapa': {'SaveRecord', 'handlerLegado', 'execucao', 'movimento'},
            'evento': {'inicio', 'retorno', 'erro'},
            'resultado': {'rejeicaoRm', 'sucesso', 'erroSemMovimentoConfirmado', 'gravado', 'recuperado'}}.items():
            if data.get(name) in choices:
                row[name] = data[name]
        if data.get('codTmv') == CODTMV:
            row['codTmv'] = CODTMV
        return row
    for marker, kind in [('START RequestId:', 'lambda_start'), ('END RequestId:', 'lambda_end'),
        ('REPORT RequestId:', 'lambda_report')]:
        if marker not in message:
            continue
        row['kind'] = kind
        if kind == 'lambda_start':
            version = re.search(r'\bVersion:\s*(\$LATEST|[1-9]\d*)\b', message)
            if version:
                row['version'] = version.group(1)
        if kind == 'lambda_report':
            for name, pattern in {'durationMs': r'(?<!Billed )\bDuration:\s*([\d.]+)\s*ms',
                'billedDurationMs': r'Billed Duration:\s*([\d.]+)\s*ms',
                'maxMemoryMb': r'Max Memory Used:\s*(\d+)\s*MB'}.items():
                match = re.search(pattern, message)
                if match:
                    row[name] = float(match.group(1))
            status = re.search(r'\bStatus:\s*(success|error|timeout)\b', message)
            if status:
                row['status'] = status.group(1)
        return row
    return None  # Never export raw payload, generic core exceptions or raw RM text.


def aws(*args, deadline):
    if tuple(args[:2]) not in AWS_READS:
        raise AuditError('AWS_OPERATION_NOT_ALLOWLISTED')
    remaining = deadline - time.monotonic()
    if remaining < 2:
        raise AuditError('AUDIT_TIME_BUDGET_EXHAUSTED')
    try:
        result = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json',
            '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '20'],
            capture_output=True, text=True, timeout=min(30, remaining))
    except subprocess.TimeoutExpired:
        raise AuditError('AWS_READ_TIMEOUT') from None
    if result.returncode:
        raise AuditError('AWS_READ_FAILED')  # Never forward CLI stderr/environment.
    try:
        return json.loads(result.stdout or '{}')
    except ValueError:
        raise AuditError('AWS_READ_INVALID_JSON') from None


def read_log_window(pattern, start, end, deadline):
    events, token, seen = [], None, set()
    for page_number in range(1, 101):
        args = ['logs', 'filter-log-events', '--log-group-name', GROUP, '--start-time', str(start),
            '--end-time', str(end), '--filter-pattern', pattern, '--limit', '1000', '--no-paginate']
        if token:
            args += ['--next-token', token]
        page = aws(*args, deadline=deadline)
        events.extend(page.get('events', []))
        token = page.get('nextToken')
        if not token:
            return events, {'pages': page_number, 'complete': True, 'matchedEvents': len(events)}
        if token in seen:
            return events, {'pages': page_number, 'complete': False, 'reason': 'TOKEN_REPEATED', 'matchedEvents': len(events)}
        seen.add(token)
    return events, {'pages': 100, 'complete': False, 'reason': 'PAGE_LIMIT', 'matchedEvents': len(events)}


def safe_reservation(item):
    safe = {}
    for field in ['pk', 'digest', 'owner', 'state', 'pg', 'lockUntil']:
        value = (item.get(field) or {}).get('S' if field != 'lockUntil' else 'N')
        if value is None:
            continue
        valid = (field == 'pk' and value == PK or field == 'digest' and re.fullmatch(r'[0-9a-f]{64}', value)
            or field == 'owner' and re.fullmatch(UUID, value, re.I) or field == 'state' and value in STATES
            or field in ['pg', 'lockUntil'] and re.fullmatch(r'\d{1,16}', value))
        if valid:
            safe[field] = value
        else:
            safe[field + 'Valid'] = False
    return safe


def add_events(out, events, seen):
    for event in events:
        message, request = unwrap(event)
        row = sanitize(event)
        if not row or (request != REFERENCE_REQUEST and str(row.get('ticket', '')) != TICKET):
            continue
        signature = (event.get('timestamp'), hashlib.sha256(message.encode()).hexdigest())
        if signature not in seen:
            seen.add(signature)
            out['events'].append(row)


def main():
    deadline = time.monotonic() + 210
    end = datetime.datetime.now(datetime.timezone.utc)
    out = {'observedUtc': end.isoformat(), 'businessWrites': False, 'configurationWrites': False,
        'candidateConfirmedByUser': False, 'ticket': TICKET, 'company': COMPANY, 'branch': BRANCH,
        'codTmv': CODTMV, 'referenceRequestId': REFERENCE_REQUEST,
        'windowStartUtc': START.isoformat(), 'windowEndUtc': end.isoformat(),
        'allowedAwsOperations': sorted('/'.join(op) for op in AWS_READS), 'events': []}
    exit_code = 0
    try:
        if aws('sts', 'get-caller-identity', deadline=deadline).get('Account') != ACCOUNT:
            raise AuditError('AWS_ACCOUNT_MISMATCH')
        cfg = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION, deadline=deadline)
        env = cfg.get('Environment', {}).get('Variables', {})
        if (cfg.get('FunctionName') != FUNCTION or env.get('STAGE') != 'prod'
            or env.get('PAGAMENTO_IDPGTO_TABLE') != TABLE
            or cfg.get('LoggingConfig', {}).get('LogGroup', GROUP) != GROUP):
            raise AuditError('AWS_TARGET_MISMATCH')
        out['function'] = {key: cfg.get(key) for key in ['FunctionName', 'CodeSha256', 'RevisionId',
            'LastUpdateStatus', 'State', 'Timeout', 'Runtime', 'LastModified']}
        response = aws('dynamodb', 'get-item', '--table-name', TABLE, '--consistent-read',
            '--key', json.dumps({'pk': {'S': PK}}), deadline=deadline)
        item = response.get('Item', {})
        record = safe_reservation(item)
        out['reservation'] = {'key': PK, 'exists': bool(item), 'record': record,
            'expectedDigestKnown': EXPECTED_DIGEST is not None,
            'expectedDigestMatches': record.get('digest') == EXPECTED_DIGEST if EXPECTED_DIGEST else None}
        start_ms, end_ms = int(START.timestamp() * 1000), int(end.timestamp() * 1000) + 1
        if end_ms <= start_ms:
            raise AuditError('INVALID_LOG_WINDOW')
        # The Zeev localizer has no timezone/AM-PM. These are hypotheses,
        # not claimed timestamps or permission to mutate discovered tickets.
        out['localizerCode'] = '202611030609-67'
        out['localizerWindowCandidates'] = []
        for hour in [6, 9, 18, 21]:
            center = LOCALIZER_DAY.replace(hour=hour, minute=9)
            window_start = int((center - datetime.timedelta(minutes=3)).timestamp() * 1000)
            window_end = min(end_ms, int((center + datetime.timedelta(minutes=3)).timestamp() * 1000))
            if window_end <= window_start:
                continue
            window_events, coverage = read_log_window('"[RM-IDPGTO]" "Integração pendente"',
                window_start, window_end, deadline)
            pending = [sanitize(event) for event in window_events]
            out['localizerWindowCandidates'].append({'hypothesisCenterUtc': center.isoformat(),
                'coverage': coverage, 'events': [event for event in pending if event and
                    event.get('kind') == 'payment_pending' and event.get('status') == 409]})
        seen = set()
        out['logCoverage'] = {}
        matches, ticket_scope = read_log_window('"' + TICKET + '"', start_ms, end_ms, deadline)
        out['logCoverage']['ticket'] = ticket_scope
        add_events(out, matches, seen)  # Preserve safe ticket evidence if context read fails.
        context, request_scope = read_log_window('"' + REFERENCE_REQUEST + '"', start_ms, end_ms, deadline)
        out['logCoverage']['referenceRequest'] = request_scope
        add_events(out, context, seen)
        out['windowComplete'] = ticket_scope['complete'] and request_scope['complete']
        if not out['windowComplete']:
            exit_code = 2
    except Exception as error:
        out['windowComplete'] = False
        out['auditError'] = str(error) if isinstance(error, AuditError) else 'LOCAL_AUDIT_FAILURE'
        exit_code = 2
    out['events'].sort(key=lambda row: row['timestamp'])
    out['requestIds'] = sorted({r['requestId'] for r in out['events'] if r.get('requestId')})
    out['pending409Timeline'] = [r for r in out['events'] if r['kind'] == 'payment_pending' and r.get('status') == 409]
    original = [r for r in out['events'] if r.get('requestId') == REFERENCE_REQUEST]
    out['referenceRequestMarkers'] = {'startSeen': any(r['kind'] == 'lambda_start' for r in original),
        'endSeen': any(r['kind'] == 'lambda_end' for r in original),
        'reportSeen': any(r['kind'] == 'lambda_report' for r in original),
        'nonKeyDiagnosticSeen': any(r['kind'] == 'non_key_result' for r in original)}
    OUT.mkdir(exist_ok=True)
    (OUT / 'readback.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return exit_code


def self_test():
    secret = 'PRIVATE_PIX_SECRET@example.test'
    message = "ticket: '226374',\n reasonCode: 'RM_INVALID_DATE', reasonSource: 'allowlist_v1',\n" + \
        "responseSha256: '" + 'a' * 64 + "', length: 1291, lineCount: 12,\n" + \
        "mentionedFields: [\n 'DATAEMISSAO', 'DATAVENCIMENTO'\n ], nativeErrorTypes: [ 'FormatException' ]"
    event = {'timestamp': 1793739541667, 'message': REFERENCE_REQUEST + '\tWARN\t[RM-IDPGTO] Retorno de criação sem chave confirmada {\n' + message + '\n}'}
    row = sanitize(event)
    assert row['reasonCode'] == 'RM_INVALID_DATE' and row['length'] == 1291 and row['lineCount'] == 12
    assert row['mentionedFields'] == ['DATAEMISSAO', 'DATAVENCIMENTO'] and row['nativeErrorTypes'] == ['FormatException']
    assert row['responseSha256'] == 'a' * 64 and row['nonKeyResult']
    pending = sanitize({'timestamp': 1, 'message': REFERENCE_REQUEST + "\t[RM-IDPGTO] Integração pendente { ticket: '226374', status: 409, state: undefined, pg: undefined, creationStage: undefined }"})
    assert pending['status'] == 409 and pending['stateUndefined'] and pending['pgUndefined']
    assert secret not in json.dumps(safe_fields("{reasonCode:'" + secret + "', errorCode:'" + secret + "', mentionedFields:['" + secret + "'], responseSha256:'" + secret + "'}"))
    assert sanitize({'timestamp': 1, 'message': '[RM-INFO] Campos recebidos: ' + secret}) is None
    assert sanitize({'timestamp': 1, 'message': '[RM-ERRO] ' + secret}) is None
    legacy = sanitize({'timestamp': 1, 'message': REFERENCE_REQUEST + '\t[RM-DIAG] ' + json.dumps({'ticket': TICKET,
        'coligada': COMPANY, 'filial': BRANCH, 'codTmv': CODTMV, 'evento': 'erro', 'etapa': 'SaveRecord',
        'errorType': 'TimeoutError', 'errorCode': 'ETIMEDOUT', 'duracaoMs': 1234, 'raw': secret})})
    assert legacy['errorType'] == 'TimeoutError' and legacy['duracaoMs'] == 1234 and secret not in json.dumps(legacy)
    assert safe_fields('{length:1234private, lineCount:2}') == {'lineCount': 2}
    report = sanitize({'timestamp': 1, 'message': 'REPORT RequestId: ' + REFERENCE_REQUEST + '\tDuration: 1398.2 ms\tBilled Duration: 1400 ms\tMax Memory Used: 88 MB\tStatus: success'})
    assert report['durationMs'] == 1398.2 and report['billedDurationMs'] == 1400 and report['status'] == 'success'
    for operation in [('lambda', 'invoke'), ('dynamodb', 'put-item'), ('dynamodb', 'update-item'), ('dynamodb', 'delete-item'), ('lambda', 'update-function-code')]:
        try:
            aws(*operation, deadline=time.monotonic() + 1)
        except AuditError as error:
            assert str(error) == 'AWS_OPERATION_NOT_ALLOWLISTED'
        else:
            raise AssertionError('Mutation was not rejected')
    assert safe_reservation({'pk': {'S': PK}, 'digest': {'S': 'a' * 64}, 'secret': {'S': secret}}) == {'pk': PK, 'digest': 'a' * 64}
    wrapped = sanitize({'timestamp': 1, 'message': json.dumps({'requestId': REFERENCE_REQUEST,
        'message': '[RM-IDPGTO] Etapa de criação { ticket: 226374, event: \'primary_key_received\', idMov: 9001 }'})})
    assert wrapped['event'] == 'primary_key_received' and wrapped['requestId'] == REFERENCE_REQUEST
    merged = {'events': []}
    add_events(merged, [event, event], set())
    assert len(merged['events']) == 1 and merged['events'][0]['reasonSource'] == 'allowlist_v1'
    original_aws = globals()['aws']
    try:
        pages = iter([{'events': [], 'nextToken': 'page2'}, {'events': [], 'nextToken': 'page3'}, {'events': [event]}])
        globals()['aws'] = lambda *args, **kwargs: next(pages)
        events, coverage = read_log_window('"226374"', 0, 2, time.monotonic() + 30)
        assert coverage['complete'] and coverage['pages'] == 3 and events == [event]
        pages = iter([{'events': [], 'nextToken': 'same'}, {'events': [], 'nextToken': 'same'}])
        events, coverage = read_log_window('"226374"', 0, 2, time.monotonic() + 30)
        assert not coverage['complete'] and coverage['reason'] == 'TOKEN_REPEATED'
    finally:
        globals()['aws'] = original_aws
    print(json.dumps({'selfTest': 'passed', 'awsRequests': 0, 'allowedAwsOperations': sorted('/'.join(op) for op in AWS_READS)}))


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    elif sys.argv[1:]:
        raise SystemExit('Only --self-test or no arguments are accepted')
    else:
        raise SystemExit(main())
