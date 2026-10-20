const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const base = path.resolve(__dirname, '../src/functions/rm/post');
const { lerResultadoSoap, registroUnico } = loadTs(path.join(base, 'pagamentoV2Rm.ts'));
const fixture = name => lerResultadoSoap(fs.readFileSync(path.join(__dirname, 'fixtures/rm', `${name}.soap.xml`), 'utf8'), 'ReadRecord');
const toXml = (name, row) => `<DataSet><${name}>${Object.entries(row).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</${name}></DataSet>`;
const linha = '836500000002100000000008000000000000000000000000';
const payload = {
  ticketRaiz: '221169', tipoDaSolicitacao: 'PG', atividadeAtual: 'TS03',
  tipoDoPagamento: 'CC', contasDeConsumo: 'Internet', codigoDaColigada2: '8',
  codigoDaFilial2: '4', codigoDoFornecedor: '0000000001', CODCOLPGTO: '8',
  idpgto: '6', idPagamento: '', codigoDeBarrasBoleto: linha,
  numeroDaNF: '656781102026', idDoMovimento: '9001',
};

function setup(options = {}) {
  const stats = { reads: 0, saves: 0, lookups: 0 };
  let movimentoCriado = '';
  let lan = { ...registroUnico(fixture('lan-vazio'), 'FLAN'), ...options.initialLan };
  const movimento = fixture('movimento').replace('<TICKET>9003</TICKET>', `<TICKET>${options.ticket || '221169'}</TICKET>`);
  const movimentoCancelado = movimento.replaceAll('<IDMOV>9001</IDMOV>', '<IDMOV>9000</IDMOV>')
    .replace('<TMOV>', '<TMOV><STATUS>C</STATUS><DATACANCELAMENTOMOV>2026-10-20T00:00:00</DATACANCELAMENTOMOV>')
    .replace('<IDLAN>9002</IDLAN>', '<IDLAN>9004</IDLAN>');
  const lanCancelado = toXml('FLAN', { CODCOLIGADA: '8', IDLAN: '9004', IDMOV: '9000',
    CODCFO: '0000000001', STATUSLAN: options.cancelamentoIncompleto ? '0' : '2',
    DATACANCELAMENTO: '2026-10-20T00:00:00' });
  const mocks = {
    '../../../utils/wsDataserver': {
      wsDataserver: class {
        async readReacord(key, server) {
          stats.reads++;
          if (server === 'FinDadosPgtoDataBR') {
            if (options.dadoPadrao) {
              const id = key.endsWith(';1') ? '1' : '9';
              return toXml('FDadosPgto', { CODCOLIGADA: '8', CODCOLCFO: '0',
                CODCFO: '0000000001', IDPGTO: id, FORMAPAGAMENTO: 'N',
                DESCRICAO: 'CONCESSIONÁRIA', ATIVO: '1' });
            }
            return fixture(options.formaI ? 'dado-i' : 'dado-n');
          }
          if (key === '8;9000' && server === 'MovMovimentoTBCData') return movimentoCancelado;
          if (key === '8;9004' && server === 'FinLanDataBR') return lanCancelado;
          if (server === 'MovMovimentoTBCData') return movimento;
          return toXml('FLAN', lan);
        }
        async saveRecord(xml, server) {
          stats.saves++;
          if (server === 'MovMovimentoTBCData') {
            movimentoCriado = xml;
            return '8;9001';
          }
          assert.equal(server, 'FinLanDataBR');
          if (!options.writeNoEffect) lan = { ...lan, ...registroUnico(xml.slice(9, -3), 'FLAN') };
          return '8;9002';
        }
      },
    },
    '../../../utils/classRm': { ConfigManagerRm: class { async getLOC() { return '01'; } } },
    './pagamentoV2Rm': {
      registroUnico,
      PrazoPagamento: class { constructor() {} },
      TransportePagamentoV2: class {
        async buscarMovimentosPorTicket() { stats.lookups++; return options.lookup ?? ['9001']; }
      },
    },
  };
  const { handlerLegado } = loadTs(path.join(base, 'solicitacaoDePagamentoLegado.ts'), mocks);
  return { run: fields => handlerLegado({ body: JSON.stringify({ ...payload, ...fields }) }), stats,
    get lan() { return lan; }, get movimentoCriado() { return movimentoCriado; } };
}

