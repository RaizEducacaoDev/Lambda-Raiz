"""Local tests of the real release functions. No AWS/RM/Zeev request is made."""
import copy
import importlib.util
import io
import itertools
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('systemic_release_tests', ROOT / 'scripts/deploy-payment-systemic.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PublicationRecovery(unittest.TestCase):
    def run_case(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / 'candidate.zip'
            candidate.write_bytes(b'local-candidate')
            backup = Path(directory) / 'backup.zip'
            backup.write_bytes(b'local-backup')
            cfg = {'CodeSha256': m.BASELINE, 'RevisionId': m.REVISION, 'LastUpdateStatus': 'Successful',
                   'State': 'Active', 'MemorySize': 512, 'Environment': {'Variables': {'TOKEN': 'PRIVATE_LOCAL_ONLY'}}}
            state = copy.deepcopy(cfg)
            calls, written = [], {}
            initial = True

            def aws(*args, **kwargs):
                nonlocal initial
                calls.append(args)
                if args[:2] == ('lambda', 'get-function-configuration'):
                    return copy.deepcopy(state)
                self.assertEqual(args[:2], ('lambda', 'update-function-code'))
                self.assertEqual(args[args.index('--function-name') + 1], m.FUNCTION)
                if initial:
                    initial = False
                    self.assertEqual(args[args.index('--revision-id') + 1], m.REVISION)
                    state.update(CodeSha256=m.sha(candidate.read_bytes()), RevisionId='accepted', LastUpdateStatus='InProgress')
                    if mode == 'foreign-code':
                        state.update(CodeSha256='foreign-package', RevisionId='foreign')
                    elif mode == 'foreign-config':
                        state['MemorySize'] = 1024
                    elif mode == 'foreign-same-code-revision':
                        state['RevisionId'] = 'foreign'
                        return {'RevisionId': 'accepted'}
                    if mode != 'verified-failure' and mode != 'success':
                        raise TimeoutError('PRIVATE_NETWORK_DETAIL')
                    return {'RevisionId': 'accepted'}
                self.assertEqual(args[args.index('--revision-id') + 1], 'accepted')
                if mode == 'rollback-cas-race':
                    state.update(CodeSha256='foreign-package', RevisionId='foreign', LastUpdateStatus='Successful')
                    raise RuntimeError('Conditional revision changed')
                state.update(CodeSha256=m.BASELINE, RevisionId='restored', LastUpdateStatus='Successful')
                if mode == 'rollback-lost-ack':
                    raise TimeoutError('PRIVATE_ROLLBACK_ACK')
                return {'RevisionId': 'restored'}

            def waiter(*args, **kwargs):
                state['LastUpdateStatus'] = 'Successful'
                return subprocess.CompletedProcess(args, 0)

            def verify():
                if mode != 'success':
                    raise AssertionError('PRIVATE_CANARY_DETAIL')

            with patch.object(m, 'aws', aws), patch.object(m.subprocess, 'run', waiter), \
                 patch.object(m, 'write', lambda name, data: written.update({name: copy.deepcopy(data)})):
                if mode == 'success':
                    result = m.publish(cfg, candidate, backup, verify)
                    self.assertEqual(result['CodeSha256'], m.sha(candidate.read_bytes()))
                    self.assertEqual(len([c for c in calls if c[:2] == ('lambda', 'update-function-code')]), 1)
                    return
                with self.assertRaisesRegex(RuntimeError, 'Systemic release failed'):
                    m.publish(cfg, candidate, backup, verify)
            failure = written['failed-release.json']
            self.assertNotIn('PRIVATE', json.dumps(failure))
            return state, failure, [c for c in calls if c[:2] == ('lambda', 'update-function-code')]

    def test_success_updates_exactly_one_function_once(self):
        self.run_case('success')

    def test_accepted_publication_lost_ack_is_rolled_back_with_current_cas(self):
        state, failure, updates = self.run_case('lost-ack')
        self.assertEqual(state['CodeSha256'], m.BASELINE)
        self.assertEqual(len(updates), 2)
        self.assertTrue(failure['rollbackConfirmed'])

    def test_verification_failure_rolls_back_our_acknowledged_revision(self):
        state, failure, updates = self.run_case('verified-failure')
        self.assertEqual(state['CodeSha256'], m.BASELINE)
        self.assertTrue(failure['rollbackConfirmed'])

    def test_intervening_code_and_configuration_are_preserved(self):
        for mode in ['foreign-code', 'foreign-config', 'foreign-same-code-revision']:
            state, failure, updates = self.run_case(mode)
            self.assertEqual(len(updates), 1)
            self.assertFalse(failure['rollbackAttempted'])

    def test_intervening_revision_during_rollback_cas_is_not_overwritten(self):
        state, failure, updates = self.run_case('rollback-cas-race')
        self.assertEqual(state['CodeSha256'], 'foreign-package')
        self.assertFalse(failure['rollbackConfirmed'])
        self.assertEqual(len(updates), 2)

    def test_rollback_with_lost_ack_is_independently_confirmed(self):
        state, failure, updates = self.run_case('rollback-lost-ack')
        self.assertTrue(failure['rollbackConfirmed'])
        self.assertEqual(failure['rollbackAcknowledgementErrorType'], 'TimeoutError')


class ScopeAndCanaries(unittest.TestCase):
    def test_release_preserves_reviewed_fiscal_geography_removal_baseline(self):
        self.assertEqual(m.BASELINE, 'oHgRl53dlYR3Z/98HuB1GRelxAvWFUIKth0WHagkRnc=')
        self.assertEqual(m.REVISION, '00ae2c0f-6801-4c07-8ff3-6b74497b2614')
        self.assertEqual(m.CORE, 'cf802a6ef20cd6047e94e0ebdfe45da7ea923a36aafd103dada801cde6bb352e')

    def test_native_timing_proxy_is_only_reads_sanitized_and_reports_budget_overrun(self):
        for elapsed, fits in [(0.1, True), (0.4, False)]:
            requests = []

            def request(req, **kwargs):
                requests.append(req)
                if req.data:
                    self.assertIn(b'ReadRecord', req.data)
                    self.assertNotIn(b'SaveRecord', req.data)
                    envelope = ET.Element('Root')
                    answer = ET.SubElement(envelope, '{http://www.totvs.com/}ReadRecordResult')
                    answer.text = '<Root><FDadosPgto><IDPGTO>2</IDPGTO><CHAVE>PRIVATE_PIX</CHAVE></FDadosPgto></Root>'
                    return io.BytesIO(ET.tostring(envelope))
                return io.BytesIO(b'[{"DOC_VERSION":2}]')

            clock = itertools.count(0, elapsed)
            with patch.object(m.urllib.request, 'urlopen', request), patch.object(m.time, 'perf_counter', lambda: next(clock)):
                result = m.native_timings({'USERNAME_TOTVS': 'private', 'PASSWORD_TOTVS': 'PRIVATE_PASSWORD'}, 30)
            self.assertEqual(len(requests), 8)
            self.assertEqual(result['proxyFitsWithAllowance'], fits)
            self.assertFalse(result['fullRuntimeLatencyProven'])
            self.assertTrue(result['lambdaSdkReadLatencyNotMeasured'])
            self.assertNotIn('PRIVATE', json.dumps(result))

    def test_canaries_have_secondary_no_creation_fence_and_exact_scopes(self):
        cases = m.canary_cases()
        self.assertEqual([c['ticketRaiz'] for c, _ in cases], ['999999990045', '999999990046'])
        self.assertNotIn('idpgto', cases[0][0])
        self.assertEqual(cases[1][0]['itens'][0]['codigoDoItem'], '')
        self.assertGreater(int(cases[1][0]['codigoDaFilial2']), 2147483647)
        self.assertEqual([case[2] for case in m.SENTINELS], ['453', '454', '455', None])
        self.assertNotIn(226374, [case[1] for case in m.SENTINELS])

    def test_actual_handler_rejects_both_canaries_before_reservation_or_creation(self):
        node = r"""
const fs=require('node:fs'),path=require('node:path');
const load=require('./tests/load-ts.cjs');const {executarPagamentoSeguro}=load(path.resolve('src/functions/rm/post/solicitacaoDePagamentoSeguro.ts'));
const input=JSON.parse(fs.readFileSync(0,'utf8'));let reserves=0,creates=0;
console.info=console.warn=console.error=()=>{};
const repo={consultar:async()=>undefined,concluida:async()=>undefined,movimentoConhecido:async()=>undefined,
 reservar:async()=>{reserves++;throw Error('RESERVE_FORBIDDEN');}};
const rm={readReacord:async()=>'<Root><FDadosPgto><CODCOLIGADA>9</CODCOLIGADA><CODCOLCFO>0</CODCOLCFO><CODCFO>0000154129</CODCFO><IDPGTO>3</IDPGTO><ATIVO>1</ATIVO><FORMAPAGAMENTO>Y</FORMAPAGAMENTO></FDadosPgto></Root>',
 buscarMovimentosPorTicket:async()=>[]};
(async()=>{const rows=[];for(const [fields,expected] of input){const r=await executarPagamentoSeguro(fields,{getRemainingTimeInMillis:()=>30000},async()=>{creates++;throw Error('CREATE_FORBIDDEN');},{repositorio:repo,rm});rows.push({status:r.statusCode,code:JSON.parse(r.body).code,expected});}process.stdout.write(JSON.stringify({rows,reserves,creates}));})().catch(()=>process.exit(1));
"""
        response = subprocess.run(['node', '-e', node], cwd=ROOT, input=json.dumps(m.canary_cases()),
                                  capture_output=True, text=True, check=True)
        result = json.loads(response.stdout)
        self.assertEqual(result['reserves'], 0)
        self.assertEqual(result['creates'], 0)
        for case in result['rows']:
            self.assertEqual(case['status'], 422)
            self.assertEqual(case['code'], case['expected'])

    def test_config_hash_preserves_secret_drift_without_disclosing_secret(self):
        cfg = {'Runtime': 'nodejs22.x', 'Environment': {'Variables': {'TOKEN': 'PRIVATE'}}}
        self.assertNotEqual(m.config_hash(cfg), m.config_hash({'Runtime': 'nodejs22.x', 'Environment': {'Variables': {'TOKEN': 'OTHER'}}}))
        self.assertEqual(m.config_hash(cfg), m.config_hash({**cfg, 'CodeSha256': 'changed', 'RevisionId': 'changed'}))
        self.assertNotIn('PRIVATE', m.config_hash(cfg))

    def test_workflow_is_explicit_once_exact_branch_and_no_automatic_rerun(self):
        text = (ROOT / '.github/workflows/payment-systemic-release.yml').read_text()
        for required in ['fix/idpgto-vinculo-obrigatorio', 'github.run_attempt == 1', '[publish-payment-systemic-once]', 'retention-days: 7', 'cancel-in-progress: false']:
            self.assertIn(required, text)
        self.assertNotIn('workflow_dispatch', text)
        self.assertNotIn('continue-on-error', text)
        self.assertIn('readback-payment-systemic.py', text)


if __name__ == '__main__':
    unittest.main()
