"""Read-only PREPARE by default; one separately approved bank link on 25/79094.

No document creation, Lambda invocation, Zeev write, claim deletion or retry.
The original CREATED root is preserved, including its positive RM adjudication.
"""
import base64, hashlib, http.client, importlib.util, json, os, re, sys, time
from pathlib import Path
import urllib.error, urllib.request, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module); return module

common = load('bank_226610_common', ROOT/'scripts/run-payment-bank-repair.py')
op = common.operator; lease = op.lease_module; require = op.require
redaction = load('bank_226610_redaction', ROOT/'scripts/payment_native_redaction.py')
TICKET = 226610; COMPANY = 25; MOV = 42677; LAN = 79094; BANK = 5; BRANCH = '1'
ROOT_KEY = 'prod#PG#25#226610'; CLAIM_KEY = ROOT_KEY+'#BANK_REPAIR_ATTEMPT'
RUNTIME = {'codeSha256':'nP8Tf7PTJVjQcqhA+QwqCkA69wFPlJ+kYe/8QHKR5/A=',
           'revisionId':'6aec6184-80d8-47eb-b386-32cab252c086'}
AUDIT_RUN = '41920563872'; AUDIT_COMMIT = 'e91449d0c330876b9e7795b3f97b30fa1fad7e0d'
AUDIT_WORKFLOW = '.github/workflows/payment-bank-nine-readonly.yml'
AUDIT_ARTIFACT = {'id':13365759281, 'name':'payment-bank-nine-readonly-evidence'}
AUDIT_SHA = '8e4efaf372ec9994332eedc8cf212b96c5b6066a6120c0c813a88e71e5d89f04'
ROOT_SHA = '72e34a290e7c1770b9f5dd2c00bae621be321e5cd0b25a42054d89c0b631e589'
INTENT_SHA = '9275ae92d1ab0b880287309c8eb9cccb658c8fcd3a35045fd404204476805fd2'
WORKFLOW = '.github/workflows/payment-bank-226610.yml'
CONFIG = ROOT/'.github/payment-bank-226610.json'
AUDIT = Path('.bank-226610-audit/readback.json')
OUT = Path('.payment-bank-226610'); APPROVED = Path('.approved-bank-226610')

def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def file_sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name, value): op.write_json(OUT/name, value, exclusive=True)

def github(path):
    token = os.environ.get('GH_TOKEN'); require(bool(token), 'GITHUB_READ_TOKEN_REQUIRED')
    request = urllib.request.Request('https://api.github.com/repos/'+common.REPOSITORY+path,
        headers={'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json'})
    try:
        with urllib.request.build_opener(op.observer.NoRedirect()).open(request, timeout=15) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError):
        raise op.GuardError('GITHUB_REFERENCE_READ_FAILED') from None

def validate_run(meta, run_id, commit, workflow, finished=True):
    require(str(meta.get('id')) == run_id and meta.get('head_sha') == commit and
        meta.get('path') == workflow and meta.get('head_branch') == common.BRANCH and
        meta.get('repository',{}).get('full_name') == common.REPOSITORY and
        meta.get('event') == 'push' and meta.get('run_attempt') == 1,
        'BANK_226610_RUN_PROVENANCE_INVALID')
    if finished:
        require(meta.get('status') == 'completed' and meta.get('conclusion') == 'success',
                'BANK_226610_REFERENCE_RUN_NOT_SUCCESSFUL')

def validate_artifact(meta, run_id, name, exact_id=None):
    require(isinstance(meta, dict) and isinstance(meta.get('artifacts'), list), 'ARTIFACT_LIST_INVALID')
    matches = [x for x in meta['artifacts'] if x.get('name') == name]
    require(len(matches) == 1 and matches[0].get('expired') is False, 'ARTIFACT_MISSING_OR_EXPIRED')
    artifact = matches[0]
    require(type(artifact.get('id')) is int and (exact_id is None or artifact['id'] == exact_id),
            'ARTIFACT_ID_CHANGED')
    require(str(artifact.get('workflow_run',{}).get('id')) == run_id, 'ARTIFACT_RUN_CHANGED')
    return artifact

