"""Pure evidence contract for one manually approved diagnostic bank attempt."""
import copy,hashlib,json
from pathlib import Path

ROOT_KEY='prod#PG#5#228007'
CLAIM_V1=ROOT_KEY+'#BANK_REPAIR_ATTEMPT'
CLAIM_V2=CLAIM_V1+'#CFO_REFERENCE_V2'
CLAIM_V3=CLAIM_V1+'#NATIVE_DIAGNOSTIC_V3'
ROOT_SHA='d37dbe6017559dc039927a7d4f941dc4dffd81f632dc2b1b88c22839ac998850'
COLUMN_SHA='29adc8573bb2debff45aa16f2ea7725d24a44edcb235cc2f77d62921a7e78efb'
V1_SHA='ec8ebb29ce759e4499c2116e4294416c36b27612a3c5e149b0b2f486f2f66591'
RECEIPT_KEY=ROOT_KEY+'#BANK_REPAIR_NO_EFFECT#'+V1_SHA
ARCHIVE_KEY=ROOT_KEY+'#BANK_REPAIR_LEASE#16dca672-7a7c-4b70-87c2-7513d0cb52f7'
ITEM_HASHES={CLAIM_V1:V1_SHA,CLAIM_V2:'41152d46172db69bc9a6ad49b20f038166cdfcc9888bf8261dbb613aceded3fb',
 RECEIPT_KEY:'dd43d10552cf3cc86b3744b8ae1d8cdd704725913e3d8085d6b2a81a27ac7b8c',ARCHIVE_KEY:'e36ef5fa835f9987cfaac39b0205c8e04d4449068caea8d77d42411da61182ba'}
RUNTIME={'codeSha256':'nP8Tf7PTJVjQcqhA+QwqCkA69wFPlJ+kYe/8QHKR5/A=','revisionId':'6aec6184-80d8-47eb-b386-32cab252c086'}
RUNS={'restore':{'id':'41914496274','commit':'c17bb0e15bb1fc91df264afe24fd43bc8d1b27cf','workflow':'.github/workflows/payment-bank-lease-v3-apply.yml'},
 'hml':{'id':'41915570241','commit':'44a1725f3d36da68102e06e5ad6872d1a3e06463','workflow':'.github/workflows/hml-null-bank-once.yml'}}
ARTIFACTS={'restore':{'id':13364357108,'name':'payment-bank-lease-v3-applied'},'hml':{'id':13364951731,'name':'hml-null-bank-private-evidence'}}
RESTORE_FILES={'applied.json':'cd1e6f9e3fe3fa48eb22e32a00c7d751eb85df7a7c2d018703b3e917f752f0dd'}
HML_FILES={'result.json':'e626e760c5cf8b350f34ae160954d81be16e94d08f7c9b59f18e25dba3cb8eba',
 'environment-schema.json':'2ba48de871df13ac467fcb1fb61b18900ffe03bf510d810e2a4ca234e8ab28b7',
 'clear-after-same-session.json':'3fc5b728b29f8c8b1a033b4d292eb336e39e2fd315e781e305e833eaaa5beb71',
 'clear-after-independent.json':'7cdf52652e8d114c8aa0195cbe5372fbc66af1461a04d079f7c10169c7d88ad5',
 'attach-after-same-session.json':'9e7447e2bcc5397ce7c6671fc8fa63f32587c933a06c06d4d286a353c397f233',
 'attach-after-independent.json':'aa74ce3069cd5e9042b5309700ecf3a76298be0f17deb7a8419c2d00f3581891',
 'clear-response.json':'ba0c7fd62539f89ceff9b04fb3a8147b00f298e768226a5873e45aa9c871694d',
 'attach-response.json':'ba0c7fd62539f89ceff9b04fb3a8147b00f298e768226a5873e45aa9c871694d'}

class GuardError(Exception):pass
def require(ok,code):
 if not ok:raise GuardError(code)
