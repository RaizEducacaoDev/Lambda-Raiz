"""Runner gates only; every service and financial effect is mocked."""
import copy
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import ssl
import unittest
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('recovery_runner',ROOT/'scripts/run-payment-backlog-recovery.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
spec=importlib.util.spec_from_file_location('runner_fixtures',ROOT/'tests/test_payment_backlog_recovery.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

def config(mode='prepare'):
    return {'version':1,'mode':mode,'tickets':[225136],'authorizedBacklogRecovery':mode=='apply',
      'approvedPlanRunId':'0' if mode=='prepare' else '1234','approvedManifestSha256':'' if mode=='prepare' else 'a'*64}
CTX={'repository':'example/payments','runId':'2345','commit':'a'*40,'branch':r.BRANCH,'workflow':r.WORKFLOW}

class RunnerTests(unittest.TestCase):
    def sql_observer(self,remaining=60):
        instance=r.RecoveryObserver.__new__(r.RecoveryObserver)
        instance.deadline=180;instance._sql_fresh_deadline=remaining
        instance._sql_retry_used=False;instance._sql_code=None
        instance.rm_auth='Basic SECRET_CANARY';instance.opener=Mock()
        return instance

    def sql_success(self,body=b'[{"proof":true}]'):
        response=Mock();response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False);response.read.return_value=body
        return response

    def test_only_transient_sql_get_repeats_once_with_sanitized_diagnostics(self):
        faults=[TimeoutError('SECRET_TIMEOUT'),
          r.urllib.error.URLError(ConnectionResetError('SECRET_RESET')),
          r.urllib.error.URLError(r.socket.gaierror(r.socket.EAI_AGAIN,'SECRET_DNS'))]
        for fault in faults:
            with self.subTest(error=type(fault).__name__):
                instance=self.sql_observer();instance.opener.open.side_effect=[fault,self.sql_success()]
                output=io.StringIO()
                with patch.object(r.time,'monotonic',return_value=0),contextlib.redirect_stdout(output):
                    self.assertEqual(instance.query('RAIZ.PG.CENSO',{'CODCFO':'PRIVATE_SUPPLIER'}),[{'proof':True}])
                calls=instance.opener.open.call_args_list;self.assertEqual(len(calls),2)
                for call in calls:
                    self.assertEqual(call.args[0].get_method(),'GET');self.assertIsNone(call.args[0].data)
                    self.assertEqual(call.kwargs['timeout'],15)
                self.assertEqual(calls[0].args[0].full_url,calls[1].args[0].full_url)
                rows=[json.loads(line) for line in output.getvalue().splitlines()]
                self.assertEqual([row['attempt'] for row in rows],[1,2]);self.assertTrue(rows[0]['retryScheduled'])
                self.assertEqual(rows[0]['sqlCode'],'RAIZ.PG.CENSO');self.assertIsNotNone(rows[0]['exceptionClass'])
                for private in ('SECRET','PRIVATE_SUPPLIER','http','Authorization','parameters='):
                    self.assertNotIn(private,output.getvalue())
                self.assertIsNone(instance._sql_code)

    def test_http403_and_tls_permanent_dns_or_unknown_network_reason_never_repeat(self):
        faults=[(r.urllib.error.HTTPError('https://SECRET',403,'SECRET_DENIED',{},None),'HTTP_RM_QUERY_403'),
          (r.urllib.error.URLError(ssl.SSLCertVerificationError('SECRET_CERT')),'NETWORK_FAILURE'),
          (r.urllib.error.URLError(r.socket.gaierror(r.socket.EAI_NONAME,'SECRET_DNS')),'NETWORK_FAILURE'),
          (r.urllib.error.URLError('SECRET_UNKNOWN'),'NETWORK_FAILURE')]
        for fault,gate in faults:
            with self.subTest(error=type(fault).__name__):
                instance=self.sql_observer();instance.opener.open.side_effect=fault;output=io.StringIO()
                with patch.object(r.time,'monotonic',return_value=0),contextlib.redirect_stdout(output):
                    with self.assertRaisesRegex(r.operator.GateError,gate) as raised:
                        instance.query('RAIZ.PG.RETRY',{'TICKET':'226530'})
                instance.opener.open.assert_called_once();self.assertFalse(instance._sql_retry_used)
                self.assertIn('sqlCode=RAIZ.PG.RETRY',str(raised.exception));self.assertIn('elapsedMs=0',str(raised.exception))
                self.assertNotIn('SECRET',output.getvalue()+str(raised.exception))

    def test_second_network_failure_stops_and_retry_budget_is_shared_across_queries(self):
        for successful_retry in (False,True):
            with self.subTest(successful_retry=successful_retry):
                instance=self.sql_observer();output=io.StringIO()
                instance.opener.open.side_effect=[TimeoutError('SECRET'),self.sql_success() if successful_retry else TimeoutError('SECRET'),TimeoutError('SECRET')]
                with patch.object(r.time,'monotonic',return_value=0),contextlib.redirect_stdout(output):
                    if successful_retry:instance.query('RAIZ.PG.DOC2',{'CODCOLIGADA':'11'})
                    else:
                        with self.assertRaisesRegex(r.operator.GateError,'NETWORK_FAILURE'):
                            instance.query('RAIZ.PG.DOC2',{'CODCOLIGADA':'11'})
                    self.assertEqual(instance.opener.open.call_count,2)
                    with self.assertRaisesRegex(r.operator.GateError,'NETWORK_FAILURE'):
                        instance.query('RAIZ.PG.WINDOW',{'CODCOLIGADA':'11'})
                self.assertEqual(instance.opener.open.call_count,3)
                self.assertFalse(json.loads(output.getvalue().splitlines()[-1])['retryScheduled'])

    def test_expired_freshness_or_observer_deadline_stops_without_request(self):
        for fresh,deadline in ((0,180),(60,0)):
            instance=self.sql_observer(fresh);instance.deadline=deadline
            with patch.object(r.time,'monotonic',return_value=0),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(r.operator.GateError,'BUDGET_EXHAUSTED'):
                    instance.query('RAIZ.PG.CENSO',{'CODCOLIGADA':'11'})
            instance.opener.open.assert_not_called()

    def test_network_error_after_deadline_never_repeats_and_timeout_is_capped(self):
        for fresh,deadline in ((0.5,180),(60,0.5)):
            instance=self.sql_observer(fresh);instance.deadline=deadline;clock=[0]
            def fail(*args,**kwargs):clock[0]=0.5;raise TimeoutError('SECRET')
            instance.opener.open.side_effect=fail
            with patch.object(r.time,'monotonic',side_effect=lambda:clock[0]),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(r.operator.GateError,'NETWORK_FAILURE'):
                    instance.query('RAIZ.PG.FISC',{'CODCOLIGADA':'11'})
            self.assertEqual(instance.opener.open.call_count,1)
            self.assertEqual(instance.opener.open.call_args.kwargs['timeout'],0.5)

    def test_response_arriving_after_deadline_is_discarded_without_retry(self):
        instance=self.sql_observer(1);clock=[0];response=self.sql_success()
        def read(*args):clock[0]=2;return b'[]'
        response.read.side_effect=read;instance.opener.open.return_value=response
        with patch.object(r.time,'monotonic',side_effect=lambda:clock[0]),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(r.operator.GateError,'BUDGET_EXHAUSTED'):
                instance.query('RAIZ.PG.CENSO',{'CODCOLIGADA':'11'})
        instance.opener.open.assert_called_once()

    def test_parse_contract_and_non_sql_reads_are_never_retried(self):
        instance=self.sql_observer();instance.opener.open.return_value=self.sql_success(b'not-json')
        with patch.object(r.time,'monotonic',return_value=0),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(json.JSONDecodeError):instance.query('RAIZ.PG.CENSO',{'CODCOLIGADA':'11'})
            with self.assertRaisesRegex(r.operator.GateError,'QUERY_PARAMETERS_NOT_ALLOWED'):
                instance.query('ARBITRARY_SQL',{'CODCOLIGADA':'11'})
            with self.assertRaisesRegex(r.operator.GateError,'QUERY_PARAMETERS_NOT_ALLOWED'):
                instance.query('RAIZ.PG.CENSO',{'CODCOLIGADA':'not;allowed'})
            with self.assertRaisesRegex(r.operator.GateError,'RM_QUERY_NOT_ALLOWED'):
                instance.http('https://example.invalid','RM_QUERY',b'SaveRecord')
        instance.opener.open.assert_called_once()
        with patch.object(r.RecoveryObserver.__bases__[0],'http',side_effect=r.operator.GateError('NETWORK_FAILURE')) as parent:
            for stage in ('RM_READRECORD','ZEEV'):
                with self.assertRaises(r.operator.GateError):instance.http('route',stage)
            self.assertEqual(parent.call_count,2)
        self.assertFalse(instance._sql_retry_used)

    def test_private_observation_resets_only_read_budget_and_never_refreshes_proofs(self):
        instance=self.sql_observer();instance._sql_retry_used=True
        with patch.object(r.RecoveryObserver.__bases__[0],'observe',return_value={'proof':'original'}) as parent,patch.object(r.time,'monotonic',return_value=0):
            self.assertEqual(instance.observe({'ticket':226530}),{'proof':'original'})
            parent.assert_called_once_with({'ticket':226530})
        self.assertFalse(instance._sql_retry_used);self.assertIsNone(instance._sql_fresh_deadline)
        now=r.observer.dt.datetime.now(r.observer.dt.timezone.utc)
        closed={'observedUtc':(now-r.observer.dt.timedelta(seconds=30)).isoformat()}
        with patch.object(r.RecoveryObserver.__bases__[0],'closure',return_value=closed),patch.object(r.time,'monotonic',return_value=100):
            self.assertIs(instance.closure(),closed)
        self.assertGreater(instance._sql_fresh_deadline,129);self.assertLessEqual(instance._sql_fresh_deadline,130)

    def test_utf8_json_proof_hash_is_independent_of_windows_default_encoding(self):
        value={'description':'Serviço de manutenção','proof':'ação / São Paulo'}
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'proof.json'
            for bom in (b'',b'\xef\xbb\xbf'):
                path.write_bytes(bom+json.dumps(value,ensure_ascii=False).encode('utf-8'))
                with patch.object(Path,'read_text',autospec=True,side_effect=lambda p,**kw:p.read_bytes().decode(kw['encoding'])) as read:
                    decoded=r.read_json(path)
                read.assert_called_once_with(path,encoding='utf-8-sig')
                self.assertEqual(r.operator.sha(decoded),r.operator.sha(value))

    def test_elapsed_age_is_ignored_but_business_task_state_is_preserved(self):
        data={'id':225136,'leadTimeInDays':None,'instanceTasks':[{'id':5,'active':True,
          'leadTimeInDays':7.26,'expectedEndDateTime':'2026-10-29T18:34:00','task':{'id':7,'timeout':16}}],
          'formFields':[{'name':'dataDeEntrada','value':'2026-10-23'}]}
        instance=r.RecoveryObserver.__new__(r.RecoveryObserver)
        with patch.object(r.RecoveryObserver.__bases__[0],'zeev_snapshot',return_value=(data,'clock')):
            actual,clock=instance.zeev_snapshot(['dataDeEntrada'])
        self.assertEqual(clock,'clock');self.assertNotIn('leadTimeInDays',actual)
        self.assertNotIn('leadTimeInDays',actual['instanceTasks'][0])
        self.assertEqual(actual['instanceTasks'][0],{k:v for k,v in data['instanceTasks'][0].items() if k!='leadTimeInDays'})
        self.assertEqual(actual['formFields'],data['formFields'])
        self.assertIn('leadTimeInDays',data['instanceTasks'][0])

    def test_default_config_is_prepare_and_only_reviewed_targets_exist(self):
        current=r.validate_config(config())
        self.assertEqual(current['mode'],'prepare');self.assertFalse(current['authorizedBacklogRecovery'])
        self.assertEqual(set(r.TARGETS),{225136,225573,226925,223885,226025,226348,226530,227585,226455,226698,228007,227386,226610,228103,228158,228198,228275,228793});self.assertEqual(r.TARGETS[226925]['idMov'],407691)
        self.assertEqual(r.TARGETS[225136]['historicalIdentity']['total'],'20000.00')
        self.assertEqual(r.TARGETS[225573]['historicalIdentity']['number'],'000006925')

    def test_apply_requires_reviewed_run_hash_authorization_and_fixed_scope(self):
        mutations=[{'authorizedBacklogRecovery':False},{'approvedPlanRunId':'0'},
          {'approvedManifestSha256':''},{'tickets':[999999]},{'tickets':[225136,225136]}]
        for update in mutations:
            with self.subTest(update=update),self.assertRaises(r.operator.GateError):r.validate_config({**config('apply'),**update})
        self.assertEqual(r.validate_config(config('apply'))['mode'],'apply')
        with self.assertRaises(r.operator.GateError):r.validate_config({**config(),'authorizedBacklogRecovery':True})

    def test_workflow_rejects_reruns_wrong_branch_or_manual_dispatch(self):
        env={'GITHUB_ACTIONS':'true','GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/'+r.BRANCH,
          'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':CTX['repository'],'GITHUB_RUN_ID':CTX['runId'],'GITHUB_SHA':CTX['commit']}
        self.assertEqual(r.context(env),CTX)
        for update in [{'GITHUB_RUN_ATTEMPT':'2'},{'GITHUB_REF':'refs/heads/main'},{'GITHUB_EVENT_NAME':'workflow_dispatch'}]:
            with self.subTest(update=update),self.assertRaises(r.operator.GateError):r.context({**env,**update})

    def test_prepare_generates_pinned_proof_and_fresh_dry_run_without_apply(self):
        plan,proof=f.fixtures();result={'mode':'dry-run','applied':False,'root':r.operator.root_key(plan),
          'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False,'manifest':{'observationSha256':plan['expectedObservationSha256']}}
        with (tempfile.TemporaryDirectory() as temp,patch.object(r,'OUT',Path(temp)/'output'),patch.object(r,'validate_target'),
          patch.object(r.observer,'prepare_plan',return_value=(plan,proof)) as prepare,
          patch.object(r,'reconcile',return_value=result) as run,patch.object(r,'code_hashes',return_value={'fixture':'hash'}),patch.object(r,'file_sha',wraps=r.file_sha) as digest):
            audit=Path(temp)/'audit.json';audit.write_text('{}')
            with patch.object(r,'AUDIT_PATH',audit):self.assertEqual(r.execute(config(),CTX),0)
            run.assert_called_once_with(plan);self.assertEqual(prepare.call_args.args[5],r.TARGETS[225136]['historicalIdentity'])
            manifest=r.read_json(r.OUT/'manifest.json');self.assertTrue(manifest['allPrepared']);self.assertEqual(len(manifest['files']),3)
            for name,value in manifest['files'].items():self.assertEqual(r.file_sha(r.OUT/name),value)

    def approved_fixture(self,directory):
        approved=directory/'approved';approved.mkdir();audit=directory/'audit.json';audit.write_text('{}')
        plan,proof=f.fixtures();plan.update(auditFile=audit.as_posix(),auditSha256=r.file_sha(audit),
          observerSha256=r.file_sha(r.OBSERVER),historicalIdentity=copy.deepcopy(r.TARGETS[225136]['historicalIdentity']))
        dry={'mode':'dry-run','applied':False,'root':r.operator.root_key(plan),'financialWrites':False,
          'zeevWrites':False,'lambdaInvoked':False,'manifest':{'observationSha256':plan['expectedObservationSha256']}}
        files={}
        for name,value in [('plan',plan),('proof',proof),('dry-run',dry)]:
            path=approved/f'{name}-225136.json';r.write_json(path,value);files[path.name]=r.file_sha(path)
        manifest={'version':1,'mode':'prepare','allPrepared':True,'requestedTickets':[225136],'preparedTickets':[225136],
          'workflow':{**CTX,'runId':'1234'},'codeSha256':{'fixture':'hash'},'files':files,
          'audit':{'runId':r.AUDIT_RUN,'file':audit.as_posix(),'sha256':r.file_sha(audit)},
          'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False}
        r.write_json(approved/'manifest.json',manifest);cfg=config('apply');cfg['approvedManifestSha256']=r.file_sha(approved/'manifest.json')
        return approved,audit,cfg,plan,manifest

    def test_approved_manifest_pins_files_audit_code_and_source_run(self):
        with tempfile.TemporaryDirectory() as temp:
            approved,audit,cfg,plan,_=self.approved_fixture(Path(temp))
            with patch.object(r,'APPROVED',approved),patch.object(r,'AUDIT_PATH',audit),patch.object(r,'code_hashes',return_value={'fixture':'hash'}),patch.object(r,'verify_run',return_value={'head_sha':CTX['commit']}) as source:
                self.assertEqual(r.approved_plans(cfg,CTX),{225136:plan});source.assert_called_once_with('1234',CTX)
                (approved/'plan-225136.json').write_text('{}')
                with self.assertRaisesRegex(r.operator.GateError,'APPROVED_FILE_CHANGED'):r.approved_plans(cfg,CTX)

    def test_missing_approval_or_changed_code_stops_before_operator(self):
        with tempfile.TemporaryDirectory() as temp:
            approved,audit,cfg,_,_=self.approved_fixture(Path(temp))
            with patch.object(r,'APPROVED',approved),patch.object(r,'AUDIT_PATH',audit),patch.object(r,'verify_run',return_value={'head_sha':CTX['commit']}),patch.object(r,'code_hashes',return_value={'changed':'hash'}),patch.object(r,'reconcile') as run:
                with self.assertRaisesRegex(r.operator.GateError,'MANIFEST_SHA'):r.approved_plans({**cfg,'approvedManifestSha256':'b'*64},CTX)
                with self.assertRaisesRegex(r.operator.GateError,'REVIEWED_CODE'):r.approved_plans(cfg,CTX)
                run.assert_not_called()

    def test_apply_stops_on_first_unknown_result_and_never_retries(self):
        cfg=config('apply');cfg['tickets']=[225136,225573]
        with tempfile.TemporaryDirectory() as temp,patch.object(r,'OUT',Path(temp)/'output'),patch.object(r,'approved_plans',return_value={225136:{'ticket':225136},225573:{'ticket':225573}}),patch.object(r,'reconcile',return_value={'mode':'apply','applied':False,'outcome':'CONCURRENT_OR_UNKNOWN_STATE_DO_NOT_RETRY'}) as run:
            self.assertEqual(r.execute(cfg,CTX),2);run.assert_called_once_with({'ticket':225136},apply=True)
            self.assertEqual(len(r.read_json(r.OUT/'summary.json')['results']),1)

    def test_prepare_isolates_failure_and_manifest_only_approves_successful_tickets(self):
        plan,proof=f.fixtures();cfg=config();cfg['tickets']=[225136,225573]
        result={'mode':'dry-run','applied':False}
        with (tempfile.TemporaryDirectory() as temp,patch.object(r,'OUT',Path(temp)/'output'),patch.object(r,'validate_target'),
          patch.object(r.observer,'prepare_plan',side_effect=[(plan,proof),r.operator.GateError('CURRENT_DOCUMENT_INVALID')]),
          patch.object(r,'reconcile',return_value=result),patch.object(r,'code_hashes',return_value={'fixture':'hash'})):
            audit=Path(temp)/'audit.json';audit.write_text('{}')
            with patch.object(r,'AUDIT_PATH',audit):self.assertEqual(r.execute(cfg,CTX),0)
            manifest=r.read_json(r.OUT/'manifest.json')
            self.assertFalse(manifest['allPrepared']);self.assertEqual(manifest['preparedTickets'],[225136])
            self.assertEqual(set(manifest['files']),{'plan-225136.json','proof-225136.json','dry-run-225136.json'})
            self.assertFalse(r.read_json(r.OUT/'failure-225573.json')['ok'])

    def test_reconcile_delegates_double_observation_and_cas_to_reviewed_operator(self):
        plan,proof=f.fixtures();backend=Mock();obs=Mock()
        with patch.object(r.observer,'create_observer',return_value=obs),patch.object(r.operator,'AwsBackend',return_value=backend) as make,patch.object(r.operator,'reconcile',return_value={'applied':True}) as call:
            r.reconcile(plan,apply=True);make.assert_called_once_with(obs,plan,True)
            call.assert_called_once_with(backend,plan,apply=True,authorized=True)

if __name__=='__main__':unittest.main()
