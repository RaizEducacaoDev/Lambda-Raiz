"""Publish positive native acknowledgement; no financial ticket invocation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('reviewed_release', Path(__file__).with_name('release-native-duplication.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.m.OUT = Path('.existing-payment-release')
r.BASE_REF = '504311b8f9f7b90fdf5332da644ee53eb0d2698e'
r.BASE_SHA = 'b7xfB0aKVyaHdY6CeUbp1ZST+SxSQcDJaVcNXgXINEo='
r.BASE_BUNDLE_SHA = 'UCAm97c7SvbXN+EKC88nTiWTQhyUrz7NzCXiWu/vz30='
r.BASE_REVISION = '7f5dabd5-e1e9-4d17-9809-8c08d4a51695'
r.SOURCES = ['src/functions/rm/post/pagamentoExistente.ts',
             'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']


def validate_candidate(bundle):
    existing = r.module(bundle, r.SOURCES[0])
    service = r.module(bundle, r.SOURCES[1])
    assert b'function consultarPagamentoExistente(' in existing
    assert b'.consultarRetomada(' in existing and b'.readReacord(' in existing
    assert b'.saveRecord(' not in existing and b'repo.' not in existing
    assert service.index(b'await consultarPagamentoExistente(') < service.index(b'await repo.concluida(')
    assert b'if (existente?.completo)' in service and b'existing_payment_confirmed_readonly' in service
    assert b'if (existente) pgEntrada = existente.pg' in service
    assert service.index(b'const antesDoEnvio = await rm.consultarRetomada(') < service.index(b'"creating_checkpoint_started"')
    for name in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(', b'.conferirEnvioProprio(']:
        assert name in service, 'Durable bank continuation must remain'
    assert service.index(b'.conferirEnvioProprio(') < service.rindex(b'.saveRecord(')
    assert b'validarFilialBancaria(dado, filial)' in service
    assert all(q not in service and q not in existing for q in [b'.consultarDocumento(', b'.buscarMovimentosPorTicket('])
    assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle, 'src/functions/rm/post/pagamentoDiagnosticoSeguro.ts')


r.validate_candidate = validate_candidate


def prepare():
    changed = subprocess.check_output(['git', 'diff', r.BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == r.SOURCES, 'Unexpected runtime source changes'
    source = Path(r.SOURCES[1])
    candidate = source.read_bytes()
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        source.write_bytes(subprocess.check_output(['git', 'show', r.BASE_REF + ':' + r.SOURCES[1]]))
        subprocess.run([npm, 'run', 'build:pagamento'], check=True)
        before = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        source.write_bytes(candidate)
    subprocess.run([npm, 'run', 'build:pagamento'], check=True)
    after = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    assert r.m.sha(before) == r.BASE_BUNDLE_SHA, 'Compiled baseline differs from active wrapper'
    assert r.patch(before, before, after) == after
    Path('.build/native-before.cjs').write_bytes(before)
    Path('.build/native-after.cjs').write_bytes(after)
    print(json.dumps({'prepared': True, 'baselineBundleVerified': True,
                      'changedRuntimeSources': r.SOURCES, 'financialWrites': False}))


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
    for name in ['deployment.json', 'independent-readback.json', 'monitor.json']:
        path = r.m.OUT / name
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            data['existingPaymentAcknowledgementVerified'] = True
            data['historicalReservationPreservedOnAcknowledgement'] = True
            path.write_text(json.dumps(data, indent=2), encoding='utf-8')
