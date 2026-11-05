"""Fixed existing-launch bank-repair leases. Never create/change a financial record."""
import datetime as dt, hashlib, json, os, subprocess, sys, tempfile, time, uuid
from pathlib import Path
ACCOUNT='757843862365';REGION='sa-east-1';TABLE='lambda-raiz-prod-pagamento-idpgto'
TARGETS={228007:(5,165611,634500),227386:(18,407685,2191110),226610:(25,42677,79094),
 228103:(8,565011,870364),228158:(8,565012,870365),228198:(8,565013,870366),228275:(8,565014,870367),228793:(2,278473,751379)}
OUT=Path('.payment-bank-lease')
def require(ok,code):
 if not ok:raise RuntimeError(code)
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def sha(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def aws(service,operation,payload):
 require((service,operation) in {('sts','get-caller-identity'),('dynamodb','get-item'),('dynamodb','put-item'),('dynamodb','update-item')},'OPERATION_FORBIDDEN')
 if service=='dynamodb':require(payload.get('TableName')==TABLE,'TABLE_MISMATCH')
 with tempfile.TemporaryDirectory() as temp:
  p=Path(temp)/'input.json';p.write_text(json.dumps(payload),encoding='utf-8')
  r=subprocess.run(['aws',service,operation,'--region',REGION,'--cli-input-json','file://'+str(p),'--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','15'],capture_output=True,text=True,timeout=25,env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
 require(r.returncode==0,'AWS_CALL_FAILED_NO_RETRY');return json.loads(r.stdout or '{}')
def get(pk):return aws('dynamodb','get-item',{'TableName':TABLE,'Key':{'pk':{'S':pk}},'ConsistentRead':True}).get('Item',{})
def request(before,owner,until):
 names={};values={};conditions=[]
 for i,(k,v) in enumerate(sorted(before.items())):
  names[f'#b{i}']=k;values[f':b{i}']=v;conditions.append(f'#b{i} = :b{i}')
 for k in ('pg','protocolVersion','recuperadaCriacaoIncerta','reconciliationEvidenceKey'):
  if k not in before:conditions.append(f'attribute_not_exists({k})')
 names['#owner']='owner';values[':newOwner']={'S':owner};values[':newUntil']={'N':str(until)}
 return {'TableName':TABLE,'Key':{'pk':before['pk']},'UpdateExpression':'SET #owner = :newOwner, lockUntil = :newUntil','ConditionExpression':' AND '.join(conditions),'ExpressionAttributeNames':names,'ExpressionAttributeValues':values}
def checked_update(before,owner,until):
 expected={**before,'owner':{'S':owner},'lockUntil':{'N':str(until)}};lost=False
 try:aws('dynamodb','update-item',request(before,owner,until))
 except Exception:lost=True
 actual=get(before['pk']['S']);require(actual==expected,'LEASE_UPDATE_NOT_CONFIRMED_DO_NOT_RETRY');return actual,lost
def acquire(case,audit):
 ticket=case['ticket'];require(ticket in TARGETS,'TARGET_NOT_ALLOWED');company,mov,lan=TARGETS[ticket];pk=f'prod#PG#{company}#{ticket}'
 match=[x for x in audit['tickets'] if x['ticket']==ticket and x['company']==company];require(len(match)==1 and not match[0]['unknownAttributes'],'AUDIT_TARGET_MISMATCH')
 before=match[0]['root'];require(get(pk)==before,'ROOT_CHANGED_SINCE_AUDIT')
 require(before['pk']=={'S':pk} and before['state']['S'] in ('CREATING','CREATED') and int(before['lockUntil']['N'])<int(time.time()*1000),'ROOT_NOT_LEASEABLE')
 owner=str(uuid.uuid4());until=int(time.time()*1000)+20*60*1000;archive_key=pk+'#BANK_REPAIR_LEASE#'+owner
 archive={'pk':{'S':archive_key},'original':{'M':before},'leaseOwner':{'S':owner},'leaseUntil':{'N':str(until)}}
 try:aws('dynamodb','put-item',{'TableName':TABLE,'Item':archive,'ConditionExpression':'attribute_not_exists(pk)'})
 except Exception:require(get(archive_key)==archive,'LEASE_ARCHIVE_NOT_CONFIRMED')
 require(get(archive_key)==archive and get(pk)==before,'LEASE_ARCHIVE_OR_ROOT_CHANGED')
 after,lost=checked_update(before,owner,until)
 proof={'version':1,'ticket':ticket,'company':company,'idmov':mov,'idlan':lan,'owner':owner,'expiresAtEpoch':until//1000,'conditionMatched':True,'rootBusinessUnchanged':True,'workflowRunUrl':f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'archiveKey':archive_key,'before':before,'leasedRoot':after,'acknowledgementLost':lost}
 (OUT/f'lease-{ticket}.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');return {'ticket':ticket,'leased':True,'expiresAtEpoch':until//1000}
def release(proof):
 ticket=proof['ticket'];require(ticket in TARGETS,'TARGET_NOT_ALLOWED');company,mov,lan=TARGETS[ticket]
 require((proof['company'],proof['idmov'],proof['idlan'])==(company,mov,lan),'LEASE_TARGET_MISMATCH')
 before=proof['before'];leased=proof['leasedRoot'];pk=f'prod#PG#{company}#{ticket}'
 require(before['pk']==leased['pk']=={'S':pk} and {k:v for k,v in before.items() if k not in ('owner','lockUntil')}=={k:v for k,v in leased.items() if k not in ('owner','lockUntil')},'LEASE_BUSINESS_CHANGED')
 archive=get(proof['archiveKey']);require(archive.get('original')=={'M':before} and archive.get('leaseOwner')==leased['owner'] and archive.get('leaseUntil')==leased['lockUntil'],'LEASE_ARCHIVE_MISMATCH')
 require(get(pk)==leased,'LEASE_CHANGED_DO_NOT_RESTORE')
 after,lost=checked_update(leased,before['owner']['S'],int(before['lockUntil']['N']));require(after==before,'RESTORATION_NOT_EXACT')
 result={'ticket':ticket,'released':True,'originalRootExactlyRestored':True,'acknowledgementLost':lost,'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat()}
 (OUT/f'released-{ticket}.json').write_text(json.dumps(result,indent=2),encoding='utf-8');return result
def main():
 require(aws('sts','get-caller-identity',{})['Account']==ACCOUNT,'ACCOUNT_MISMATCH');OUT.mkdir(exist_ok=True)
 config=json.loads(Path('.github/payment-bank-lease.json').read_text());require(config['mode'] in ('acquire','release'),'INVALID_MODE')
 results=[]
 if config['mode']=='acquire':
  audit=json.loads(Path('.payment-bulk-readonly/readback.json').read_text());require(audit.get('coverageComplete') is True,'AUDIT_INCOMPLETE')
  for ticket in config['tickets']:results.append(acquire({'ticket':ticket},audit));print(json.dumps(results[-1]),flush=True)
 else:
  for ticket in config['tickets']:results.append(release(json.loads(Path(f'.prior-bank-lease/lease-{ticket}.json').read_text())));print(json.dumps(results[-1]),flush=True)
 (OUT/'summary.json').write_text(json.dumps({'mode':config['mode'],'results':results,'financialWrites':False},indent=2))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'status':'STOPPED_NO_RETRY','type':type(e).__name__,'code':str(e) if isinstance(e,RuntimeError) else 'UNEXPECTED_FAILURE'}));sys.exit(2)
