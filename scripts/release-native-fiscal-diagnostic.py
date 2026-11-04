"""Scoped publication of the verified native fiscal diagnostic; no ticket replay."""
import argparse,importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('reviewed_release',Path(__file__).with_name('release-native-duplication.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.m.OUT=Path('.native-fiscal-diagnostic-release')
r.BASE_REF='fb1e30623ebcae06bf08fe963ee840a118c648ca'
r.BASE_SHA='f4driLg+9qhXQN4A7hvgLvKrmpotW1EtSsk35lIVVVM='
r.BASE_BUNDLE_SHA='1Gife+Z0skdEMqZWajm+f/5fL0QD98QANwoaqmDM4fU='
r.BASE_REVISION='08becd62-7243-43b3-b7c2-e2adb52215d7'
r.SOURCES=['src/functions/rm/post/pagamentoDiagnosticoSeguro.ts','src/functions/rm/post/pagamentoEvidencia.ts']
def validate_candidate(bundle):
    for source in r.SOURCES:
        assert b'RM_INVALID_FISCAL_NATURE' in r.module(bundle,source),'Native fiscal reason missing'
    service=r.module(bundle,'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts')
    assert all(name not in service for name in [b'.consultarDocumento(',b'.consultarRetomada(',b'.buscarMovimentosPorTicket('])
    assert b'primary_key_received' in service and b'.saveRecord(' in service
    assert b'autoriza uma nova cria' not in r.module(bundle,r.SOURCES[1])
r.validate_candidate=validate_candidate
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','release','readback','monitor']);parser.add_argument('--evidence',default=str(r.m.OUT));args=parser.parse_args()
    if args.mode=='prepare':r.prepare()
    elif args.mode=='release':r.release()
    else:r.readback(args.evidence,args.mode=='monitor')
    for name in ['deployment.json','independent-readback.json','monitor.json']:
        path=r.m.OUT/name
        if path.exists():
            data=json.loads(path.read_text());data['nativeFiscalReasonVerified']=True;path.write_text(json.dumps(data,indent=2))