def config(value):
    keys = {'version','mode','authorizedBankWrite','approvedPrepareRunId','approvedManifestSha256'}
    require(isinstance(value, dict) and set(value) == keys and type(value['version']) is int and
            value['version'] == 1 and value['mode'] in ('prepare','apply') and
            type(value['authorizedBankWrite']) is bool, 'BANK_226610_CONFIG_INVALID')
    require(isinstance(value['approvedPrepareRunId'], str) and isinstance(value['approvedManifestSha256'], str),
            'BANK_226610_APPROVAL_FORMAT_INVALID')
    if value['mode'] == 'prepare':
        require(value['authorizedBankWrite'] is False and value['approvedPrepareRunId'] == '0' and
                value['approvedManifestSha256'] == '', 'PREPARE_CANNOT_AUTHORIZE_WRITE')
    else:
        require(value['authorizedBankWrite'] is True and re.fullmatch('[1-9][0-9]*', value['approvedPrepareRunId']) and
                re.fullmatch('[a-f0-9]{64}', value['approvedManifestSha256']), 'EXPLICIT_FRESH_BANK_APPROVAL_REQUIRED')
    return value

def source_hashes():
    result = common.code_hashes()
    for path in ['scripts/run-payment-bank-226610.py','scripts/payment_native_redaction.py',
                 'tests/test_payment_bank_226610.py', WORKFLOW]:
        result[path] = file_sha(ROOT/path)
    # Config is the separate, explicit operator approval; it is not executable source.
    return dict(sorted(result.items()))

def audit_row(audit):
    require(isinstance(audit, dict) and audit.get('status') == 'COMPLETE_READ_ONLY' and
        audit.get('purpose') == 'NINE_BANK_ROOTS_AND_CANONICAL_CLAIMS_READ_ONLY' and
        audit.get('account') == lease.ACCOUNT and audit.get('region') == lease.REGION and
        audit.get('table') == lease.TABLE and audit.get('authorizedForApply') is False,
        'AUDIT9_CONTRACT_INVALID')
    for field in ['coverageComplete','runtimeStable','allRootsStable','allClaimsStable',
                  'allCanonicalClaimsAbsent','allExpectedRootMovementLinks','allRootAttributesKnown']:
        require(audit.get(field) is True, 'AUDIT9_INCOMPLETE_OR_UNSTABLE')
    for field in ['expectedRuntime','runtimeStart','runtimeEnd']:
        require(audit.get(field) == RUNTIME, 'AUDIT9_RUNTIME_MISMATCH')
    require(audit.get('workflow') == {'repository':common.REPOSITORY,'branch':common.BRANCH,
        'path':AUDIT_WORKFLOW,'runId':AUDIT_RUN,'commit':AUDIT_COMMIT}, 'AUDIT9_PROVENANCE_MISMATCH')
    require(isinstance(audit.get('tickets'), list) and len(audit['tickets']) == 9 and
            len({r.get('ticket') for r in audit['tickets']}) == 9, 'AUDIT9_TARGET_COUNT_INVALID')
    rows = [r for r in audit['tickets'] if r.get('ticket') == TICKET]
    require(len(rows) == 1, 'AUDIT9_TARGET_NOT_UNIQUE'); row = rows[0]
    require((row.get('company'),row.get('idMov'),row.get('idLan'),row.get('rootKey'),row.get('claimKey')) ==
            (COMPANY,MOV,LAN,ROOT_KEY,CLAIM_KEY), 'AUDIT9_EXACT_TARGET_MISMATCH')
    require(row.get('unknownAttributes') == row.get('claimUnknownAttributes') == row.get('reviewFlags') == [],
            'AUDIT9_UNKNOWN_ROOT_ATTRIBUTES')
    for field in ['rootStable','claimStable','claimAbsentBothReads','rootMovementLinkMatchesExpected','readComplete']:
        require(row.get(field) is True, 'AUDIT9_TARGET_UNSTABLE')
    original = row.get('root')
    require(isinstance(original,dict) and lease.sha(original) == ROOT_SHA and
        original.get('state') == {'S':'CREATED'} and original.get('pg') == {'S':str(MOV)} and
        original.get('protocolVersion') == {'N':'2'} and original.get('digest') == {'S':INTENT_SHA},
        'AUDIT9_ORIGINAL_ROOT_CHANGED')
    for phase in ['before','after']:
        observed = row.get(phase,{})
        require(observed.get('root',{}).get('item') == original and
            observed.get('root',{}).get('sha256') == ROOT_SHA and observed.get('root',{}).get('exists') is True,
            'AUDIT9_ROOT_READBACK_MISMATCH')
        require(observed.get('claim',{}).get('item') == {} and
            observed.get('claim',{}).get('exists') is False, 'AUDIT9_CANONICAL_CLAIM_NOT_ABSENT')
    return row

