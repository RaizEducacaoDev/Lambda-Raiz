const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const cache=new Map(),load=name=>require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post',name),{},cache);
const {respostaErroPagamento}=load('pagamentoResposta.ts');
const {PagamentoInvalido}=load('pagamentoIdentidade.ts');
const {ConflitoPagamento}=load('pagamentoV2Idempotencia.ts');
const {PrazoPagamentoInsuficiente,FalhaContratoRm}=load('pagamentoV2Rm.ts');
const {diagnosticarRetornoRm}=load('pagamentoDiagnosticoSeguro.ts');
const base={etapa:'criacao_movimento',criacaoIncerta:false};
const result=(erro,extra={})=>respostaErroPagamento({...base,erro,...extra});

test('rejeição nativa conserva o contrato400 do backup, independentemente da reserva e do IDMOV',()=>{
 const diagnostic=diagnosticarRetornoRm('Já Existe Nota do Emitente com este Número e Série.\n=====\nat RM.Fixture');
 for(const extra of [{},{pgConfirmado:'9001'},{criacaoIncerta:true}]){
  const r=result(Error('PRIVATE_NATIVE_RAW'),{...extra,diagnostico:diagnostic,mensagemNativa:'Já Existe Nota do Emitente com este Número e Série.'});
  assert.equal(r.status,400);assert.equal(r.body.code,'RM_DUPLICATE_RECORD');assert.equal(r.body.origem,'TOTVS');
  assert.match(r.body.message,/Erro ao gravar no TOTVS:.*Número e Série/);assert.equal(r.body.message,r.body.error);
  assert.equal(JSON.stringify(r).includes('PRIVATE_NATIVE_RAW'),false);
 }
});

test('uma rejeição não classificada com resumo nativo seguro é400; resposta inesperada ou chave de outra coligada é503',()=>{
 const r=result(Error('private'),{diagnostico:diagnosticarRetornoRm('Série não cadastrada.\n=====\nat RM.Fixture'),mensagemNativa:'Série não cadastrada.'});
 assert.equal(r.status,400);assert.equal(r.body.code,'RM_UNCLASSIFIED_REJECTION');
 for(const diagnostic of [diagnosticarRetornoRm('unexpected'),diagnosticarRetornoRm('9;9001',true)]){
  assert.equal(result(Error('private'),{diagnostico:diagnostic}).status,503);
 }
});

test('orçamento local mantém causa específica antes e depois da criação; nunca afirma problema no cadastro bancário',()=>{
 for(const pgConfirmado of [undefined,'9001']){
  const r=result(new PrazoPagamentoInsuficiente(17000,16670),{pgConfirmado,etapa:'gravacao_vinculo'});
  assert.equal(r.status,503);assert.equal(r.body.code,'PRAZO_INTEGRACAO_INSUFICIENTE');assert.equal(r.body.reason,'PRAZO_INSUFICIENTE');
  assert.equal(r.body.origem,'INTEGRACAO');assert.equal(r.log.necessarioMs,17000);assert.equal(r.log.disponivelMs,16670);
  assert.equal(r.body.etapa,'gravacao_vinculo');assert.doesNotMatch(r.body.message,/IDPGTO|cadastro bancário|reconciliar/);
  assert.equal(r.body.efeito,pgConfirmado?'MOVIMENTO_CONFIRMADO':'SEM_MOVIMENTO_CONFIRMADO');
  assert.equal(r.body.PG,pgConfirmado);if(pgConfirmado)assert.match(r.body.message,/movimento 9001 já está gravado/);
 }
});

test('ticket inválido não recebe código de IDPGTO; seleção bancária inválida conserva seu código público',()=>{
 const invalid=result(new PagamentoInvalido('Ticket inválido'),{etapa:'validacao_solicitacao'});
 const bank=result(new PagamentoInvalido('Selecione o dado bancário'),{etapa:'identidade_bancaria'});
 assert.equal(invalid.status,422);assert.equal(invalid.body.code,'DADOS_PAGAMENTO_INVALIDOS');
 assert.equal(bank.body.code,'IDPGTO_NAO_CONFIRMADO');assert.equal(bank.body.origem,'FORMULARIO');
});

test('conflito com movimento confirmado não vira erro de banco, nem pede reconciliação ao usuário',()=>{
 const r=result(new ConflitoPagamento('Baseline/lease diverge; reconciliar'),{pgConfirmado:'9001',etapa:'preparacao_vinculo'});
 assert.equal(r.status,409);assert.equal(r.body.code,'OPERACAO_EM_CONFLITO');assert.equal(r.body.efeito,'MOVIMENTO_CONFIRMADO');
 assert.doesNotMatch(r.body.message,/baseline|lease|reconciliar|IDPGTO/i);
 assert.match(r.body.message,/movimento 9001 já está gravado/);
});

test('processamento em andamento ou estado desconhecido não acusa divergência no formulário',()=>{
 for(const erro of [new ConflitoPagamento('Ticket em processamento ou estado desconhecido'),
  new ConflitoPagamento('aguarde','OPERACAO_EM_PROCESSAMENTO'),new ConflitoPagamento('Estado da reserva inválido','ESTADO_TENTATIVA_INVALIDO')]){
  const r=result(erro,{etapa:'controle_tentativa'});assert.equal(r.status,409);
  assert.doesNotMatch(r.body.message,/dados.*não correspondem|Confira os campos|reconcil/i);
  assert.match(r.body.message,/Aguarde alguns instantes e envie novamente/);
 }
});

test('timeout, contrato RM inválido e concorrência são causas distintas, sem expor exceções',()=>{
 const secret='Bearer SECRET_PRIVATE password=PRIVATE';
 const cases=[
  [Object.assign(Error(secret),{name:'CanceledError',code:'ERR_CANCELED'}),'COMUNICACAO_NAO_CONFIRMADA',503],
  [new FalhaContratoRm(secret),'RESPOSTA_TOTVS_INVALIDA',503],
  [Object.assign(Error(secret),{name:'ConditionalCheckFailedException'}),'OPERACAO_EM_PROCESSAMENTO',409],
 ];
 for(const [erro,code,status] of cases){
  const r=result(erro,{etapa:'confirmacao_final',pgConfirmado:'9001'});assert.equal(r.status,status);assert.equal(r.body.code,code);
  assert.equal(r.body.message,r.body.error);assert.equal(JSON.stringify(r).includes(secret),false);
 }
});

test('um checkpoint perdido após chave recebida informa o efeito confirmado, sem alegar falha de criação',()=>{
 const r=result(Error('PRIVATE_CHECKPOINT'),{etapa:'controle_criacao',pgConfirmado:'9001',criacaoIncerta:true});
 assert.equal(r.body.efeito,'MOVIMENTO_CONFIRMADO');assert.equal(r.body.PG,'9001');
 assert.match(r.body.message,/movimento 9001 já está gravado/);assert.doesNotMatch(r.body.message,/Não foi possível criar/);
 assert.equal(r.log.etapa,'controle_criacao');assert.equal(JSON.stringify(r).includes('PRIVATE_CHECKPOINT'),false);
});
