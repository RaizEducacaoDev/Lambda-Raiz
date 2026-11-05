"""Publish corrected-form retry; never invoke a real financial ticket."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('scoped_release', Path(__file__).with_name('release-native-duplication.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.m.OUT = Path('.payment-form-retry-release')
r.BASE_REF = 'c21a97afcffa0ee0298677d7fa435e55a427c6be'
r.BASE_SHA = 'YL4vIKotm0GuMQC1sMC8ellzldxJgi7tu9rT9m8EO2Q='
r.BASE_BUNDLE_SHA = base64.b64encode(bytes.fromhex('412b70886137fc0c8f3c9bba3fe8f25d1b48fa58f603f023c4fca27ae1d9358b')).decode()
r.BASE_REVISION = '1e5b7eb2-1e94-4706-981c-466734da49d7'
r.SOURCES = ['src/functions/rm/post/pagamentoV2Idempotencia.ts',
             'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']


def validate_candidate(bundle):
    repository = r.module(bundle, r.SOURCES[0])
    service = r.module(bundle, r.SOURCES[1])
    assert b'Ticket reservado com dados diferentes' not in repository
    assert b'async encerrarRejeicao(' in repository
    for condition in [b'#state = :creating', b'#owner = :owner', b'digest = :digest',
                      b'lockUntil = :until', b'attribute_not_exists(pg)', b'attribute_not_exists(continuation)']:
        assert condition in repository
    assert b'entrada.idDoMovimento || entrada.movimentoExistente' not in service
    assert b'await consultarPagamentoExistente(' in service
    assert b'const aposRejeicao = await rm.consultarRetomada(' in service
    assert b'!aposRejeicao.movimentos.length && !aposRejeicao.lancamentos.length' in service
    assert service.index(b'const aposRejeicao = ') < service.index(b'await repo.encerrarRejeicao(')
    assert b'if (!match && rejeicaoNegocio)' in service
    for call in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(',
                 b'.conferirEnvioProprio(', b'validarFilialBancaria(dado, filial)']:
        assert call in service
    assert all(q not in service for q in [b'.consultarDocumento(', b'.buscarMovimentosPorTicket('])


r.validate_candidate = validate_candidate


def prepare():
    changed = subprocess.check_output(['git', 'diff', r.BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == r.SOURCES, 'Unexpected runtime source changes'
    candidates = {name: Path(name).read_bytes() for name in r.SOURCES}
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        for name in r.SOURCES:
            Path(name).write_bytes(subprocess.check_output(['git', 'show', r.BASE_REF + ':' + name]))
        subprocess.run([npm, 'run', 'build:pagamento'], check=True)
        before = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        for name, data in candidates.items():
            Path(name).write_bytes(data)
    subprocess.run([npm, 'run', 'build:pagamento'], check=True)
    after = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    Path('.build/native-before.cjs').write_bytes(before)
    Path('.build/native-after.cjs').write_bytes(after)
    assert r.m.sha(before) == r.BASE_BUNDLE_SHA, 'Compiled baseline differs from active wrapper'
    assert r.patch(before, before, after) == after
    print(json.dumps({'prepared': True, 'activeBaselineVerified': True, 'changedSources': r.SOURCES}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'release', 'readback', 'monitor'])
    parser.add_argument('--evidence', default=str(r.m.OUT))
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare()
    elif args.mode == 'release':
        r.release()
    else:
        r.readback(args.evidence, args.mode == 'monitor')
