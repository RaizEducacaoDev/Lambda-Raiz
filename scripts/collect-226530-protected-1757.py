"""Read encrypted envelopes for one ticket only; never invoke or write AWS data."""
import base64,datetime as dt,importlib.util,json,re,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('a',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
OUT=Path('.226530-protected-1757');OUT.mkdir(exist_ok=True)
deadline=time.monotonic()+90
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('STAGE')=='prod'
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
start=dt.datetime(2026,11,5,20,56,tzinfo=dt.timezone.utc)
out={'ticket':226530,'company':11,'readOnly':True,'lambdaInvoked':False,'awsWrites':False,'envelopes':[]}
keys={'version','ticket','coligada','observedUtc','responseSha256','wrappedKey','iv','tag','ciphertext'}
while time.monotonic()<deadline-35:
    end=dt.datetime.now(dt.timezone.utc)
    events,coverage=a.read_log_window('"[RM-DIAG-PROTEGIDO]" "226530"',int(start.timestamp()*1000),int(end.timestamp()*1000),deadline)
    found=[]
    for event in events:
        message,request=a.unwrap(event)
        if '[RM-DIAG-PROTEGIDO]' not in message:continue
        data=json.loads(message.split('[RM-DIAG-PROTEGIDO]',1)[1].strip())
        assert set(data)==keys and data['version']==1 and data['ticket']==226530 and data['coligada']==11
        assert re.fullmatch('[0-9a-f]{64}',data['responseSha256'])
        for key,minimum,maximum in [('wrappedKey',384,384),('iv',12,12),('tag',16,16),('ciphertext',1,16384)]:
            val=base64.b64decode(data[key],validate=True);assert minimum<=len(val)<=maximum
        found.append({'requestId':request,'timestamp':event['timestamp'],'envelope':data})
    out.update(observedUtc=end.isoformat(),coverage=coverage,envelopes=found,
        function={k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified']})
    (OUT/'encrypted-envelopes.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    if found:break
    time.sleep(min(15,max(0,deadline-time.monotonic()-35)))
print(json.dumps({'ticket':226530,'envelopeCount':len(out['envelopes']),'coverageComplete':out.get('coverage',{}).get('complete'),'awsWrites':False,'lambdaInvoked':False}))
