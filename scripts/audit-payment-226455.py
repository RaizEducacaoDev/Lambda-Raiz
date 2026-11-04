"""Read-only incident 226455: no invoke, reservation changes, RM or Zeev writes."""
import datetime as dt
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import re
import sys
import time

spec = importlib.util.spec_from_file_location('incident_base', Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
a.TICKET, a.COMPANY, a.BRANCH, a.PK = '226455', '9', '2', 'prod#PG#9#226455'
deadline = time.monotonic() + 300
assert a.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == a.ACCOUNT
if os.environ.get('INCIDENT_ORIGINAL_ONLY') == '1':
    request='4a422f5f-566c-4f32-895a-00ad2d72041e'
    raw, covered=a.read_log_window('"'+request+'"',1793366400000,1793366700000,deadline)
    markers=['DATASAIDA','DATAEMISSAO','DATAVENCIMENTO','CHAVEACESSONFE','NUMEROMOV','SERIE','IDPRD','CODLOC','CODCCUSTO','IDPGTO','CODIGOBARRA','IPTE']
    phrases={'entry_date':'DATA DE ENTRADA','access_key':'CHAVE DE ACESSO','barcode':'CODIGO DE BARRAS',
             'duplicate':'DUPLIC','required':'OBRIGATOR','invalid':'INVALID','period':'PERIODO',
             'timeout':'TIMEOUT','reset':'ECONNRESET','soap_fault':'FAULT','return_without_key':'CHAVE',
             'stock':'ESTOQUE','permission':'PERMISSAO','format':'FORMAT','product':'PRODUTO'}
    known_errors={
        'RM_RETURN_WITHOUT_EXPECTED_KEY':'Criação RM de resultado incerto; consultar movimento do ticket',
        'CREATION_NOT_CONFIRMED':'Criação não confirmada; preservar reserva para conciliação',
        'CREATION_STATE_MISMATCH':'Criação fora do estado autorizado',
        'TIME_BEFORE_DISPATCH':'Tempo insuficiente antes de enviar a criação ao RM; manter pendente sem criar',
        'TIME_BUDGET':'Tempo insuficiente; operação mantida pendente',
        'SOAP_INVALID':'SOAP RM inválido ou Fault',
        'SOAP_RESULT_MISSING':'Resultado SOAP RM ausente ou ambíguo',
        'XML_INVALID':'XML RM inválido'}
    import unicodedata
    rows=[]
    for event in raw:
        message,_=a.unwrap(event)
        normalized=''.join(c for c in unicodedata.normalize('NFD',message) if not unicodedata.combining(c)).upper()
        safe=a.sanitize(event)
        row={'timestamp':event['timestamp'],'known':safe,'length':len(message),
             'messageSha256':hashlib.sha256(message.encode()).hexdigest(),
             'labels':[label for label in ['[RM-INFO]','[RM-ERRO]','[RM-WARN]','[RM-DIAG]','[RM-IDPGTO]'] if label in message],
             'mentionedFields':[v for v in markers if re.search(r'\b'+v+r'\b',normalized)],
             'fixedIndicators':[k for k,v in phrases.items() if v in normalized]}
        row['knownCodeErrors']=[code for code,literal in known_errors.items() if literal in message]
        # Export only the date field if explicitly present and matching a bounded date grammar.
        value=a.scalar(message,'dataDeEntrada')
        if value is not None and re.fullmatch(r'[0-9T:/ .+Z-]{0,35}',value): row['dataDeEntradaIfLogged']=value
        rows.append(row)
    out={'ticket':226455,'requestId':request,'businessWrites':False,'coverage':covered,'events':rows}
    directory=Path('.payment-226455-audit');directory.mkdir(exist_ok=True)
    (directory/'original-detail.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps(out,indent=2));assert covered['complete'];sys.exit(0)
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
