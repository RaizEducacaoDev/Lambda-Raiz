"""Publish one function only, after live SELECT contracts and immutable ZIP guards.

No operational reconciliation, creation, fiscal approval or DynamoDB write.
Default mode is a read-only snapshot. Deploy requires the explicit workflow mode.
"""
import base64,datetime,hashlib,io,json,os,pathlib,re,subprocess,urllib.request,xml.etree.ElementTree as ET,zipfile

FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
TABLE='lambda-raiz-prod-pagamento-idpgto'
BASELINE='rRubhd20rr3yhbQkdzbyCvDJrnAtozxO/Q8sN0XpJtA='
REVISION='a2cf38ea-8857-4e06-847e-614b57f9d844'
HOST='https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
OUT=pathlib.Path('.pagamento-retomada-release');OUT.mkdir(exist_ok=True)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(name,data):
 (OUT/name).write_text(json.dumps(data,indent=2),encoding='utf-8')
def aws(*args,payload=None):
 r=subprocess.run(['aws',*args,'--output','json'],input=json.dumps(payload) if payload is not None else None,capture_output=True,text=True)
 if r.returncode:
  code=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError(f'AWS {args[0]}/{args[1]} failed: {code.group(1) if code else "CLI_ERROR"}')
 return json.loads(r.stdout or '{}')
