"""Fresh AWS/configuration/Dynamo/API readback. No financial effects."""
import argparse,datetime,hashlib,io,json,pathlib,re,subprocess,urllib.request,urllib.error,zipfile
p=argparse.ArgumentParser();p.add_argument('--evidence-directory',required=True);args=p.parse_args()
matches=list(pathlib.Path(args.evidence_directory).rglob('deployment.json'));assert len(matches)==1
deployment=json.loads(matches[0].read_text());FUNCTION='lambda-raiz-prod-solicitacaoDePagamento';TABLE='lambda-raiz-prod-pagamento-idpgto'
assert deployment['function']==FUNCTION and deployment['configurationPreserved'] and deployment['existingCheckpointsPreserved']
def aws(*args):
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  code=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('AWS readback failed: '+(code.group(1) if code else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
active=aws('lambda','get-function','--function-name',FUNCTION);cfg=active['Configuration']
assert cfg['CodeSha256']==deployment['activeCodeSha256'] and cfg['RevisionId']==deployment['revisionId']
assert cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
with urllib.request.urlopen(active['Code']['Location'],timeout=30) as response:package=response.read()
assert __import__('base64').b64encode(hashlib.sha256(package).digest()).decode()==cfg['CodeSha256']
with zipfile.ZipFile(io.BytesIO(package)) as z:
 core=z.read('src/functions/rm/post/solicitacaoDePagamento.core.cjs')
 assert hashlib.sha256(core).hexdigest()=='cf802a6ef20cd6047e94e0ebdfe45da7ea923a36aafd103dada801cde6bb352e'
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'function':FUNCTION,'activeCodeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'lastUpdateStatus':cfg['LastUpdateStatus'],'legacyCorePreserved':True,'financialWrites':False,'dynamoWrites':False,'checkpoints':[],'httpRoutes':[]}
for company,ticket,pg,lan in [(31,228063,453,468),(31,228080,454,469),(31,228130,455,470),(11,228310,None,None)]:
 for suffix in ['']+([f'#FLAN#{lan}'] if lan else []):
  pk=f'prod#PG#{company}#{ticket}{suffix}';row=aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':pk}})).get('Item',{})
  assert row.get('state',{}).get('S')==('COMPLETE' if pg else 'CREATING')
  if pg:assert row.get('pg',{}).get('S')==str(pg)
  else:
   assert 'pg' not in row and row['digest']['S']=='76f1c54ead4fe3fc82c00ffc0164d5d019bc6feb0d53578fb7444b482520a2c1'
   assert row['owner']['S']=='0bd66c31-c259-45b7-8208-9b9caa49f74f' and row['lockUntil']['N']=='1793395143619'
  out['checkpoints'].append({'pk':pk,'state':row['state']['S'],'pg':row.get('pg',{}).get('S'),**({'originalAttemptPreserved':True} if not pg else {})})
policy=json.loads(aws('lambda','get-policy','--function-name',FUNCTION)['Policy'])
apis=set(re.findall(r':execute-api:sa-east-1:757843862365:([a-z0-9]+)/',json.dumps(policy)))
for api in sorted(apis):
 for resource in aws('apigateway','get-resources','--rest-api-id',api).get('items',[]):
  if resource.get('path')!='/solicitacaoDePagamento':continue
  target=aws('apigateway','get-integration','--rest-api-id',api,'--resource-id',resource['id'],'--http-method','POST')['uri']
  assert f':function:{FUNCTION}/invocations' in target
  url=f'https://{api}.execute-api.sa-east-1.amazonaws.com/prod/solicitacaoDePagamento'
  request=urllib.request.Request(url,data=json.dumps({'tipoDaSolicitacao':'PG','ticketRaiz':'999999990014','codigoDaColigada2':'31','codigoDoFornecedor':'0000173261'}).encode(),headers={'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(request,timeout=30) as response:status=response.status;body=json.load(response)
  except urllib.error.HTTPError as error:status=error.code;body=json.load(error)
  assert status==422 and body.get('code')=='IDPGTO_NAO_CONFIRMADO'
  out['httpRoutes'].append({'url':url,'unqualifiedPaymentTarget':True,'negativeCanaryStatus':status})
assert out['httpRoutes']
directory=pathlib.Path('.pagamento-fiscal-readback');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
