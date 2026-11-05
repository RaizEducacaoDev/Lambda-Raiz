"""Publish only the existing-movement diagnostic; never invoke a financial ticket."""
import argparse
import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('scoped',Path(__file__).with_name('release-payment-contract-incident.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.m.OUT=Path('.existing-field-diagnostic-release')
r.BASE_REF='3cd5bbeb7540545c7d4f4ce8ee80708123f6a290'
r.BASE_SHA='n4kdssBrzIc07z0MKLu1vsuRcZQQW11jrZBQVWyD4wU='
r.BASE_BUNDLE_SHA='RS6FUrupaXXPp8m5Xms3MlHDCxCPc6fmrjq/hz1t1Vo='
r.BASE_REVISION='820b8aec-d20c-43a8-9dd9-226d08c8e6d2'
r.SOURCES=['src/functions/rm/post/pagamentoExistente.ts','src/functions/rm/post/pagamentoV2Idempotencia.ts']
r.MODULE_COUNTS=dict(zip(r.SOURCES,[1,2]))

def validate(bundle):
    p=r.chunks(bundle)
    existing=b'\x00'.join(x[2] for x in p[r.SOURCES[0]])
    for marker in [b'DADOS_MOVIMENTO_DIVERGENTES',b'camposDivergentes',b'numero(entrada.numeroDaNF)',
                   b'numero(mov.NUMEROMOV)',b'dataCanonica(entrada.dataDeEmissao)',b'dataCanonica(mov.DATAEMISSAO)',
                   b'valorCanonico(entrada.valorTotal)',b'valorCanonico(mov.VALORBRUTO)',b'mov.CODCCUSTO',b'mov.IDNAT',
                   b'conferirItens(xml, entrada, tipo)',b'conferirTributos(xml, entrada)',b'plano.campos.every',
                   b'mov.STATUS === "C"',b'compl.TICKET !== ticket']:
        assert marker in existing,'Existing-payment guard or diagnostic missing'
    assert b'.saveRecord(' not in existing and b'.avancar(' not in existing and b'.reservar(' not in existing

original_patch=r.patch
def patch(active,before,after):
    # The repository edit adds a TS reason literal only; every compiled byte of
    # the repository must remain identical, in addition to all other modules.
    name=r.SOURCES[1]
    assert [x[2] for x in r.chunks(before)[name]]==[x[2] for x in r.chunks(after)[name]],'Repository runtime changed'
    return original_patch(active,before,after)
r.patch=patch
r.validate_candidate=validate

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','release','readback']);p.add_argument('--evidence',default=str(r.m.OUT));a=p.parse_args()
    if a.mode=='prepare':r.prepare()
    elif a.mode=='release':r.release(expected_ref='refs/heads/fix/payment-existing-field-diagnostic-20261105')
    else:r.readback(a.evidence,False)
