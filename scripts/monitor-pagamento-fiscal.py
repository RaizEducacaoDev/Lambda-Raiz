"""One-time post-release read-only checks; only fixed identifiers leave AWS."""
import datetime,json,pathlib,re,subprocess
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento';TABLE='lambda-raiz-prod-pagamento-idpgto'
EXPECTED='r0ACtmx4cuGdCAaexa2P6RHkXAEnO5lctl4tiP1iqkk='
def aws(*args):
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  code=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('Read-only audit failed: '+(code.group(1) if code else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert cfg['CodeSha256']==EXPECTED and cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'businessWrites':False,'configurationWrites':False}
key='prod#PG#11#228310'
root=aws('dynamodb','get-item','--table-name',TABLE,'--key',json.dumps({'pk':{'S':key}}),'--consistent-read')['Item']
assert root['state']['S']=='CREATING' and 'pg' not in root and root['digest']['S']=='76f1c54ead4fe3fc82c00ffc0164d5d019bc6feb0d53578fb7444b482520a2c1'
assert root['owner']['S']=='0bd66c31-c259-45b7-8208-9b9caa49f74f' and root['lockUntil']['N']=='1793395143619'
out['originalReservationPreserved']=True
children=aws('dynamodb','scan','--table-name',TABLE,'--consistent-read','--filter-expression','begins_with(pk, :prefix)','--expression-attribute-values',json.dumps({':prefix':{'S':key+'#'}}),'--select','COUNT','--limit','100','--no-paginate')
out['originalChildren']={'count':children['Count'],'complete':not children.get('LastEvaluatedKey')}
assert out['originalChildren']['complete'] and out['originalChildren']['count']==0
start=int(datetime.datetime(2026,10,30,23,21,35,tzinfo=datetime.timezone.utc).timestamp()*1000)
logs=aws('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(start),'--filter-pattern','"[RM-IDPGTO]"','--limit','200','--no-paginate')
out['postReleaseLogWindowComplete']=not bool(logs.get('nextToken'));out['pendingEvents']=[]
for event in logs.get('events',[]):
 message=event.get('message','')
 if 'Integração pendente' not in message:continue
 ticket=re.search(r'\bticket[\'\"]?\s*:\s*[\'\"]?(\d+)',message);status=re.search(r'\bstatus[\'\"]?\s*:\s*(\d+)',message)
 state=re.search(r'\bstate[\'\"]?\s*:\s*[\'\"]?([A-Z]+)',message)
 out['pendingEvents'].append({'timestamp':event['timestamp'],'ticket':ticket.group(1) if ticket else None,'status':int(status.group(1)) if status else None,'state':state.group(1) if state else None})
out['unexpectedServerFailures']=[event for event in out['pendingEvents'] if event['status'] is None or event['status']>=500]
original=aws('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(int(datetime.datetime(2026,10,30,21,17,tzinfo=datetime.timezone.utc).timestamp()*1000)),'--end-time',str(int(datetime.datetime(2026,10,30,21,19,tzinfo=datetime.timezone.utc).timestamp()*1000)),'--filter-pattern','"0087563c-cd5e-4baf-956b-67b290f1ab14"','--limit','100','--no-paginate')
messages=[event.get('message','') for event in original.get('events',[])]
out['originalExecution']={'requestId':'0087563c-cd5e-4baf-956b-67b290f1ab14','endObserved':any('END RequestId:' in value for value in messages),'reportObserved':any('REPORT RequestId:' in value for value in messages),'timeoutObserved':any('Task timed out' in value for value in messages),'windowComplete':not bool(original.get('nextToken'))}
directory=pathlib.Path('.pagamento-fiscal-monitor');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
assert not out['unexpectedServerFailures'],'Inspect post-release server failures without retrying financial operations'