test('221169 vincula IDPGTO ao FLAN e confirma os campos por leitura do RM', async () => {
  const x = setup();
  const response = await x.run();
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).PG, '9001');
  assert.equal(x.lan.IDPGTO, '6');
  assert.equal(x.lan.CODCOLPGTO, '8');
  assert.equal(x.lan.IPTE, linha);
  assert.equal(x.stats.saves, 1);
  assert.equal(x.stats.lookups, 1);
});

test('223399 confirma o IDPGTO no FLAN antes de devolver sucesso ao Zeev', async () => {
  const x = setup({ ticket: '223399' });
  const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
    contasDeConsumo: 'I', idPagamento: '8$_$0$_$0000000001$_$6',
    listaDeParcelas: [{ vencimentoDaParcela: '', valorDaParcela: '' }] });
  assert.equal(response.statusCode, 200);
  assert.equal(x.lan.IDPGTO, '6');
  assert.equal(x.lan.CODCOLPGTO, '8');
  assert.equal(x.stats.lookups, 1);
});

test('223399 substitui o cadastro padrão do RM somente no lançamento novo e sem baixa', async () => {
  const x = setup({ ticket: '223399', dadoPadrao: true, initialLan: {
    CODCOLPGTO: '8', IDPGTO: '1', NUMERODOCUMENTO: '223399001/01',
    VALORBAIXADO: '0.0000', BAIXAPENDENTE: '0',
  } });
  const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
    idpgto: '9', idPagamento: '8$_$0$_$0000000001$_$9', numeroDaNF: '223399001' });
  assert.equal(response.statusCode, 200);
  assert.equal(x.lan.IDPGTO, '9');
  assert.equal(x.lan.CODCOLPGTO, '8');
  assert.equal(x.lan.IPTE, linha);
  assert.equal(x.stats.saves, 1);
});

test('223399 preserva o bloqueio quando o cadastro anterior não é o padrão vazio', async () => {
  const baseLan = { CODCOLPGTO: '8', IDPGTO: '1', NUMERODOCUMENTO: '223399001/01',
    VALORBAIXADO: '0.0000', BAIXAPENDENTE: '0' };
  for (const alteracao of [{ CODIGOBARRA: 'outro' }, { VALORBAIXADO: '1.0000' },
    { IDPGTO: '2' }, { NUMERODOCUMENTO: 'outro/01' }]) {
    const x = setup({ ticket: '223399', dadoPadrao: true,
      initialLan: { ...baseLan, ...alteracao } });
    const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
      idpgto: '9', idPagamento: '8$_$0$_$0000000001$_$9', numeroDaNF: '223399001' });
    assert.notEqual(response.statusCode, 200);
    assert.equal(x.stats.saves, 0);
  }
});

test('223399 bloqueia IDPGTO ausente antes de gravar o RM', async () => {
  const x = setup({ ticket: '223399', lookup: [] });
  const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
    contasDeConsumo: 'I', idDoMovimento: '', idpgto: '', idPagamento: '' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.saves, 0);
});

test('223399 não confirma sucesso quando o RM não persiste o vínculo bancário', async () => {
  const x = setup({ ticket: '223399', writeNoEffect: true });
  const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
    contasDeConsumo: 'I', idPagamento: '8$_$0$_$0000000001$_$6' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.lan.IDPGTO, undefined);
});