def reference_audit():
    validate_run(github('/actions/runs/'+AUDIT_RUN), AUDIT_RUN, AUDIT_COMMIT, AUDIT_WORKFLOW)
    validate_artifact(github('/actions/runs/'+AUDIT_RUN+'/artifacts'), AUDIT_RUN,
                      AUDIT_ARTIFACT['name'], AUDIT_ARTIFACT['id'])
    require(file_sha(AUDIT) == AUDIT_SHA, 'AUDIT9_RAW_FILE_CHANGED')
    audit = read(AUDIT); audit_row(audit); return audit

def controls(audit):
    row = audit_row(audit)
    require(lease.get(ROOT_KEY) == row['root'], 'CURRENT_ROOT_DIFFERS_FROM_AUDIT9')
    require(lease.get(CLAIM_KEY) == {}, 'DURABLE_BANK_ATTEMPT_ALREADY_EXISTS_NO_RETRY')
    require(int(row['root']['lockUntil']['N']) < int(time.time()*1000), 'ORIGINAL_ROOT_LEASE_NOT_EXPIRED')

def branch_snapshot(snapshot):
    for table in ['nativeMov','sqlMov','nativeLan','sqlLan']:
        rows = snapshot.get(table)
        require(isinstance(rows,list) and len(rows) == 1 and op.text(rows[0].get('CODFILIAL')) == BRANCH,
                'BANK_226610_MOVEMENT_OR_LAUNCH_BRANCH_CHANGED')

class BankAdapter(op.RemoteLiveAdapter):
    def __init__(self, lease_proof=None, message_dir=None):
        super().__init__(TICKET, lease_proof)
        self.message_dir = message_dir; self.secret_values = []; self.http_dispatch_count = 0
        self.bank_branch_confirmed = False

    def config(self):
        runtime = super().config(); require(runtime == RUNTIME, 'BANK_226610_RUNTIME_PIN_CHANGED')
        require(self.rm_user == 'p_heflo', 'BANK_226610_AUTH_USER_CHANGED')
        decoded = base64.b64decode(self.rm_auth[6:]).decode('utf-8')
        self.secret_values.extend([self.rm_user,decoded.split(':',1)[1],self.rm_auth,self.rm_auth[6:],self.zeev_token])
        return runtime

    def node(self, value):
        if 'bank' in value:
            bank = value['bank']
            require(isinstance(bank,dict) and op.text(bank.get('CODFILIAL')) == BRANCH and
                    op.text(bank.get('CODCOLIGADA')) == str(COMPANY) and
                    op.text(bank.get('IDPGTO')) == str(BANK), 'BANK_226610_BANK_BRANCH_OR_ID_CHANGED')
            self.bank_branch_confirmed = True
        self.secret_values.extend(redaction.known_pii(value))
        return super().node(value)

    def read(self, ticket, independent=False):
        require(ticket == TICKET, 'BANK_226610_SCOPE_CHANGED'); self.bank_branch_confirmed = False
        value = super().read(ticket, independent)
        require(self.bank_branch_confirmed, 'BANK_226610_BANK_BRANCH_NOT_OBSERVED')
        branch_snapshot(value); return value

    def capture_message(self, raw, stage, complete):
        require(self.message_dir is not None, 'PRIVATE_MESSAGE_DIRECTORY_REQUIRED')
        self.message_dir.mkdir(parents=True, exist_ok=True)
        text = raw.decode('utf-8',errors='replace') if isinstance(raw,bytes) else str(raw)
        try:
            root = ET.fromstring(text); result = root.find('.//{http://www.totvs.com/}SaveRecordResult')
            fault = next((n for n in root.iter() if n.tag.endswith('Fault')), None)
            if result is not None and result.text is not None: text = result.text
            elif fault is not None: text = '\n'.join(t for t in fault.itertext() if t.strip())
            else:
                body = root.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
                if body is not None: text = ET.tostring(body,encoding='unicode')
        except ET.ParseError: pass
        safe, counts = redaction.redact(text,self.secret_values)
        path = self.message_dir/'native-response-redacted.txt'
        with path.open('x',encoding='utf-8') as f: f.write(safe); f.flush(); os.fsync(f.fileno())
        op.write_json(self.message_dir/'native-response-private-metadata.json',
            {'stage':stage,'responseSha256':hashlib.sha256(text.encode()).hexdigest(),
             'redactedSha256':file_sha(path),'length':len(text),'lineCount':len(text.splitlines()),
             'completeResponse':complete,'redactions':counts,'rawCredentialsOrKnownPiiRetained':False},exclusive=True)

    def native_save_http(self, raw, headers):
        require(self.http_dispatch_count == 0 and self.save_attempted and self.claimed is not None and
            self.claimed.get('pk') == {'S':CLAIM_KEY}, 'BANK_226610_HTTP_NOT_ONE_SHOT_CLAIMED')
        require(self.claimed_fields == {'IDPGTO':str(BANK),'CODCOLPGTO':str(COMPANY)}, 'BANK_226610_FIELDS_CHANGED')
        require(lease.get(CLAIM_KEY) == self.claimed, 'BANK_226610_CLAIM_CHANGED_BEFORE_HTTP')
        require(self.config() == RUNTIME, 'BANK_226610_RUNTIME_CHANGED_BEFORE_HTTP')
        self.assert_live_lease(TICKET)
        require(self.preflight_deadline is not None and time.monotonic() <= self.preflight_deadline,
                'PREFLIGHT_EXPIRED_BEFORE_BANK_POST')
        self.http_dispatch_count += 1
        try:
            with self.opener.open(urllib.request.Request(op.observer.HOST+'/wsDataServer/IwsDataServer',
                    data=raw,headers=headers), timeout=15) as response: value = response.read(8000001)
        except urllib.error.HTTPError as error:
            body = error.read(8000001); self.capture_message(body,'HTTP_ERROR',len(body)<=8000000)
            raise op.NativeSaveError(f'BANK_SAVE_HTTP_{error.code}',op.native_diagnostic(body)) from None
        except http.client.IncompleteRead as error:
            self.capture_message(error.partial,'INCOMPLETE_HTTP_RESPONSE',False)
            raise op.NativeSaveError('BANK_SAVE_INCOMPLETE_RESPONSE_NO_RETRY',op.native_diagnostic(error.partial)) from None
        except (urllib.error.URLError,TimeoutError):
            raise op.GuardError('BANK_SAVE_NETWORK_OUTCOME_UNCERTAIN_NO_RETRY') from None
        self.capture_message(value,'SAVE_RECORD_HTTP_RESPONSE',len(value)<=8000000)
        require(len(value)<=8000000,'BANK_SAVE_RESPONSE_TOO_LARGE')
        try: root = op.observer.xml_dataset(value)
        except Exception: raise op.NativeSaveError('BANK_SAVE_INVALID_XML',op.native_diagnostic(value)) from None
        if any(n.tag.endswith('Fault') for n in root.iter()):
            raise op.NativeSaveError('BANK_SAVE_SOAP_FAULT',op.native_diagnostic(value))
        result = root.find('.//{http://www.totvs.com/}SaveRecordResult')
        require(result is not None and result.text, 'BANK_SAVE_RESULT_MISSING'); return result.text

