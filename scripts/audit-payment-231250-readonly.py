"""One-off exact-ticket AWS reads. No Lambda invocation or resource writes."""
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time

spec = importlib.util.spec_from_file_location('audit_base', Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
a.PK = 'prod#PG#1#231250'
a.CODTMV = '1.2.16'
a.NUMBERS.update({'necessarioMs', 'disponivelMs'})
a.ERROR_TYPES.add('PrazoPagamentoInsuficiente')
a.ENUMS.update({
    'code': {'PRAZO_INTEGRACAO_INSUFICIENTE', 'IDPGTO_NAO_CONFIRMADO', 'OPERACAO_EM_PROCESSAMENTO', 'OPERACAO_EM_CONFLITO', 'DADOS_SOLICITACAO_ALTERADOS', 'MOVIMENTO_RESERVA_DIVERGENTE', 'ESTADO_TENTATIVA_INVALIDO', 'DADOS_MOVIMENTO_DIVERGENTES', 'FALHA_INTEGRACAO_PAGAMENTO', 'RESPOSTA_TOTVS_INVALIDA', 'COMUNICACAO_NAO_CONFIRMADA', 'FALHA_COMUNICACAO_TOTVS'},
    'reason': {'PRAZO_INSUFICIENTE', 'OPERACAO_EM_PROCESSAMENTO', 'OPERACAO_EM_CONFLITO', 'DADOS_SOLICITACAO_ALTERADOS', 'MOVIMENTO_RESERVA_DIVERGENTE', 'ESTADO_TENTATIVA_INVALIDO', 'DADOS_MOVIMENTO_DIVERGENTES', 'FALHA_TECNICA', 'RESPOSTA_RM_INVALIDA', 'TIMEOUT_OU_CANCELAMENTO', 'FALHA_COMUNICACAO', 'CONCORRENCIA_DETECTADA'},
    'origem': {'INTEGRACAO', 'TOTVS', 'FORMULARIO'},
    'efeito': {'MOVIMENTO_CONFIRMADO', 'CRIACAO_NAO_CONFIRMADA', 'SEM_MOVIMENTO_CONFIRMADO'},
    'etapa': {'inicio', 'identidade_bancaria', 'validacao_solicitacao', 'consulta_existente', 'validacao_bancaria', 'validacao_documento', 'validacao_fiscal', 'controle_tentativa', 'criacao_movimento', 'controle_criacao', 'leitura_movimento', 'leitura_lancamento', 'preparacao_vinculo', 'gravacao_vinculo', 'confirmacao_vinculo', 'confirmacao_final'},
})


def reservation(pk, deadline):
    assert pk in {a.PK, a.PK + '#FLAN#70223'}
    item = a.aws('dynamodb', 'get-item', '--table-name', a.TABLE, '--consistent-read',
                 '--key', json.dumps({'pk': {'S': pk}}), deadline=deadline).get('Item', {})
    safe = {'exists': bool(item), 'key': pk}
    for k, t, pattern in [('state', 'S', r'RESERVED|CREATING|CREATED|UPDATING|COMPLETE'),
                           ('pg', 'S', r'\d+'), ('lockUntil', 'N', r'\d+'), ('protocolVersion', 'N', r'2')]:
        value = item.get(k, {}).get(t)
        if value is not None:
            assert re.fullmatch(pattern, value)
            safe[k] = value
    raw = item.get('continuation', {}).get('S')
    safe['hasContinuation'] = raw is not None
    if raw:
        c = json.loads(raw)
        safe['receiptMovement'] = c.get('receipt', {}).get('pg')
        safe['hasBaseline'] = bool(c.get('baseline'))
        progress = c.get('progress', {})
        assert all(re.fullmatch(r'\d+', k) and v in {'PREPARED', 'UPDATING', 'COMPLETE'} for k, v in progress.items())
        safe['progress'] = progress
        safe['baselineHashes'] = c.get('baseline')
        assert safe['baselineHashes'] is None or re.fullmatch(r'[a-f0-9]{64}', safe['baselineHashes'].get('movementHash', ''))
    return safe


def main():
    deadline = time.monotonic() + 210
    assert a.aws('sts', 'get-caller-identity', deadline=deadline)['Account'] == a.ACCOUNT
    cfg = a.aws('lambda', 'get-function-configuration', '--function-name', a.FUNCTION, deadline=deadline)
    assert cfg['FunctionName'] == a.FUNCTION
    out = {'observedUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'readOnly': True,
           'ticket': 231250, 'company': 1, 'branch': 1, 'movement': 45423, 'entry': 70223,
           'lambdaInvocations': False, 'businessWrites': False, 'awsWrites': False,
           'function': {k: cfg.get(k) for k in ['FunctionName', 'CodeSha256', 'RevisionId', 'LastModified', 'Timeout', 'State', 'LastUpdateStatus']},
           'before': [reservation(pk, deadline) for pk in [a.PK, a.PK + '#FLAN#70223']], 'requests': []}
    start = int(dt.datetime(2026, 11, 9, 18, 40, tzinfo=dt.timezone.utc).timestamp()*1000)
    end = int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
    events, cov = a.read_log_window('"231250"', start, end, deadline)
    out['ticketCoverage'] = cov
    requests = {}
    for e in events:
        _, request = a.unwrap(e)
        if request:
            requests.setdefault(request, []).append(e['timestamp'])
    assert 0 < len(requests) <= 25
    for request, times in requests.items():
        full, coverage = a.read_log_window('"'+request+'"', min(times)-60000, max(times)+60000, deadline)
        safe = [row for e in full if (row := a.sanitize(e)) is not None]
        out['requests'].append({'requestId': request, 'coverage': coverage, 'events': safe})
    out['after'] = [reservation(pk, deadline) for pk in [a.PK, a.PK + '#FLAN#70223']]
    out['reservationUnchanged'] = out['before'] == out['after']
    out['coverageComplete'] = cov['complete'] and all(r['coverage']['complete'] for r in out['requests'])
    assert out['coverageComplete']
    p = Path('.audit231250')
    p.mkdir(exist_ok=True)
    (p/'aws-readonly.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(json.dumps({'readOnly': True, 'requestCount': len(requests), 'coverageComplete': True, 'reservationUnchanged': out['reservationUnchanged']}))


if __name__ == '__main__':
    main()
