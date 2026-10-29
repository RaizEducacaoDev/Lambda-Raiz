"""Scoped AWS maintenance; never exports environment variables or raw bank logs."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import urllib.request
import base64
import os
import re
import zipfile

FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
ACCOUNT = '757843862365'
out = pathlib.Path('.idpgto-evidence')
out.mkdir(exist_ok=True)

def aws(*args, payload=None):
    command=['aws', *args, '--output', 'json']
    if payload is not None:command.extend(['--cli-input-json','file:///dev/stdin'])
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None, capture_output=True, text=True)
    if result.returncode:
        match=re.search(r'An error occurred \(([^)]+)\)',result.stderr)
        raise RuntimeError(f'AWS {args[0]}/{args[1]} failed: {match.group(1) if match else "CLI_ERROR"}')
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
events={'events':[]}
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

if os.environ.get('IDPGTO_OPERATION') != 'deploy':
    raise SystemExit(0)

BASELINE='b67LvMkiNMdDwbxosvWUdLuROKDowQPGQkdqPf/pjfg='
assert cfg['CodeSha256']==BASELINE, 'Active function changed: do not overwrite'
assert cfg['RevisionId']=='891fa7e0-2bde-43d0-9ad1-3252bae041ee', 'Function configuration drift'
assert cfg['Handler']=='src/functions/rm/post/solicitacaoDePagamento.handler'
assert cfg['Role']==f'arn:aws:iam::{ACCOUNT}:role/lambda-raiz-prod-sa-east-1-lambdaRole'
assert cfg['Runtime']=='nodejs22.x' and cfg['Architectures']==['arm64']

original=None
for e in events.get('events',[]):
    msg=e.get('message','')
    if 'Campos recebidos:' in msg:
        candidate_fields=json.loads(msg.split('Campos recebidos:',1)[1].strip())
        if str(candidate_fields.get('ticketRaiz'))=='227324':original=candidate_fields;break
assert original is not None,'Original test request unavailable; stop before AWS changes'
assert original['codigoDaColigada2']=='31' and original['codigoDaFilial2']=='1'
assert original['codigoDoFornecedor']=='0000173261' and original['tipoDaSolicitacao']=='PG'
assert str(original['valorTotal']).replace(',','.') in ['1','1.0','1.00']

# Build against the fresh production snapshot, not against an old Git bundle.
subprocess.run(['python3','scripts/build-pagamento-package.py','--baseline',str(out/'active-before.zip'),
    '--bundle','.build/solicitacaoDePagamento.cjs','--output','.build/pagamento-idpgto.zip'],check=True)
subprocess.run(['node','scripts/smoke-pagamento-package.cjs'],check=True)

table='lambda-raiz-prod-pagamento-idpgto'
try:
    described=aws('dynamodb','describe-table','--table-name',table)
except RuntimeError as exc:
    if 'ResourceNotFoundException' not in str(exc):raise
    aws('dynamodb','create-table','--table-name',table,'--billing-mode','PAY_PER_REQUEST',
        '--attribute-definitions','AttributeName=pk,AttributeType=S','--key-schema','AttributeName=pk,KeyType=HASH',
        '--sse-specification','Enabled=true')
    subprocess.run(['aws','dynamodb','wait','table-exists','--table-name',table],check=True)
    described=aws('dynamodb','describe-table','--table-name',table)
assert described['Table']['KeySchema']==[{'AttributeName':'pk','KeyType':'HASH'}]
ttl=aws('dynamodb','describe-time-to-live','--table-name',table)
assert ttl['TimeToLiveDescription']['TimeToLiveStatus']=='DISABLED', 'Reservations must never expire automatically'
aws('dynamodb','update-continuous-backups','--table-name',table,
    '--point-in-time-recovery-specification','PointInTimeRecoveryEnabled=true')
policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem'],
    'Resource':described['Table']['TableArn'],'Condition':{'ArnEquals':{'lambda:SourceFunctionArn':cfg['FunctionArn']}}}]}
try:
    prior_policy=aws('iam','get-role-policy','--role-name',cfg['Role'].rsplit('/',1)[1],
        '--policy-name','lambda-raiz-prod-pagamento-idpgto-only')
    assert prior_policy['PolicyDocument']==policy, 'Existing policy differs; preserve it for reconciliation'
except RuntimeError as exc:
    if 'NoSuchEntity' not in str(exc):raise
aws('iam','put-role-policy','--role-name',cfg['Role'].rsplit('/',1)[1],
    '--policy-name','lambda-raiz-prod-pagamento-idpgto-only','--policy-document',json.dumps(policy))

# Keep all existing environment values in memory; never write or print secrets.
variables=dict(cfg.get('Environment',{}).get('Variables',{}))
variables['PAGAMENTO_IDPGTO_TABLE']=table
updated=aws('lambda','update-function-configuration',payload={'FunctionName':FUNCTION,'RevisionId':cfg['RevisionId'],
    'Environment':{'Variables':variables}})
subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True)
current=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert current['CodeSha256']==BASELINE
assert current.get('Environment',{}).get('Variables',{})==variables
candidate=pathlib.Path('.build/pagamento-idpgto.zip')
candidate_sha=base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()
aws('lambda','update-function-code','--function-name',FUNCTION,'--revision-id',current['RevisionId'],
    '--zip-file','fileb://'+str(candidate))
subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True)
after=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert after['CodeSha256']==candidate_sha and after['LastUpdateStatus']=='Successful'
assert after['Handler']==cfg['Handler'] and after['Role']==cfg['Role'] and after['Timeout']==cfg['Timeout']
assert after['Runtime']==cfg['Runtime'] and after['Architectures']==cfg['Architectures']
assert after.get('Environment',{}).get('Variables',{})==variables
deployment={'function':FUNCTION,'region':'sa-east-1','baselineCodeSha256':BASELINE,'activeCodeSha256':candidate_sha,
    'revisionId':after['RevisionId'],'lastUpdateStatus':after['LastUpdateStatus'],'table':table,
    'rolePolicy':policy,'originalHandlerPreserved':True,'otherEnvironmentValuesPreserved':True,
    'deployedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(out/'deployment.json').write_text(json.dumps(deployment,indent=2));print(json.dumps(deployment,indent=2))

def invoke(fields,name):
    event={'body':json.dumps(fields)}
    result_path=out/(name+'.json')
    response=aws('lambda','invoke',str(result_path),payload={'FunctionName':FUNCTION,'InvocationType':'RequestResponse',
        'Payload':base64.b64encode(json.dumps(event).encode()).decode()})
    assert not response.get('FunctionError'), 'Lambda execution error'
    result=json.loads(result_path.read_text())
    return result

root={'tipoDaSolicitacao':'PG','codigoDaColigada2':'31','codigoDaFilial2':'1','codigoDoFornecedor':'0000173261','ticketRaiz':'999999990001'}
for i,bad in enumerate([root,{**root,'idpgto':'2','CODCOLPGTO':'1'},{**root,'idpgto':'2','IDPGTO':'3','CODCOLPGTO':'31'}]):
    assert invoke(bad,'negative-'+str(i))['statusCode']==422

# Existing R$1 test: associate its confirmed PIX without creating a new obligation.
# The exact original request is read in memory; raw bank information is never exported.
test={**original,'idpgto':'2','idPagamento':'31$_$0$_$0000173261$_$2','CODCOLPGTO':'31','CODCOLCFO':'0',
    'idDoMovimento':'452','idDoLancamento':'467'}
# Clear stale aliases only after verifying their intended correction against the exact key.
for alias in ['idPgto','IDPGTO','idpagamento']:
    if alias in test:test[alias]='2' if alias!='idpagamento' else test['idPagamento']
for alias in ['codcolpgto','codColPgto']:
    if alias in test:test[alias]='31'
first=invoke(test,'controlled-227324-first')
assert first['statusCode']==200, 'Controlled test did not confirm persistence; inspect sanitized response'
body=json.loads(first['body']);assert body['PG']=='452' and body['LF']=='467' and body['integracaoBancaria'] in ['gravada','ja_gravada']
second=invoke(test,'controlled-227324-replay')
assert second['statusCode']==200
body2=json.loads(second['body']);assert body2['PG']=='452' and body2['LF']=='467' and body2['integracaoBancaria']=='ja_gravada'
proof={'ticket':227324,'coligada':31,'idMov':452,'idLan':467,'expectedIdPgto':2,
    'first':body['integracaoBancaria'],'replay':body2['integracaoBancaria'],'newMovementRequested':False,
    'verifiedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(out/'controlled-test.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2))