def fresh_plan(audit):
    controls(audit); started = time.monotonic(); adapter = BankAdapter()
    first = adapter.read(TICKET); second = adapter.read(TICKET,independent=True)
    plan = op.review(second,TICKET)
    require(op.review(first,TICKET) == plan, 'CURRENT_BUSINESS_OBSERVATION_CHANGED')
    require(plan['baseline']['intentDigest'] == INTENT_SHA, 'BANK_226610_INTENT_DIFFERS_FROM_ANCHORED_ROOT')
    require(plan['writeFields'] == ['CODCOLPGTO','IDPGTO'], 'BANK_226610_NON_MINIMAL_FIELDS')
    controls(audit)
    require(time.monotonic()-started <= 60, 'BANK_OBSERVATIONS_OLDER_THAN_60_SECONDS')
    return plan

def proof_summary():
    return {'ticket':TICKET,'company':COMPANY,'idmov':MOV,'idlan':LAN,'bank':BANK,'branch':1,
            'auditRunId':AUDIT_RUN,'auditArtifactId':AUDIT_ARTIFACT['id'],'auditFileSha256':AUDIT_SHA,
            'rootSha256':ROOT_SHA,'rootState':'CREATED','intentSha256':INTENT_SHA,
            'nativeBankBranchRequiredOnEveryRead':True,'canonicalClaimKey':CLAIM_KEY}

def approved_plan(cfg, ctx):
    run = cfg['approvedPrepareRunId']; require(run != ctx['runId'], 'APPROVAL_CANNOT_REFERENCE_CURRENT_RUN')
    require(file_sha(APPROVED/'manifest.json') == cfg['approvedManifestSha256'], 'APPROVED_MANIFEST_SHA_CHANGED')
    manifest = read(APPROVED/'manifest.json'); meta = github('/actions/runs/'+run)
    validate_run(meta,run,manifest.get('workflow',{}).get('commit'),WORKFLOW)
    validate_artifact(github('/actions/runs/'+run+'/artifacts'),run,'payment-bank-226610-private')
    require(manifest.get('workflow') == {**ctx,'runId':run,'commit':meta['head_sha']} and
        manifest.get('version') == 1 and manifest.get('mode') == 'prepare' and manifest.get('readOnly') is True and
        manifest.get('financialWrites') is False and manifest.get('leaseAcquired') is False,
        'APPROVED_MANIFEST_NOT_READONLY_PREPARE')
    require(manifest.get('sourceHashes') == source_hashes() and manifest.get('runtime') == RUNTIME and
        manifest.get('proof') == proof_summary(), 'APPROVED_SOURCE_OR_PROOF_CHANGED')
    require(manifest.get('planFileSha256') == file_sha(APPROVED/'plan.json'), 'APPROVED_PLAN_FILE_CHANGED')
    plan = read(APPROVED/'plan.json')
    require(manifest.get('planSha256') == op.digest(plan), 'APPROVED_PLAN_HASH_CHANGED'); return plan

