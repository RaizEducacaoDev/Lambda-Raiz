"""Read only the sanitized payment-error window for localizer 202611050445-2."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import time

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
OUT=Path('.localizer-202611050445');OUT.mkdir(exist_ok=True)
deadline=time.monotonic()+180
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('STAGE')=='prod'
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
start=dt.datetime(2026,11,5,19,43,tzinfo=dt.timezone.utc)
end=dt.datetime(2026,11,5,19,47,tzinfo=dt.timezone.utc)
assert end<dt.datetime.now(dt.timezone.utc)<end+dt.timedelta(hours=12)
codes={'FALHA_INTEGRACAO_PAGAMENTO','PRAZO_INTEGRACAO_INSUFICIENTE','RESPOSTA_TOTVS_INVALIDA','COMUNICACAO_NAO_CONFIRMADA','FALHA_COMUNICACAO_TOTVS','OPERACAO_EM_PROCESSAMENTO','DADOS_PAGAMENTO_INVALIDOS','IDPGTO_NAO_CONFIRMADO'}|a.REASONS
a.ENUMS={**a.ENUMS,'code':codes,'reason':codes|{'FALHA_TECNICA','PRAZO_INSUFICIENTE','TIMEOUT_OU_CANCELAMENTO','FALHA_COMUNICACAO','CONCORRENCIA_DETECTADA'},'origem':{'TOTVS','FORMULARIO','INTEGRACAO'},'etapa':{'inicio','identidade_bancaria','validacao_solicitacao','consulta_existente','validacao_bancaria','validacao_documento','validacao_fiscal','controle_tentativa','criacao_movimento','controle_criacao','leitura_movimento','leitura_lancamento','preparacao_vinculo','gravacao_vinculo','confirmacao_vinculo','confirmacao_final'},'efeito':{'MOVIMENTO_CONFIRMADO','CRIACAO_NAO_CONFIRMADA','SEM_MOVIMENTO_CONFIRMADO'}}
a.NUMBERS=a.NUMBERS|{'necessarioMs','disponivelMs'}
events,coverage=a.read_log_window('"[RM-IDPGTO] Integração pendente"',int(start.timestamp()*1000),int(end.timestamp()*1000),deadline)
requests={}
for e in events:
    _,r=a.unwrap(e)
    if r:requests.setdefault(r,[]).append(e['timestamp'])
assert len(requests)<=15,'Error window too broad'
result={'localizer':'202611050445-2','readOnly':True,'lambdaInvoked':False,'awsWrites':False,'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'coverage':coverage,'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified']},'requests':[]}
for r,times in sorted(requests.items(),key=lambda x:min(x[1])):
    rows,cov=a.read_log_window('"'+r+'"',min(times)-45000,max(times)+1000,deadline)
    result['requests'].append({'requestId':r,'coverage':cov,'events':[row for e in rows if (row:=a.sanitize(e)) is not None]})
result['coverageComplete']=coverage['complete'] and all(r['coverage']['complete'] for r in result['requests'])
(OUT/'readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
assert result['coverageComplete'],'Incomplete log coverage'
