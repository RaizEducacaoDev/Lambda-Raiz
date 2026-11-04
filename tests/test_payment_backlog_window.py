"""Alternative proof rejects ambiguity; no external calls or financial writes."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('window_operator_fixtures',ROOT/'tests/test_payment_backlog_recovery.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
m=f.m;w=m.WINDOW

def echo(plan,closure):
    start=dt.datetime.fromisoformat(w.epoch_stamp(closure['originalStartMs']));end=dt.datetime.fromisoformat(w.epoch_stamp(closure['originalReportMs']))
    return {'WINDOW_VERSION':1,'REQUEST_COMPANY':plan['company'],'REQUEST_TICKET':str(plan['ticket']),
      'REQUEST_START_UTC':start.isoformat(),'REQUEST_END_UTC':end.isoformat(),
      'WINDOW_START_UTC':(start-dt.timedelta(seconds=120)).isoformat(),'WINDOW_END_UTC':(end+dt.timedelta(seconds=120)).isoformat(),
      'WINDOW_START_LOCAL':(start-dt.timedelta(hours=3,seconds=120)).isoformat(),'WINDOW_END_LOCAL':(end-dt.timedelta(hours=3)+dt.timedelta(seconds=120)).isoformat()}

def fixtures(ticket=226025):
    plan,proof=f.fixtures();company=next(company for company,t in w.CASES if t==ticket)
    plan.update(company=company,ticket=ticket,currentDigest='b'*64)
    plan['expectedRoot']['pk']={'S':f'prod#PG#{company}#{ticket}'}
    if ticket in (223885,226698):plan['expectedRoot']['state']={'S':'RESERVED'}
    plan['alternativeOriginalClosure']=w.policy(company,ticket,m)
    proof['identity']['company']=str(company);proof['bank']['company']=str(company)
    for p in proof['plans']:p['bankCompany']=str(company)
    proof['zeev'].update(company=company,ticket=ticket,currentDigest=plan['currentDigest'],identity=copy.deepcopy(proof['identity']),
      bank={k:v for k,v in proof['bank'].items() if k!='active'},plans=copy.deepcopy(proof['plans']))
    for key in ['native','independent']:
        proof[key].update(company=company,ticket=ticket,lookupIdentities=[m.sha(proof['identity'])],
          document={**{k:proof['identity'][k] for k in m.DOCUMENT},'configured':True})
    c=proof['closure'];c.update(originalRootSha256=m.sha(plan['expectedRoot']),originalRequestId=plan['alternativeOriginalClosure']['originalRequestId'])
    request=c['originalRequestId'];start=c['originalStartMs']
    event=lambda kind,at,**kwargs:{'kind':kind,'requestId':request,'timestamp':at,**kwargs}
    events=[event('lambda_start',start)]
    if ticket in (223885,226698):events.append(event('payment_pending',start+1000,state='RESERVED',creationStage='preflight'))
    else:
        events += [event('creation_checkpoint',start+100,event='transport_call_started'),
          event('creation_checkpoint',start+1000,event='transport_call_returned'),
          event('non_key_result',start+1001,nonKeyResult=True,responseSha256='d'*64)]
    events += [event('lambda_end',c['originalEndMs']),event('lambda_report',c['originalReportMs'])]
    original={'requestId':request,'coverage':{'complete':True},'events':events,'fixedCodeIndicators':[]}
    c['originalOutcome']=w.original_evidence(original,events,[],m)
    rows=[{**echo(plan,c),'ROW_KIND':None,'TOTAL_MOVEMENTS':0,'TOTAL_LAUNCHES':0}]
    alternative={'observedUtc':m.utc(),'querySha256':w.query_sha(),'complete':True,'committedRead':True,
      'rows':rows,'exclusions':[],'currentCensusBefore':{'movements':[],'launches':[]}}
    proof['alternativeOriginalClosure']=alternative
    if plan['alternativeOriginalClosure']['exclusions']:
        candidate=plan['alternativeOriginalClosure']['exclusions'][0];created=w.epoch_stamp(start+200)
        mov={**echo(plan,c),'TOTAL_MOVEMENTS':1,'TOTAL_LAUNCHES':1,'ROW_KIND':'MOV','CODCOLIGADA':company,'CODFILIAL':1,
          'CODCOLCFO':0,'CODCFO':'0000182519','IDMOV':candidate['idMov'],'IDLAN':None,'CODTMV':'1.2.16','DOCUMENTO':'000000127',
          'SERIE':'REC','CODTDO':None,'STATUS':'F','DATAEMISSAO':'2026-11-03','DATASAIDA':'2026-11-03',
          'VALORBRUTO':'950.00','VALORLIQUIDO':'950.00','VALOR':'950.00','RECCREATEDON':created,'RECMODIFIEDON':created,
          'TICKET':str(candidate['ticket']),'ORFAO':0,'COMPLEMENT_CREATED':created,'COMPLEMENT_MODIFIED':created}
        lan={**mov,'ROW_KIND':'LAN','IDLAN':candidate['idLans'][0],'DOCUMENTO':'000000127/01','STATUS':'0','DATAVENCIMENTO':'2026-11-13',
          'VALORBAIXADO':'0.00','IDPGTO':1,'CODCOLPGTO':company}
        normalized=w.canonical_launch(lan,m);header=w.canonical_movement(mov,m)
        form={'codigoDaColigada2':str(company),'codigoDaFilial2':'1','codigoDoFornecedor':'0000182519',
          'tipoDoPagamento':'OG','outrosGastos':'FR',
          'idDoMovimento':str(candidate['idMov']),'idDoLancamento':str(candidate['idLans'][0]),'numeroDaNF':'127','serieDaNF':'',
          'dataDeEmissao':'03/11/2026','dataDeEntrada':'03/11/2026','dataDeVencimento':'13/11/2026','valorTotalDoPagamento':'950,00'}
        exclusion={'observedUtc':m.utc(),'declared':copy.deepcopy(candidate),'movement':header,
          'complement':{'company':str(company),'idMov':str(candidate['idMov']),'ticket':str(candidate['ticket']),'createdOn':created,'modifiedOn':created},
          'launches':[normalized],'payments':[{k:normalized[k] for k in ['company','idMov','idLan','dueDate','amount']}],
          'zeev':{'observedUtc':m.utc(),'ticket':candidate['ticket'],'flowId':299,'active':True,'form':form,'workflowSha256':'f'*64}}
        alternative.update(rows=[mov,lan],exclusions=[exclusion],currentCensusBefore={'movements':[copy.deepcopy(mov)],'launches':[copy.deepcopy(lan)]})
    f.refresh_hash(plan,proof);return plan,proof

class WindowTests(unittest.TestCase):
    def check(self,plan,proof):f.refresh_hash(plan,proof);return m.validate_observation(plan,proof)

    def test_seven_fixed_roots_accept_strong_alternative_without_invented_historical_identity(self):
        for _,ticket in w.CASES:
            with self.subTest(ticket=ticket):
                plan,proof=fixtures(ticket);self.assertNotIn('historicalIdentity',plan);m.validate_observation(plan,proof)
                self.assertNotEqual(plan['currentDigest'],plan['expectedRoot']['digest']['S'])

    def test_bare_zero_or_lambda_end_without_native_return_never_authorizes(self):
        plan,proof=fixtures();e=proof['closure']['originalOutcome']
        events=[x for x in e['originalEvents'] if x['kind'] in ['lambda_start','lambda_end','lambda_report']]
        e.update(originalEvents=events,readbackEvents=copy.deepcopy(events))
        with self.assertRaisesRegex(m.GateError,'NATIVE_RESPONSE_COMPLETION'):self.check(plan,proof)
        del proof['alternativeOriginalClosure']
        with self.assertRaises(m.GateError):self.check(plan,proof)

    def test_fixed_original_literal_only_accepted_when_live_log_and_source_contract_match(self):
        plan,proof=fixtures(227585);e=proof['closure']['originalOutcome']
        events=[x for x in e['originalEvents'] if x['kind'] in ['lambda_start','lambda_end','lambda_report']]
        e.update(originalEvents=events,readbackEvents=copy.deepcopy(events),fixedCodeIndicators=['RM_RETURN_WITHOUT_EXPECTED_KEY'])
        self.check(plan,proof)
        e['sourceCode']['builderDoesNotEmitCreationOrModificationAuditTimestamp']=False
        with self.assertRaisesRegex(m.GateError,'ORIGINAL_CODE'):self.check(plan,proof)

    def test_policy_cannot_be_applied_to_another_root_or_adoption(self):
        plan,proof=fixtures();plan['ticket']=225136;plan['company']=1;plan['expectedRoot']['pk']={'S':'prod#PG#1#225136'}
        with self.assertRaisesRegex(m.GateError,'NOT_ALLOWLISTED'):m.validate_plan(plan)
        plan,proof=fixtures();plan['historicalIdentity']=proof['identity']
        with self.assertRaisesRegex(m.GateError,'POLICY_INVALID'):m.validate_plan(plan)
        plan,proof=fixtures();plan['action']='ADOPT_EXISTING';plan['idMov']=111
        with self.assertRaisesRegex(m.GateError,'CANNOT_ADOPT'):m.validate_plan(plan)

    def test_reserved_preflight_with_transport_or_creating_confirmation_is_rejected(self):
        for marker in ['transport_call_started','creating_checkpoint_confirmed']:
            plan,proof=fixtures(223885);e=proof['closure']['originalOutcome'];row={'kind':'creation_checkpoint','event':marker,
              'requestId':proof['closure']['originalRequestId'],'timestamp':proof['closure']['originalStartMs']+500}
            e['originalEvents'].insert(1,row);e['readbackEvents']=copy.deepcopy(e['originalEvents'])
            with self.assertRaisesRegex(m.GateError,'DISPATCH_NOT_EXCLUDED'):self.check(plan,proof)

    def test_window_rejects_wrong_echo_wrong_timezone_truncation_and_counts(self):
        for change in [{'REQUEST_COMPANY':9},{'REQUEST_START_UTC':'2000-01-01T00:00:00'},{'TOTAL_MOVEMENTS':1},{'WINDOW_END_LOCAL':'2000-01-01T00:00:00'}]:
            plan,proof=fixtures();proof['alternativeOriginalClosure']['rows'][0].update(change)
            with self.subTest(change=change),self.assertRaises(m.GateError):self.check(plan,proof)
        plan,proof=fixtures();proof['alternativeOriginalClosure']['rows']*=1001
        with self.assertRaisesRegex(m.GateError,'TRUNCATED'):self.check(plan,proof)

    def test_proven_rm_minus_three_suffix_preserves_sql_naive_wall_clock(self):
        self.assertEqual(w.stamp('2026-10-30T13:21:57.452-03:00',m),'2026-10-30T13:21:57.452')
        for suffix in ('','Z','+00:00'):
            self.assertEqual(w.stamp('2026-10-30T13:21:57.452'+suffix,m),'2026-10-30T13:21:57.452')
        for ticket in (226025,226348,226455):
            plan,proof=fixtures(ticket)
            for row in proof['alternativeOriginalClosure']['rows']:
                for name in ('REQUEST_START_UTC','REQUEST_END_UTC','WINDOW_START_UTC','WINDOW_END_UTC',
                             'WINDOW_START_LOCAL','WINDOW_END_LOCAL','RECCREATEDON','RECMODIFIEDON',
                             'COMPLEMENT_CREATED','COMPLEMENT_MODIFIED'):
                    if row.get(name):row[name]+='-03:00'
            # SQL JSON has a suffix; native XML and normalized exclusion proofs
            # have none. Both must identify the same original clocks and records.
            with self.subTest(ticket=ticket):self.check(plan,proof)

    def test_unproven_offsets_and_moved_wall_clock_remain_rejected(self):
        for suffix in ('-02:00','-04:00','+03:00','-03:30','-0300','-03','-03:00:00'):
            with self.subTest(suffix=suffix),self.assertRaisesRegex(m.GateError,'ZONE_INVALID'):
                w.stamp('2026-10-30T13:21:57.452'+suffix,m)
        plan,proof=fixtures()
        row=proof['alternativeOriginalClosure']['rows'][0]
        shifted=dt.datetime.fromisoformat(row['REQUEST_START_UTC'])+dt.timedelta(hours=3)
        row['REQUEST_START_UTC']=shifted.isoformat()+'-03:00'
        with self.assertRaisesRegex(m.GateError,'INTERVAL_MISMATCH'):self.check(plan,proof)

    def test_unknown_candidate_or_orphan_or_own_ticket_block_even_if_ids_are_known(self):
        mutations=[('ORFAO',1),('TICKET','226348'),('IDMOV',888888)]
        for key,value in mutations:
            plan,proof=fixtures(226348);proof['alternativeOriginalClosure']['rows'][1][key]=value
            with self.subTest(key=key),self.assertRaises(m.GateError):self.check(plan,proof)

    def test_other_ticket_label_alone_does_not_exclude_effect(self):
        mutations=[lambda p:p['exclusions'][0].pop('zeev'),
          lambda p:p['exclusions'][0]['zeev']['form'].update(idDoMovimento='123'),
          lambda p:p['exclusions'][0]['zeev']['form'].update(idDoLancamento='123'),
          lambda p:p['exclusions'][0]['zeev']['form'].update(numeroDaNF='128'),
          lambda p:p['exclusions'][0]['zeev']['form'].update(valorTotalDoPagamento='951,00'),
          lambda p:p['exclusions'][0]['complement'].update(modifiedOn='2026-11-04T00:00:00.000'),
          lambda p:p['exclusions'][0]['payments'].clear(),
          lambda p:p['exclusions'][0]['launches'][0].update(bankId='2')]
        for index,mutate in enumerate(mutations):
            plan,proof=fixtures(226348);mutate(proof['alternativeOriginalClosure'])
            with self.subTest(index=index),self.assertRaises(m.GateError):self.check(plan,proof)

    def test_excluded_current_census_rows_must_match_proven_window_exactly(self):
        plan,proof=fixtures(226455);proof['alternativeOriginalClosure']['currentCensusBefore']['movements'][0]['DOCUMENTO']='000000999'
        with self.assertRaisesRegex(m.GateError,'UNEXPLAINED_CURRENT'):self.check(plan,proof)

    def test_expired_or_changed_original_log_evidence_blocks(self):
        plan,proof=fixtures();proof['closure']['originalOutcome']['observedUtc']='2000-01-01T00:00:00Z'
        with self.assertRaisesRegex(m.GateError,'NOT_FRESH'):self.check(plan,proof)
        plan,proof=fixtures();proof['closure']['originalOutcome']['readbackEvents'].pop()
        with self.assertRaisesRegex(m.GateError,'LOG_EVIDENCE'):self.check(plan,proof)

    def test_null_document_requires_explicit_doc2_proof_and_alternative_scope(self):
        plan,proof=fixtures(227585)
        for name in ['identity']:
            proof[name].update(documentType=None,movementType='1.2.17')
        proof['zeev']['identity']=copy.deepcopy(proof['identity'])
        for name in ['native','independent']:
            proof[name]['document'].update(documentType=None,movementType='1.2.17');proof[name]['lookupIdentities']=[m.sha(proof['identity'])]
        with self.assertRaisesRegex(m.GateError,'IDENTITY_TEXT'):self.check(plan,proof)
        proof['documentNullProof']={'version':2,'hasMovementExtension':1,'documentTypeIsNull':1,'rowSourceSha256':'f'*64}
        self.check(plan,proof)
        proof['documentNullProof']['documentTypeIsNull']=0
        with self.assertRaisesRegex(m.GateError,'NULL_DOCUMENT'):self.check(plan,proof)

    def test_alternate_apply_keeps_archive_double_observation_and_single_cas(self):
        plan,proof=fixtures();backend=f.Fake(plan,proof)
        result=m.reconcile(backend,plan,apply=True,authorized=True)
        self.assertTrue(result['applied']);self.assertEqual(backend.observations,2)
        self.assertEqual(backend.items[backend.pk]['state'],{'S':'RESERVED'});self.assertNotIn('pg',backend.items[backend.pk])
        self.assertEqual(backend.calls.count('cas'),1)

    def test_live_collector_reads_each_native_child_and_other_zeev_ticket_before_excluding(self):
        plan,proof=fixtures(226348);alternative=proof['alternativeOriginalClosure'];mov,lan=alternative['rows'];calls=[]
        def dataset(rows):
            root=ET.Element('Dataset')
            for name,row in rows:
                node=ET.SubElement(root,name)
                for key,value in row.items():
                    if value is not None:ET.SubElement(node,key).text=str(value)
            return root
        def records(root,name):return [{child.tag:child.text or '' for child in row}for row in root.findall(name)]
        def unique(root,name):values=records(root,name);self.assertEqual(len(values),1);return values[0]
        class FakeObserver:
            zeev_token='test';opener=None
            def query(self,code,params):
                calls.append(code);assert params['INICIOUTC']==w.epoch_stamp(proof['closure']['originalStartMs']);return copy.deepcopy(alternative['rows'])
            def read_record(self,server,key,company):
                calls.append((server,key))
                if server=='MovMovimentoTBCData':
                    return dataset([('TMOV',{**mov,'NUMEROMOV':mov['DOCUMENTO']}),
                      ('TMOVCOMPL',{k:mov[k]for k in ['CODCOLIGADA','IDMOV','TICKET','RECCREATEDON','RECMODIFIEDON']}),
                      ('TMOVPAGTO',{k:lan[k]for k in ['CODCOLIGADA','IDMOV','IDLAN','DATAVENCIMENTO','VALOR']})])
                return dataset([('FLAN',{**lan,'NUMERODOCUMENTO':lan['DOCUMENTO'],'VALORORIGINAL':lan['VALOR'],'STATUSLAN':lan['STATUS']})])
            def zeev_snapshot(self,names):
                calls.append(('ZEEV_GET',self.plan['ticket']));z=alternative['exclusions'][0]['zeev']
                return {'id':z['ticket'],'active':True,'flow':{'id':299},'instanceTasks':[],
                  'formFields':[{'name':k,'row':1,'value':v}for k,v in z['form'].items()]},m.utc()
        result,remaining_m,remaining_f=w.collect(FakeObserver(),plan,proof['closure'],[mov],[lan],m,unique,records)
        self.assertEqual((remaining_m,remaining_f),([],[]));self.assertEqual(len(result['exclusions']),1)
        self.assertIn(('ZEEV_GET',228527),calls);self.assertIn(('FinLanDataBR','8;870693'),calls)
        w.validate(plan,result,proof['closure'],m)

    def test_original_response_is_reobserved_not_inferred_from_saved_flags(self):
        plan,proof=fixtures(226025);e=proof['closure']['originalOutcome']
        original={'requestId':e['requestId'],'coverage':{'complete':True},'events':e['originalEvents'],'fixedCodeIndicators':[]}
        with self.assertRaisesRegex(m.GateError,'NOT_REOBSERVED'):w.original_evidence(original,e['originalEvents'][:-1],[],m)
        with self.assertRaisesRegex(m.GateError,'NOT_REOBSERVED'):w.original_evidence(original,e['originalEvents'],['RM_RETURN_WITHOUT_EXPECTED_KEY'],m)

if __name__=='__main__':unittest.main()
