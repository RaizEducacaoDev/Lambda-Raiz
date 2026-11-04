"""226698 positive-chain evidence only; no services, writes or production fixture imports."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


o = load('predispatch_observer_tests', ROOT / 'scripts/observe-payment-backlog.py')
m, w = o.m, o.m.WINDOW
p = load('predispatch_tests', ROOT / 'scripts/payment_backlog_predispatch.py')


def fixtures():
    root = {'pk': {'S': 'prod#PG#8#226698'}, 'state': {'S': 'RESERVED'}, 'digest': {'S': 'a'*64},
            'owner': {'S': '974b1745-53a1-4b3e-95ec-f67f547d9628'}, 'lockUntil': {'N': str(p.END)}}
    plan = {'company': 8, 'ticket': 226698, 'action': 'RESERVE_NEW', 'expectedRoot': root,
            'alternativeOriginalClosure': w.policy(8, 226698, m)}
    closure = {'observedUtc': m.utc(), 'originalRequestId': p.REQUEST, 'originalStartMs': p.START,
        'originalEndMs': p.END, 'originalReportMs': p.END, 'originalRootSha256': m.sha(root),
        'coverageComplete': True, 'endSeen': True, 'reportSeen': True, 'laterDispatches': 0, 'logSourceSha256': 'c'*64}
    events = [{'kind': 'lambda_start', 'requestId': p.REQUEST, 'timestamp': p.START},
        {'kind': 'payment_pending', 'requestId': p.REQUEST, 'timestamp': p.END-2, 'state': 'RESERVED', 'creationStage': 'preflight'},
        {'kind': 'lambda_end', 'requestId': p.REQUEST, 'timestamp': p.END},
        {'kind': 'lambda_report', 'requestId': p.REQUEST, 'timestamp': p.END}]
    closure['originalOutcome'] = w.original_evidence({'events': events, 'requestId': p.REQUEST,
        'coverage': {'complete': True}, 'fixedCodeIndicators': []}, events, [], m)
    start, end = (dt.datetime.fromisoformat(w.epoch_stamp(v)) for v in (p.START, p.END))
    echo = {'WINDOW_VERSION': 1, 'REQUEST_COMPANY': 8, 'REQUEST_TICKET': '226698', 'TOTAL_MOVEMENTS': 2, 'TOTAL_LAUNCHES': 2,
        'REQUEST_START_UTC': start.isoformat(), 'REQUEST_END_UTC': end.isoformat(),
        'WINDOW_START_UTC': (start-dt.timedelta(seconds=120)).isoformat(), 'WINDOW_END_UTC': (end+dt.timedelta(seconds=120)).isoformat(),
        'WINDOW_START_LOCAL': (start-dt.timedelta(hours=3, seconds=120)).isoformat(),
        'WINDOW_END_LOCAL': (end-dt.timedelta(hours=3)+dt.timedelta(seconds=120)).isoformat()}
    values = {565020: (11, 36880, '827.72', '2026-11-03T11:44:21', '2026-11-03T11:44:22'),
        565059: (4, 36881, '479.62', '2026-11-03T17:25:59', '2026-11-03T17:25:59'),
        565060: (10, 36884, '1038.35', '2026-11-03T17:27:25', '2026-11-03T17:27:25'),
        565061: (3, 36892, '827.72', '2026-11-03T17:29:16', '2026-11-03T17:29:16'),
        565836: (4, 36894, '871.50', '2026-11-04T16:56:30', '2026-11-04T16:56:30')}
    proof = {'observedUtc': m.utc(), 'predispatchPolicy': p.policy(), 'querySha256': w.query_sha(),
        'currentCensusQuerySha256': p.census_sha(), 'ticketLookupQuerySha256': p.retry_sha(),
        'contractsVerified': True, 'complete': True, 'committedRead': True,
        'rows': [], 'exclusions': [], 'currentCensusBefore': {'movements': [], 'launches': []}}
    for declared in p.ALL:
        branch, number, amount, created, modified = values[declared['idMov']]
        mov = {'OBS_VERSION': 1, 'REQUEST_COMPANY': 8, 'REQUEST_TICKET': '226698', 'TOTAL_MOVEMENTS': 5, 'TOTAL_LAUNCHES': 5,
            'ROW_KIND': 'MOV', 'CODCOLIGADA': 8, 'CODFILIAL': branch, 'CODCOLCFO': 0, 'CODCFO': '0000077555',
            'IDMOV': declared['idMov'], 'CODTMV': '1.2.03', 'DOCUMENTO': str(number).zfill(9), 'SERIE': '1', 'CODTDO': '002',
            'STATUS': 'F', 'DATAEMISSAO': '2026-10-27', 'DATASAIDA': '2026-10-27', 'VALORBRUTO': amount,
            'VALORLIQUIDO': amount, 'VALOR': amount, 'RECCREATEDON': created, 'RECMODIFIEDON': modified,
            'TICKET': str(declared['ticket']), 'ORFAO': 0}
        lan = {**mov, 'ROW_KIND': 'LAN', 'IDLAN': declared['idLans'][0], 'DOCUMENTO': mov['DOCUMENTO']+'/01', 'STATUS': '0',
            'DATAVENCIMENTO': '2026-11-06', 'VALORBAIXADO': '0.00', 'IDPGTO': 12, 'CODCOLPGTO': 8}
        proof['currentCensusBefore']['movements'].append(mov)
        proof['currentCensusBefore']['launches'].append(lan)
        if declared in p.WINDOW:
            proof['rows'] += [{**mov, **echo, 'COMPLEMENT_CREATED': created, 'COMPLEMENT_MODIFIED': created}, {**lan, **echo}]
        header, financial = w.canonical_movement(mov, m), w.canonical_launch(lan, m)
        native_financial = {**financial, 'createdOn': None, 'modifiedOn': None}
        form = {'codigoDaColigada2': '8', 'codigoDaFilial2': str(branch), 'codigoDoFornecedor': '0000077555',
            'idDoMovimento': str(declared['idMov']), 'idDoLancamento': str(declared['idLans'][0]),
            'tipoDoPagamento': 'NF', 'tipoDeItem': 'Serviço', 'numeroDaNF': str(number), 'serieDaNF': '',
            'dataDeEmissao': '27/10/2026', 'dataDeEntrada': '27/10/2026', 'dataDeVencimento': '06/11/2026',
            'valorTotalDoPagamento': amount.replace('.', ',')}
        lookup = [{'RETOMADA_VERSION': 1, 'REQUEST_COMPANY': 8, 'REQUEST_TICKET': str(declared['ticket']),
            'TOTAL_MOVEMENTS': 1, 'TOTAL_LAUNCHES': 1, 'CODCOLIGADA': 8, 'IDMOV': declared['idMov'],
            'ROW_KIND': kind, 'IDLAN': declared['idLans'][0] if kind == 'LAN' else None} for kind in ('MOV', 'LAN')]
        proof['exclusions'].append({'observedUtc': m.utc(), 'declared': copy.deepcopy(declared), 'movement': header, 'ticketLookup': lookup,
            'complement': {'company': '8', 'idMov': str(declared['idMov']), 'ticket': str(declared['ticket']),
                'createdOn': w.stamp(created, m), 'modifiedOn': w.stamp(created, m)}, 'launches': [native_financial],
            'payments': [{k: financial[k] for k in ('company', 'idMov', 'idLan', 'dueDate', 'amount')}],
            'zeev': {'observedUtc': m.utc(), 'ticket': declared['ticket'], 'active': True, 'flowId': 299, 'form': form}})
    return plan, proof, closure


class FakeObserver:
    fixture = None
    broken_contract = False
    calls = []

    def __init__(self, fixture):
        type(self).fixture = fixture; type(self).calls = []
        self.zeev_token = 'test'; self.opener = object()

    def query(self, code, parameters):
        if code == 'RAIZ.PG.RETRY':
            assert parameters['CODCOLIGADA'] == '8'
            chain = next(c for c in self.fixture['exclusions'] if str(c['declared']['ticket']) == parameters['TICKET'])
            type(self).calls.append(('query', code))
            return copy.deepcopy(chain['ticketLookup'])
        assert code == 'RAIZ.PG.WINDOW'
        assert parameters == {'CODCOLIGADA': '8', 'TICKET': '226698', 'INICIOUTC': w.epoch_stamp(p.START), 'FIMUTC': w.epoch_stamp(p.END)}
        type(self).calls.append(('query', code))
        return copy.deepcopy(self.fixture['rows'])

    def read_record(self, server, key, company):
        type(self).calls.append((server, key, company)); root = ET.Element('NewDataSet')
        def row(name, fields):
            node = ET.SubElement(root, name)
            for k, value in fields.items():
                if value is not None: ET.SubElement(node, k).text = str(value)
        if server == 'GlbConsSQLData':
            name = {'WINDOW': 'pagamento-janela-criacao.sql', 'CENSO': 'pagamento-censo-operacional.sql',
                    'RETRY': 'pagamento-retomada.sql'}[key.split('.')[-1]]
            text = (ROOT / 'sql' / name).read_text(encoding='utf-8-sig')
            row('GConsSql', {'SENTENCA': 'SELECT 1' if self.broken_contract else text}); return root
        identifier = int(key.split(';')[1]); assert company == 8
        if server == 'MovMovimentoTBCData':
            sql = next(r for r in self.fixture['currentCensusBefore']['movements'] if r['IDMOV'] == identifier)
            chain = next(r for r in self.fixture['exclusions'] if r['declared']['idMov'] == identifier)
            row('TMOV', {**sql, 'NUMEROMOV': sql['DOCUMENTO']})
            row('TMOVCOMPL', {'CODCOLIGADA': 8, 'IDMOV': identifier, 'TICKET': sql['TICKET'],
                'RECCREATEDON': chain['complement']['createdOn'], 'RECMODIFIEDON': chain['complement']['modifiedOn']})
            payment = chain['payments'][0]
            row('TMOVPAGTO', {'CODCOLIGADA': 8, 'IDMOV': identifier, 'IDLAN': payment['idLan'], 'VALOR': payment['amount'], 'DATAVENCIMENTO': payment['dueDate']})
        else:
            assert server == 'FinLanDataBR'
            sql = next(r for r in self.fixture['currentCensusBefore']['launches'] if r['IDLAN'] == identifier)
            native = {k: v for k, v in sql.items() if k not in ('RECCREATEDON', 'RECMODIFIEDON')}
            row('FLAN', {**native, 'NUMERODOCUMENTO': sql['DOCUMENTO'], 'STATUSLAN': sql['STATUS'], 'VALORORIGINAL': sql['VALOR']})
        return root

    def zeev_snapshot(self, names):
        chain = next(r for r in self.fixture['exclusions'] if r['declared']['ticket'] == self.plan['ticket'])
        z = chain['zeev']; assert names == w.OTHER_FIELDS
        return {'id': z['ticket'], 'active': True, 'flow': {'id': 299}, 'formFields': [
            {'name': key, 'row': 1, 'value': value} for key, value in z['form'].items()]}, m.utc()


class PreDispatchTests(unittest.TestCase):
    def test_all_five_owned_chains_allow_only_reserved_result(self):
        plan, proof, closure = fixtures()
        self.assertEqual(p.validate(plan, proof, closure, m, w), (p.declared_ids(p.ALL), p.declared_ids(p.ALL, True)))
        self.assertNotIn('historicalIdentity', plan)

    def test_collect_is_readonly_and_window_parameters_never_expand(self):
        plan, proof, closure = fixtures(); observer = FakeObserver(proof)
        observed, movements, launches = p.collect(observer, plan, closure, proof['currentCensusBefore']['movements'],
            proof['currentCensusBefore']['launches'], m, o.unique, o.records, w)
        self.assertEqual((movements, launches), ([], [])); self.assertEqual(len(observed['exclusions']), 5)
        self.assertEqual(sum(call[0] == 'FinLanDataBR' for call in observer.calls), 5)
        self.assertTrue(all(call[0] in {'GlbConsSQLData', 'MovMovimentoTBCData', 'FinLanDataBR', 'query'} for call in observer.calls))

    def test_window_entry_points_route_exact_target_to_positive_chain_contract(self):
        plan, proof, closure = fixtures()
        self.assertEqual(w.validate(plan, proof, closure, m), p.validate(plan, proof, closure, m, w))
        observer = FakeObserver(proof)
        routed, moves, lans = w.collect(observer, plan, closure, proof['currentCensusBefore']['movements'],
            proof['currentCensusBefore']['launches'], m, o.unique, o.records)
        self.assertEqual(routed['predispatchPolicy'], p.policy())
        self.assertEqual((moves, lans), ([], []))
        routed['currentCensusBefore']['movements'].clear()
        with self.assertRaisesRegex(m.GateError, 'CENSUS_NOT_EXHAUSTIVE'):
            w.validate(plan, routed, closure, m)

    def test_runner_manifest_pins_predispatch_helper_bytes(self):
        runner = load('predispatch_runner_hash_test', ROOT / 'scripts/run-payment-backlog-recovery.py')
        self.assertEqual(runner.code_hashes()['scripts/payment_backlog_predispatch.py'], p.policy()['implementationSha256'])

    def reject(self, mutate, pattern=None):
        plan, proof, closure = fixtures(); mutate(plan, proof, closure)
        with self.assertRaisesRegex(m.GateError, pattern or '.'):
            p.validate(plan, proof, closure, m, w)

    def test_only_exact_legacy_reserved_scope(self):
        for field, value in [('state', {'S': 'CREATING'}), ('pg', {'S': '565060'}), ('protocolVersion', {'N': '2'})]:
            self.reject(lambda plan, proof, closure: plan['expectedRoot'].update({field: value}), 'SCOPE')
        self.reject(lambda plan, proof, closure: plan.update(ticket=226455), 'SCOPE')
        self.reject(lambda plan, proof, closure: plan.update(historicalIdentity={}), 'SCOPE')

    def test_transport_checkpoint_or_later_dispatch_rejected(self):
        for event in ('transport_call_started', 'creating_checkpoint_confirmed'):
            def change(plan, proof, closure):
                e = closure['originalOutcome']; item = {'requestId': p.REQUEST, 'timestamp': p.START+1, 'event': event}
                e['originalEvents'].insert(1, item); e['readbackEvents'] = copy.deepcopy(e['originalEvents'])
            self.reject(change, 'DISPATCH_NOT_EXCLUDED')
        self.reject(lambda plan, proof, closure: closure.update(laterDispatches=1), 'CLOSURE')

    def test_unknown_missing_duplicate_or_own_current_effect_rejected(self):
        self.reject(lambda plan, proof, closure: proof['currentCensusBefore']['movements'].append(copy.deepcopy(proof['currentCensusBefore']['movements'][0])), 'EXHAUSTIVE')
        self.reject(lambda plan, proof, closure: proof['currentCensusBefore']['launches'].pop(), 'EXHAUSTIVE')
        self.reject(lambda plan, proof, closure: proof['currentCensusBefore']['launches'][0].update(IDLAN=999999), 'UNDECLARED')
        self.reject(lambda plan, proof, closure: proof['currentCensusBefore']['movements'][0].update(TICKET='226698'), 'OWN_EFFECT')
        self.reject(lambda plan, proof, closure: proof['currentCensusBefore']['launches'][0].update(ORFAO=1), 'SOURCE_OR_OWN')

    def test_extra_window_effect_cannot_be_hidden_in_current(self):
        self.reject(lambda plan, proof, closure: proof['rows'][0].update(IDMOV=565020), 'UNEXPLAINED_WINDOW')

    def test_original_time_and_source_cannot_be_substituted(self):
        self.reject(lambda plan, proof, closure: closure.update(originalStartMs=p.START+1), 'CLOSURE')
        self.reject(lambda plan, proof, closure: closure.update(coverageComplete=False), 'CLOSURE')
        self.reject(lambda plan, proof, closure: proof.update(currentCensusQuerySha256='0'*64), 'SOURCE')
        self.reject(lambda plan, proof, closure: proof.update(contractsVerified=False), 'SOURCE')
        self.reject(lambda plan, proof, closure: proof['predispatchPolicy'].update(implementationSha256='0'*64), 'SOURCE')

    def test_expired_sources_rejected(self):
        self.reject(lambda plan, proof, closure: proof.update(observedUtc='2000-01-01T00:00:00Z'), 'NOT_FRESH')
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['zeev'].update(observedUtc='2000-01-01T00:00:00Z'), 'NOT_FRESH')

    def test_other_ids_document_values_and_all_children_required(self):
        for field, value in [('idDoMovimento', '999'), ('idDoLancamento', '999'), ('numeroDaNF', '999'), ('valorTotalDoPagamento', '1,00')]:
            self.reject(lambda plan, proof, closure: proof['exclusions'][0]['zeev']['form'].update({field: value}))
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['payments'].clear(), 'FINANCIAL_CHAIN')
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['launches'][0].update(bankId='999'))

    def test_native_audit_absent_allowed_but_present_mismatch_rejected(self):
        plan, proof, closure = fixtures()
        proof['exclusions'][0]['launches'][0]['createdOn'] = proof['exclusions'][0]['movement']['createdOn']
        p.validate(plan, proof, closure, m, w)
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['launches'][0].update(createdOn='2026-11-04T00:00:00.000'))

    def test_only_pinned_one_second_early_modification_allowed(self):
        def alter(plan, proof, closure):
            mov = next(r for r in proof['currentCensusBefore']['movements'] if r['IDMOV'] == 565020)
            chain = next(r for r in proof['exclusions'] if r['declared']['idMov'] == 565020)
            mov['RECMODIFIEDON'] = '2026-11-03T17:28:29'; chain['movement']['modifiedOn'] = '2026-11-03T17:28:29.000'
        self.reject(alter, 'EARLIER_MODIFICATION')
        def other(plan, proof, closure):
            mov = next(r for r in proof['currentCensusBefore']['movements'] if r['IDMOV'] == 565059)
            chain = next(r for r in proof['exclusions'] if r['declared']['idMov'] == 565059)
            mov['RECMODIFIEDON'] = '2026-11-03T17:26:00'; chain['movement']['modifiedOn'] = '2026-11-03T17:26:00.000'
        self.reject(other, 'WAS_MODIFIED')

    def test_ticket_complement_must_remain_immutable(self):
        self.reject(lambda plan, proof, closure: proof['exclusions'][2]['complement'].update(modifiedOn='2026-11-03T11:44:22.000'), 'TICKET_LINK')

    def test_other_ticket_global_census_must_have_exact_only_child(self):
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['ticketLookup'][0].update(TOTAL_LAUNCHES=2), 'LOOKUP_INCOMPLETE')
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['ticketLookup'][1].update(IDLAN=999999), 'CHILDREN_CHANGED')
        self.reject(lambda plan, proof, closure: proof['exclusions'][0]['ticketLookup'][1].update(CODCOLIGADA=9), 'LOOKUP_INCOMPLETE')

    def test_registered_query_change_blocks_before_candidate_reads(self):
        plan, proof, closure = fixtures(); observer = FakeObserver(proof); observer.broken_contract = True
        with self.assertRaisesRegex(m.GateError, 'REGISTERED_QUERY'):
            p.collect(observer, plan, closure, proof['currentCensusBefore']['movements'], proof['currentCensusBefore']['launches'], m, o.unique, o.records, w)
        self.assertFalse(any(call[0] == 'FinLanDataBR' for call in observer.calls))


if __name__ == '__main__':
    unittest.main()