def apply_once(audit, plan, ctx):
    controls(audit); require(fresh_plan(audit) == plan, 'LIVE_PLAN_DIFFERS_FROM_APPROVED_PREPARE')
    controls(audit); lease.OUT.mkdir(exist_ok=True); lease.acquire({'ticket':TICKET},audit)
    path = lease.OUT/f'lease-{TICKET}.json'; lp = read(path)
    require(lp['before'] == audit_row(audit)['root'] and lease.sha(lp['before']) == ROOT_SHA,
            'NEW_LEASE_ORIGINAL_ROOT_CHANGED')
    require(op.validate_lease(path,file_sha(path),TICKET) == lp, 'NEW_LEASE_PROOF_CHANGED')
    op.checked_remote_proof(lp,TICKET)
    directory = OUT/f'ticket-{TICKET}'; adapter = BankAdapter(lp,directory)
    result = op.execute(adapter,TICKET,plan,op.digest(plan),directory,
        f'https://github.com/{common.REPOSITORY}/actions/runs/{ctx["runId"]}',path,file_sha(path))
    require(result.get('state') == 'VERIFIED' and result.get('sameSessionAndIndependentReadback') is True and
            adapter.http_dispatch_count == 1, 'BANK_OUTCOME_NOT_VERIFIED_NO_RETRY')
    restored = lease.release(lp)
    require(restored.get('released') is True and restored.get('originalRootExactlyRestored') is True,
            'BANK_LEASE_RELEASE_NOT_VERIFIED')
    return {'state':'VERIFIED','bankVerified':True,'leaseReleased':True,'httpDispatches':1}

def main():
    cfg = config(read(CONFIG)); ctx = common.context(); ctx['workflow'] = WORKFLOW; OUT.mkdir(exist_ok=False)
    validate_run(github('/actions/runs/'+ctx['runId']),ctx['runId'],ctx['commit'],WORKFLOW,finished=False)
    require(lease.aws('sts','get-caller-identity',{})['Account'] == lease.ACCOUNT, 'AWS_ACCOUNT_MISMATCH')
    audit = reference_audit(); controls(audit)
    if cfg['mode'] == 'prepare':
        plan = fresh_plan(audit); write('plan.json',plan)
        write('manifest.json',{'version':1,'mode':'prepare','readOnly':True,'workflow':ctx,'runtime':RUNTIME,
            'sourceHashes':source_hashes(),'proof':proof_summary(),'planSha256':op.digest(plan),
            'planFileSha256':file_sha(OUT/'plan.json'),'financialWrites':False,'leaseAcquired':False,
            'nativeFinancialChainRevalidatedTwice':True,'bankBranchConfirmedTwice':1})
        print(json.dumps({'state':'PREPARED_READ_ONLY','runId':ctx['runId'],
                          'manifestSha256':file_sha(OUT/'manifest.json'),'automaticApply':False})); return 0
    plan = approved_plan(cfg,ctx)
    try: result = apply_once(audit,plan,ctx)
    except Exception as error:
        result = {'state':'STOPPED_NO_AUTOMATIC_RETRY','errorType':type(error).__name__,
                  'gate':str(error) if isinstance(error,op.GuardError) else 'EXTERNAL_FAILURE',
                  'leaseMayRemainUntilExpiry':True}
    write('result.json',{'workflow':ctx,'proof':proof_summary(),'runtime':RUNTIME,'sourceHashes':source_hashes(),
        'automaticRetry':False,'financialDocumentCreations':False,'zeevWrites':False,'lambdaInvoked':False,**result})
    print(json.dumps(result)); return 0 if result['state'] == 'VERIFIED' else 2

if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'state':'STOPPED_NO_RETRY','errorType':type(error).__name__,
                         'gate':str(error) if isinstance(error,op.GuardError) else 'EXTERNAL_FAILURE'}))
        raise SystemExit(2)
