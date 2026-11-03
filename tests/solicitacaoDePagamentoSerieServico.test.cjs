const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const loadTs = require('./load-ts.cjs');

const forbidden = async () => { throw new Error('Network/legacy RM access forbidden in offline test'); };
const { handlerLegado } = loadTs(path.resolve(__dirname, '../src/functions/rm/post/solicitacaoDePagamentoLegado.ts'), {
  '../../../utils/wsDataserver': { wsDataserver: class { saveRecord = forbidden; readReacord = forbidden; } },
  '../../../utils/classRm': { ConfigManagerRm: class { getLOC = forbidden; getIdMovPorTicket = forbidden; } },
  axios: { get: forbidden, post: forbidden, request: forbidden },
});
const parser = new XMLParser({ parseTagValue: false });
const payload = {
  ticketRaiz: '9003', atividadeAtual: 'TS03', tipoDaSolicitacao: 'PG', tipoDoPagamento: 'NF', tipoDeItem: 'Serviço',
  codigoDaColigada2: '9', codigoDaFilial2: '3', codigoDoFornecedor: '0000000001', CODCOLCFO: '0',
  idpgto: '3', idPagamento: '9$_$0$_$0000000001$_$3', CODCOLPGTO: '9',
  numeroDaNF: '114', serie: '70000', dataDeEmissao: '22/10/2026', dataDeEntrada: '30/10/2026',
  dataDeVencimento: '06/11/2026', codigoDaFormaPagamento: '001', valorTotal: '1,00', outrasDespesas: '0,00',
  codigoDoCentroDeCusto: '1.02.018', codigoDaNaturezaFiscal: '1.949.01', idDaNaturezaFiscal: '27',
  tributosCodigoDaReceita: '17080', informacoes: 'OFFLINE SERIES TEST', listaDeParcelas: [], tributos: [],
  itens: [{ codigoDaNatureza: '02.01.00034', coligadaDaNatureza: '0', codigoDoItem: '124113',
    qtdDoItem: '1', valorDoItem: '1,00', desconto: '0,00' }],
  chaveDeAcesso: '', tipoDeFrete: '0', valorDoFrete: '0,00',
};

async function capture(overrides = {}) {
  const input = { ...payload, ...overrides };
  const before = structuredClone(input);
  const calls = [];
  const response = await handlerLegado({ body: JSON.stringify(input) }, {
    getLOC: async (company, branch) => {
      assert.equal(company, '9'); assert.equal(branch, '3'); return '01.001';
    },
    transporte: { saveRecord: async (xml, server, context) => {
      calls.push({ xml, server, context }); return '9;9001';
    } },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { PG: '9001' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].server, 'MovMovimentoTBCData');
  assert.equal(calls[0].context, 'CODCOLIGADA=9;CODUSUARIO=p_heflo');
  assert.deepEqual(input, before);
  const xml = calls[0].xml;
  assert.ok(xml.startsWith('<![CDATA[') && xml.endsWith(']]>'));
  const document = xml.slice(9, -3);
  assert.equal(XMLValidator.validate(document), true);
  return { xml, document, data: parser.parse(document).MovMovimento, input };
}

test('NF de serviço1.2.03 envia a série explícita70000 no XML real do handler', async () => {
  const result = await capture();
  assert.equal(result.data.TMOV.CODTMV, '1.2.03');
  assert.equal(result.data.TMOV.SERIE, '70000');
});

test('serviço sem série informada continua omitindo a tag e usando o default nativo', async () => {
  for (const serie of [undefined, null, '', '  ']) {
    const result = await capture({ serie });
    assert.equal(Object.hasOwn(result.data.TMOV, 'SERIE'), false);
    assert.doesNotMatch(result.document, /<SERIE(?:>|\s*\/)/);
  }
});

test('série de serviço conserva zeros à esquerda e o escape XML existente', async () => {
  for (const serie of ['00070000', '0', 'A&B<1']) {
    const result = await capture({ serie });
    assert.equal(result.data.TMOV.SERIE, serie);
  }
  assert.match((await capture({ serie: 'A&B<1' })).document, /<SERIE>A&amp;B&lt;1<\/SERIE>/);
});

test('NF material e transporte mantêm a série existente, inclusive a tag vazia', async () => {
  for (const [fields, codTmv] of [[{ tipoDeItem: 'Material' }, '1.2.01'],
    [{ tipoDoPagamento: 'TM', tipoDeItem: '' }, '1.2.25']]) {
    const supplied = await capture({ ...fields, serie: '00070000' });
    assert.equal(supplied.data.TMOV.CODTMV, codTmv);
    assert.equal(supplied.data.TMOV.SERIE, '00070000');
    const absent = await capture({ ...fields, serie: undefined });
    assert.equal(Object.hasOwn(absent.data.TMOV, 'SERIE'), true);
    assert.equal(absent.data.TMOV.SERIE, '');
  }
});

test('conta de consumo mantém a omissão de série mesmo se o campo vier preenchido', async () => {
  const result = await capture({ tipoDoPagamento: 'CC', tipoDeItem: '', contasDeConsumo: 'E' });
  assert.equal(result.data.TMOV.CODTMV, '1.2.10');
  assert.equal(Object.hasOwn(result.data.TMOV, 'SERIE'), false);
});

test('incluir série de serviço altera somente SERIE e preserva número, datas e identidade bancária', async () => {
  const original = await capture({ serie: undefined });
  const explicit = await capture();
  assert.equal(explicit.document.replace('<SERIE>70000</SERIE>', ''), original.document);
  for (const [name, value] of Object.entries({ NUMEROMOV: '114', CODCOLIGADA: '9', CODFILIAL: '3',
    CODCFO: '0000000001', CODCOLCFO: '0', DATAEMISSAO: '2026-10-22T00:00:00', DATASAIDA: '2026-10-30T00:00:00' })) {
    assert.equal(explicit.data.TMOV[name], value, name);
  }
  assert.equal(explicit.data.TMOVPAGTO.DATAVENCIMENTO, '2026-11-06T00:00:00');
  for (const field of ['idpgto', 'idPagamento', 'CODCOLPGTO', 'CODCOLCFO']) {
    assert.equal(explicit.input[field], payload[field], field);
  }
  assert.deepEqual(explicit.data.TMOVPAGTO, original.data.TMOVPAGTO);
  assert.deepEqual(explicit.data.TITMMOV, original.data.TITMMOV);
  assert.deepEqual(explicit.data.TMOVCOMPL, original.data.TMOVCOMPL);
});
