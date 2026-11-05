"""Publish bank/branch compatibility preflight without replaying any ticket."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('reviewed_release', Path(__file__).with_name('release-native-duplication.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.m.OUT = Path('.payment-bank-branch-release')
r.BASE_REF = '19a29d16a565759029bbb7c903649a6c6707dce0'
r.BASE_SHA = 'nP8Tf7PTJVjQcqhA+QwqCkA69wFPlJ+kYe/8QHKR5/A='
r.BASE_BUNDLE_SHA = 'gHGA92on/9W7p+GmB/uTlqCQUzHsTAcJZ73rWtDuGE0='
r.BASE_REVISION = '6aec6184-80d8-47eb-b386-32cab252c086'
r.SOURCES = ['src/functions/rm/post/pagamentoIdentidade.ts',
             'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']


def validate_candidate(bundle):
    identity = r.module(bundle, r.SOURCES[0])
    service = r.module(bundle, r.SOURCES[1])
    assert b'function validarFilialBancaria(' in identity
    assert b'dado.CODFILIAL' in identity and b'Number(cadastrada) > 0' in identity
    assert b'Number(cadastrada) !== Number(filial)' in identity
    assert b'validarFilialBancaria(dado, filial)' in service
    assert service.index(b'validarFilialBancaria(dado, filial)') < service.index(b'.reservar(')
    assert all(query not in service for query in
               [b'.consultarDocumento(', b'.consultarRetomada(', b'.buscarMovimentosPorTicket('])
    assert b'primary_key_received' in service and b'.saveRecord(' in service
    assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle, 'src/functions/rm/post/pagamentoDiagnosticoSeguro.ts')
    assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle, 'src/functions/rm/post/pagamentoEvidencia.ts')


r.validate_candidate = validate_candidate


def prepare():
    changed = subprocess.check_output(['git', 'diff', r.BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == r.SOURCES, 'Unexpected runtime source changes'
    candidates = {source: Path(source).read_bytes() for source in r.SOURCES}
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        for source in r.SOURCES:
            Path(source).write_bytes(subprocess.check_output(['git', 'show', r.BASE_REF + ':' + source]))
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
            data['bankBranchPreflightVerified'] = True
            path.write_text(json.dumps(data, indent=2), encoding='utf-8')
