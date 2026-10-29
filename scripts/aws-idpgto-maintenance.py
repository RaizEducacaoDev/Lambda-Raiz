"""Read-only AWS baseline; never exports environment variables or raw bank logs."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import urllib.request
import base64

FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
ACCOUNT = '757843862365'
out = pathlib.Path('.idpgto-evidence')
out.mkdir(exist_ok=True)

def aws(*args):
    result = subprocess.run(['aws', *args, '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'AWS {args[0]}/{args[1]} failed: {result.stderr[:800]}')
    return json.loads(result.stdout or '{}')

identity = aws('sts', 'get-caller-identity')
assert identity['Account'] == ACCOUNT, 'Unexpected AWS account'
active = aws('lambda', 'get-function', '--function-name', FUNCTION)
cfg = active['Configuration']
assert cfg['FunctionName'] == FUNCTION
metadata = {key: cfg.get(key) for key in ['FunctionName', 'Runtime', 'Handler', 'Architectures',
    'CodeSha256', 'RevisionId', 'LastModified', 'Timeout', 'MemorySize', 'State', 'LastUpdateStatus', 'Role']}
metadata.update({'account': ACCOUNT, 'region': 'sa-east-1', 'observedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
metadata['paymentFlags'] = {k: v for k, v in cfg.get('Environment', {}).get('Variables', {}).items() if k.startswith('PAGAMENTO_')}
data = urllib.request.urlopen(active['Code']['Location'], timeout=30).read()
assert base64.b64encode(hashlib.sha256(data).digest()).decode() == cfg['CodeSha256']
(out / 'active-before.zip').write_bytes(data)
(out / 'baseline.json').write_text(json.dumps(metadata, indent=2))
print(json.dumps(metadata, indent=2))

start = int(datetime.datetime(2026, 10, 28, 21, 18, tzinfo=datetime.timezone.utc).timestamp() * 1000)
try:
    events = aws('logs', 'filter-log-events', '--log-group-name', '/aws/lambda/' + FUNCTION,
        '--start-time', str(start), '--end-time', str(start + 180000), '--filter-pattern', '"227324"')
    safe = []
    allowed = ['ticketRaiz', 'tipoDaSolicitacao', 'atividadeAtual', 'tipoDoPagamento', 'formaDePagamento',
        'idpgto', 'idPgto', 'IDPGTO', 'idPagamento', 'CODCOLPGTO', 'codcolpgto', 'codColPgto',
        'codigoDaColigada2', 'codigoDaFilial2', 'codigoDoFornecedor', 'CODCOLCFO', 'idDoMovimento', 'idDoLancamento']
    for event in events.get('events', []):
        msg = event.get('message', '')
        item = {'timestamp': event['timestamp'], 'eventId': event['eventId']}
        if 'Campos recebidos:' in msg:
            try:
                fields = json.loads(msg.split('Campos recebidos:', 1)[1].strip())
                item['fields'] = {k: fields[k] for k in allowed if k in fields}
                item['bankPayloadPresent'] = {k: bool(fields.get(k)) for k in ['chavePIX', 'codigoDeBarrasBoleto', 'codigoPagamento']}
            except ValueError:
                item['payloadParseable'] = False
        else:
            item['category'] = 'related_log_without_raw_payload'
        safe.append(item)
    (out / 'ticket-log-summary.json').write_text(json.dumps(safe, indent=2))
    print(json.dumps({'ticketLogEvents': len(safe), 'summary': safe}, indent=2))
except RuntimeError as exc:
    (out / 'logs-unavailable.json').write_text(json.dumps({'error': str(exc)}))
    print('CloudWatch unavailable; baseline remains available.')
