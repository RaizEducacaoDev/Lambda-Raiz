"""One production acknowledgement of an already complete, freshly verified chain.

No task approval, SaveRecord or Dynamo write API is available in this script.
The Lambda is invoked once only, after a local read-only positive confirmation.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


o = module('readonly_observer', 'scripts/observe-payment-backlog.py')
release = module('existing_release', 'scripts/release-existing-payment.py')
r = release.r
OUT = Path('.existing-payment-smoke')
EXPECTED = {'PG':'45178','LF':'69912','idLans':['69912'],'integracaoBancaria':'ja_gravada'}
NODE = r'''
const fs=require('fs'),load=require('./tests/load-ts.cjs'),mods=new Map();
const {executarPagamentoSeguro}=load('src/functions/rm/post/solicitacaoDePagamentoSeguro.ts',{},mods);
const {parsearCensoRetomada}=load('src/functions/rm/post/pagamentoRetomada.ts',{},mods);
const x=JSON.parse(fs.readFileSync(0,'utf8'));let prohibitedCalls=0;
console.info=()=>{};console.warn=()=>{};console.error=()=>{};
const deny=async()=>{prohibitedCalls++;throw Error('PROHIBITED');};
const repo=new Proxy({},{get:()=>deny}),rm={saveRecord:deny,
 consultarRetomada:async(c,t)=>parsearCensoRetomada(x.census,c,t),
 readReacord:async(k,s)=>{
  if(k==='1;45178'&&s==='MovMovimentoTBCData')return x.mov;
  if(k==='1;69912'&&s==='FinLanDataBR')return x.lan;
  return deny();}};
executarPagamentoSeguro(x.payload,{getRemainingTimeInMillis:()=>30000},deny,{rm,repositorio:repo})
 .then(v=>process.stdout.write(JSON.stringify({statusCode:v.statusCode,body:JSON.parse(v.body),prohibitedCalls})))
 .catch(()=>{process.exitCode=1;});
'''


class Observer(o.Observer):
    def __init__(self, report):
        self.plan = {'ticket':225374,'expectedRuntime':{'codeSha256':report['activeCodeSha256'],'revisionId':report['revisionId']}}
        self.deadline = time.monotonic() + 300
        self.opener = urllib.request.build_opener(o.NoRedirect())
        self.config()

    def controls(self):
        return [self.aws('dynamodb','get-item','--table-name','lambda-raiz-prod-pagamento-idpgto',
            '--consistent-read','--key',json.dumps({'pk':{'S':pk}})).get('Item',{})
            for pk in ['prod#PG#1#225374','prod#PG#1#225374#FLAN#69912']]

    def native(self):
        return {'census':self.query('RAIZ.PG.RETRY',{'CODCOLIGADA':'1','TICKET':'225374'}),
            'mov':ET.tostring(self.read_record('MovMovimentoTBCData','1;45178',1),encoding='unicode'),
            'lan':ET.tostring(self.read_record('FinLanDataBR','1;69912',1),encoding='unicode')}


def run(evidence):
    os.environ['AWS_MAX_ATTEMPTS'] = '1'
    report = json.loads((Path(evidence)/'deployment.json').read_text())
    cfg, package = r.m.active()
    assert cfg['CodeSha256']==report['activeCodeSha256'] and cfg['RevisionId']==report['revisionId']
    assert {n:r.m.sha(v) for n,v in r.m.entries(package).items()}==report['entries']
    release.validate_candidate(r.m.entries(package)[r.m.ENTRY])
    observer = Observer(report)
    template = o.TEMPLATE.read_text(encoding='utf-8-sig')
    names = sorted(set(re.findall(r'\{Form\.(\w+)\}',template)) | {'idDoLancamento'})
    zeev, _ = observer.zeev_snapshot(names)
    payload, fields = o.render(zeev,template)
    assert fields['idDoMovimento']=='45178' and fields['idDoLancamento']=='69912'
    assert fields['codigoDaColigada2']=='1' and fields['codigoDaFilial2']=='1'
    pending = [t for t in zeev['instanceTasks'] if t.get('active')]
    assert len(pending)==1 and pending[0]['task']['name']=='T07 - Realizar Análise fiscal'
    before = observer.native()
    controls = observer.controls()
    # The known legacy reservation is also a fallback barrier: with explicit PG,
    # concluida() rejects this no-PG root before any bank/reservation mutation.
    assert controls[0].get('state')=={'S':'CREATING'} and 'pg' not in controls[0]
    local = subprocess.run(['node','-e',NODE],cwd=ROOT,input=json.dumps({'payload':payload,**before}),
        text=True,capture_output=True,encoding='utf-8',timeout=30)
    assert local.returncode==0
    checked = json.loads(local.stdout)
    assert checked=={'statusCode':200,'body':EXPECTED,'prohibitedCalls':0}
    observer.config()
    assert observer.controls()==controls
    assert observer.native()==before
    build = Path('.build'); build.mkdir(exist_ok=True)
    request, response = build/'existing-225374-request.json', build/'existing-225374-response.json'
    request.write_text(json.dumps({'body':json.dumps(payload,ensure_ascii=False)},ensure_ascii=False),encoding='utf-8')
    result = {'ticket':225374,'company':1,'branch':1,'startedUtc':r.m.now(),
        'runtimeSha256':report['activeCodeSha256'],'invocationAttempted':False,'taskApproved':False}
    try:
        result['invocationAttempted'] = True
        invoked = r.m.aws('lambda','invoke','--function-name',r.m.FUNCTION,
            '--cli-binary-format','raw-in-base64-out','--invocation-type','RequestResponse',
            '--cli-read-timeout','45','--payload','file://'+str(request),str(response))
        assert 'FunctionError' not in invoked
        value = json.loads(response.read_text())
        assert value['statusCode']==200 and json.loads(value['body'])==EXPECTED
        result['response'] = {'statusCode':200,'body':EXPECTED}
    finally:
        request.unlink(missing_ok=True)
        after = observer.native()
        after_controls = observer.controls()
        after_zeev, _ = observer.zeev_snapshot(names)
        result.update(observedUtc=r.m.now(),nativeUnchanged=after==before,
            controlsUnchanged=after_controls==controls,zeevUnchanged=after_zeev==zeev,
            nativeBeforeSha256=o.m.sha(before),nativeAfterSha256=o.m.sha(after),
            controlBeforeSha256=o.m.sha(controls),controlAfterSha256=o.m.sha(after_controls))
        OUT.mkdir(exist_ok=True)
        (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result,indent=2))
    assert result['nativeUnchanged'] and result['controlsUnchanged'] and result['zeevUnchanged']
    observer.config()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--evidence',required=True)
    args=parser.parse_args()
    run(args.evidence)
