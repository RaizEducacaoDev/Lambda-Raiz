"""Offline guards and one-shot synthetic flow; no network or financial writes."""
import base64, copy, importlib.util, io, json, tempfile, time, unittest, urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_226610_test',ROOT/'scripts/run-payment-bank-226610.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
helper = m.load('bank_226610_core_fixture',ROOT/'tests/test_payment_bank_repair.py')

def original():
    return {'digest':{'S':m.INTENT_SHA},'lockUntil':{'N':'1793828452858'},
        'owner':{'S':'7a371fce-223e-4ed1-9acc-228389814890'},'pg':{'S':'42677'},
        'pk':{'S':m.ROOT_KEY},'protocolVersion':{'N':'2'},
        'reconciliationEvidenceKey':{'S':m.ROOT_KEY+'#ADJUDICATION#e1a50fdc79094cf33e2a991cd553daa6979f9195c46c9a56a02be072178e7366'},
        'recuperadaCriacaoIncerta':{'BOOL':True},'state':{'S':'CREATED'}}

def audit():
    root = original()
    row = {'ticket':m.TICKET,'company':m.COMPANY,'idMov':m.MOV,'idLan':m.LAN,
        'rootKey':m.ROOT_KEY,'claimKey':m.CLAIM_KEY,'root':root,
        'unknownAttributes':[],'claimUnknownAttributes':[],'reviewFlags':[],
        **{k:True for k in ['rootStable','claimStable','claimAbsentBothReads','rootMovementLinkMatchesExpected','readComplete']}}
    for phase in ['before','after']:
        row[phase] = {'root':{'item':copy.deepcopy(root),'sha256':m.ROOT_SHA,'exists':True},
                      'claim':{'item':{},'exists':False}}
    return {'status':'COMPLETE_READ_ONLY','purpose':'NINE_BANK_ROOTS_AND_CANONICAL_CLAIMS_READ_ONLY',
        'account':m.lease.ACCOUNT,'region':m.lease.REGION,'table':m.lease.TABLE,'authorizedForApply':False,
        **{k:True for k in ['coverageComplete','runtimeStable','allRootsStable','allClaimsStable',
                           'allCanonicalClaimsAbsent','allExpectedRootMovementLinks','allRootAttributesKnown']},
        **{k:copy.deepcopy(m.RUNTIME) for k in ['expectedRuntime','runtimeStart','runtimeEnd']},
        'workflow':{'repository':m.common.REPOSITORY,'branch':m.common.BRANCH,'path':m.AUDIT_WORKFLOW,
                    'runId':m.AUDIT_RUN,'commit':m.AUDIT_COMMIT},
        'tickets':[row]+[{'ticket':900000+i} for i in range(8)]}

def metadata(run='888',commit='a'*40,workflow=m.WORKFLOW):
    return {'id':int(run),'head_sha':commit,'path':workflow,'repository':{'full_name':m.common.REPOSITORY},
        'head_branch':m.common.BRANCH,'run_attempt':1,'event':'push','status':'completed','conclusion':'success'}

def artifact(run='888',name='payment-bank-226610-private',identifier=123):
    return {'artifacts':[{'id':identifier,'name':name,'expired':False,'workflow_run':{'id':int(run)}}]}

def state():
    value = helper.fixture(m.TICKET)
    value['validation']['payloadValidation']['digest'] = m.INTENT_SHA
    value['remoteSources']['runtime'] = copy.deepcopy(m.RUNTIME)
    return value

