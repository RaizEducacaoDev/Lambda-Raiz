"""No external services: prove fencing, complete evidence and no ambiguous replay."""
from collections import Counter
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import time
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('backlog_recovery',Path(__file__).resolve().parents[1]/'scripts/reconcile-payment-backlog.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RUNTIME={'codeSha256':'Pt8n1Td1BarRUJWuGaQnMcNY5bYXcS8b3TvUaY28U0U=','revisionId':'8e19007a-a781-4bad-b4c9-3c749e5b9318'}

def fixtures(adopt=False):
    company,ticket=(5,228007) if adopt else (1,225136)
    now=int(time.time()*1000);lease=now-200000
    root={'pk':{'S':f'prod#PG#{company}#{ticket}'},'state':{'S':'CREATED' if adopt else 'CREATING'},
        'digest':{'S':'a'*64},'owner':{'S':'974b1745-53a1-4b3e-95ec-f67f547d9628'},'lockUntil':{'N':str(lease)},
        'legacyExtra':{'M':{'value':{'S':'preserve original'}}}}
    if adopt:root['pg']={'S':'165611'}
    plan={'version':1,'action':'ADOPT_EXISTING' if adopt else 'RESERVE_NEW','company':company,'ticket':ticket,
        'expectedRoot':root,'currentDigest':'b'*64 if adopt else 'a'*64,'expectedRuntime':dict(RUNTIME)}
    if adopt:plan['idMov']=165611
    identity={'company':str(company),'branch':'1','supplierCompany':'0','supplier':'0000157430','movementType':'1.2.03',
        'number':'000000018','series':'1','documentType':'002','issueDate':'2026-10-23','entryDate':'2026-10-23','total':'100.00'}
    bank={'company':str(company),'supplierCompany':'0','supplier':'0000157430','id':'1','paymentCode':'Y'}
    parcels=[{'dueDate':'2026-11-10','amount':'60.00','bankCompany':str(company),'bankId':'1'},
             {'dueDate':'2026-11-20','amount':'40.00','bankCompany':str(company),'bankId':'1'}]
    census={'observedUtc':m.utc(),'company':company,'ticket':ticket,'complete':True,'committedRead':True,
        'lookupModes':sorted(m.LOOKUPS),'lookupIdentities':[m.sha(m.identity(identity))],
        'document':{**{k:identity[k] for k in m.DOCUMENT},'configured':True},'movements':[],'launches':[],'documentCandidates':[]}
    if adopt:
        census['movements']=[{**identity,'idMov':'165611','ticket':str(ticket),'status':'F','gross':'100.00','net':'100.00'}]
        census['documentCandidates']=[{'company':company,'idMov':165611,'ticket':ticket}]
        for index,parcel in enumerate(parcels):
            census['launches'].append({**{k:identity[k] for k in ('company','branch','supplierCompany','supplier','issueDate')},
                'idMov':'165611','idLan':str(634500+index),'ticket':str(ticket),'dueDate':parcel['dueDate'],'amount':parcel['amount'],
                'status':0,'paid':'0.00','pendingPayment':0,'boletoCount':0,'boletoId':None,'bankId':None,'bankCompany':None})
    proof={'observedUtc':m.utc(),'runtime':dict(RUNTIME),'identity':identity,'bank':{**bank,'active':True},'plans':parcels,
        'zeev':{'observedUtc':m.utc(),'active':True,'flowId':299,'ticket':ticket,'company':company,'currentDigest':plan['currentDigest'],
            'identity':dict(identity),'bank':dict(bank),'plans':copy.deepcopy(parcels),
            'validation':{'payload':True,'bank':True,'document':True,'fiscal':True}},
        'closure':{'observedUtc':m.utc(),'originalRequestId':'723c6c39-f369-4fff-a663-23ab30ba5749','logSourceSha256':'c'*64,
            'originalRootSha256':m.sha(root),'originalStartMs':lease-90000,'originalEndMs':lease-88000,'originalReportMs':lease-88000,
            'endSeen':True,'reportSeen':True,'coverageComplete':True,'laterDispatches':0},
        'native':copy.deepcopy(census),'independent':copy.deepcopy(census)}
    refresh_hash(plan,proof)
    return plan,proof

def refresh_hash(plan,proof):
    proof['sourceReadbackSha256']=m.observation_sha(proof)
    plan['expectedObservationSha256']=proof['sourceReadbackSha256']

class Fake:
    def __init__(self,plan,proof):
        self.plan,self.proof=copy.deepcopy(plan),copy.deepcopy(proof)
        self.pk=m.root_key(plan);self.items={self.pk:copy.deepcopy(plan['expectedRoot'])}
        self.calls=[];self.observations=0;self.mode=None;self.final_mutation=None;self.archive_mode=None

    def bootstrap(self):
        self.calls.append('bootstrap');return dict(RUNTIME)

    def get(self,key):
        self.calls.append('get');return copy.deepcopy(self.items.get(key,{}))

    def observe(self,plan):
        self.calls.append('observe');self.observations+=1
        proof=copy.deepcopy(self.proof)
        if self.observations==2 and self.final_mutation:self.final_mutation(proof)
        return proof

    def archive(self,item):
        self.calls.append('archive');self.items[item['pk']['S']]=copy.deepcopy(item)
        if self.archive_mode=='different':self.items[item['pk']['S']]['manifestJson']={'S':'different'}
        if self.archive_mode:raise TimeoutError('not for output')

    def update(self,request):
        self.calls.append('cas');root=self.items[self.pk]
        if self.mode=='conflict':root['owner']={'S':'concurrent'}
        if self.mode=='new_marker':root['recuperadaCriacaoIncerta']={'BOOL':True}
        for alias,name in request['ExpressionAttributeNames'].items():
            if alias.startswith('#old') and root.get(name)!=request['ExpressionAttributeValues'][':'+alias[1:]]:
                raise m.GateError('conditional conflict')
        for name in m.CRITICAL:
            if f'attribute_not_exists({name})' in request['ConditionExpression'] and name in root:
                raise m.GateError('concurrent marker')
        if self.mode=='timeout_before':raise TimeoutError('not applied')
        values=request['ExpressionAttributeValues']
        mapping={'state':':state','owner':':owner','digest':':digest','lockUntil':':until','protocolVersion':':protocol','reconciliationEvidenceKey':':evidence'}
        if ':pg' in values:mapping.update(pg=':pg',recuperadaCriacaoIncerta=':recovered')
        for k,v in mapping.items():root[k]=copy.deepcopy(values[v])
        if self.mode=='progress':root['state']={'S':'CREATING'}
        if self.mode in ('timeout_after','progress'):raise TimeoutError('applied response lost')
        return {'Attributes':copy.deepcopy(root)}

class RecoveryTests(unittest.TestCase):
    def test_null_text_is_never_reinterpreted_as_literal_none(self):
        _,proof=fixtures()
        for field in ('supplier','number','series','documentType','issueDate','entryDate'):
            value={**proof['identity'],field:None}
            with self.assertRaisesRegex(m.GateError,'IDENTITY_TEXT'):m.identity(value,allow_omitted_entry=True)

    def test_omitted_entry_is_preserved_while_actual_native_dates_still_must_agree(self):
        plan,proof=fixtures(True)
        proof['identity']['entryDate']='';proof['zeev']['identity']['entryDate']=''
        expected=m.identity(proof['identity'],allow_omitted_entry=True)
        for source in ('native','independent'):proof[source]['lookupIdentities']=[m.sha(expected)]
        refresh_hash(plan,proof)
        with self.assertRaisesRegex(m.GateError,'OMISSION_NOT_EXPLICIT'):m.validate_observation(plan,proof)
        proof['zeev']['entryDateOmitted']=True;refresh_hash(plan,proof);m.validate_observation(plan,proof)
        self.assertEqual(proof['identity']['entryDate'],'')
        proof['native']['movements'][0]['entryDate']='';refresh_hash(plan,proof)
        with self.assertRaises(m.GateError):m.validate_observation(plan,proof)
        proof['native']['movements'][0]['entryDate']='2026-10-24';refresh_hash(plan,proof)
        with self.assertRaisesRegex(m.GateError,'INDEPENDENT_NATIVE_READS_DISAGREE'):m.validate_observation(plan,proof)

    def run_case(self,adopt=False,apply=True):
        plan,proof=fixtures(adopt);fake=Fake(plan,proof)
        return plan,proof,fake,m.reconcile(fake,plan,apply=apply,authorized=apply)

    def test_scope_exactly_matches_readonly_inventory_without_importing_its_side_effects(self):
        import ast
        tree=ast.parse((Path(__file__).resolve().parents[1]/'scripts/audit-payment-bulk-recovery.py').read_text(encoding='utf-8'))
        cases=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CASES' for t in node.targets))
        self.assertEqual(m.CASES,frozenset(cases));self.assertEqual(len(m.CASES),39)
        self.assertNotIn((9,226374),m.CASES)

    def test_dry_run_has_zero_writes(self):
        plan,proof,fake,result=self.run_case(apply=False)
        self.assertFalse(result['applied']);self.assertNotIn('archive',fake.calls);self.assertNotIn('cas',fake.calls)
        self.assertEqual(fake.items[fake.pk],plan['expectedRoot'])

    def test_authorization_is_required_before_any_read(self):
        plan,proof=fixtures();fake=Fake(plan,proof)
        with self.assertRaisesRegex(m.GateError,'AUTHORIZATION'):m.reconcile(fake,plan,apply=True)
        self.assertFalse(fake.calls)

    def test_same_digest_can_be_recovered_with_full_closed_attempt_proof(self):
        plan,proof,fake,result=self.run_case()
        self.assertEqual(plan['currentDigest'],plan['expectedRoot']['digest']['S'])
        self.assertTrue(result['applied']);self.assertEqual(result['outcome'],'NEW_ATTEMPT_RESERVED')
        current=fake.items[fake.pk]
        self.assertEqual(current['state'],{'S':'RESERVED'});self.assertEqual(current['protocolVersion'],{'N':'2'})
        self.assertEqual(current['legacyExtra'],plan['expectedRoot']['legacyExtra']);self.assertNotIn('pg',current)
        self.assertNotEqual(current['owner'],plan['expectedRoot']['owner'])
        self.assertLess(int(current['lockUntil']['N']),int(time.time()*1000))
        self.assertFalse(result['financialWrites']);self.assertFalse(result['zeevWrites']);self.assertFalse(result['lambdaInvoked'])

    def test_existing_record_is_adopted_not_completed_or_recreated(self):
        plan,proof,fake,result=self.run_case(adopt=True)
        self.assertTrue(result['applied']);self.assertEqual(result['outcome'],'EXISTING_MOVEMENT_ADOPTED')
        current=fake.items[fake.pk]
        self.assertEqual(current['state'],{'S':'CREATED'});self.assertEqual(current['pg'],{'S':'165611'})
        self.assertEqual(current['recuperadaCriacaoIncerta'],{'BOOL':True})
        self.assertEqual(fake.calls.count('cas'),1)

    def test_creating_without_pg_can_adopt_only_unique_owned_record(self):
        plan,proof=fixtures(True);plan['expectedRoot']['state']={'S':'CREATING'};plan['expectedRoot'].pop('pg')
        proof['closure']['originalRootSha256']=m.sha(plan['expectedRoot']);refresh_hash(plan,proof)
        self.assertTrue(m.reconcile(Fake(plan,proof),plan,apply=True,authorized=True)['applied'])

    def test_new_protocol_or_prior_recovery_is_never_overwritten(self):
        for name,value in [('protocolVersion',{'N':'2'}),('reconciliationEvidenceKey',{'S':'history'}),('recuperadaCriacaoIncerta',{'BOOL':False})]:
            plan,proof=fixtures();plan['expectedRoot'][name]=value;fake=Fake(plan,proof)
            with self.assertRaises(m.GateError):m.reconcile(fake,plan,apply=True,authorized=True)
            self.assertFalse(fake.calls)

    def test_unknown_ticket_and_explicit_null_pg_fail_closed(self):
        plan,proof=fixtures();plan.update(company=9,ticket=226374)
        with self.assertRaisesRegex(m.GateError,'ALLOWLISTED'):m.validate_plan(plan)
        plan,proof=fixtures();plan['expectedRoot']['pg']={'NULL':True}
        with self.assertRaisesRegex(m.GateError,'POSSIBLE_EFFECT'):m.validate_plan(plan)

    def test_current_digest_change_requires_search_of_original_identity_too(self):
        plan,proof=fixtures();plan['currentDigest']='d'*64;proof['zeev']['currentDigest']=plan['currentDigest'];refresh_hash(plan,proof)
        with self.assertRaises(m.GateError):m.validate_observation(plan,proof)
        historical={**proof['identity'],'number':'000000017'};plan['historicalIdentity']=historical
        with self.assertRaises(m.GateError):m.validate_observation(plan,proof)
        for name in ('native','independent'):proof[name]['lookupIdentities'].append(m.sha(m.identity(historical)))
        refresh_hash(plan,proof);m.validate_observation(plan,proof)

    def test_empty_ticket_lookup_alone_cannot_authorize_new_creation(self):
        changes=[lambda p:p.pop('closure'),lambda p:p['closure'].update(endSeen=False),lambda p:p['closure'].update(reportSeen=False),
                 lambda p:p['closure'].update(coverageComplete=False),lambda p:p['closure'].update(laterDispatches=1),
                 lambda p:p['independent'].update(complete=False),lambda p:p['native'].update(committedRead=False),
                 lambda p:p['native'].update(lookupModes=['ticket']),lambda p:p['native']['documentCandidates'].append({'idMov':45178})]
        for change in changes:
            with self.subTest(change=change):
                plan,proof=fixtures();change(proof);refresh_hash(plan,proof);fake=Fake(plan,proof)
                with self.assertRaises(m.GateError):m.reconcile(fake,plan,apply=True,authorized=True)
                self.assertNotIn('archive',fake.calls)

    def test_every_source_must_be_fresh_not_only_aggregate(self):
        old=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=61)).isoformat()
        for name in (None,'native','independent','closure','zeev'):
            plan,proof=fixtures();(proof[name] if name else proof)['observedUtc']=old;refresh_hash(plan,proof)
            with self.assertRaisesRegex(m.GateError,'NOT_FRESH'):m.validate_observation(plan,proof)

    def test_bank_change_and_invalid_current_fields_block_mutation(self):
        changes=[lambda p:p['bank'].update(active=False),lambda p:p['bank'].update(id='2'),
                 lambda p:p['zeev'].update(active=False),lambda p:p['zeev']['validation'].update(fiscal=False),
                 lambda p:p['zeev']['identity'].update(series='2')]
        for change in changes:
            plan,proof=fixtures();change(proof);refresh_hash(plan,proof);fake=Fake(plan,proof)
            with self.assertRaises(m.GateError):m.reconcile(fake,plan,apply=True,authorized=True)
            self.assertNotIn('archive',fake.calls)

    def test_existing_records_require_complete_equal_parcels_and_ownership(self):
        changes=[lambda p:p['native']['launches'].pop(),lambda p:p['native']['launches'][0].update(amount='59.00'),
            lambda p:p['native']['movements'][0].update(ticket='another'),
            lambda p:p['native']['documentCandidates'][0].update(ticket=225374),
            lambda p:p['native']['launches'][0].update(bankId='2',bankCompany='5'),
            lambda p:p['native']['launches'][0].update(status=1,paid='60.00'),
            lambda p:p['native']['launches'][0].update(boletoCount=1),
            lambda p:p['native']['launches'][0].update(pendingPayment=1),
            lambda p:p['native']['movements'][0].update(net='99.00'),
            lambda p:p['independent']['launches'][0].update(bankId='1',bankCompany='5')]
        for change in changes:
            with self.subTest(change=change):
                plan,proof=fixtures(True);change(proof);refresh_hash(plan,proof);fake=Fake(plan,proof)
                with self.assertRaises(m.GateError):m.reconcile(fake,plan,apply=True,authorized=True)
                self.assertNotIn('archive',fake.calls)

    def test_final_observation_change_can_only_leave_an_archive(self):
        plan,proof=fixtures();fake=Fake(plan,proof)
        fake.final_mutation=lambda p:p['bank'].update(id='2')
        with self.assertRaises(m.GateError):m.reconcile(fake,plan,apply=True,authorized=True)
        self.assertEqual(fake.calls.count('archive'),1);self.assertNotIn('cas',fake.calls)
        self.assertEqual(fake.items[fake.pk],plan['expectedRoot'])

    def test_cas_guards_all_original_attributes_and_critical_absences(self):
        plan,proof=fixtures();request=m.cas_request(plan,m.root_key(plan)+'#ADJUDICATION#'+'e'*64,'new-owner',int(time.time()*1000))
        self.assertTrue(set(plan['expectedRoot'])<=set(request['ExpressionAttributeNames'].values()))
        for name in m.CRITICAL:self.assertIn(f'attribute_not_exists({name})',request['ConditionExpression'])
        self.assertNotIn('REMOVE',request['UpdateExpression']);self.assertNotIn('DELETE',request['UpdateExpression'])

    def test_concurrent_owner_or_new_critical_marker_does_not_get_overwritten(self):
        for mode in ('conflict','new_marker'):
            plan,proof=fixtures();fake=Fake(plan,proof);fake.mode=mode
            result=m.reconcile(fake,plan,apply=True,authorized=True)
            self.assertFalse(result['applied']);self.assertEqual(fake.calls.count('cas'),1)
            self.assertEqual(result['outcome'],'CONCURRENT_OR_UNKNOWN_STATE_DO_NOT_RETRY')

    def test_lost_acknowledgement_is_read_back_never_retried(self):
        for mode,applied,outcome in [('timeout_before',False,'NOT_APPLIED_NO_RETRY'),
                                   ('timeout_after',True,'NEW_ATTEMPT_RESERVED'),
                                   ('progress',False,'CONCURRENT_PROGRESS_DO_NOT_RETRY')]:
            plan,proof=fixtures();fake=Fake(plan,proof);fake.mode=mode
            result=m.reconcile(fake,plan,apply=True,authorized=True)
            self.assertEqual(result['applied'],applied);self.assertEqual(result['outcome'],outcome)
            self.assertTrue(result['acknowledgementLost']);self.assertEqual(fake.calls.count('cas'),1)

    def test_archive_lost_ack_requires_exact_readback(self):
        plan,proof=fixtures();fake=Fake(plan,proof);fake.archive_mode='same'
        self.assertTrue(m.reconcile(fake,plan,apply=True,authorized=True)['applied'])
        plan,proof=fixtures();fake=Fake(plan,proof);fake.archive_mode='different'
        with self.assertRaisesRegex(m.GateError,'ARCHIVE'):m.reconcile(fake,plan,apply=True,authorized=True)
        self.assertNotIn('cas',fake.calls)

    def test_observation_hash_ignores_only_read_clocks_not_attempt_or_business_time(self):
        plan,proof=fixtures();other=copy.deepcopy(proof);other['observedUtc']=m.utc();other['native']['observedUtc']=m.utc()
        self.assertEqual(m.observation_sha(other),m.observation_sha(proof))
        other['closure']['originalStartMs']+=1
        self.assertNotEqual(m.observation_sha(other),m.observation_sha(proof))

    def test_aws_backend_rejects_financial_and_out_of_scope_operations_before_cli(self):
        plan,proof=fixtures();backend=m.AwsBackend(Mock(),plan,True)
        for service,operation,payload in [('lambda','invoke',{}),('dynamodb','delete-item',{}),
            ('dynamodb','update-item',{'TableName':m.TABLE,'Key':{'pk':{'S':'prod#PG#9#226374'}}}),
            ('dynamodb','put-item',{'TableName':m.TABLE,'Item':{'pk':{'S':m.root_key(plan)}}})]:
            with patch.object(m.subprocess,'run') as run:
                with self.assertRaises(m.GateError):backend.aws(service,operation,payload)
                run.assert_not_called()

if __name__=='__main__':unittest.main()
