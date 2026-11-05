"""Review fixed error metadata for the production payment Lambda. AWS reads only."""
import collections,datetime as dt,importlib.util,json,re,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('a',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.AWS_READS=a.AWS_READS|{('logs','start-query'),('logs','get-query-results')}
run_cli=a.subprocess.run
def safe_cli(*args,**kwargs):
    result=run_cli(*args,**kwargs)
    if result.returncode:
        found=re.search(r'An error occurred \(([A-Za-z]+)\)',result.stderr or '')
        allowed={'AccessDeniedException','InvalidParameterException','ThrottlingException','ResourceNotFoundException','ServiceUnavailableException','UnrecognizedClientException','ExpiredTokenException'}
        code=found[1] if found and found[1] in allowed else 'CLI_FAILURE'
        if 'Read timeout' in (result.stderr or ''):code='READ_TIMEOUT'
        raise a.AuditError('AWS_READ_FAILED_'+code)
    return result
a.subprocess.run=safe_cli
outdir=Path('.review-payment-errors-20261105');outdir.mkdir(exist_ok=True)
deadline=time.monotonic()+220
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('STAGE')=='prod'
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
codes={'FALHA_INTEGRACAO_PAGAMENTO','PRAZO_INTEGRACAO_INSUFICIENTE','RESPOSTA_TOTVS_INVALIDA','COMUNICACAO_NAO_CONFIRMADA','FALHA_COMUNICACAO_TOTVS','OPERACAO_EM_CONFLITO','OPERACAO_EM_PROCESSAMENTO','DADOS_SOLICITACAO_ALTERADOS','MOVIMENTO_RESERVA_DIVERGENTE','ESTADO_TENTATIVA_INVALIDO','DADOS_MOVIMENTO_DIVERGENTES','DADOS_PAGAMENTO_INVALIDOS','IDPGTO_NAO_CONFIRMADO','NATUREZA_FISCAL_INCOMPATIVEL','DOCUMENTO_RM_DUPLICADO','NUMERO_DOCUMENTO_INVALIDO','SERIE_DOCUMENTO_INVALIDA'}|a.REASONS
a.ENUMS={**a.ENUMS,'code':codes,'reason':codes|{'FALHA_TECNICA','PRAZO_INSUFICIENTE','RESPOSTA_RM_INVALIDA','TIMEOUT_OU_CANCELAMENTO','FALHA_COMUNICACAO','CONCORRENCIA_DETECTADA'},'origem':{'TOTVS','FORMULARIO','INTEGRACAO'},'etapa':{'inicio','identidade_bancaria','validacao_solicitacao','consulta_existente','validacao_bancaria','validacao_documento','validacao_fiscal','controle_tentativa','criacao_movimento','controle_criacao','leitura_movimento','leitura_lancamento','preparacao_vinculo','gravacao_vinculo','confirmacao_vinculo','confirmacao_final'},'efeito':{'MOVIMENTO_CONFIRMADO','CRIACAO_NAO_CONFIRMADA','SEM_MOVIMENTO_CONFIRMADO'}}
a.NUMBERS=a.NUMBERS|{'necessarioMs','disponivelMs'}
start=dt.datetime(2026,11,5,18,tzinfo=dt.timezone.utc);end=dt.datetime.now(dt.timezone.utc)
assert start<end<start+dt.timedelta(hours=12)
query='fields toMillis(@timestamp) as timestampMillis, @message | filter @message like /pendente/ or @message like /reasonCode/ | sort @timestamp asc | limit 10000'
qid=a.aws('logs','start-query','--log-group-name',a.GROUP,'--start-time',str(int(start.timestamp())),
          '--end-time',str(int(end.timestamp())),'--query-string',query,deadline=deadline)['queryId']
assert re.fullmatch(a.UUID,qid,re.I)
result={}
while time.monotonic()<deadline-30:
    result=a.aws('logs','get-query-results','--query-id',qid,deadline=deadline)
    if result.get('status') in ['Complete','Failed','Cancelled','Timeout']:break
    time.sleep(2)
rows=[]
for result_row in result.get('results',[]):
    fields={f['field']:f['value'] for f in result_row}
    ts=int(fields['timestampMillis']);assert int(start.timestamp()*1000)<=ts<=int(end.timestamp()*1000)
    event={'timestamp':ts,'message':fields.get('@message','')}
    safe=a.sanitize(event)
    if safe is not None:rows.append(safe)
stats=result.get('statistics',{})
coverage=[{'method':'LogsInsights','status':result.get('status'),'matchedEvents':stats.get('recordsMatched'),
           'recordsScanned':stats.get('recordsScanned'),'bytesScanned':stats.get('bytesScanned'),
           'complete':result.get('status')=='Complete' and stats.get('recordsMatched',10001)<=10000}]
unique={(r['timestamp'],r.get('requestId'),r['kind']):r for r in rows};rows=sorted(unique.values(),key=lambda r:r['timestamp'])
pending=[r for r in rows if r['kind']=='payment_pending']
native=[r for r in rows if r['kind']=='non_key_result']
def groups(items,fields):
    counts=collections.Counter(tuple(str(r.get(k,'NOT_RECORDED')) for k in fields) for r in items)
    return [dict(zip(fields,k),count=v) for k,v in sorted(counts.items(),key=lambda x:(-x[1],x[0]))]
result={'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified']},'readOnly':True,'awsWrites':False,'lambdaInvoked':False,
        'observedUtc':end.isoformat(),'windowStartUtc':start.isoformat(),'coverage':coverage,'coverageComplete':all(v['complete'] for v in coverage),
        'pendingCount':len(pending),'nativeResultCount':len(native),'pendingGroups':groups(pending,['status','code','etapa','efeito']),
        'nativeGroups':groups(native,['reasonCode','responseSha256']),'events':rows}
(outdir/'review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='events'},ensure_ascii=False,indent=2))
assert result['coverageComplete'],'Incomplete review coverage'