test('223399 cria uma conta de Internet de parcela única e vincula o lançamento', async () => {
  const x = setup({ ticket: '223399', lookup: [] });
  const response = await x.run({ ticketRaiz: '223399', atividadeAtual: 'aprovacaoDoGestor',
    contasDeConsumo: 'I', idDoMovimento: '', idPagamento: '8$_$0$_$0000000001$_$6',
    numeroDaNF: '463806702', listaDeParcelas: [{ vencimentoDaParcela: '', valorDaParcela: '' }],
    dataDeEmissao: '17/09/2026', dataDeEntrada: '', dataDeVencimento: '23/10/2026',
    valorTotal: '20,42', informacoes: 'Conta de Internet', codigoDoCentroDeCusto: '01',
    chaveDeAcesso: '', tributos: [], itens: [] });
  assert.equal(response.statusCode, 200);
  assert.match(x.movimentoCriado, /<NUMEROMOV>463806702<\/NUMEROMOV>/);
  assert.equal(x.lan.IDPGTO, '6');
  assert.equal(x.stats.saves, 2);
});

test('221169 sem IDPGTO válido falha antes de alterar o RM', async () => {
  const x = setup();
  const response = await x.run({ idpgto: '', idPagamento: '' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.reads, 0);
  assert.equal(x.stats.saves, 0);
});

test('atividade real do Zeev exige IDPGTO antes de criar movimento', async () => {
  const x = setup();
  const response = await x.run({ atividadeAtual: 'aprovacaoDoGestor', idpgto: '' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.reads, 0);
  assert.equal(x.stats.saves, 0);
});

test('221169 bloqueia contexto de atividade inesperado antes de alterar o RM', async () => {
  const x = setup();
  const response = await x.run({ atividadeAtual: 'analiseFiscal' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.reads, 0);
  assert.equal(x.stats.saves, 0);
});

test('221169 não devolve sucesso se o RM não persistir o vínculo', async () => {
  const x = setup({ writeNoEffect: true });
  const response = await x.run();
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.saves, 1);
  assert.equal(x.lan.IDPGTO, undefined);
});

test('221169 bloqueia pagamento cadastrado em forma diferente de boleto', async () => {
  const x = setup({ formaI: true });
  const response = await x.run();
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.saves, 0);
});

test('221169 cria movimento com a referência completa e só confirma após vincular o FLAN', async () => {
  const x = setup({ lookup: [] });
  const response = await x.run({
    idDoMovimento: '', dataDeEmissao: '19/10/2026', dataDeEntrada: '19/10/2026',
    dataDeVencimento: '21/10/2026', valorTotal: '10,00', informacoes: 'Conta de Internet',
    codigoDoCentroDeCusto: '01', chaveDeAcesso: '', tributos: [], itens: [],
  });
  assert.equal(response.statusCode, 200);
  assert.match(x.movimentoCriado, /<NUMEROMOV>656781102026<\/NUMEROMOV>/);
  assert.equal(x.lan.IDPGTO, '6');
  assert.equal(x.stats.saves, 2);
});

test('221169 ignora IDMOV antigo somente após confirmar cancelamento de TMOV e FLAN', async () => {
  const x = setup({ lookup: ['9000'] });
  const response = await x.run({
    atividadeAtual: 'aprovacaoDoGestor', idDoMovimento: '9000',
    dataDeEmissao: '19/10/2026', dataDeEntrada: '19/10/2026',
    dataDeVencimento: '21/10/2026', valorTotal: '10,00', informacoes: 'Conta de Internet',
    codigoDoCentroDeCusto: '01', chaveDeAcesso: '', tributos: [], itens: [],
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).PG, '9001');
  assert.match(x.movimentoCriado, /<NUMEROMOV>656781102026<\/NUMEROMOV>/);
  assert.equal(x.lan.IDPGTO, '6');
});

test('221169 não recria se o FLAN antigo ainda estiver ativo', async () => {
  const x = setup({ lookup: ['9000'], cancelamentoIncompleto: true });
  const response = await x.run({ atividadeAtual: 'aprovacaoDoGestor', idDoMovimento: '9000' });
  assert.notEqual(response.statusCode, 200);
  assert.equal(x.stats.saves, 0);
});

test('outras instâncias seguem o caminho legado existente', async () => {
  const x = setup({ lookup: [] });
  const response = await x.run({ ticketRaiz: '221170', idpgto: '', idPagamento: '' });
  assert.equal(response.statusCode, 200);
  assert.equal(x.stats.reads, 0);
  assert.equal(x.stats.saves, 0);
  assert.equal(x.stats.lookups, 0);
});
