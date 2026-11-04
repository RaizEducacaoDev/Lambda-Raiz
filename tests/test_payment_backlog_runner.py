"""Runner gates only; every service and financial effect is mocked."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
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
    def test_default_config_is_prepare_and_only_exact_three_targets_exist(self):
        current=r.validate_config(config())
        self.assertEqual(current['mode'],'prepare');self.assertFalse(current['authorizedBacklogRecovery'])
        self.assertEqual(set(r.TARGETS),{225136,225573,226925,223885,226025,226348,226530,227585,226455,226698});self.assertEqual(r.TARGETS[226925]['idMov'],407691)
        self.assertEqual(r.TARGETS[225136]['historicalIdentity']['total'],'20000.00')
        self.assertEqual(r.TARGETS[225573]['historicalIdentity']['number'],'000006925')

    def test_apply_requires_reviewed_run_hash_authorization_and_fixed_scope(self):
        mutations=[{'authorizedBacklogRecovery':False},{'approvedPlanRunId':'0'},
          {'approvedManifestSha256':''},{'tickets':[228007]},{'tickets':[225136,225136]}]
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
