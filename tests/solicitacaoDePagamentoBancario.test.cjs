const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs');
const base = path.resolve(__dirname, '../src/functions/rm/post');
const h = load(path.join(base, 'solicitacaoDePagamentoBancario.ts'));
const parser = load(path.join(base, 'pagamentoV2Rm.ts'));
const linha = '836500000002100000000008000000000000000000000000';
const bank = { codigoDoFornecedor: '0000000001', idPagamento: '8$_$0$_$0000000001$_$6', idpgto: '6' };

test('gate exige simultaneamente PG, TS03, CC e flag; aliases são limitados', () => {
 const payload = { tipoDaSolicitacao: 'PG', atividadeAtual: 'TS03', tipoDoPagamento: 'CC', integracaoBancariaV2: 'S' };
 for (const alias of ['CC', 'Conta de consumo', 'contas de consumo', '  Contas  de consumo ']) assert.equal(h.deveExecutarV2({...payload,tipoDoPagamento:alias}),true);
 for (const [k,v] of Object.entries(payload)) {
   assert.equal(h.deveExecutarV2({...payload,[k]:''}),false,k);
   assert.equal(h.deveExecutarV2({...payload,[k]:'outro'}),false,k);
 }
 assert.equal(h.deveExecutarV2({...payload,atividadeAtual:'gravarPagamento'}),false);
 assert.equal(h.deveExecutarV2(null),false);
});
test('chave exige ID positivo, titularidade e todos aliases consistentes', () => {
 assert.equal(h.resolverChaveDadoPagamento(bank).idPgto,6);
 for (const id of ['0','-1','I','1.2','6e0','9007199254740992']) assert.throws(() => h.resolverChaveDadoPagamento({...bank,idpgto:id}));
 assert.throws(() => h.resolverChaveDadoPagamento({...bank,idPagamento:'8$_$0$_$0000000001$_$0'}));
 assert.throws(() => h.resolverChaveDadoPagamento({...bank,idPgto:'7'}));
 assert.throws(() => h.resolverChaveDadoPagamento({...bank,idpagamento:'8$_$0$_$0000000001$_$7'}));
 assert.throws(() => h.resolverChaveDadoPagamento({...bank,codigoDoFornecedor:'0000000002'}));
 assert.throws(() => h.resolverChaveDadoPagamento({...bank,idPagamento:'6'}));
 assert.equal(h.resolverChaveDadoPagamento({...bank,idPagamento:'6',CODCOLPGTO:'8',CODCOLCFO:'0'}).idPgto,6);
});
test('arrecadação exige 48 dígitos, DV dos quatro blocos e geral', () => {
 assert.equal(h.obterDadosBoleto(linha).codigoBarras,'83650000000100000000000000000000000000000000');
 assert.equal(h.obterDadosBoleto('838700000001100000000007000000000000000000000000').ipte.length,48);
 assert.equal(h.digitoArrecadacao('01230067896',10),3);
 assert.equal(h.digitoArrecadacao('01230067896',11),0);
 for (const pos of [0,11,23,35,47]) {
   const alterada = linha.slice(0,pos)+(Number(linha[pos])+1)%10+linha.slice(pos+1);
   assert.throws(() => h.obterDadosBoleto(alterada));
 }
 // Recalcula só o DV do bloco após adulterar o geral: o DV geral ainda deve rejeitar.
 const bloco = linha.slice(0,3)+'6'+linha.slice(4,11);
 const geralInvalido = bloco+h.digitoArrecadacao(bloco,10)+linha.slice(12);
 assert.throws(() => h.obterDadosBoleto(geralInvalido), /geral/);
 for (const bad of [linha.slice(0,44),linha.slice(0,47),'',linha+'A','000000000000000000000000000000000000000000000000']) assert.throws(() => h.obterDadosBoleto(bad));
});
test('parser lê envelopes reais sanitizados e respeita case FDadosPgto', () => {
 for (const [fixture,row] of [['dado-n','FDadosPgto'],['dado-i','FDadosPgto'],['movimento','TMOV'],['lan-vazio','FLAN']]) {
   const soap=fs.readFileSync(path.join(__dirname,'fixtures/rm',fixture+'.soap.xml'),'utf8');
   const xml=parser.lerResultadoSoap(soap,'ReadRecord');
   assert.equal(parser.registroUnico(xml,row).CODCOLIGADA,'8');
   assert.equal(parser.lerResultadoSoap(soap.replaceAll('s:','soapenv:').replace('xmlns:s=','xmlns:soapenv='),'ReadRecord'),xml);
 }
 const xml='<FinLAN><FLAN><IDLAN>1</IDLAN><IDLAN>2</IDLAN></FLAN></FinLAN>';
 assert.throws(() => parser.registroUnico(xml,'FLAN'));
 assert.throws(() => parser.registroUnico('<FinLAN><FLAN/><FLAN/></FinLAN>','FLAN'));
 assert.throws(() => parser.registroUnico('<bad>','FLAN'));
 assert.throws(() => parser.lerResultadoSoap('<s:Envelope><s:Body><s:Fault>Erro</s:Fault></s:Body></s:Envelope>','ReadRecord'));
 assert.throws(() => parser.registroUnico('<!DOCTYPE x><FinLAN/>','FLAN'));
});
test('legado coincide com código AWS recuperado exceto adaptações explícitas de injeção V2', () => {
 let source=fs.readFileSync(path.join(base,'solicitacaoDePagamentoLegado.ts'),'utf8').replaceAll('\r\n','\n');
 source=source.replace("export const handlerLegado = async (event: any, opcoesV2?: { transporte: Pick<wsDataserver, 'saveRecord'>; getLOC: (coligada: string, filial: string) => Promise<string> }) => {",'export const handler = async (event: any) => {');
 source=source.replace('const ESTOQUE = opcoesV2 ? await opcoesV2.getLOC(CODCOLIGADA, CODFILIAL) : await ConfigManagerRm.getLOC(CODCOLIGADA, CODFILIAL);','const ESTOQUE = await ConfigManagerRm.getLOC(CODCOLIGADA, CODFILIAL);');
 source=source.replace('\n      if (opcoesV2) return; // V2 confirma os dados pelo seu próprio protocolo durável.','');
 source=source.replace('result = await (opcoesV2?.transporte || dataServer).saveRecord(cData,','result = await dataServer.saveRecord(cData,');
 source=source.replace('\n      if (opcoesV2) throw errSoap; // Resultado incerto permanece reservado na V2.','');
 const provenance=require('./fixtures/rm/provenance.json');
 assert.equal(createHash('sha256').update(source).digest('hex'),provenance.legacyNormalizedSha256);
});
test('wrapper entrega integralmente NF, PIX, boleto, transferência, outras tarefas e flags ao legado', async () => {
 let legado=0,v2=0;
 const {handler}=load(path.join(base,'solicitacaoDePagamento.ts'), {
   './solicitacaoDePagamentoLegado':{handlerLegado:async(event)=>{legado++;return {same:event};}},
   './solicitacaoDePagamentoV2':{executarPagamentoV2:async()=>{v2++;return {v2:true};}},
 });
 for (const tipo of ['NF','PIX','BOLETO','TM','Transferência','CC']) {
   const event={body:JSON.stringify({tipoDaSolicitacao:'PG',atividadeAtual:'TS03',tipoDoPagamento:tipo,integracaoBancariaV2:'N'})};
   assert.equal((await handler(event)).same,event);
 }
 for (const atividade of ['validarPrestacaoContas','gravarPagamento','TS02']) {
  const event={body:JSON.stringify({tipoDaSolicitacao:'PG',atividadeAtual:atividade,tipoDoPagamento:'CC',integracaoBancariaV2:'S'})};
  assert.equal((await handler(event)).same,event);
 }
 assert.equal(legado,9); assert.equal(v2,0);
 assert.deepEqual(await handler({body:JSON.stringify({tipoDaSolicitacao:'PG',atividadeAtual:'TS03',tipoDoPagamento:'Contas de consumo',integracaoBancariaV2:'S'})}),{v2:true});
});
