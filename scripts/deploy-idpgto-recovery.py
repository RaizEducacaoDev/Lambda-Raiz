"""Guarded, function-only recovery release. Snapshot by default."""
import base64,datetime,hashlib,json,os,pathlib,re,subprocess,urllib.request
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
BASELINE='9Du9JUQuUp2gOgh4Kx45+7W3pWFgZIYWHn0W87A+HCE='
REVISION='72eba493-e23f-4291-9d3e-4965c1251bdc'
out=pathlib.Path('.idpgto-recovery');out.mkdir(exist_ok=True)
def aws(*args,stdin_value=None):
    r=subprocess.run(['aws',*args,'--output','json'],input=json.dumps(stdin_value) if stdin_value is not None else None,capture_output=True,text=True)
    if r.returncode:
        m=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
        raise RuntimeError(f'AWS {args[0]}/{args[1]} failed: {m.group(1) if m else "CLI_ERROR"}')
    return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
active=aws('lambda','get-function','--function-name',FUNCTION);cfg=active['Configuration']
assert cfg['FunctionName']==FUNCTION and cfg['CodeSha256']==BASELINE and cfg['RevisionId']==REVISION
assert cfg['Handler']=='src/functions/rm/post/solicitacaoDePagamento.handler'
assert cfg['Runtime']=='nodejs22.x' and cfg['Architectures']==['arm64']
blob=urllib.request.urlopen(active['Code']['Location'],timeout=30).read()
assert base64.b64encode(hashlib.sha256(blob).digest()).decode()==BASELINE
backup=out/'active-before-recovery.zip';backup.write_bytes(blob)
metadata={k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','Runtime','Architectures','Handler','Role','Timeout','MemorySize','LastUpdateStatus']}
metadata.update({'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':os.environ.get('IDPGTO_RECOVERY_MODE','snapshot')})
(out/'baseline.json').write_text(json.dumps(metadata,indent=2));print(json.dumps(metadata,indent=2))
if os.environ.get('IDPGTO_RECOVERY_MODE')!='deploy':raise SystemExit(0)

subprocess.run(['python3','scripts/build-pagamento-package.py','--baseline',str(backup),'--expected-baseline-sha',BASELINE,
    '--bundle','.build/solicitacaoDePagamento.cjs','--output','.build/pagamento-recovery.zip'],check=True)
subprocess.run(['node','scripts/smoke-pagamento-package.cjs'],check=True)
candidate=pathlib.Path('.build/pagamento-recovery.zip');sha=base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()
aws('lambda','update-function-code','--function-name',FUNCTION,'--revision-id',REVISION,'--zip-file','fileb://'+str(candidate))
subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True)
after=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert after['CodeSha256']==sha and after['LastUpdateStatus']=='Successful'
for key in ['Handler','Runtime','Architectures','Role','Timeout','MemorySize','Environment']:
    assert after.get(key)==cfg.get(key),f'Configuration changed: {key}'
deployment={'function':FUNCTION,'previousCodeSha256':BASELINE,'activeCodeSha256':sha,'revisionId':after['RevisionId'],
    'lastUpdateStatus':after['LastUpdateStatus'],'configurationPreserved':True,'deployedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(out/'deployment.json').write_text(json.dumps(deployment,indent=2));(out/'active-recovery.zip').write_bytes(candidate.read_bytes())
print(json.dumps(deployment,indent=2))
for i,fields in enumerate([
    {'tipoDaSolicitacao':'PG','ticketRaiz':'999999990003','codigoDaColigada2':'31','codigoDoFornecedor':'0000173261'},
    {'tipoDaSolicitacao':'PG','ticketRaiz':'999999990003','codigoDaColigada2':'31','codigoDoFornecedor':'0000173261','idpgto':'4','CODCOLPGTO':'1'}]):
    responsefile=out/f'negative-{i}.json'
    aws('lambda','invoke','--function-name',FUNCTION,'--invocation-type','RequestResponse','--payload','fileb:///dev/stdin',str(responsefile),
        stdin_value={'body':json.dumps(fields)})
    assert json.loads(responsefile.read_text())['statusCode']==422
