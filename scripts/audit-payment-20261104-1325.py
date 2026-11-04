"""Read current package/version and correlate the new localizer; never invoke/write."""
import base64, datetime, hashlib, importlib.util, io, json, pathlib, time, urllib.request, zipfile

source=pathlib.Path(__file__).with_name('audit-payment-conflict-20261103-0609.py')
spec=importlib.util.spec_from_file_location('audit_payment_current',source)
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
audit.AWS_READS=audit.AWS_READS | {('lambda','get-function'),('cloudtrail','lookup-events')}
deadline=time.monotonic()+210
assert audit.aws('sts','get-caller-identity',deadline=deadline)['Account']==audit.ACCOUNT
active=audit.aws('lambda','get-function','--function-name',audit.FUNCTION,deadline=deadline)
cfg=active['Configuration'];now=datetime.datetime.now(datetime.timezone.utc)
out={'observedUtc':now.isoformat(),'localizer':'202611040125-5','businessWrites':False,'configurationWrites':False,
 'allowedAwsOperations':sorted('/'.join(v) for v in audit.AWS_READS),
 'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','State','LastUpdateStatus','LastModified','Runtime','Timeout','Handler']},
 'windows':[]}
for hour in [1,4,13,16]:
 center=datetime.datetime(2026,11,4,hour,25,tzinfo=datetime.timezone.utc)
 end=min(center+datetime.timedelta(minutes=4),now)
 if end<=center-datetime.timedelta(minutes=2):continue
 events,coverage=audit.read_log_window('"[RM-IDPGTO]"',int((center-datetime.timedelta(minutes=2)).timestamp()*1000),int(end.timestamp()*1000),deadline)
 out['windows'].append({'centerUtc':center.isoformat(),'endUtc':end.isoformat(),'coverage':coverage,
   'events':[v for event in events if (v:=audit.sanitize(event)) is not None]})
original_start=datetime.datetime(2026,11,2,14,43,45,tzinfo=datetime.timezone.utc)
original_end=original_start+datetime.timedelta(minutes=2)
original_events,coverage=audit.read_log_window('"4efffdfd-b6d7-4a87-857f-fe99421654d3"',int(original_start.timestamp()*1000),int(original_end.timestamp()*1000),deadline)
out['originalInvocation']={'requestId':'4efffdfd-b6d7-4a87-857f-fe99421654d3','coverage':coverage,
 'events':[v for event in original_events if (v:=audit.sanitize(event)) is not None]}
after_start=datetime.datetime(2026,11,2,14,43,51,382000,tzinfo=datetime.timezone.utc)
after_events,after_coverage=audit.read_log_window('"[RM-IDPGTO]" "226374"',int(after_start.timestamp()*1000),int(now.timestamp()*1000),deadline)
after_safe=[v for event in after_events if (v:=audit.sanitize(event)) is not None]
out['afterOriginal']={'startUtc':after_start.isoformat(),'endUtc':now.isoformat(),'coverage':after_coverage,
 'creationCallsAfterOriginal':sum(1 for e in after_safe if e.get('kind')=='creation_checkpoint' and e.get('event')=='transport_call_started' and str(e.get('ticket'))=='226374'),
 'events':after_safe}
try:
 provenance=audit.aws('cloudtrail','lookup-events','--lookup-attributes',json.dumps([{'AttributeKey':'ResourceName','AttributeValue':audit.FUNCTION}]),
  '--start-time','2026-11-04T14:40:00Z','--end-time','2026-11-04T14:55:00Z','--max-results','50',deadline=deadline)
 safe=[]
 for event in provenance.get('Events',[]):
  detail=json.loads(event.get('CloudTrailEvent','{}'));name=detail.get('eventName','')
  if not name.startswith('UpdateFunction'):continue
  identity=detail.get('userIdentity',{});agent=str(detail.get('userAgent',''))
  safe.append({'eventTime':detail.get('eventTime'),'eventName':name,'identityType':identity.get('type'),
   'agentClass':'AWS_CLI' if 'aws-cli' in agent else 'CONSOLE' if 'console' in agent.lower() else 'OTHER',
   'requestId':detail.get('requestID'),'codeSha256':(detail.get('responseElements') or {}).get('codeSha256')})
 out['publicationProvenance']={'available':True,'events':safe}
except audit.AuditError:
 out['publicationProvenance']={'available':False,'reason':'CloudTrail read unavailable; no permission changes requested'}
out['reservations']=[]
for company,ticket in [(9,226374),(11,228310)]:
 item=audit.aws('dynamodb','get-item','--table-name',audit.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':f'prod#PG#{company}#{ticket}'}}),deadline=deadline).get('Item',{})
 out['reservations'].append(audit.safe_reservation(item))
with urllib.request.urlopen(active['Code']['Location'],timeout=25) as response:blob=response.read()
assert base64.b64encode(hashlib.sha256(blob).digest()).decode()==cfg['CodeSha256']
env=cfg.get('Environment',{}).get('Variables',{})
secrets=[v.encode() for k,v in env.items() if any(p in k.upper() for p in ['PASSWORD','SECRET','TOKEN','PRIVATE_KEY']) and len(v)>=8]
with zipfile.ZipFile(io.BytesIO(blob)) as package:
 for info in package.infolist():
  data=package.read(info.filename)
  assert not any(s in data for s in secrets),'Current package contains an environment secret; do not export it'
 entries={info.filename:hashlib.sha256(package.read(info.filename)).hexdigest() for info in package.infolist()}
 core=entries.get('src/functions/rm/post/solicitacaoDePagamento.core.cjs')
 out['package']={'codeSha256':cfg['CodeSha256'],'coreSha256':core,'entrySha256':entries.get('src/functions/rm/post/solicitacaoDePagamento.js'),'entries':entries}
directory=pathlib.Path('.payment-current-1325');directory.mkdir(exist_ok=True)
(directory/'current-package.zip').write_bytes(blob)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
assert all(w['coverage']['complete'] for w in out['windows']),'Incomplete log coverage'
assert out['originalInvocation']['coverage']['complete'] and out['afterOriginal']['coverage']['complete'],'Incomplete original-operation coverage'
