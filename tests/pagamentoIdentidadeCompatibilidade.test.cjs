const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

let networkCalls = 0;
const restore = [];
const blockNetwork = () => { networkCalls++; throw new Error('Network forbidden in bank identity compatibility tests'); };
for (const [object, key] of [[http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'],
  [net, 'connect'], [net, 'createConnection'], [tls, 'connect'], [globalThis, 'fetch']]) {
  const original = object[key];
  restore.push(() => { object[key] = original; });
  object[key] = blockNetwork;
}
after(() => {
  try { assert.equal(networkCalls, 0, 'No test may attempt an external request'); }
  finally { restore.reverse().forEach(fn => fn()); }
});

const load = require('./load-ts.cjs');
const source = path.resolve(__dirname, '../src/functions/rm/post');
const { identidadePagamento, PagamentoInvalido, planosPagamento, codigoMovimento, intencaoPagamento, hashIntencao } =
  load(path.join(source, 'pagamentoIdentidade.ts'));
const base = { codigoDaColigada2: '11', codigoDoFornecedor: '0000000001', idpgto: '3' };
const expected = { idPgto: 3, codColPgto: '11', codColCfo: '0', codCfo: '0000000001' };
const idAliases = ['idpgto', 'idPgto', 'IDPGTO', 'idPagamento', 'idpagamento'];
const companyAliases = ['CODCOLPGTO', 'codcolpgto', 'codColPgto'];
const supplierCompanyAliases = ['CODCOLCFO', 'codcolcfo', 'codColCfo'];
const composite = (company = '11', supplierCompany = '0', supplier = '0000000001', id = '3') =>
  [company, supplierCompany, supplier, id].join('$_$');
function invalid(input, ...fields) {
  assert.throws(() => identidadePagamento(input), error => {
    assert.ok(error instanceof PagamentoInvalido);
    fields.forEach(field => assert.ok(error.message.includes(field), `Missing ${field}: ${error.message}`));
    assert.ok(!error.message.includes('Aliases/chave bancária divergem'));
    assert.ok(!error.message.includes('Identificador bancário ou de destino ausente/inválido'));
    return true;
  });
}

test('ID numérico explícito usa apenas a coligada destino quando a bancária está ausente', () => {
  const before = JSON.stringify(base);
  assert.deepEqual(identidadePagamento(base), expected);
  assert.equal(JSON.stringify(base), before, 'The input must not be rewritten');
  assert.deepEqual(identidadePagamento({ ...base, codigoDaColigada: '11', codigoDaColigada2: '' }), expected);
  for (const alias of idAliases) {
    const input = { codigoDaColigada2: '11', codigoDoFornecedor: base.codigoDoFornecedor, [alias]: '003' };
    assert.deepEqual(identidadePagamento(input), expected, alias);
  }
});

test('coligada bancária vazia continua ausente, mas valor explícito inválido nunca recebe fallback', () => {
  for (const alias of companyAliases) {
    assert.deepEqual(identidadePagamento({ ...base, [alias]: '' }), expected);
    assert.deepEqual(identidadePagamento({ ...base, [alias]: '11' }), expected);
    for (const value of ['0', '-1', 'I', '11.0', '1e1', '9007199254740992']) invalid({ ...base, [alias]: value }, alias);
    invalid({ ...base, [alias]: '8' }, alias, 'codigoDaColigada2');
  }
});

test('chave composta conserva coligada, fornecedor global zero e ID exatamente selecionados', () => {
  for (const alias of idAliases) {
    const input = { codigoDaColigada2: '11', codigoDoFornecedor: base.codigoDoFornecedor, [alias]: composite() };
    assert.deepEqual(identidadePagamento(input), expected, alias);
  }
  for (const alias of supplierCompanyAliases) assert.deepEqual(identidadePagamento({ ...base, [alias]: '0' }), expected);
  assert.deepEqual(identidadePagamento({ ...base, CODCOLCFO: '11', idPagamento: composite('11', '11') }),
    { ...expected, codColCfo: '11' });
});

test('falta real de IDPGTO permanece bloqueada mesmo com destino e coligada bancária válidos', () => {
  invalid({ codigoDaColigada2: '11', codigoDoFornecedor: base.codigoDoFornecedor }, 'IDPGTO');
  invalid({ codigoDaColigada2: '11', codigoDoFornecedor: base.codigoDoFornecedor, CODCOLPGTO: '11' }, 'IDPGTO');
  invalid({ ...base, idpgto: '', idPagamento: '' }, 'IDPGTO');
  invalid({ ...base, idpgto: '0' }, 'idpgto');
});

test('cada alias numérico inválido é identificado mesmo quando outro contém o ID correto', () => {
  for (const alias of idAliases) {
    for (const value of ['0', '-1', 'I', '3.0', '3e0', '9007199254740992']) {
      invalid({ ...base, idpgto: '3', [alias]: value }, alias);
    }
  }
});

test('conflitos explícitos identificam os dois aliases e não escolhem arbitrariamente um ID', () => {
  invalid({ ...base, idPgto: '4' }, 'idpgto', 'idPgto');
  invalid({ ...base, idPagamento: composite('11', '0', base.codigoDoFornecedor, '4') }, 'idpgto', 'idPagamento.IDPGTO');
  invalid({ ...base, idPagamento: composite('8') }, 'idPagamento.CODCOLPGTO', 'codigoDaColigada2');
  invalid({ ...base, idPagamento: composite(), CODCOLPGTO: '8' }, 'CODCOLPGTO');
  invalid({ ...base, idPagamento: composite('11', '8'), CODCOLCFO: '0' }, 'idPagamento.CODCOLCFO', 'CODCOLCFO');
  invalid({ ...base, idPagamento: composite('11', '0', '0000000002') }, 'idPagamento.CODCFO', 'codigoDoFornecedor');
  invalid({ ...base, CODCOLCFO: '0', codcolcfo: '11' }, 'CODCOLCFO', 'codcolcfo');
});

test('componentes inválidos da chave composta apontam o campo correspondente', () => {
  invalid({ ...base, idPagamento: '11$_$0$_$3' }, 'idPagamento');
  invalid({ ...base, idPagamento: composite('0') }, 'idPagamento.CODCOLPGTO');
  invalid({ ...base, idPagamento: composite('11', '-1') }, 'idPagamento.CODCOLCFO');
  invalid({ ...base, idPagamento: composite('11', '0', base.codigoDoFornecedor, 'I') }, 'idPagamento.IDPGTO');
  invalid({ ...base, codigoDaColigada2: 'I' }, 'codigoDaColigada2');
  invalid({ ...base, codigoDaColigada2: '', codigoDaColigada: 'I' }, 'codigoDaColigada');
  invalid({ ...base, codigoDoFornecedor: '' }, 'codigoDoFornecedor');
});

test('normalização de compatibilidade não altera o digest dos pedidos já explícitos', () => {
  const payload = { ...base, tipoDoPagamento: 'NF', tipoDeItem: 'Serviço', dataDeVencimento: '09/11/2026', valorTotal: '200,00',
    numeroDaNF: '94', dataDeEntrada: '28/10/2026', dataDeEmissao: '25/10/2026', serie: '', itens: [], tributos: [] };
  function digest(p) {
    const key = identidadePagamento(p);
    return hashIntencao(intencaoPagamento(p, key, planosPagamento(p, key), codigoMovimento(p)));
  }
  assert.equal(digest(payload), digest({ ...payload, CODCOLPGTO: '11', CODCOLCFO: '0' }));
  assert.equal(digest(payload), digest({ ...payload, idPagamento: composite() }));
});

test('compatibilidade não pula a leitura nativa nem permite criar com cadastro de outro fornecedor', async () => {
  const { executarPagamentoSeguro } = load(path.join(source, 'solicitacaoDePagamentoSeguro.ts'));
  const count = { reads: 0, reservations: 0, nativeWrites: 0, creates: 0 };
  const input = { ...base, tipoDaSolicitacao: 'PG', tipoDoPagamento: 'NF', tipoDeItem: 'Serviço',
    codigoDaFilial2: '1', ticketRaiz: '999001', dataDeVencimento: '09/11/2026', valorTotal: '200,00',
    numeroDaNF: '94', formaDePagamento: 'Boleto', codigoPagamento: 'I' };
  const rm = {
    consultarRetomada: async () => ({ movimentos: [], lancamentos: [] }),
    readReacord: async (pk, server) => {
      count.reads++;
      assert.equal(pk, '11;0;0000000001;3');
      assert.equal(server, 'FinDadosPgtoDataBR');
      return '<FinDadosPgtoBR><FDadosPgto><CODCOLIGADA>11</CODCOLIGADA><CODCOLCFO>0</CODCOLCFO>' +
        '<CODCFO>0000000002</CODCFO><IDPGTO>3</IDPGTO><ATIVO>1</ATIVO><FORMAPAGAMENTO>I</FORMAPAGAMENTO></FDadosPgto></FinDadosPgtoBR>';
    },
    saveRecord: async () => { count.nativeWrites++; throw new Error('Native writes forbidden'); },
  };
  const repositorio = {
    consultar: async () => undefined,
    concluida: async () => undefined,
    reservar: async () => { count.reservations++; throw new Error('Reservations forbidden'); },
  };
  const response = await executarPagamentoSeguro(input, { getRemainingTimeInMillis: () => 30000 },
    async () => { count.creates++; throw new Error('Creation forbidden'); }, { rm, repositorio });
  assert.equal(response.statusCode, 422);
  assert.equal(JSON.parse(response.body).code, 'IDPGTO_NAO_CONFIRMADO', 'The public error contract stays unchanged');
  assert.deepEqual(count, { reads: 1, reservations: 0, nativeWrites: 0, creates: 0 });
});