def canon(value):return value.replace('\r\n','\n').replace('\r','\n').strip()
def sha(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
def checkpoints(stage):
 result={}
 for company,ticket,lan in [(31,228063,468),(31,228080,469),(31,228130,470),(11,228310,None),(9,226374,None)]:
  for suffix in ['']+([f'#FLAN#{lan}'] if lan else []):
   pk=f'{stage}#PG#{company}#{ticket}{suffix}'
   result[pk]=aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':pk}})).get('Item')
 return result
def verify_contracts(env):
 assert env['STAGE']=='prod' and env['PAGAMENTO_IDPGTO_TABLE']==TABLE
 assert env['RM_PROD'].rstrip('/')==HOST.replace(':8051','')
 auth='Basic '+base64.b64encode((env['USERNAME_TOTVS']+':'+env['PASSWORD_TOTVS']).encode()).decode()
 evidence=[]
 def get(code,params):
  from urllib.parse import urlencode
  url=HOST+f'/api/framework/v1/consultaSQLServer/RealizaConsulta/{code}/0/T?'+urlencode({'parameters':params})
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':auth,'Accept':'application/json'}),timeout=12) as response:return json.load(response)
 for code,filename in [('RAIZ.PG.RECON','pagamento-reconciliacao.sql'),('RAIZ.PG.FISC','pagamento-natureza-fiscal.sql'),('RAIZ.PG.DOC','pagamento-documento.sql'),('RAIZ.PG.RETRY','pagamento-retomada.sql')]:
  sql=canon((pathlib.Path('sql')/filename).read_text(encoding='utf-8-sig'))
  envelope=ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope');body=ET.SubElement(envelope,'{http://schemas.xmlsoap.org/soap/envelope/}Body');op=ET.SubElement(body,'ReadRecord',xmlns='http://www.totvs.com/')
  for key,value in {'DataServerName':'GlbConsSQLData','PrimaryKey':f'0;T;{code}','Contexto':f"CODCOLIGADA=0;CODSISTEMA=G;CODUSUARIO={env['USERNAME_TOTVS']}"}.items():ET.SubElement(op,key).text=value
  request=urllib.request.Request(HOST+'/wsDataServer/IwsDataServer',data=ET.tostring(envelope),headers={'Authorization':auth,'Content-Type':'text/xml;charset=UTF-8','SOAPAction':'http://www.totvs.com/IwsDataServer/ReadRecord'})
  with urllib.request.urlopen(request,timeout=12) as response:soap=ET.fromstring(response.read())
  result=soap.find('.//{http://www.totvs.com/}ReadRecordResult');assert result is not None and result.text
  dataset=ET.fromstring(result.text);rows=dataset.findall('GConsSql')
  assert len(rows)==1 and canon(rows[0].findtext('SENTENCA',''))==sql,f'Native contract differs: {code}'
  record={'code':code,'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'definitionConfirmed':True,'readOnlyCanaries':[]}
  if code=='RAIZ.PG.RECON':
   for company,ticket,expected in [(31,228063,453),(31,228080,454),(31,228130,455),(11,228310,None),(9,226374,None)]:
    data=get(code,f'CODCOLIGADA={company};TICKET={ticket}');assert isinstance(data,list) and len(data)==1
    row=data[0];assert row['RECON_VERSION']==1 and row['REQUEST_COMPANY']==company and row['REQUEST_TICKET']==str(ticket)
    assert row['TOTAL_MOVEMENTS']==(0 if expected is None else 1) and (expected is None or row['IDMOV']==expected)
    record['readOnlyCanaries'].append({'company':company,'ticket':ticket,'count':row['TOTAL_MOVEMENTS'],'idMov':row.get('IDMOV')})
  elif code=='RAIZ.PG.FISC':
   for nature,route in [(121,'D'),(166,'F')]:
    data=get(code,f'CODCOLIGADA=11;CODFILIAL=1;CODCOLCFO=0;CODCFO=0000173261;IDNAT={nature}');assert isinstance(data,list) and len(data)==1
    row=data[0];assert row['FISCAL_VERSION']==1 and row['REQUEST_NATURE']==nature and row['NATURE_ID']==nature and row['NATURE_ROUTE']==route
    assert row['REQUEST_COMPANY']==11 and row['REQUEST_BRANCH']==1 and row['REQUEST_SUPPLIER_COMPANY']==0 and row['REQUEST_SUPPLIER']=='0000173261'
    assert all(row[key]==1 for key in ['HAS_SUPPLIER','HAS_BRANCH','HAS_NATURE','NATURE_ACTIVE','SUPPLIER_COUNTRY_ID','BRANCH_COUNTRY_ID'])
    assert row['SUPPLIER_UF']=='RJ' and row['BRANCH_UF']=='RS'
    record['readOnlyCanaries'].append({'nature':nature,'route':route,'supplierUF':'RJ','branchUF':'RS'})
  elif code=='RAIZ.PG.RETRY':
   assert 'NOLOCK' not in sql.upper() and 'READCOMMITTEDLOCK' in sql
   for company,ticket,expected in [(9,226374,(0,0)),(31,228063,(1,1))]:
    data=get(code,f'CODCOLIGADA={company};TICKET={ticket}')
    js="const fs=require('node:fs'),path=require('node:path'),load=require('./tests/load-ts.cjs');const m=load(path.resolve('src/functions/rm/post/pagamentoRetomada.ts'));const p=JSON.parse(fs.readFileSync(0,'utf8'));const r=m.parsearCensoRetomada(p.rows,p.company,p.ticket);process.stdout.write(JSON.stringify([r.movimentos.length,r.lancamentos.length]));"
    parsed=subprocess.run(['node','-e',js],input=json.dumps({'rows':data,'company':str(company),'ticket':str(ticket)}),capture_output=True,text=True,check=True)
    assert tuple(json.loads(parsed.stdout))==expected
    record['readOnlyCanaries'].append({'company':company,'ticket':ticket,'movements':expected[0],'launches':expected[1]})
  else:
   assert hashlib.sha256(sql.encode()).hexdigest()=='2c5e4716a2b63f54417c591dc5233da471b58d9360f7ef9c0d6a563a27c53a31'
   for series,count,configured in [('~',1,1),('70000',0,0),('NFN',0,1)]:
    data=get(code,'CODCOLIGADA=9;CODFILIAL=3;CODCOLCFO=0;CODCFO=0000154129;CODTMV=1.2.03;NUMERO=114;SERIE='+series)
    assert isinstance(data,list) and len(data)==1
    row=data[0];assert row['DOC_VERSION']==1 and row['REQUEST_COMPANY']==9 and row['REQUEST_BRANCH']==3 and row['REQUEST_SUPPLIER_COMPANY']==0
    assert row['REQUEST_SUPPLIER']=='0000154129' and row['REQUEST_MOVEMENT_TYPE']=='1.2.03' and row['REQUEST_NUMBER']=='114'
    assert row['REQUEST_SERIES']==('' if series=='~' else series) and row['HAS_MOVEMENT_TYPE']==1 and row['MASK']=='#########'
    assert row['PRINCIPAL_COUNT']==1 and row['EFFECTIVE_SERIES']==('1' if series=='~' else series) and row['EFFECTIVE_NUMBER']=='000000114'
    assert row['EFFECTIVE_DOCUMENT_TYPE']=='002' and row['SERIES_MATCH_COUNT']==configured and row['DOC_MATCH_COUNT']==count
    if count:assert row['IDMOV']==78497 and row['TICKET']=='110229' and row['CODCOLCFOAUX']==0 and row['CODCFOAUX']=='0000154129' and row.get('CRO') is None and row.get('SUBSERIE') is None
    record['readOnlyCanaries'].append({'series':series,'matchedMovements':count,'seriesLinks':configured})
  evidence.append(record)
 write('native-contracts.json',{'verifiedUtc':now(),'configurationWrites':False,'financialWrites':False,'queries':evidence})

assert aws('sts','get-caller-identity')['Account']=='757843862365'
active=aws('lambda','get-function','--function-name',FUNCTION);cfg=active['Configuration'];env=cfg['Environment']['Variables']
assert cfg['CodeSha256']==BASELINE and cfg['RevisionId']==REVISION and cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
assert cfg['Runtime']=='nodejs22.x' and cfg['Architectures']==['arm64'] and cfg['Handler']=='src/functions/rm/post/solicitacaoDePagamento.handler'
before=checkpoints(env['STAGE']);incident=before['prod#PG#11#228310'];assert incident['state']['S']=='CREATING' and 'pg' not in incident
assert incident['digest']['S']=='76f1c54ead4fe3fc82c00ffc0164d5d019bc6feb0d53578fb7444b482520a2c1'
uncertain=before['prod#PG#9#226374'];assert uncertain['state']['S']=='CREATING' and 'pg' not in uncertain
assert uncertain['digest']['S']=='f6d5bff690ca5fe785705ea08e586f3f4fb4454f9c191ccb77ca450ed1ed3932'
assert uncertain['owner']['S']=='0e4b5367-a872-4668-a268-6f8c8e119db1' and uncertain['lockUntil']['N']=='1793630719027'
def canary_roots():
 return {ticket:aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':'prod#PG#9#'+ticket}})).get('Item') for ticket in ['999999990035','999999990036']}
assert not any(canary_roots().values()),'Canary identifiers already reserved; stop'
verify_contracts(env)
with urllib.request.urlopen(active['Code']['Location'],timeout=30) as response:blob=response.read()
assert sha(blob)==BASELINE
with zipfile.ZipFile(io.BytesIO(blob)) as package:
 for entry in package.infolist():
  assert env['PASSWORD_TOTVS'].encode() not in package.read(entry),'Do not archive a package containing a live credential'
backup=OUT/'active-before.zip';backup.write_bytes(blob)
write('baseline.json',{'observedUtc':now(),'function':FUNCTION,'codeSha256':BASELINE,'revisionId':REVISION,'commit':os.environ.get('GITHUB_SHA'),'configurationWrites':False,'businessWrites':False})
if os.environ.get('PAGAMENTO_RETRY_RELEASE_MODE')!='deploy':raise SystemExit(0)
subprocess.run(['python3','scripts/build-pagamento-package.py','--baseline',str(backup),'--expected-baseline-sha',BASELINE,'--bundle','.build/solicitacaoDePagamento.cjs','--output','.build/pagamento-retomada.zip'],check=True)
subprocess.run(['node','scripts/smoke-pagamento-package.cjs'],check=True)
candidate=pathlib.Path('.build/pagamento-retomada.zip');candidate_sha=sha(candidate.read_bytes())
verify_contracts(env) # Fresh official readback immediately before publication.
try:
 aws('lambda','update-function-code','--function-name',FUNCTION,'--revision-id',REVISION,'--zip-file','fileb://'+str(candidate))
 subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True,capture_output=True)
 after=aws('lambda','get-function-configuration','--function-name',FUNCTION)
 assert after['CodeSha256']==candidate_sha and after['LastUpdateStatus']=='Successful' and after['State']=='Active'
 for key in ['Handler','Runtime','Architectures','Role','Timeout','MemorySize','Environment','VpcConfig','Layers','TracingConfig','DeadLetterConfig','FileSystemConfigs','EphemeralStorage','KMSKeyArn']:
  assert after.get(key)==cfg.get(key),f'Unexpected configuration drift: {key}'
 canaries=[]
 for i,fields in enumerate([
  {'tipoDaSolicitacao':'PG','ticketRaiz':'999999990013','codigoDaColigada2':'31','codigoDoFornecedor':'0000173261'},
  {'tipoDaSolicitacao':'PG','ticketRaiz':'999999990013','codigoDaColigada2':'31','codigoDoFornecedor':'0000173261','idpgto':'4','CODCOLPGTO':'1'}]):
  responsefile=OUT/f'negative-{i}.json'
  aws('lambda','invoke','--function-name',FUNCTION,'--invocation-type','RequestResponse','--payload','fileb:///dev/stdin',str(responsefile),payload={'body':json.dumps(fields)})
  result=json.loads(responsefile.read_text());assert result['statusCode']==422
  canaries.append({'case':i,'statusCode':422})
 # Missing item list is deliberate: even a failed preflight regression cannot
 # construct a valid financial creation. Successful canaries must not reserve.
 document={'tipoDaSolicitacao':'PG','tipoDoPagamento':'NF','tipoDeItem':'Serviço','codigoDaColigada2':'9','codigoDaFilial2':'3',
  'codigoDoFornecedor':'0000154129','CODCOLCFO':'0','idpgto':'3','CODCOLPGTO':'9','numeroDaNF':'114',
  'dataDeEmissao':'22/10/2026','dataDeEntrada':'27/10/2026','dataDeVencimento':'10/11/2026','valorTotal':'5273,40'}
 for ticket,series,expected in [('999999990035','','DOCUMENTO_RM_DUPLICADO'),('999999990036','70000','SERIE_DOCUMENTO_INVALIDA')]:
  responsefile=OUT/('document-'+ticket+'.json')
  aws('lambda','invoke','--function-name',FUNCTION,'--invocation-type','RequestResponse','--payload','fileb:///dev/stdin',str(responsefile),payload={'body':json.dumps({**document,'ticketRaiz':ticket,'serie':series})})
  result=json.loads(responsefile.read_text());assert result['statusCode']==422 and json.loads(result['body'])['code']==expected
  canaries.append({'case':expected,'statusCode':422,'zeroReservationConfirmed':canary_roots()[ticket] is None})
 assert not any(canary_roots().values()),'Creation preflight unexpectedly reserved a canary'
 assert checkpoints(env['STAGE'])==before,'Existing operational checkpoints changed'
except Exception as error:
 failure={'observedUtc':now(),'errorType':type(error).__name__,'candidateCodeSha256':candidate_sha,'rollbackAttempted':False}
 try:
  current=aws('lambda','get-function-configuration','--function-name',FUNCTION)
  if current['LastUpdateStatus']=='InProgress':
   subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True,capture_output=True)
   current=aws('lambda','get-function-configuration','--function-name',FUNCTION)
  # Restore only our own package, guarded by the latest revision. Never replace
  # an intervening operator's publication or touch operational reservations.
  if current['CodeSha256']==candidate_sha and current['LastUpdateStatus']!='InProgress':
   failure['rollbackAttempted']=True
   aws('lambda','update-function-code','--function-name',FUNCTION,'--revision-id',current['RevisionId'],'--zip-file','fileb://'+str(backup))
   subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',FUNCTION],check=True,capture_output=True)
   restored=aws('lambda','get-function-configuration','--function-name',FUNCTION)
   failure['rollbackConfirmed']=restored['CodeSha256']==BASELINE and restored['LastUpdateStatus']=='Successful'
 except Exception as rollback_error:
  failure['rollbackErrorType']=type(rollback_error).__name__
 write('failed-release.json',failure)
 raise RuntimeError('Scoped payment release verification failed; inspect fixed-code evidence') from None
deployment={'function':FUNCTION,'previousCodeSha256':BASELINE,'activeCodeSha256':candidate_sha,'revisionId':after['RevisionId'],'lastUpdateStatus':after['LastUpdateStatus'],'configurationPreserved':True,'existingCheckpointsPreserved':True,'financialWrites':False,'deployedUtc':now(),'commit':os.environ.get('GITHUB_SHA'),'canaries':canaries}
write('deployment.json',deployment);(OUT/'active-package.zip').write_bytes(candidate.read_bytes())
print(json.dumps(deployment,indent=2))