def sha(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def file_sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def proof_template():
 return copy.deepcopy({'version':1,'purpose':'ONE_MANUAL_NATIVE_DIAGNOSTIC_V3','ticket':228007,'company':5,'idmov':165611,'idlan':634500,
  'claimKey':CLAIM_V3,'runtime':RUNTIME,'referenceRuns':RUNS,'referenceArtifacts':ARTIFACTS,'restoreFiles':RESTORE_FILES,'hmlFiles':HML_FILES,
  'priorItems':ITEM_HASHES,'restoredRootSha256':ROOT_SHA,'allColumnEvidenceSha256':COLUMN_SHA,'automaticRetryAllowed':False,'newDocumentCreationAllowed':False,'historicalRollbackClaimed':False})
def validate_proof(proof):require(proof==proof_template(),'DIAGNOSTIC_PROOF_NOT_EXACT')
def validate_run(meta,expected):
 require(str(meta.get('id'))==expected['id']and meta.get('head_sha')==expected['commit']and meta.get('path')==expected['workflow']and
  meta.get('repository',{}).get('full_name')=='RaizEducacaoDev/Lambda-Raiz'and meta.get('head_branch')=='fix/idpgto-vinculo-obrigatorio'and
  meta.get('run_attempt')==1 and meta.get('event')=='push'and meta.get('status')=='completed'and meta.get('conclusion')=='success','REFERENCE_RUN_PROVENANCE_INVALID')
def load_proof(restore_dir,hml_dir,metas):
 for name,pins in [('restore',RESTORE_FILES),('hml',HML_FILES)]:
  validate_run(metas[name],RUNS[name]);directory=Path(restore_dir if name=='restore'else hml_dir)
  for file,expected in pins.items():require(file_sha(directory/file)==expected,'REFERENCE_ARTIFACT_FILE_CHANGED')
 read=lambda d,n:json.loads((Path(d)/n).read_text(encoding='utf-8-sig'))
 restore=read(restore_dir,'applied.json');require(restore.get('verified')is True and restore.get('rootExactlyRestored')is True and restore.get('fourPreservedItemsExactlyUnchanged')is True and restore.get('claimMutations')==0 and restore.get('newFinancialAttemptAuthorized')is False,'LEASE_RESTORATION_NOT_CONFIRMED')
 require(restore.get('expectedControlItemHashes')=={ROOT_KEY:ROOT_SHA,**ITEM_HASHES},'RESTORED_CONTROL_HASHES_CHANGED')
 h=read(hml_dir,'result.json');env=read(hml_dir,'environment-schema.json')
 require(h.get('database')=='C3U7RQ_160289_RM_DV'and env.get('authUsernameExactlyP_heflo')is True and h.get('ticket')==228310 and h.get('idlan')==148481 and h.get('saveCalls')=={'clear':1,'attach':1}and h.get('finalBankRestoredAndVerified')is True and h.get('productionWrites')is False and h.get('creations')is False,'HML_NULL_TO_BANK_PROOF_INVALID')
 for phase in('clear','attach'):
  require(h[phase]['verified']is True and h[phase]['nativeExactKey']is True and len(h[phase]['checks'])==2 and all(v['validated']is True for v in h[phase]['checks']),'HML_DOUBLE_READBACK_MISSING')
 return proof_template()
def assert_controls(get,proof,before_lease=False,own_claim=None):
 validate_proof(proof)
 for key,expected in ITEM_HASHES.items():require(sha(get(key))==expected,'PRIOR_CLAIM_RECEIPT_OR_ARCHIVE_CHANGED')
 if before_lease:require(sha(get(ROOT_KEY))==ROOT_SHA,'ROOT_NOT_EXACTLY_RESTORED')
 require(get(CLAIM_V3)==({}if own_claim is None else own_claim),'DIAGNOSTIC_ATTEMPT_ALREADY_EXISTS_NO_RETRY')
 return CLAIM_V3
