"""Publish durable bank continuation while preserving the active branch preflight."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('reviewed_release', Path(__file__).with_name('release-native-duplication.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.m.OUT = Path('.payment-bank-continuation-release')
r.BASE_REF = '7808cc0172255508a92bb04d2ecb33c22985f023'
r.BASE_SHA = 'fATe4oapr4+C+6Lr1+HA34HKv2WxORkfpp4F70uv5Xw='
r.BASE_BUNDLE_SHA = 'nZPA6oDNK2MVX+rOkkxE0lhsXdGEuuIn+a7kVZvAk0g='
r.BASE_REVISION = 'a6054569-cbeb-4dd5-a78d-2636e9f1b8d2'
r.SOURCES = ['src/functions/rm/post/pagamentoContinuacao.ts',
             'src/functions/rm/post/pagamentoV2Idempotencia.ts',
             'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
EXISTING_SOURCES = r.SOURCES[1:]


def validate_candidate(bundle):
    continuation = r.module(bundle, r.SOURCES[0])
    repository = r.module(bundle, r.SOURCES[1])
    service = r.module(bundle, r.SOURCES[2])
    assert b'function validarContinuacao(' in continuation and b'function baselineParcela(' in continuation
    for name in [b'confirmarCriacaoPropria(', b'selarBaseline(', b'avancarParcelaPropria(', b'conferirEnvioProprio(']:
        assert name in repository and b'.' + name in service, 'Durable continuation is not connected to the real handler'
    assert service.index(b'.conferirEnvioProprio(') < service.rindex(b'.saveRecord(')
    assert b'validarFilialBancaria(dado, filial)' in service
    assert all(query not in service for query in
               [b'.consultarDocumento(', b'.consultarRetomada(', b'.buscarMovimentosPorTicket('])
    assert b'primary_key_received' in service and b'.corrigirReserva(' in service
    assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle, 'src/functions/rm/post/pagamentoDiagnosticoSeguro.ts')
    assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle, 'src/functions/rm/post/pagamentoEvidencia.ts')


r.validate_candidate = validate_candidate


def prepare():
    changed = subprocess.check_output(['git', 'diff', r.BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == r.SOURCES, 'Unexpected runtime source changes'
    candidates = {source: Path(source).read_bytes() for source in EXISTING_SOURCES}
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        for source in EXISTING_SOURCES:
            Path(source).write_bytes(subprocess.check_output(['git', 'show', r.BASE_REF + ':' + source]))
        # The new module is not imported by the baseline. Its presence on disk
        # cannot bypass the exact compiled baseline hash checked below.
        subprocess.run([npm, 'run', 'build:pagamento'], check=True)
        before = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        for source, data in candidates.items():
            Path(source).write_bytes(data)
    subprocess.run([npm, 'run', 'build:pagamento'], check=True)
    after = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    assert r.m.sha(before) == r.BASE_BUNDLE_SHA, 'Compiled baseline differs from active wrapper'
    assert r.patch(before, before, after) == after
    Path('.build/native-before.cjs').write_bytes(before)
    Path('.build/native-after.cjs').write_bytes(after)
    print(json.dumps({'prepared': True, 'changedRuntimeSources': r.SOURCES,
                      'baselineBundleVerified': True, 'ticketRetriesPerformed': False}))


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
            data['durableBankContinuationVerified'] = True
            data['requiresOwnCreationAndSealedBaselineForDefaultBankReplacement'] = True
            path.write_text(json.dumps(data, indent=2), encoding='utf-8')
