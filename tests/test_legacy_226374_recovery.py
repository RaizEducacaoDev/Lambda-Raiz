"""Pure/fake regression tests: no AWS, Zeev, RM or financial writes."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('legacy226374', Path(__file__).resolve().parents[1] /
                                             'scripts/reconcile-legacy-226374.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NEW_DIGEST = 'a' * 64
CODE = 'Pt8n1Td1BarRUJWuGaQnMcNY5bYXcS8b3TvUaY28U0U='


def root():
    return {'pk': {'S': m.PK}, 'state': {'S': 'CREATING'}, 'owner': {'S': m.OWNER},
            'digest': {'S': m.DIGEST}, 'lockUntil': {'N': str(m.LOCK)}, 'legacyExtra': {'S': 'preserve'}}


def proof():
    return {'originalRequestId': m.REQUEST, 'endSeen': True, 'reportSeen': True,
            'logCoverageComplete': True, 'creationCallsAfterOriginal': 0,
            'sourceSha256': 'b' * 64, 'auditRunId': '41870831902', 'observedUtc': m.utc(), 'activeCodeSha256': CODE}


def observation():
    common = {'OBS_VERSION': 1, 'TOTAL_MOVEMENTS': 1, 'TOTAL_LAUNCHES': 1, 'CODCOLIGADA': 9,
              'CODFILIAL': 3, 'CODCOLCFO': 0, 'CODCFO': '0000154129', 'IDMOV': 78497,
              'TICKET': '110229', 'ORFAO': 0, 'TICKET_MATCH': 0, 'SERIE': '1', 'CODTDO': '002',
              'VALOR': 5100, 'DATAEMISSAO': '2025-12-01T00:00:00-03:00',
              'RECCREATEDON': '2025-12-04T10:33:39-03:00', 'RECMODIFIEDON': '2026-02-12T15:15:26-03:00'}
    return {'fields': dict(m.FIELDS), 'codeSha256': CODE, 'revisionId': 'revision', 'laterDispatches': 0,
            'original': [{**common, 'ROW_KIND': 'MOV', 'STATUS': 'Q', 'DOCUMENTO': '000000114'},
                         {**common, 'ROW_KIND': 'LAN', 'IDLAN': 161973, 'STATUS': '1',
                          'DOCUMENTO': '000000114/01', 'VALORBAIXADO': 5100}],
            'retry': [{'RETOMADA_VERSION': 1, 'REQUEST_COMPANY': 9, 'REQUEST_TICKET': '226374',
                       'TOTAL_MOVEMENTS': 0, 'TOTAL_LAUNCHES': 0, 'ROW_KIND': 'EMPTY'}],
            'document': [{'DOC_VERSION': 1, 'REQUEST_COMPANY': 9, 'REQUEST_BRANCH': 3,
                          'REQUEST_SUPPLIER_COMPANY': 0, 'REQUEST_SUPPLIER': '0000154129',
                          'REQUEST_MOVEMENT_TYPE': '1.2.03', 'REQUEST_NUMBER': '1141', 'REQUEST_SERIES': '',
                          'HAS_MOVEMENT_TYPE': 1, 'MASK': '#########', 'PRINCIPAL_COUNT': 1,
                          'EFFECTIVE_SERIES': '1', 'EFFECTIVE_NUMBER': '000001141',
                          'EFFECTIVE_DOCUMENT_TYPE': '002', 'SERIES_MATCH_COUNT': 1, 'DOC_MATCH_COUNT': 0}],
            'bank': {'CODCOLIGADA': '9', 'CODCOLCFO': '0', 'CODCFO': '0000154129',
                     'IDPGTO': '3', 'ATIVO': '1', 'FORMAPAGAMENTO': 'S'}}


class Fake:
    def __init__(self):
        self.items = {m.PK: root()}
        self.writes = []
        self.reads = 0
        self.observations = 0
        self.mode = None
        self.archive_mode = None
        self.final_mutation = None
        self.mutate_root_after_archive = False

    def bootstrap(self):
        return 'revision'

    def observe(self):
        self.observations += 1
        value = observation()
        if self.observations == 2 and self.final_mutation:
            self.final_mutation(value)
        return value

    def get(self, key):
        self.reads += 1
        return copy.deepcopy(self.items.get(key, {}))

    def archive(self, item):
        self.writes.append(('archive', copy.deepcopy(item)))
        key = item['pk']['S']
        self.items[key] = copy.deepcopy(item)
        if self.mutate_root_after_archive:
            self.items[m.PK]['owner'] = {'S': 'another-owner'}
        if self.archive_mode == 'different':
            self.items[key]['manifestJson'] = {'S': 'different'}
        if self.archive_mode:
            raise TimeoutError('archive acknowledgement lost')

    def update(self, request):
        self.writes.append(('cas', copy.deepcopy(request)))
        values = request['ExpressionAttributeValues']
        names = request['ExpressionAttributeNames']
        # Emulate optimistic conflict if a writer changed ANY captured attribute.
        if self.mode == 'conflict':
            self.items[m.PK]['owner'] = {'S': 'concurrent'}
        for key, name in names.items():
            if key.startswith('#old'):
                if self.items[m.PK].get(name) != values[':' + key[1:]]:
                    raise m.GateError('ConditionalCheckFailedException')
        if self.mode == 'timeout_before':
            raise TimeoutError('not accepted')
        for name, variable in {'state': ':reserved', 'owner': ':owner', 'digest': ':digest',
                               'lockUntil': ':lease', 'protocolVersion': ':protocol',
                               'reconciliationEvidenceKey': ':evidence'}.items():
            self.items[m.PK][name] = copy.deepcopy(values[variable])
        if self.mode == 'concurrent_progress':
            self.items[m.PK]['state'] = {'S': 'CREATING'}
        if self.mode in ('timeout_after', 'concurrent_progress'):
            raise TimeoutError('accepted but response lost')
        return {'Attributes': copy.deepcopy(self.items[m.PK])}


def run(fake, apply=False, authorized=False, **kwargs):
    return m.reconcile(fake, apply=apply, authorized=authorized,
                       new_digest=kwargs.get('digest', NEW_DIGEST), closure=kwargs.get('closure', proof()))


class LegacyRecovery(unittest.TestCase):
    def test_native_rm_two_digit_fraction_is_validated_without_losing_date_gate(self):
        current = observation()
        current['original'][0]['RECMODIFIEDON'] = '2026-02-12T15:15:27.53-03:00'
        m.validate_observation(current)
        current['original'][0]['RECMODIFIEDON'] = '2026-11-02T15:15:27.53-03:00'
        with self.assertRaises(m.GateError):
            m.validate_observation(current)

    def test_zeev_override_is_memory_only_and_preserves_runtime_gates(self):
        live = m.Live(False, CODE)
        env = {'STAGE': 'prod', 'PAGAMENTO_IDPGTO_TABLE': m.TABLE,
               'RM_PROD': m.HOST.replace(':8051', ''), 'ZEEV_PROD': m.ZEEV,
               'USERNAME_TOTVS': 'fixture-user', 'PASSWORD_TOTVS': 'fixture-password', 'TOKEN_ZEEV': ''}
        cfg = {'CodeSha256': CODE, 'State': 'Active', 'LastUpdateStatus': 'Successful',
               'Environment': {'Variables': env}}
        live.aws = Mock(return_value=cfg)
        original = copy.deepcopy(cfg)
        with patch.dict(m.os.environ, {'RECONCILE_ZEEV_TOKEN': 'fixture-override'}, clear=True):
            self.assertEqual(live.config(), (cfg, env))
            self.assertEqual(live.zeev_token(env), 'fixture-override')
            self.assertEqual(cfg, original)
            env['STAGE'] = 'dev'
            with self.assertRaises(m.GateError):
                live.config()
            env['STAGE'] = 'prod'
        with patch.dict(m.os.environ, {}, clear=True):
            with self.assertRaises(m.GateError):
                live.config()
            self.assertEqual(live.zeev_token({'TOKEN_ZEEV': 'fixture-native'}), 'fixture-native')
        self.assertEqual({call.args[:2] for call in live.aws.call_args_list},
                         {('lambda', 'get-function-configuration')})

    def test_http_failure_reports_stage_status_without_raw_secret(self):
        live = m.Live(False, CODE)
        for stage in ('ZEEV_INSTANCE', 'RM_READRECORD', 'RM_QUERY', 'AWS_PACKAGE'):
            with self.subTest(stage=stage):
                error = m.urllib.error.HTTPError('https://private.invalid/?secret=TOKEN', 401,
                                                'private body TOKEN', {'Authorization': 'TOKEN'},
                                                m.io.BytesIO(b'private response TOKEN'))
                live.opener = Mock()
                live.opener.open.side_effect = error
                with self.assertRaises(m.GateError) as caught:
                    live.http(m.urllib.request.Request('https://private.invalid/'), stage)
                self.assertEqual(str(caught.exception), 'HTTP ' + stage + ' status=401')
                self.assertNotIn('TOKEN', str(caught.exception))
                self.assertNotIn('private', str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)

    def test_network_failure_classification_keeps_details_private_and_does_not_retry(self):
        failures = [(m.ssl.SSLCertVerificationError(1, 'private TOKEN'), 'TLS_CERTIFICATE'),
                    (m.ssl.SSLError(1, 'private TOKEN'), 'TLS_ERROR'),
                    (m.socket.gaierror(-2, 'private TOKEN'), 'DNS_ERROR'),
                    (TimeoutError('private TOKEN'), 'NETWORK_TIMEOUT'),
                    (ConnectionRefusedError('private TOKEN'), 'CONNECTION_REFUSED'),
                    (OSError('private TOKEN'), 'NETWORK_ERROR')]
        for reason, expected in failures:
            with self.subTest(category=expected):
                live = m.Live(False, CODE)
                live.opener = Mock()
                live.opener.open.side_effect = m.urllib.error.URLError(reason)
                with self.assertRaises(m.GateError) as caught:
                    live.http(m.urllib.request.Request('https://private.invalid/'), 'RM_READRECORD')
                self.assertEqual(str(caught.exception), 'HTTP RM_READRECORD status=' + expected)
                self.assertNotIn('TOKEN', str(caught.exception))
                self.assertNotIn('private', str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)
                self.assertEqual(live.opener.open.call_count, 1)

    def test_default_dry_run_has_no_mutations(self):
        fake = Fake()
        result = run(fake)
        self.assertEqual(fake.writes, [])
        self.assertEqual(fake.items[m.PK], root())
        self.assertFalse(result['applied'])
        self.assertFalse(result['manifest']['historicalRollbackProven'])

    def test_apply_requires_business_confirmation_before_reads(self):
        fake = Fake()
        with self.assertRaises(m.GateError):
            run(fake, apply=True)
        self.assertEqual(fake.reads, 0)
        self.assertFalse(fake.writes)

    def test_new_attempt_archives_full_original_and_has_expired_fresh_owner(self):
        fake = Fake()
        result = run(fake, apply=True, authorized=True)
        self.assertTrue(result['applied'])
        self.assertEqual([k for k, _ in fake.writes], ['archive', 'cas'])
        current = fake.items[m.PK]
        self.assertEqual(current['protocolVersion'], {'N': '2'})
        self.assertEqual(current['state'], {'S': 'RESERVED'})
        self.assertNotEqual(current['owner'], root()['owner'])
        self.assertEqual(current['legacyExtra'], root()['legacyExtra'])
        self.assertNotIn('pg', current)
        self.assertEqual(result['manifest']['originalSnapshot'], root())
        self.assertEqual(fake.observations, 2)
        self.assertLess(int(current['lockUntil']['N']), int(m.time.time() * 1000))

    def test_incorrect_historical_fields_block_all_writes(self):
        for key, value in [('state', {'S': 'RESERVED'}), ('digest', {'S': NEW_DIGEST}),
                           ('owner', {'S': 'another'}), ('lockUntil', {'N': str(m.LOCK + 1)}),
                           ('pg', {'NULL': True}), ('protocolVersion', {'N': '2'}),
                           ('recuperadaCriacaoIncerta', {'BOOL': False})]:
            with self.subTest(key=key):
                fake = Fake()
                fake.items[m.PK][key] = value
                with self.assertRaises(m.GateError):
                    run(fake, apply=True, authorized=True)
                self.assertFalse(fake.writes)

    def test_cas_protects_all_snapshot_fields_and_forbids_old_effect_markers(self):
        request = m.cas_request(root(), NEW_DIGEST, m.PK + '#ADJUDICATION#test', 'new-owner', int(m.time.time() * 1000))
        self.assertIn('legacyExtra', request['ExpressionAttributeNames'].values())
        for name in ('pg', 'protocolVersion', 'reconciliationEvidenceKey', 'recuperadaCriacaoIncerta'):
            self.assertIn('attribute_not_exists(' + name + ')', request['ConditionExpression'])
        self.assertNotIn('DELETE', request['UpdateExpression'])

    def test_native_or_zeev_change_blocks_cas(self):
        mutations = [lambda p: p['fields'].update(numeroDaNF='114'),
                     lambda p: p['bank'].update(ATIVO='0'),
                     lambda p: p['original'].append(dict(p['original'][0])),
                     lambda p: p['original'][1].update(ORFAO=1),
                     lambda p: p['retry'][0].update(TOTAL_LAUNCHES=1),
                     lambda p: p['document'][0].update(DOC_MATCH_COUNT=1),
                     lambda p: p.update(laterDispatches=1),
                     lambda p: p.update(revisionId='new-revision')]
        for change in mutations:
            with self.subTest(change=change):
                fake = Fake()
                fake.final_mutation = change
                with self.assertRaises(m.GateError):
                    run(fake, apply=True, authorized=True)
                self.assertEqual([k for k, _ in fake.writes], ['archive'])
                self.assertEqual(fake.items[m.PK], root())

    def test_existing_equivalent_archive_or_lost_acknowledgement_is_verified(self):
        fake = Fake()
        fake.archive_mode = 'same'
        self.assertTrue(run(fake, apply=True, authorized=True)['applied'])
        self.assertEqual(len(fake.writes), 2)

    def test_immutable_archive_mismatch_blocks_cas(self):
        fake = Fake()
        fake.archive_mode = 'different'
        with self.assertRaises(m.GateError):
            run(fake, apply=True, authorized=True)
        self.assertEqual([k for k, _ in fake.writes], ['archive'])

    def test_concurrent_root_change_before_cas_is_preserved(self):
        fake = Fake()
        fake.mutate_root_after_archive = True
        with self.assertRaises(m.GateError):
            run(fake, apply=True, authorized=True)
        self.assertEqual([k for k, _ in fake.writes], ['archive'])
        self.assertEqual(fake.items[m.PK]['owner'], {'S': 'another-owner'})

    def test_lost_cas_response_reads_back_and_never_retries(self):
        for mode, outcome, applied in [('timeout_after', 'NEW_ATTEMPT_RESERVED', True),
                                       ('timeout_before', 'NOT_APPLIED_NO_RETRY', False),
                                       ('conflict', 'CONCURRENT_OR_UNKNOWN_STATE_DO_NOT_RETRY', False),
                                       ('concurrent_progress', 'CONCURRENT_PROGRESS_DO_NOT_RETRY', False)]:
            with self.subTest(mode=mode):
                fake = Fake()
                fake.mode = mode
                result = run(fake, apply=True, authorized=True)
                self.assertEqual(result['outcome'], outcome)
                self.assertEqual(result['applied'], applied)
                self.assertEqual(len([k for k, _ in fake.writes if k == 'cas']), 1)

    def test_closure_or_digest_missing_blocks_all_writes(self):
        for key, value in [('endSeen', False), ('reportSeen', False), ('logCoverageComplete', False),
                           ('creationCallsAfterOriginal', 1), ('originalRequestId', 'other'),
                           ('observedUtc', '2026-11-01T00:00:00+00:00'), ('sourceSha256', '')]:
            with self.subTest(key=key):
                fake = Fake()
                closure = proof()
                closure[key] = value
                with self.assertRaises(m.GateError):
                    run(fake, apply=True, authorized=True, closure=closure)
                self.assertFalse(fake.writes)
        for digest in (m.DIGEST, '', 'invalid'):
            with self.assertRaises(m.GateError):
                run(Fake(), apply=True, authorized=True, digest=digest)

    def test_aws_allowlist_never_allows_financial_or_configuration_writes(self):
        for apply in (False, True):
            live = m.Live(apply, CODE)
            for service, operation in [('lambda', 'invoke'), ('lambda', 'update-function-code'),
                                       ('dynamodb', 'delete-item'), ('dynamodb', 'update-time-to-live'),
                                       ('iam', 'put-role-policy')]:
                with self.assertRaises(m.GateError):
                    live.aws(service, operation, {})
        for operation in ('put-item', 'update-item'):
            with self.assertRaises(m.GateError):
                m.Live(False, CODE).aws('dynamodb', operation, {'TableName': m.TABLE})

    def test_incorrect_target_is_rejected_before_subprocess(self):
        live = m.Live(True, CODE)
        for service, operation, payload in [('lambda', 'get-function', {'FunctionName': 'other'}),
                                           ('dynamodb', 'get-item', {'TableName': 'other'}),
                                           ('dynamodb', 'update-item', {'TableName': m.TABLE, 'Key': {'pk': {'S': 'other'}}}),
                                           ('dynamodb', 'put-item', {'TableName': m.TABLE, 'Item': {'pk': {'S': m.PK}}})]:
            with self.assertRaises(m.GateError):
                live.aws(service, operation, payload)


if __name__ == '__main__':
    unittest.main()
