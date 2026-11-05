"""226698 only: prove pre-dispatch closure and every fixed other-ticket chain.

The original creation windows never change. Three additional, positively owned
chains explain the broader current supplier/date census. No financial writes,
historical-intention inference, arbitrary candidates or native timestamp fill.
"""
import copy
import datetime as dt
import hashlib
from pathlib import Path
import re

TICKET = 226698
COMPANY = 8
REQUEST = '02598a6b-8a26-496e-bb72-e64cd4ae37d7'
START = 1793737708490
END = 1793737715146
WINDOW = [
    {'company': 8, 'idMov': 565060, 'ticket': 226724, 'idLans': [870771]},
    {'company': 8, 'idMov': 565061, 'ticket': 226695, 'idLans': [870772]},
]
OUTSIDE = [
    {'company': 8, 'idMov': 565020, 'ticket': 226690, 'idLans': [870502]},
    {'company': 8, 'idMov': 565059, 'ticket': 226745, 'idLans': [870770]},
    {'company': 8, 'idMov': 565836, 'ticket': 226692, 'idLans': [871417]},
]
ALL = WINDOW + OUTSIDE


def applies(plan):
    return plan.get('company') == COMPANY and plan.get('ticket') == TICKET


def policy():
    return {'version': 1, 'contract': '226698-predispatch-positive-census-v1',
            'implementationSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'windowExclusions': copy.deepcopy(WINDOW), 'currentOutsideExclusions': copy.deepcopy(OUTSIDE)}


def census_sha():
    text = (Path(__file__).resolve().parents[1] / 'sql/pagamento-censo-operacional.sql').read_text(encoding='utf-8-sig').strip()
    return hashlib.sha256(text.encode()).hexdigest()


def retry_sha():
    text = (Path(__file__).resolve().parents[1] / 'sql/pagamento-retomada.sql').read_text(encoding='utf-8-sig').strip()
    return hashlib.sha256(text.encode()).hexdigest()


def scope(plan, closure, m, base):
    root = plan.get('expectedRoot', {})
    m.require(applies(plan) and plan.get('action') == 'RESERVE_NEW' and 'historicalIdentity' not in plan and
              root.get('pk') == {'S': 'prod#PG#8#226698'} and root.get('state') == {'S': 'RESERVED'} and
              'pg' not in root and 'protocolVersion' not in root, 'PREDISPATCH_SCOPE_INVALID')
    m.fresh(closure.get('observedUtc'))
    m.require(closure.get('originalRequestId') == REQUEST and closure.get('originalStartMs') == START and
              closure.get('originalEndMs') == closure.get('originalReportMs') == END and
              closure.get('originalRootSha256') == m.sha(root) and closure.get('endSeen') is True and
              closure.get('reportSeen') is True and closure.get('coverageComplete') is True and
              type(closure.get('laterDispatches')) is int and closure['laterDispatches'] == 0 and
              isinstance(closure.get('logSourceSha256'), str) and re.fullmatch(m.HEX, closure['logSourceSha256']),
              'PREDISPATCH_CLOSURE_NOT_PROVEN')
    base.validate_original(plan, closure, closure.get('originalOutcome', {}), m)


def ids(rows, field):
    return {(row['CODCOLIGADA'], row[field]) for row in rows}


def declared_ids(declarations, launch=False):
    return {(row['company'], lan) for row in declarations for lan in row['idLans']} if launch else {
        (row['company'], row['idMov']) for row in declarations}


def current_rows(current, m):
    m.require(isinstance(current, dict) and set(current) == {'movements', 'launches'}, 'PREDISPATCH_CURRENT_CENSUS_MISSING')
    moves, lans = current['movements'], current['launches']
    m.require(isinstance(moves, list) and isinstance(lans, list) and len(moves) == len(lans) == 5,
              'PREDISPATCH_CENSUS_NOT_EXHAUSTIVE')
    m.require(ids(moves, 'IDMOV') == declared_ids(ALL) and ids(lans, 'IDLAN') == declared_ids(ALL, True),
              'PREDISPATCH_UNDECLARED_CURRENT_EFFECT')
    for kind, rows in [('MOV', moves), ('LAN', lans)]:
        for row in rows:
            m.require(row.get('ROW_KIND') == kind and row.get('CODCOLIGADA') == COMPANY and row.get('ORFAO') == 0 and
                      row.get('OBS_VERSION') == 1 and row.get('REQUEST_COMPANY') == COMPANY and
                      row.get('REQUEST_TICKET') == str(TICKET) and row.get('TOTAL_MOVEMENTS') == 5 and
                      row.get('TOTAL_LAUNCHES') == 5 and str(row.get('TICKET')) != str(TICKET),
                      'PREDISPATCH_CURRENT_SOURCE_OR_OWN_EFFECT')
            declaration = next((d for d in ALL if row.get('IDMOV') == d['idMov']), None)
            m.require(declaration is not None and str(row.get('TICKET')) == str(declaration['ticket']) and
                      (kind == 'MOV' or row['IDLAN'] in declaration['idLans']), 'PREDISPATCH_CHILD_OR_OWNER_MISMATCH')
    return moves, lans


def validate_chain(proof, declared, movement, children, closure, m, base, inside):
    m.fresh(proof.get('observedUtc'))
    m.require(proof.get('declared') == declared, 'PREDISPATCH_DECLARATION_CHANGED')
    lookup = proof.get('ticketLookup')
    m.require(isinstance(lookup, list) and len(lookup) == 1+len(declared['idLans']) and all(
        row.get('RETOMADA_VERSION') == 1 and row.get('REQUEST_COMPANY') == declared['company'] and
        row.get('REQUEST_TICKET') == str(declared['ticket']) and row.get('TOTAL_MOVEMENTS') == 1 and
        row.get('TOTAL_LAUNCHES') == len(declared['idLans']) and row.get('CODCOLIGADA') == declared['company'] and
        row.get('IDMOV') == declared['idMov'] for row in lookup), 'PREDISPATCH_OTHER_TICKET_LOOKUP_INCOMPLETE')
    m.require([row.get('ROW_KIND') for row in lookup].count('MOV') == 1 and
        sorted(row.get('IDLAN') for row in lookup if row.get('ROW_KIND') == 'LAN') == sorted(declared['idLans']) and
        all(row.get('ROW_KIND') in ('MOV', 'LAN') for row in lookup), 'PREDISPATCH_OTHER_TICKET_CHILDREN_CHANGED')
    expected = base.canonical_movement(movement, m)
    m.require(proof.get('movement') == expected and expected['company'] == str(declared['company']) and
              expected['idMov'] == str(declared['idMov']) and expected['ticket'] == str(declared['ticket']),
              'PREDISPATCH_MOVEMENT_MISMATCH')
    created = dt.datetime.fromisoformat(expected['createdOn'])
    modified = dt.datetime.fromisoformat(expected['modifiedOn'])
    start = dt.datetime.fromisoformat(base.epoch_stamp(closure['originalStartMs']))
    end = dt.datetime.fromisoformat(base.epoch_stamp(closure['originalReportMs']))
    intervals = [(start-dt.timedelta(seconds=120), end+dt.timedelta(seconds=120)),
                 (start-dt.timedelta(hours=3, seconds=120), end-dt.timedelta(hours=3)+dt.timedelta(seconds=120))]
    m.require(any(lower <= created <= upper for lower, upper in intervals) == inside,
              'PREDISPATCH_CANDIDATE_WINDOW_CLASSIFICATION_CHANGED')
    if declared['idMov'] == 565020:
        m.require(expected['createdOn'] == '2026-11-03T11:44:21.000' and
                  expected['modifiedOn'] == '2026-11-03T11:44:22.000' and
                  modified-created == dt.timedelta(seconds=1) and created <= modified < start-dt.timedelta(hours=3) and
                  modified < start, 'PREDISPATCH_EARLIER_MODIFICATION_NOT_PROVEN')
    else:
        m.require(created == modified, 'PREDISPATCH_OTHER_MOVEMENT_WAS_MODIFIED')
    complement = proof.get('complement', {})
    m.require(complement == {'company': expected['company'], 'idMov': expected['idMov'], 'ticket': expected['ticket'],
                            'createdOn': expected['createdOn'], 'modifiedOn': expected['createdOn']},
              'PREDISPATCH_TICKET_LINK_WAS_MODIFIED')
    if inside:
        m.require(base.stamp(movement.get('COMPLEMENT_CREATED'), m) == complement['createdOn'] and
                  base.stamp(movement.get('COMPLEMENT_MODIFIED'), m) == complement['modifiedOn'],
                  'PREDISPATCH_WINDOW_COMPLEMENT_MISMATCH')
    normalized = sorted([base.canonical_launch(row, m) for row in children], key=lambda row: int(row['idLan']))
    m.require([int(row['idLan']) for row in normalized] == sorted(declared['idLans']), 'PREDISPATCH_CHILD_IDS_CHANGED')
    base.validate_native_launches(normalized, proof.get('launches'), m)
    expected_payments = [{k: row[k] for k in ('company', 'idMov', 'idLan', 'dueDate', 'amount')} for row in normalized]
    m.require(proof.get('payments') == expected_payments and all(
        row['ticket'] == expected['ticket'] and row['company'] == expected['company'] and row['idMov'] == expected['idMov'] and
        all(row[k] == expected[k] for k in ('branch', 'supplierCompany', 'supplier', 'issueDate')) for row in normalized),
        'PREDISPATCH_FINANCIAL_CHAIN_MISMATCH')
    z = proof.get('zeev', {}); m.fresh(z.get('observedUtc')); form = z.get('form', {})
    m.require(z.get('ticket') == declared['ticket'] and z.get('flowId') == 299 and z.get('active') is True and
              set(form) <= set(base.OTHER_FIELDS), 'PREDISPATCH_OTHER_ZEEV_CONTEXT_INVALID')
    m.require(len(normalized) == 1 and str(form.get('idDoMovimento')) == expected['idMov'] and
              str(form.get('idDoLancamento')) == normalized[0]['idLan'] and
              str(form.get('codigoDaColigada2')) == expected['company'] and str(form.get('codigoDaFilial2')) == expected['branch'] and
              form.get('codigoDoFornecedor') == expected['supplier'] and base.other_movement_type(form, m) == expected['movementType'],
              'PREDISPATCH_OTHER_ZEEV_LINK_MISMATCH')
    number = form.get('numeroDaNF', '')
    m.require(re.fullmatch(r'\d{1,35}', number) and re.fullmatch(r'\d{1,35}', expected['number']) and int(number) == int(expected['number']) and
              (not form.get('serieDaNF') or form['serieDaNF'] == expected['series']) and
              base.date(form.get('dataDeEmissao'), m) == expected['issueDate'] and
              (not form.get('dataDeEntrada') or base.date(form['dataDeEntrada'], m) == expected['entryDate']) and
              base.amount(form.get('valorTotalDoPagamento'), m) == expected['gross'] == expected['total'] == normalized[0]['amount'] and
              base.date(form.get('dataDeVencimento'), m) == normalized[0]['dueDate'], 'PREDISPATCH_OTHER_DOCUMENT_OR_VALUE_MISMATCH')


def validate(plan, proof, closure, m, base):
    scope(plan, closure, m, base); m.fresh(proof.get('observedUtc'))
    m.require(proof.get('predispatchPolicy') == policy() and proof.get('querySha256') == base.query_sha() and
              proof.get('currentCensusQuerySha256') == census_sha() and proof.get('ticketLookupQuerySha256') == retry_sha() and proof.get('complete') is True and
              proof.get('committedRead') is True and proof.get('contractsVerified') is True, 'PREDISPATCH_SOURCE_NOT_PROVEN')
    wm, wl = base.window_rows(proof.get('rows'), plan, closure, m)
    m.require(ids(wm, 'IDMOV') == declared_ids(WINDOW) and ids(wl, 'IDLAN') == declared_ids(WINDOW, True),
              'PREDISPATCH_UNEXPLAINED_WINDOW_EFFECT')
    cm, cl = current_rows(proof.get('currentCensusBefore'), m)
    chains = proof.get('exclusions')
    m.require(isinstance(chains, list) and len(chains) == len(ALL), 'PREDISPATCH_CHAIN_COUNT_INVALID')
    for declaration in ALL:
        selected = [p for p in chains if p.get('declared') == declaration]
        m.require(len(selected) == 1, 'PREDISPATCH_CHAIN_NOT_UNIQUE')
        current_mov = next(row for row in cm if row['IDMOV'] == declaration['idMov'])
        current_lan = [row for row in cl if row['IDMOV'] == declaration['idMov']]
        inside = declaration in WINDOW
        if inside:
            mov = next(row for row in wm if row['IDMOV'] == declaration['idMov'])
            children = [row for row in wl if row['IDMOV'] == declaration['idMov']]
            m.require(base.canonical_movement(mov, m) == base.canonical_movement(current_mov, m) and
                      sorted([base.canonical_launch(r, m) for r in children], key=lambda r: r['idLan']) ==
                      sorted([base.canonical_launch(r, m) for r in current_lan], key=lambda r: r['idLan']),
                      'PREDISPATCH_CURRENT_WINDOW_DISAGREE')
        else:
            mov, children = current_mov, current_lan
        validate_chain(selected[0], declaration, mov, children, closure, m, base, inside)
    return declared_ids(ALL), declared_ids(ALL, True)


def collect(obs, plan, closure, current_mov, current_lan, m, unique, records, base):
    scope(plan, closure, m, base)
    observed = m.utc()
    current = {'movements': copy.deepcopy(current_mov), 'launches': copy.deepcopy(current_lan)}
    current_rows(current, m)
    for code, filename in [('RAIZ.PG.WINDOW', 'pagamento-janela-criacao.sql'), ('RAIZ.PG.CENSO', 'pagamento-censo-operacional.sql'),
                           ('RAIZ.PG.RETRY', 'pagamento-retomada.sql')]:
        contract = unique(obs.read_record('GlbConsSQLData', '0;T;' + code, 0), 'GConsSql')
        wanted = (Path(__file__).resolve().parents[1] / 'sql' / filename).read_text(encoding='utf-8-sig').strip()
        actual = str(contract.get('SENTENCA', '')).replace('\r\n', '\n').replace('\r', '\n').strip()
        m.require(actual == wanted, 'PREDISPATCH_REGISTERED_QUERY_CHANGED')
    params = {'CODCOLIGADA': '8', 'TICKET': str(TICKET), 'INICIOUTC': base.epoch_stamp(START), 'FIMUTC': base.epoch_stamp(END)}
    rows = obs.query('RAIZ.PG.WINDOW', params)
    wm, wl = base.window_rows(rows, plan, closure, m)
    m.require(ids(wm, 'IDMOV') == declared_ids(WINDOW) and ids(wl, 'IDLAN') == declared_ids(WINDOW, True),
              'PREDISPATCH_UNEXPLAINED_WINDOW_EFFECT')
    chains = []
    for declaration in ALL:
        mov = declaration['idMov']
        ticket_lookup = obs.query('RAIZ.PG.RETRY', {'CODCOLIGADA': '8', 'TICKET': str(declaration['ticket'])})
        dataset = obs.read_record('MovMovimentoTBCData', f'8;{mov}', 8)
        header, complement = unique(dataset, 'TMOV'), unique(dataset, 'TMOVCOMPL')
        native_lan = []
        for lan in declaration['idLans']:
            record = unique(obs.read_record('FinLanDataBR', f'8;{lan}', 8), 'FLAN')
            # Keep genuinely omitted audit keys omitted; base records None for
            # that case and rejects present-but-empty audit elements.
            native_lan.append(base.canonical_launch({**record, 'TICKET': complement.get('TICKET')}, m, True))
        payments = sorted([{'company': m.identifier(r['CODCOLIGADA']), 'idMov': m.identifier(r['IDMOV']),
            'idLan': m.identifier(r['IDLAN']), 'dueDate': base.date(r['DATAVENCIMENTO'], m), 'amount': base.amount(r['VALOR'], m)}
            for r in records(dataset, 'TMOVPAGTO')], key=lambda r: int(r['idLan']))
        child = type(obs).__new__(type(obs)); child.plan = {'ticket': declaration['ticket']}
        child.zeev_token, child.opener = obs.zeev_token, obs.opener
        form, form_time = child.zeev_snapshot(base.OTHER_FIELDS)
        chains.append({'observedUtc': m.utc(), 'declared': copy.deepcopy(declaration), 'ticketLookup': ticket_lookup,
            'movement': base.canonical_movement({**header, 'TICKET': complement.get('TICKET')}, m, True),
            'complement': {'company': m.identifier(complement.get('CODCOLIGADA')), 'idMov': m.identifier(complement.get('IDMOV')),
                'ticket': complement.get('TICKET'), 'createdOn': base.stamp(complement.get('RECCREATEDON'), m),
                'modifiedOn': base.stamp(complement.get('RECMODIFIEDON'), m)},
            'launches': native_lan, 'payments': payments, 'zeev': base.other_zeev(form, form_time, m)})
    proof = {'observedUtc': observed, 'predispatchPolicy': policy(), 'querySha256': base.query_sha(),
             'currentCensusQuerySha256': census_sha(), 'ticketLookupQuerySha256': retry_sha(),
             'contractsVerified': True, 'complete': True, 'committedRead': True,
             'rows': rows, 'exclusions': chains, 'currentCensusBefore': current}
    validate(plan, proof, closure, m, base)
    return proof, [], []
