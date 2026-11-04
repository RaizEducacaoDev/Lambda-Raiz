"""One authorized ticket execution; no deployment, no parameter or Zeev changes."""
import base64,datetime as dt,hashlib,importlib.util,json,os,re,subprocess,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
o=load('observer','observe-payment-backlog.py');a=o.a
deadline=time.monotonic()+180
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']=='757843862365'
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg['CodeSha256']=='f4driLg+9qhXQN4A7hvgLvKrmpotW1EtSsk35lIVVVM=' and cfg['RevisionId']=='08becd62-7243-43b3-b7c2-e2adb52215d7'
assert cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
assert base64.b64encode(hashlib.sha256((ROOT/'.build/solicitacaoDePagamento.cjs').read_bytes()).digest()).decode()=='1Gife+Z0skdEMqZWajm+f/5fL0QD98QANwoaqmDM4fU='
env=cfg['Environment']['Variables']
assert env['STAGE']=='prod' and env['PAGAMENTO_IDPGTO_TABLE']=='lambda-raiz-prod-pagamento-idpgto'
assert env['RM_PROD'].rstrip('/')=='https://raizeducacao160286.rm.cloudtotvs.com.br'
obs=o.Observer.__new__(o.Observer);obs.plan={'ticket':225136};obs.opener=urllib.request.build_opener(o.NoRedirect());obs.zeev_token=os.environ['TICKET225136_ZEEV_TOKEN']
obs.rm_user=env['USERNAME_TOTVS'];obs.rm_auth='Basic '+base64.b64encode((obs.rm_user+':'+env['PASSWORD_TOTVS']).encode()).decode()
template=o.TEMPLATE.read_text(encoding='utf-8-sig');names=set(re.findall(r'\{Form\.(\w+)\}',template))|set(o.EXTRA)
snapshot,_=obs.zeev_snapshot(names);payload,fields=o.render(snapshot,template)
assert payload['serie']=='' and payload['idDaNaturezaFiscal']=='3' and payload['codigoDaNaturezaFiscal']=='1.949.01'
assert payload['dataDeEmissao']=='23/10/2026' and payload['dataDeEntrada']=='23/10/2026' and payload['dataDeVencimento']=='10/11/2026'
assert fields.get('idDoLancamento','')==''
root=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':'prod#PG#1#225136'}}),deadline=deadline)['Item']
assert root['state']['S'] in ('CREATING','RESERVED') and 'pg' not in root and int(root['lockUntil']['N'])<int(time.time()*1000)
native=obs.query('RAIZ.PG.RETRY',{'CODCOLIGADA':1,'TICKET':225136})
assert len(native)==1 and native[0]['TOTAL_MOVEMENTS']==0 and native[0]['TOTAL_LAUNCHES']==0
out=ROOT/'.ticket225136-execution';out.mkdir(exist_ok=True)
(out/'preflight.json').write_text(json.dumps({'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'ticket':225136,'runtimeSha':cfg['CodeSha256'],'root':root,'nativeBefore':native,'nativeWritesAuthorized':True,'zeevWrites':False},indent=2))
result=subprocess.run(['node','scripts/execute-payment-225136.cjs'],input=json.dumps(payload,ensure_ascii=False),text=True,encoding='utf-8',env={**os.environ,**env},timeout=60)
root_after=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':'prod#PG#1#225136'}}),deadline=deadline).get('Item',{})
after=obs.query('RAIZ.PG.RETRY',{'CODCOLIGADA':1,'TICKET':225136})
(out/'readback.json').write_text(json.dumps({'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'ticket':225136,'native':after,'root':root_after},indent=2))
assert result.returncode==0,'Execution process failed; inspect persisted state before any retry'
