"""Exact ticket 226698, AWS reads only; no invocation or financial writes."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import time
spec=importlib.util.spec_from_file_location('a',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.PK='prod#PG#8#226698'
OUT=Path('.226698-readonly');OUT.mkdir(exist_ok=True);deadline=time.monotonic()+180
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('STAGE')=='prod'
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
start=dt.datetime(2026,11,5,20,35,tzinfo=dt.timezone.utc);end=dt.datetime.now(dt.timezone.utc)
assert start<end<start+dt.timedelta(hours=3)
codes={'FALHA_INTEGRACAO_PAGAMENTO','OPERACAO_EM_CONFLITO','OPERACAO_EM_PROCESSAMENTO','DADOS_MOVIMENTO_DIVERGENTES','DADOS_PAGAMENTO_INVALIDOS','IDPGTO_NAO_CONFIRMADO','PRAZO_INTEGRACAO_INSUFICIENTE'}|a.REASONS
a.ENUMS={**a.ENUMS,'code':codes,'reason':codes|{'FALHA_TECNICA','CONCORRENCIA_DETECTADA','PRAZO_INSUFICIENTE'},'origem':{'TOTVS','FORMULARIO','INTEGRACAO'},'etapa':{'consulta_existente','controle_tentativa','criacao_movimento','leitura_movimento','gravacao_vinculo','confirmacao_vinculo','confirmacao_final'},'efeito':{'MOVIMENTO_CONFIRMADO','CRIACAO_NAO_CONFIRMADA','SEM_MOVIMENTO_CONFIRMADO'}}
events,coverage=a.read_log_window('"226698"',int(start.timestamp()*1000),int(end.timestamp()*1000),deadline)
requests={}
for event in events:
    _,request=a.unwrap(event)
    if request:requests.setdefault(request,[]).append(event['timestamp'])
assert len(requests)<=12,'Narrow the window'
def project(event):
    safe=a.sanitize(event)
    if safe is not None:return safe
    message,request=a.unwrap(event)
    markers={'[RM-IDPGTO] Divergência de movimento existente':'existing_mismatch','[RM-IDPGTO] Operação existente confirmada':'existing_confirmed'}
    for marker,kind in markers.items():
        if marker not in message:continue
        safe={'timestamp':event['timestamp'],'utc':dt.datetime.fromtimestamp(event['timestamp']/1000,dt.timezone.utc).isoformat(),'requestId':request,'kind':kind,**a.safe_fields(message.split(marker,1)[1])}
        if kind=='existing_mismatch':
            match=re.search(r'camposDivergentes\s*:\s*\[([^\]]*)\]',message,re.S)
            assert match
            fields=re.findall(r"['\"]([A-Z]+)['\"]",match[1])
            assert not re.sub(r"['\"][A-Z]+['\"]|[\s,]",'',match[1])
            assert fields and set(fields)<={'NUMEROMOV','SERIE','DATAEMISSAO','VALORBRUTO','CODCCUSTO','IDNAT'}
            safe['camposDivergentes']=fields
        return safe
    return None
out={'ticket':226698,'company':8,'localizer':'202611050542-10','observedUtc':end.isoformat(),'readOnly':True,'lambdaInvoked':False,'awsWrites':False,'coverage':coverage,'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified']},'requests':[]}
for request,times in sorted(requests.items(),key=lambda x:min(x[1])):
    rows,cov=a.read_log_window('"'+request+'"',min(times)-45000,max(times)+2000,deadline)
    out['requests'].append({'requestId':request,'coverage':cov,'events':[v for row in rows if (v:=project(row)) is not None]})
item=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':a.PK}}),deadline=deadline).get('Item',{})
out['reservation']=a.safe_reservation(item)
out['coverageComplete']=coverage['complete'] and all(r['coverage']['complete'] for r in out['requests'])
(OUT/'readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False,indent=2));assert out['coverageComplete']
