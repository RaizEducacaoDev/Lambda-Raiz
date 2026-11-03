"""Read-only correlation around Zeev error 202611031224-82. No invokes/writes."""
import datetime,json,pathlib,re,subprocess
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
START=datetime.datetime(2026,11,3,15,22,tzinfo=datetime.timezone.utc)
END=datetime.datetime(2026,11,3,15,27,tzinfo=datetime.timezone.utc)
def aws(*args):
 result=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if result.returncode:
  code=re.search(r'An error occurred \(([^)]+)\)',result.stderr)
  raise RuntimeError('AWS read-only audit failed: '+(code.group(1) if code else 'CLI_ERROR'))
 return json.loads(result.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'businessWrites':False,'configurationWrites':False,'function':FUNCTION,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'state':cfg['State'],'lastUpdateStatus':cfg['LastUpdateStatus'],'windowStartUtc':START.isoformat(),'windowEndUtc':END.isoformat(),'events':[]}
token=None;seen=set()
for _ in range(20):
 args=['logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(int(START.timestamp()*1000)),'--end-time',str(int(END.timestamp()*1000)),'--filter-pattern','"[RM-IDPGTO]"','--limit','200','--no-paginate']
 if token:args.extend(['--next-token',token])
 page=aws(*args)
 for event in page.get('events',[]):
  message=event.get('message','')
  ticket=re.search(r'\bticket[\'\"]?\s*:\s*[\'\"]?(\d+)',message)
  status=re.search(r'\bstatus[\'\"]?\s*:\s*(\d+)',message)
  if not ticket:continue
  request=re.search(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b',message,re.I)
  row={'timestamp':event['timestamp'],'ticket':int(ticket.group(1)),'requestId':request.group(0) if request else None,'status':int(status.group(1)) if status else None,'pending':'Integração pendente' in message,'creationStage':'Etapa de criação' in message,'bankConfirmed':'Vínculo financeiro confirmado' in message}
  out['events'].append(row)
 token=page.get('nextToken')
 if not token:break
 if token in seen:break
 seen.add(token)
out['windowComplete']=not bool(token)
out['candidates422']=sorted({event['ticket'] for event in out['events'] if event['status']==422})
directory=pathlib.Path('.payment-422-20261103');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
assert out['windowComplete'],'Log window incomplete; do not infer no events'
