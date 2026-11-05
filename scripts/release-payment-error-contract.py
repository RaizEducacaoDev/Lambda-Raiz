"""Scoped error-presentation release. No financial ticket invocation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec = importlib.util.spec_from_file_location('scoped_release', Path(__file__).with_name('release-payment-contract-incident.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.m.OUT = Path('.payment-error-contract-release')
r.BASE_REF = 'a461014189395304d6e5dbb17a67323764e77699'
r.BASE_SHA = '6WqYDSPH1gAoYgzxtFOtWJtieNGivE660r4TegykP/w='
r.BASE_BUNDLE_SHA = 'ZlDMRiERZPJRmb1g1hF9idJ39XFRuv52LM/g/Cp0AwU='
r.BASE_REVISION = '1b73895d-1b5c-4b1f-8d19-6f4d351bcac0'
r.SOURCES = ['src/functions/rm/post/pagamentoResposta.ts',
             'src/functions/rm/post/pagamentoV2Idempotencia.ts',
             'src/functions/rm/post/pagamentoV2Rm.ts',
             'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
NEW_SOURCE = r.SOURCES[0]
r.MODULE_COUNTS = dict(zip(r.SOURCES, [1, 2, 1, 1]))


def outside(bundle):
    markers = list(re.finditer(rb'(?m)^// src/[^\r\n]+\n', bundle))
    intervals = [(match.start(), markers[i+1].start() if i+1 < len(markers) else len(bundle))
                 for i, match in enumerate(markers) if match.group()[3:-1].decode() in r.SOURCES]
    for start, end in reversed(intervals):
        bundle = bundle[:start] + bundle[end:]
    return bundle


def validate_candidate(bundle):
    parts = r.chunks(bundle)
    policy, repository, transport, service = [b'\x00'.join(part[2] for part in parts[name]) for name in r.SOURCES]
    assert b'function respostaErroPagamento(' in policy and b'status = 400' in policy
    for marker in [b'PRAZO_INTEGRACAO_INSUFICIENTE', b'RESPOSTA_TOTVS_INVALIDA', b'MOVIMENTO_CONFIRMADO',
                   b'FORMULARIO', b'INTEGRACAO', b'OPERACAO_EM_PROCESSAMENTO']:
        assert marker in policy
    assert b'PRAZO_INSUFICIENTE' in transport and b'new PrazoPagamentoInsuficiente(' in transport
    assert b'OPERACAO_EM_PROCESSAMENTO' in repository and b'ESTADO_TENTATIVA_INVALIDO' in repository
    assert b'respostaErroPagamento({' in service and b'...resposta.log' in service
    assert b'pgConfirmado: movimentoConfirmado' in service and b'...resposta.body' not in service
    assert b'formatResponse(resposta.status, resposta.body)' in service
    # This release changes diagnosis/presentation, never budgets or financial XML.
    assert b'propria ? 17e3 : 11e3' in service
    for marker in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(',
                   b'.conferirEnvioProprio(', b'await consultarPagamentoExistente(', b'.encerrarRejeicao(']:
        assert marker in service
    assert all(marker not in service for marker in [b'.consultarDocumento(', b'.buscarMovimentosPorTicket('])


def patch(active, before, after):
    assert active == before and r.m.sha(before) == r.BASE_BUNDLE_SHA, 'Active wrapper or source baseline drift'
    assert before != after and outside(before) == outside(after), 'Change outside reviewed error modules'
    validate_candidate(after)
    return after


r.validate_candidate = validate_candidate
r.patch = patch
r.outside = outside


def prepare():
    changed = subprocess.check_output(['git', 'diff', r.BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == r.SOURCES, 'Unexpected runtime source changes'
    old_sources = [name for name in r.SOURCES if name != NEW_SOURCE]
    candidates = {name:Path(name).read_bytes() for name in old_sources}
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        for name in old_sources:
            Path(name).write_bytes(subprocess.check_output(['git','show',r.BASE_REF+':'+name]))
        subprocess.run([npm,'run','build:pagamento'],check=True)
        before = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        for name,data in candidates.items():
            Path(name).write_bytes(data)
    subprocess.run([npm,'run','build:pagamento'],check=True)
    after = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    patch(before,before,after)
    Path('.build/contract-before.cjs').write_bytes(before)
    Path('.build/contract-after.cjs').write_bytes(after)
    print(json.dumps({'prepared':True,'baselineVerified':True,'onlyErrorModulesChanged':True,
                      'budgetsUnchanged':True,'financialTicketInvocations':False}))


def release():
    assert os.environ.get('GITHUB_EVENT_NAME') == 'push'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/fix/payment-error-contract-baseline-20261105'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'Never rerun publication automatically'
    r.release(expected_ref='refs/heads/fix/payment-error-contract-baseline-20261105')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['prepare','release','readback','monitor'])
    parser.add_argument('--evidence',default=str(r.m.OUT))
    args=parser.parse_args()
    if args.mode=='prepare':prepare()
    elif args.mode=='release':release()
    else:r.readback(args.evidence,args.mode=='monitor')