class AuditControls(unittest.TestCase):
    def test_exact_post_anchoring_root_and_full_audit9(self):
        self.assertEqual(m.lease.sha(original()),m.ROOT_SHA)
        a = audit(); self.assertEqual(m.audit_row(a)['root'],original())
        items = {m.ROOT_KEY:original()}; before = copy.deepcopy(items)
        with patch.object(m.time,'time',return_value=1793830000):
            with patch.object(m.lease,'get',side_effect=lambda key:copy.deepcopy(items.get(key,{}))):m.controls(a)
        self.assertEqual(items,before)

    def test_old_audit39_unanchored_root_unknown_fields_and_truncation_block(self):
        changes = [('workflow',{}),('coverageComplete',False),('tickets',[]),('runtimeEnd',{}),
                   ('purpose','OLD_BULK_AUDIT'),('authorizedForApply',True)]
        for key,value in changes:
            with self.subTest(key=key),self.assertRaises(m.op.GuardError):m.audit_row({**audit(),key:value})
        for changed in ['owner','digest','pg','protocolVersion','unexpected']:
            a = audit(); a['tickets'][0]['root'][changed] = {'S':'different'}
            with self.subTest(changed=changed),self.assertRaises(m.op.GuardError):m.audit_row(a)
        a = audit(); a['tickets'][0]['after']['claim']={'item':{'pk':{'S':m.CLAIM_KEY}},'exists':True}
        with self.assertRaises(m.op.GuardError):m.audit_row(a)

    def test_fresh_root_change_or_any_canonical_claim_blocks_before_lease(self):
        for changed in ['root','claim']:
            items = {m.ROOT_KEY:original()}
            if changed == 'root':items[m.ROOT_KEY]['owner']={'S':'new-owner'}
            else:items[m.CLAIM_KEY]={'pk':{'S':m.CLAIM_KEY}}
            with patch.object(m.lease,'get',side_effect=lambda key:copy.deepcopy(items.get(key,{}))),patch.object(m.lease,'acquire') as acquire:
                with self.assertRaises(m.op.GuardError):m.apply_once(audit(),{}, {'runId':'999'})
                acquire.assert_not_called()

    def test_run_provenance_failed_rerun_branch_repository_and_commit(self):
        m.validate_run(metadata(),'888','a'*40,m.WORKFLOW)
        for key,value in [('head_sha','b'*40),('head_branch','main'),('run_attempt',2),('conclusion','failure'),
                          ('repository',{'full_name':'other/repo'}),('path','other.yml')]:
            with self.subTest(key=key),self.assertRaises(m.op.GuardError):
                m.validate_run({**metadata(),key:value},'888','a'*40,m.WORKFLOW)

    def test_artifact_exact_id_run_and_expiry(self):
        m.validate_artifact(artifact(),'888','payment-bank-226610-private',123)
        for key,value in [('id',999),('expired',True),('workflow_run',{'id':999}),('name','other')]:
            item=artifact();item['artifacts'][0][key]=value
            with self.subTest(key=key),self.assertRaises(m.op.GuardError):
                m.validate_artifact(item,'888','payment-bank-226610-private',123)

    def test_reference_audit_raw_file_corruption_fails(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'audit.json';path.write_text(json.dumps(audit()))
            def github(url):
                if url.endswith('/artifacts'):return artifact(m.AUDIT_RUN,m.AUDIT_ARTIFACT['name'],m.AUDIT_ARTIFACT['id'])
                return metadata(m.AUDIT_RUN,m.AUDIT_COMMIT,m.AUDIT_WORKFLOW)
            with patch.object(m,'AUDIT',path),patch.object(m,'github',side_effect=github):
                with self.assertRaises(m.op.GuardError):m.reference_audit()

class BranchAndPlans(unittest.TestCase):
    def test_bank_branch_and_fixed_bank_required_before_validator(self):
        for bank in [{'CODCOLIGADA':'25','IDPGTO':'5','CODFILIAL':'2'},
                     {'CODCOLIGADA':'25','IDPGTO':'5'},
                     {'CODCOLIGADA':'25','IDPGTO':'5','CODFILIAL':None},
                     {'CODCOLIGADA':'25','IDPGTO':'4','CODFILIAL':'1'}]:
            adapter=m.BankAdapter()
            with patch.object(m.op.RemoteLiveAdapter,'node') as node,self.assertRaises(m.op.GuardError):
                adapter.node({'bank':bank})
            node.assert_not_called()

    def test_exact_bank_branch_one_passes_and_records_no_pii(self):
        adapter=m.BankAdapter()
        with patch.object(m.op.RemoteLiveAdapter,'node',return_value={'valid':True}):
            self.assertEqual(adapter.node({'bank':{'CODCOLIGADA':'25','IDPGTO':'5','CODFILIAL':'1'}}),{'valid':True})
        self.assertTrue(adapter.bank_branch_confirmed)

    def test_branch_guard_repeated_for_each_read_and_all_four_chains(self):
        adapter=m.BankAdapter(); adapter.bank_branch_confirmed=True
        with patch.object(m.op.RemoteLiveAdapter,'read',return_value=state()):
            with self.assertRaises(m.op.GuardError):adapter.read(m.TICKET)
        for table in ['nativeMov','sqlMov','nativeLan','sqlLan']:
            for bad in [None,'2']:
                value=state();value[table][0]['CODFILIAL']=bad
                with self.subTest(table=table,bad=bad),self.assertRaises(m.op.GuardError):m.branch_snapshot(value)

    def test_runtime_or_auth_user_changed_blocks(self):
        adapter=m.BankAdapter();adapter.rm_user='p_heflo';adapter.rm_auth='Basic '+base64.b64encode(b'p_heflo:synthetic').decode();adapter.zeev_token='synthetic-token'
        with patch.object(m.op.RemoteLiveAdapter,'config',return_value=m.RUNTIME):self.assertEqual(adapter.config(),m.RUNTIME)
        with patch.object(m.op.RemoteLiveAdapter,'config',return_value={}):
            with self.assertRaises(m.op.GuardError):adapter.config()
        adapter.rm_user='other'
        with patch.object(m.op.RemoteLiveAdapter,'config',return_value=m.RUNTIME):
            with self.assertRaises(m.op.GuardError):adapter.config()

    def test_prepare_two_reads_stable_anchored_intent_and_no_effects(self):
        adapter=Mock();adapter.read.return_value=state()
        with patch.object(m,'controls') as controls,patch.object(m,'BankAdapter',return_value=adapter),patch.object(m.lease,'acquire') as acquire:
            plan=m.fresh_plan(audit());self.assertEqual(plan['ticket'],m.TICKET)
            self.assertEqual(adapter.read.call_count,2);self.assertEqual(controls.call_count,2)
            adapter.claim_dispatch.assert_not_called();adapter.save.assert_not_called();acquire.assert_not_called()
        for problem in ['intent','change','extra_field']:
            second=state()
            if problem=='intent':second['validation']['payloadValidation']['digest']='different'
            elif problem=='change':second['formDigest']='different'
            else:second['plans'][0]['campos'].append(['IPTE','synthetic'])
            adapter=Mock();adapter.read.side_effect=[state(),second]
            with patch.object(m,'controls'),patch.object(m,'BankAdapter',return_value=adapter),self.assertRaises(m.op.GuardError):m.fresh_plan(audit())

    def test_plan_manifest_or_sources_changed_before_lease(self):
        ctx={'repository':m.common.REPOSITORY,'branch':m.common.BRANCH,'workflow':m.WORKFLOW,'runId':'999','commit':'b'*40}
        for problem in ['manifest','source','plan']:
            with tempfile.TemporaryDirectory() as d:
                path=Path(d);(path/'plan.json').write_text('{}')
                manifest={'version':1,'mode':'prepare','readOnly':True,'financialWrites':False,'leaseAcquired':False,
                    'workflow':{**ctx,'runId':'888','commit':'a'*40},'sourceHashes':{'good':'hash'},'runtime':m.RUNTIME,
                    'proof':m.proof_summary(),'planSha256':m.op.digest({}),'planFileSha256':m.file_sha(path/'plan.json')}
                if problem=='source':manifest['sourceHashes']={}
                if problem=='plan':manifest['planFileSha256']='0'*64
                (path/'manifest.json').write_text(json.dumps(manifest))
                cfg={'approvedPrepareRunId':'888','approvedManifestSha256':'0'*64 if problem=='manifest' else m.file_sha(path/'manifest.json')}
                with patch.object(m,'APPROVED',path),patch.object(m,'github',side_effect=lambda u:artifact() if u.endswith('artifacts') else metadata()),patch.object(m,'source_hashes',return_value={'good':'hash'}),patch.object(m.lease,'acquire') as acquire:
                    with self.assertRaises(m.op.GuardError):m.approved_plan(cfg,ctx)
                    acquire.assert_not_called()

    def test_config_prepare_cannot_authorize_and_hashes_exclude_approval(self):
        cfg={'version':1,'mode':'prepare','authorizedBankWrite':False,'approvedPrepareRunId':'0','approvedManifestSha256':''}
        self.assertEqual(m.config(cfg),cfg)
        approved={**cfg,'mode':'apply','authorizedBankWrite':True,'approvedPrepareRunId':'888','approvedManifestSha256':'a'*64}
        self.assertEqual(m.config(approved),approved)
        for change in [{'authorizedBankWrite':True},{'mode':'apply'},{'version':True},{'ticket':228007}]:
            with self.assertRaises(m.op.GuardError):m.config({**cfg,**change})
        hashes=m.source_hashes();self.assertNotIn('.github/payment-bank-226610.json',hashes)
        for path in [m.WORKFLOW,'scripts/run-payment-bank-226610.py','scripts/payment_native_redaction.py','tests/test_payment_bank_226610.py']:
            self.assertIn(path,hashes)

    def test_workflow_fixed_audit_shared_group_private_and_prepare_default(self):
        text=(ROOT/m.WORKFLOW).read_text();self.assertIn('run-id: 41920563872',text)
        self.assertNotIn('41892943724',text);self.assertIn('group: payment-backlog-bank-lease',text)
        self.assertIn('retention-days: 1',text);self.assertNotIn('workflow_dispatch',text)
        # Approval config may later change to a separately reviewed APPLY; source stays pinned.
        self.assertIn(m.config(m.read(m.CONFIG))['mode'],('prepare','apply'))

class CaptureAndOneShot(unittest.TestCase):
    def adapter(self,d):
        a=m.BankAdapter(message_dir=Path(d));a.save_attempted=True
        a.claimed={'pk':{'S':m.CLAIM_KEY},'nonce':{'S':'one'}};a.claimed_fields={'IDPGTO':'5','CODCOLPGTO':'25'}
        a.config=Mock(return_value=m.RUNTIME);a.assert_live_lease=Mock();a.preflight_deadline=time.monotonic()+60
        a.secret_values=['private-secret','person@example.com'];a.opener=Mock();return a

    def response(self,body):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return body
        return Response()

    def test_rejection_or_http_error_retained_at_single_http_without_pii(self):
        for http_error in [False,True]:
            with tempfile.TemporaryDirectory() as d:
                a=self.adapter(d);body=b'<Envelope xmlns="http://www.totvs.com/"><SaveRecordResult>Motivo completo. Password=private-secret person@example.com</SaveRecordResult></Envelope>'
                if http_error:a.opener.open.side_effect=urllib.error.HTTPError('https://invalid',500,'not logged',{},io.BytesIO(body))
                else:a.opener.open.return_value=self.response(body)
                with patch.object(m.lease,'get',return_value=a.claimed):
                    if http_error:
                        with self.assertRaises(m.op.NativeSaveError):a.native_save_http(b'not-retained',{})
                    else:self.assertIn('Motivo completo',a.native_save_http(b'not-retained',{}))
                    with self.assertRaises(m.op.GuardError):a.native_save_http(b'not-retained',{})
                self.assertEqual(a.opener.open.call_count,1);self.assertEqual(a.opener.open.call_args.kwargs['timeout'],15)
                text=(Path(d)/'native-response-redacted.txt').read_text();self.assertIn('Motivo completo',text)
                self.assertNotIn('private-secret',text);self.assertNotIn('person@example.com',text)

    def test_timeout_claim_change_runtime_change_and_target_change_do_not_retry(self):
        for problem in ['timeout','claim','runtime','target']:
            with tempfile.TemporaryDirectory() as d:
                a=self.adapter(d);a.opener.open.side_effect=TimeoutError()
                if problem=='runtime':a.config.return_value={}
                if problem=='target':a.claimed_fields={'IDPGTO':'1','CODCOLPGTO':'5'}
                with patch.object(m.lease,'get',return_value={} if problem=='claim' else a.claimed):
                    for _ in range(2):
                        with self.assertRaises(m.op.GuardError):a.native_save_http(b'not-retained',{})
                self.assertEqual(a.opener.open.call_count,1 if problem=='timeout' else 0)

    def test_apply_exact_audit_lease_claim_once_two_readbacks_and_release_only_success(self):
        for outcome in ['success','nonkey','after_commit_timeout']:
            with self.subTest(outcome=outcome),tempfile.TemporaryDirectory() as d:
                directory=Path(d);snapshot=state();events=[];lp=helper.proof(m.TICKET)
                lp['before']=original();lp['leasedRoot']={**original(),'owner':{'S':lp['owner']},'lockUntil':{'N':str(lp['expiresAtEpoch']*1000)}}
                store={m.ROOT_KEY:original()}
                def get(key):return copy.deepcopy(store.get(key,{}))
                def acquire(case,a):
                    self.assertEqual(case,{'ticket':m.TICKET});self.assertEqual(a,audit());events.append('lease')
                    store[m.ROOT_KEY]=copy.deepcopy(lp['leasedRoot'])
                    store[lp['archiveKey']]={'pk':{'S':lp['archiveKey']},'original':{'M':lp['before']},
                        'leaseOwner':lp['leasedRoot']['owner'],'leaseUntil':lp['leasedRoot']['lockUntil']}
                    m.op.write_json(directory/f'lease-{m.TICKET}.json',lp)
                def aws(service,operation,payload):
                    if (service,operation)==('sts','get-caller-identity'):return {'Account':m.lease.ACCOUNT}
                    self.assertEqual((service,operation),('dynamodb','put-item'))
                    self.assertEqual(payload['ConditionExpression'],'attribute_not_exists(pk)')
                    self.assertEqual(payload['Item']['pk'],{'S':m.CLAIM_KEY})
                    if m.CLAIM_KEY in store:raise RuntimeError('conditional')
                    store[m.CLAIM_KEY]=copy.deepcopy(payload['Item']);events.append('claim');return{}
                class Response:
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                    def read(self,*args):
                        events.append('http')
                        if outcome != 'nonkey':
                            for row in snapshot['nativeLan']+snapshot['sqlLan']:row.update(IDPGTO='5',CODCOLPGTO='25')
                        if outcome=='after_commit_timeout':raise TimeoutError()
                        msg='25;79094' if outcome=='success' else 'Motivo completo. Cadastro rejeitado.'
                        return ('<Envelope xmlns="http://www.totvs.com/"><SaveRecordResult>'+msg+'</SaveRecordResult></Envelope>').encode()
                class Adapter(m.BankAdapter):
                    def read(self,*args,**kwargs):events.append('read');m.branch_snapshot(snapshot);return copy.deepcopy(snapshot)
                    def config(self):return m.RUNTIME
                adapter=Adapter(lp,directory/'output/ticket-226610');adapter.opener=Mock();adapter.opener.open.return_value=Response()
                plan=m.op.review(snapshot,m.TICKET)
                with patch.object(m,'OUT',directory/'output'),patch.object(m.lease,'OUT',directory),patch.object(m.lease,'get',side_effect=get),patch.object(m.lease,'aws',side_effect=aws),patch.object(m.lease,'acquire',side_effect=acquire),patch.object(m.lease,'release',return_value={'released':True,'originalRootExactlyRestored':True}) as release,patch.object(m,'fresh_plan',return_value=plan),patch.object(m,'BankAdapter',return_value=adapter):
                    if outcome=='success':self.assertEqual(m.apply_once(audit(),plan,{'runId':'999'})['state'],'VERIFIED');release.assert_called_once()
                    else:
                        with self.assertRaises(m.op.GuardError):m.apply_once(audit(),plan,{'runId':'999'})
                        release.assert_not_called()
                    with self.assertRaises(m.op.GuardError):m.apply_once(audit(),plan,{'runId':'999'})
                self.assertEqual(events.count('claim'),1);self.assertEqual(events.count('http'),1)
                self.assertEqual(events.count('read'),4);self.assertLess(events.index('claim'),events.index('http'))
                self.assertEqual(store[lp['archiveKey']]['original'],{'M':original()})

if __name__ == '__main__':unittest.main()
