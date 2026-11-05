"""Restore native RM diagnostics, preserving the deployed financial protocol."""
import argparse,importlib.util,json,os,re,subprocess
from pathlib import Path

spec=importlib.util.spec_from_file_location('scoped',Path(__file__).with_name('release-payment-contract-incident.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.m.OUT=Path('.native-errors-restored-release')
r.BASE_REF='a9376a64590f7ea9d836cce0c16533c14f955b48'
r.BASE_SHA='xJKa7fIorZjKlZsLhu9+Uhn4Yxcz7tJQ3aXBLH0k/oU='
r.BASE_BUNDLE_SHA='T9p8ijf2S4X0n9/lx6+36niBWvj8ONmqppmqj0c2HVQ='
r.BASE_REVISION='c844eabc-2d51-48c1-944c-0a3e19dc859a'
r.SOURCES=['src/functions/rm/post/pagamentoDiagnosticoSeguro.ts',
           'src/functions/rm/post/pagamentoErroNativo.ts',
           'src/functions/rm/post/pagamentoResposta.ts',
           'src/functions/rm/post/pagamentoV2Rm.ts',
           'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
NEW_SOURCE=r.SOURCES[1]
r.MODULE_COUNTS=dict(zip(r.SOURCES,[1,1,1,1,1]))
BRANCH='refs/heads/fix/payment-native-errors-restored-20261105'

def outside(bundle):
    markers=list(re.finditer(rb'(?m)^// src/[^\r\n]+\n',bundle))
    intervals=[(m.start(),markers[i+1].start() if i+1<len(markers) else len(bundle))
               for i,m in enumerate(markers) if m.group()[3:-1].decode() in r.SOURCES]
    for start,end in reversed(intervals):bundle=bundle[:start]+bundle[end:]
    return bundle

def validate_candidate(bundle):
    chunks=r.chunks(bundle)
    native=b'\x00'.join(p[2] for p in chunks[NEW_SOURCE])
    service=b'\x00'.join(p[2] for p in chunks[r.SOURCES[-1]])
    for marker in [b'sanitizarTextoErroRm',b'extrairTextoErroRm',b'mensagemNegocioRm',b'ErroNativoRm']:
        assert marker in native,'Native diagnostic contract missing'
    for marker in [b'.confirmarCriacaoPropria(',b'.selarBaseline(',b'.avancarParcelaPropria(',b'.conferirEnvioProprio(',
                   b'await consultarPagamentoExistente(',b'await repo.encerrarRejeicao(',b'validarFilialBancaria(dado, filial)',
                   b'propria ? 17e3 : 11e3',b'if (!match && rejeicaoNegocio)']:
        assert marker in service,'Financial guard changed'
    assert service.count(b'.saveRecord(')==2,'Financial dispatch count changed'
    assert service.index(b'.conferirEnvioProprio(')<service.rindex(b'.saveRecord(')
    assert b'!aposRejeicao.movimentos.length && !aposRejeicao.lancamentos.length' in service
    assert b'entrada.idDoMovimento || entrada.movimentoExistente' not in service

def patch(active,before,after):
    assert active==before and r.m.sha(before)==r.BASE_BUNDLE_SHA,'Active entrypoint or source baseline drift'
    assert before!=after and outside(before)==outside(after),'Change outside reviewed error modules'
    validate_candidate(after)
    return after

def unchanged_source_guards():
    source=r.SOURCES[3]
    old=subprocess.check_output(['git','show',r.BASE_REF+':'+source]).decode().replace('\r\n','\n')
    new=Path(source).read_text(encoding='utf-8').replace('\r\n','\n')
    pattern=r'export class PrazoPagamento \{[\s\S]*?\n\}'
    before=re.findall(pattern,old);after=re.findall(pattern,new)
    assert len(before)==len(after)==1 and before==after,'Time budgets changed'
    source=r.SOURCES[0]
    old=subprocess.check_output(['git','show',r.BASE_REF+':'+source]).decode().replace('\r\n','\n')
    new=Path(source).read_text(encoding='utf-8').replace('\r\n','\n')
    pattern=r'// Temporary observation[\s\S]*?(?=// Persisted diagnostics)'
    before=re.findall(pattern,old);after=re.findall(pattern,new)
    assert len(before)==len(after)==1 and before==after,'Bounded incident observer changed'

def prepare():
    changed=subprocess.check_output(['git','diff',r.BASE_REF,'--name-only','--','src'],text=True).splitlines()
    assert changed==r.SOURCES,'Unexpected runtime source changes'
    unchanged_source_guards()
    sources=[name for name in r.SOURCES if name!=NEW_SOURCE]
    candidates={name:Path(name).read_bytes() for name in sources}
    npm='npm.cmd' if os.name=='nt' else 'npm'
    try:
        for name in sources:Path(name).write_bytes(subprocess.check_output(['git','show',r.BASE_REF+':'+name]))
        subprocess.run([npm,'run','build:pagamento'],check=True)
        before=Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        for name,data in candidates.items():Path(name).write_bytes(data)
    subprocess.run([npm,'run','build:pagamento'],check=True)
    after=Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    patch(before,before,after)
    Path('.build/contract-before.cjs').write_bytes(before)
    Path('.build/contract-after.cjs').write_bytes(after)
    print(json.dumps({'prepared':True,'baselineVerified':True,'onlyReviewedErrorModulesChanged':True,
                      'timeBudgetsUnchanged':True,'financialTicketInvocations':False}))

r.outside=outside;r.patch=patch;r.validate_candidate=validate_candidate

def release():
    assert os.environ.get('GITHUB_EVENT_NAME')=='push'
    assert os.environ.get('GITHUB_REF')==BRANCH
    assert os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Never automatically repeat a publication'
    r.release(expected_ref=BRANCH)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','release','readback']);p.add_argument('--evidence',default=str(r.m.OUT));a=p.parse_args()
    if a.mode=='prepare':prepare()
    elif a.mode=='release':release()
    else:r.readback(a.evidence,False)
