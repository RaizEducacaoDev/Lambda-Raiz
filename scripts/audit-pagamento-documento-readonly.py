"""Fresh post-release AWS evidence. Fixed read-only operations; no invoke/write."""
import datetime,json,pathlib,re,subprocess

FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
TABLE='lambda-raiz-prod-pagamento-idpgto'
ALLOWED={('sts','get-caller-identity'),('lambda','get-function-configuration'),('dynamodb','get-item'),('logs','filter-log-events')}
def aws(*args):
 assert tuple(args[:2]) in ALLOWED,'Only fixed read-only AWS operations are allowed'
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  code=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('Read-only audit failed: '+(code.group(1) if code else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')

assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert cfg['CodeSha256']=='6Mf0NJD8HIyDhId6FzbAGKqWu13Strj23mIvnBhKmxQ='
assert cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
row=aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':'prod#PG#9#226374'}}))['Item']
assert row['state']['S']=='CREATING' and 'pg' not in row
assert row['digest']['S']=='f6d5bff690ca5fe785705ea08e586f3f4fb4454f9c191ccb77ca450ed1ed3932'
assert row['owner']['S']=='0e4b5367-a872-4668-a268-6f8c8e119db1' and row['lockUntil']['N']=='1793630719027'
now=datetime.datetime.now(datetime.timezone.utc);end=int(now.timestamp()*1000);start=end-10*60*1000
token=None;seen=set();events=[]
for _ in range(20):
 args=['logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(start),'--end-time',str(end),'--filter-pattern','"226374"','--limit','100','--no-paginate']
 if token:args.extend(['--next-token',token])
 page=aws(*args);events.extend(page.get('events',[]));nxt=page.get('nextToken')
 if not nxt:token=None;break
 if nxt in seen:raise RuntimeError('Repeated pagination token; coverage not proven')
 seen.add(nxt);token=nxt
assert not token,'Log coverage incomplete'
pending=[];dispatches=0
for event in events:
 message=event.get('message','')
 if 'SaveRecord' in message or 'transport_call_started' in message:dispatches+=1
 if 'Integração pendente' in message:
  status=re.search(r'\bstatus[\'\"]?\s*:\s*(\d+)',message)
  pending.append({'timestamp':event['timestamp'],'status':int(status.group(1)) if status else None})
out={'observedUtc':now.isoformat(),'function':FUNCTION,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],
 'businessWrites':False,'configurationWrites':False,'originalReservationUnchanged':True,'originalReservationState':'CREATING',
 'logCoverageComplete':True,'logWindowMinutes':10,'pendingEvents':pending,'nativeCreationDispatchEvents':dispatches}
directory=pathlib.Path('.payment-document-postrelease');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
assert pending and all(e['status']==422 for e in pending) and dispatches==0,'Unexpected effect or pending status; inspect without replay'
