"""Publish only a bounded, encrypted incident observer. No ticket invocation."""
import argparse
import importlib.util
import os
from pathlib import Path

spec=importlib.util.spec_from_file_location('scoped',Path(__file__).with_name('release-payment-contract-incident.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.m.OUT=Path('.diagnostic-226530-release')
r.BASE_REF='a461014189395304d6e5dbb17a67323764e77699'
r.BASE_SHA='6WqYDSPH1gAoYgzxtFOtWJtieNGivE660r4TegykP/w='
r.BASE_BUNDLE_SHA='ZlDMRiERZPJRmb1g1hF9idJ39XFRuv52LM/g/Cp0AwU='
r.BASE_REVISION='1b73895d-1b5c-4b1f-8d19-6f4d351bcac0'
r.SOURCES=['src/functions/rm/post/pagamentoDiagnosticoSeguro.ts','src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
r.MODULE_COUNTS=dict(zip(r.SOURCES,[1,1]))

def validate(bundle):
    p=r.chunks(bundle)
    observer,service=[b'\x00'.join(x[2] for x in p[n]) for n in r.SOURCES]
    for marker in [b'function capturarDiagnostico226530(',b'ticket !== "226530"',b'coligada !== "11"',
                   b'2026-11-05T21:00:00Z',b'16384',b'aes-256-gcm',b'RSA_PKCS1_OAEP_PADDING',b'sha256',
                   b'[RM-DIAG-PROTEGIDO]',b'rm-native-226530-11-v1']:
        assert marker in observer,'Observer scope/encryption gate missing'
    assert b'capturarDiagnostico226530(retorno, ticket, coligada)' in service
    assert service.index(b'const retorno = await rm.saveRecord(')<service.index(b'capturarDiagnostico226530(retorno, ticket, coligada)')
    assert b'if (!match || match[1] !== coligada)' in service
    # Financial guards remain byte-for-byte outside the two reviewed modules;
    # these checks also guard important call ordering inside the service.
    for marker in [b'.confirmarCriacaoPropria(',b'.selarBaseline(',b'.avancarParcelaPropria(',b'.conferirEnvioProprio(',
                   b'await consultarPagamentoExistente(',b'await repo.encerrarRejeicao(',b'validarFilialBancaria(dado, filial)']:
        assert marker in service
    assert service.index(b'.conferirEnvioProprio(')<service.rindex(b'.saveRecord(')

r.validate_candidate=validate
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','release','readback']);p.add_argument('--evidence',default=str(r.m.OUT));a=p.parse_args()
    if a.mode=='prepare':r.prepare()
    elif a.mode=='release':
        assert os.environ.get('GITHUB_REF')=='refs/heads/fix/diagnostic-226530-20261105'
        r.release(expected_ref='refs/heads/fix/diagnostic-226530-20261105')
    else:r.readback(a.evidence,False)
