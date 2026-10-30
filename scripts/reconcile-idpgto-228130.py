"""One-time adoption of an independently verified existing movement; never invoke RM creation."""
import datetime,hashlib,json,os,pathlib,re,subprocess,time
TABLE='lambda-raiz-prod-pagamento-idpgto';PK='prod#PG#31#228130'
OWNER='fa31aa1a-ff43-44fb-825a-c51aee7ad911'
DIGEST='98496e090a527edfbd4f4116be3d430b32d3c9d73d3732aeb7ff1b86102b2fef'
LOCK=1793381128979
def aws(*args):
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  m=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('AWS operation failed: '+(m.group(1) if m else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
proofpath=pathlib.Path('docs/operations/idpgto-228130-bank-readback.json');raw=proofpath.read_bytes();proof=json.loads(raw)
assert (proof['ticket'],proof['company'],proof['idmov'],proof['idlan'],proof['idpgto'],proof['codcolpgto'])==(228130,31,455,470,4,31)
assert proof['bankLinkVerified'] and proof['bankIdentityVerified'] and proof['uniqueMovementAndFinancial']
assert proof['newMovementCreated'] is False and proof['paymentExecuted'] is False
assert proof['sqlReadback']['BOLETOS']==proof['sqlReadback']['BAIXAS']==0 and proof['sqlReadback']['STATUSLAN']==0
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(proof['observedUtc'])).total_seconds()
assert 0<=age<=900,'Operational proof expired; reread RM before any adoption'
cfg=aws('lambda','get-function-configuration','--function-name','lambda-raiz-prod-solicitacaoDePagamento')
assert cfg['CodeSha256']==os.environ['IDPGTO_EXPECTED_CODE_SHA'] and cfg['LastUpdateStatus']=='Successful'
assert cfg['Environment']['Variables']['PAGAMENTO_IDPGTO_TABLE']==TABLE
def get(key):return aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':key}})).get('Item',{})
before=get(PK)
assert before.get('state')=={'S':'CREATING'} and before.get('owner')=={'S':OWNER} and before.get('digest')=={'S':DIGEST}
assert before.get('lockUntil')=={'N':str(LOCK)} and 'pg' not in before
assert not get(PK+'#FLAN#470'),'Unexpected child checkpoint; reconcile separately'
now=int(time.time()*1000);assert LOCK<now
sha=hashlib.sha256(raw).hexdigest();applied=False
if os.environ.get('IDPGTO_RECONCILE_MODE')=='apply':
 aws('dynamodb','update-item','--table-name',TABLE,'--key',json.dumps({'pk':{'S':PK}}),
  '--update-expression','SET #state = :created, pg = :pg, reconciledAt = :now, reconciliationEvidenceSha256 = :evidence',
  '--condition-expression','#state = :creating AND #owner = :owner AND digest = :digest AND lockUntil = :oldLock AND lockUntil < :now AND attribute_not_exists(pg)',
  '--expression-attribute-names',json.dumps({'#state':'state','#owner':'owner'}),
  '--expression-attribute-values',json.dumps({':created':{'S':'CREATED'},':pg':{'S':'455'},':now':{'N':str(now)},':evidence':{'S':sha},
   ':creating':{'S':'CREATING'},':owner':{'S':OWNER},':digest':{'S':DIGEST},':oldLock':{'N':str(LOCK)}}))
 applied=True
after=get(PK)
assert after.get('digest')==before['digest'] and after.get('owner')==before['owner'] and after.get('lockUntil')==before['lockUntil']
if applied:assert after.get('state')=={'S':'CREATED'} and after.get('pg')=={'S':'455'}
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ticket':228130,'existingMovement':455,'existingFinancial':470,
 'conditionalAdoptionApplied':applied,'before':before,'after':after,'evidenceSha256':sha,'intentPreserved':True,'reservationDeleted':False,
 'lambdaInvoked':False,'rmInvoked':False,'newMovementCreated':False}
directory=pathlib.Path('.idpgto-reconciled');directory.mkdir(exist_ok=True)
(directory/'reconciliation.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
