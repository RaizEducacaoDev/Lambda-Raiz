const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const modules = new Map();
const load = file => require('./load-ts.cjs')(path.resolve(__dirname, '../src/functions/rm/post', file), {}, modules);
const { prepararDocumento, validarDocumento, DocumentoPagamentoInvalido } = load('pagamentoDocumento.ts');
const { PagamentoInvalido } = load('pagamentoIdentidade.ts');
const base = { codColigada: '9', codFilial: '3', codColCfo: '0', codCfo: '0000000001', codTmv: '1.2.03' };
const expected = { ...base, numero: '114', serie: '' };
const native = changes => ({ DOC_VERSION: 1, REQUEST_COMPANY: 9, REQUEST_BRANCH: 3, REQUEST_SUPPLIER_COMPANY: 0,
  REQUEST_SUPPLIER: base.codCfo, REQUEST_MOVEMENT_TYPE: '1.2.03', REQUEST_NUMBER: '114', REQUEST_SERIES: '',
  HAS_MOVEMENT_TYPE: 1, MASK: '#########', PRINCIPAL_COUNT: 1, SERIES_MATCH_COUNT: 1,
  EFFECTIVE_SERIES: '1', EFFECTIVE_NUMBER: '000000114', EFFECTIVE_DOCUMENT_TYPE: '002', DOC_MATCH_COUNT: 0, ...changes });
const match = changes => native({ DOC_MATCH_COUNT: 1, CODCOLIGADA: 9, IDMOV: 78497, CODFILIAL: 3,
  CODCOLCFO: 0, CODCFO: base.codCfo, CODTMV: '1.2.03', SERIE: '1', NUMEROMOV: '000000114', CODTDO: '002',
  CODCOLCFOAUX: 0, CODCFOAUX: base.codCfo, CRO: null, SUBSERIE: null, TICKET: '110229', ...changes });
const invalidContract = data => assert.throws(() => validarDocumento(data, expected), error => {
  assert.ok(error instanceof Error); assert.equal(error instanceof PagamentoInvalido, false);
  assert.equal(error.message.includes('PRIVATE'), false); return true;
});
const typed = (data, code, key = expected) => assert.throws(() => validarDocumento(data, key), error => {
  assert.ok(error instanceof DocumentoPagamentoInvalido); assert.ok(error instanceof PagamentoInvalido);
  assert.equal(error.code, code); return true;
});

test('preparação exclusiva1.2.03 conserva número/zeros/série e nunca infere DPS/NFN', () => {
  const input = { numeroDaNF: '000114', serie: '  00001 ', serieDaDPS: '70000', numeroDPS: '999', idpgto: '3' };
  const original = structuredClone(input);
  assert.deepEqual(prepararDocumento(input, base), { ...base, numero: '000114', serie: '00001' });
  assert.deepEqual(input, original);
  assert.deepEqual(prepararDocumento({ numeroDaNF: '114', serieDaDPS: '70000' }, base), expected);
  for (const codTmv of ['1.2.01', '1.2.10', '1.2.25']) assert.equal(prepararDocumento({}, { ...base, codTmv }), undefined);
});

test('número não é truncado nem convertido de formato ambíguo; série inválida é422 tipado', () => {
  for (const numeroDaNF of ['', '1234567890', '114/2026', '1.14', 114, null, {}]) {
    assert.throws(() => prepararDocumento({ numeroDaNF }, base), error => error.code === 'NUMERO_DOCUMENTO_INVALIDO');
  }
  for (const serie of ['123456', 'A&B', '<NFN>', {}, 1]) {
    assert.throws(() => prepararDocumento({ numeroDaNF: '114', serie }, base), error => error.code === 'SERIE_DOCUMENTO_INVALIDA');
  }
  assert.equal(prepararDocumento({ numeroDaNF: '114', serie: '0' }, base).serie, '0');
});

test('whitespace no número é rejeitado antes da consulta para não divergir do slice9 do montador', () => {
  for (const numeroDaNF of [' 123456789', '123456789 ', ' 114 ', '\t114', '114\n']) {
    assert.throws(() => prepararDocumento({ numeroDaNF, serie: '1' }, base),
      error => error instanceof DocumentoPagamentoInvalido && error.code === 'NUMERO_DOCUMENTO_INVALIDO', numeroDaNF);
  }
});

test('sentinela zero aceita SQLNULL omitido ou explícito e máscara/série principal comprovadas', () => {
  const snapshot = structuredClone(expected);
  assert.deepEqual(validarDocumento([native()], expected), { serie: '1', numero: '114', tipoDocumento: '002' });
  assert.deepEqual(expected, snapshot);
  const zero = native();
  for (const field of ['CODCOLIGADA', 'IDMOV', 'CODFILIAL', 'CODCOLCFO', 'CODCFO', 'CODTMV', 'SERIE',
    'NUMEROMOV', 'CODTDO', 'CODCOLCFOAUX', 'CODCFOAUX', 'CRO', 'SUBSERIE', 'TICKET']) zero[field] = null;
  assert.doesNotThrow(() => validarDocumento([zero], expected));
  invalidContract([native({ IDMOV: 0 })]); invalidContract([native({ TICKET: '' })]);
});

test('série explícita exige valor exato e vínculo, sem escolher principal ou NFN por descrição', () => {
  const explicit = { ...expected, serie: '00001' };
  assert.deepEqual(validarDocumento([native({ REQUEST_SERIES: '00001', EFFECTIVE_SERIES: '00001', PRINCIPAL_COUNT: 0 })], explicit),
    { serie: '00001', numero: '114', tipoDocumento: '002' });
  typed([native({ REQUEST_SERIES: '70000', EFFECTIVE_SERIES: '70000', SERIES_MATCH_COUNT: 0 })], 'SERIE_DOCUMENTO_INVALIDA', { ...expected, serie: '70000' });
  assert.throws(() => validarDocumento([native({ REQUEST_SERIES: '00001', EFFECTIVE_SERIES: '1' })], explicit), error => !(error instanceof PagamentoInvalido));
  assert.doesNotThrow(() => validarDocumento([native({ REQUEST_SERIES: 'NFN', EFFECTIVE_SERIES: 'NFN', PRINCIPAL_COUNT: 2 })], { ...expected, serie: 'NFN' }));
});

test('tipo/série sem cadastro são422; múltiplos defaults/vínculos ou máscara desconhecida são503', () => {
  const missingType = native({ HAS_MOVEMENT_TYPE: 0, PRINCIPAL_COUNT: 0, SERIES_MATCH_COUNT: 0, EFFECTIVE_SERIES: '', EFFECTIVE_NUMBER: '' });
  delete missingType.MASK; delete missingType.EFFECTIVE_DOCUMENT_TYPE;
  typed([missingType], 'SERIE_DOCUMENTO_INVALIDA');
  typed([native({ PRINCIPAL_COUNT: 0, EFFECTIVE_SERIES: '', SERIES_MATCH_COUNT: 0 })], 'SERIE_DOCUMENTO_INVALIDA');
  typed([native({ SERIES_MATCH_COUNT: 0 })], 'SERIE_DOCUMENTO_INVALIDA');
  for (const change of [{ PRINCIPAL_COUNT: 2, EFFECTIVE_SERIES: '' }, { SERIES_MATCH_COUNT: 2 },
    { MASK: '###.###' }, { MASK: '##########' }, { MASK: '' }, { MASK: null }]) invalidContract([native(change)]);
  typed([native({ MASK: '##', EFFECTIVE_NUMBER: '' })], 'NUMERO_DOCUMENTO_INVALIDO');
});

test('eco nativo é exato, globalCFO0 é aceito e número/série mantêm zeros', () => {
  assert.doesNotThrow(() => validarDocumento([native({ REQUEST_COMPANY: '9', REQUEST_BRANCH: '3', REQUEST_SUPPLIER_COMPANY: '0' })], expected));
  assert.deepEqual(validarDocumento([native({ REQUEST_NUMBER: '000114' })], { ...expected, numero: '000114' }),
    { serie: '1', numero: '000114', tipoDocumento: '002' });
  for (const change of [{ DOC_VERSION: 2 }, { REQUEST_COMPANY: 11 }, { REQUEST_BRANCH: 1 },
    { REQUEST_SUPPLIER_COMPANY: 9 }, { REQUEST_SUPPLIER: 'PRIVATE_OTHER' }, { REQUEST_SUPPLIER: 1 },
    { REQUEST_MOVEMENT_TYPE: '1.2.01' }, { REQUEST_NUMBER: '000114' }, { REQUEST_NUMBER: 114 },
    { REQUEST_SERIES: '1' }, { REQUEST_SERIES: null }]) invalidContract([native(change)]);
});

test('padding e dados efetivos não podem divergir da máscara/intenção', () => {
  for (const change of [{ EFFECTIVE_NUMBER: '114' }, { EFFECTIVE_NUMBER: '000000115' },
    { EFFECTIVE_NUMBER: 114 }, { EFFECTIVE_SERIES: null }, { EFFECTIVE_DOCUMENT_TYPE: null },
    { EFFECTIVE_DOCUMENT_TYPE: 2 }]) invalidContract([native(change)]);
  const missing = native(); delete missing.EFFECTIVE_SERIES; invalidContract([missing]);
});

test('colisão de identidade nativa bloqueia mesmo em outroCODTMV ou no mesmo ticket, sem reaproveitar', () => {
  typed([match()], 'DOCUMENTO_RM_DUPLICADO');
  typed([match({ CODTMV: '1.2.01', CODCFO: '0000000002', CODCOLCFO: 11, TICKET: '9003' })], 'DOCUMENTO_RM_DUPLICADO');
  const nullable = match();
  for (const field of ['CRO', 'SUBSERIE', 'CODCFO', 'CODCOLCFO', 'TICKET']) delete nullable[field];
  typed([nullable], 'DOCUMENTO_RM_DUPLICADO');
});

test('todas as nove partes da chave são conferidas;NULL é diferente de vazio', () => {
  for (const change of [{ CODCOLIGADA: 11 }, { CODFILIAL: 1 }, { CODCOLCFOAUX: 9 }, { CODCFOAUX: 'PRIVATE_OTHER' },
    { SERIE: 'NFN' }, { NUMEROMOV: '000000115' }, { CODTDO: '001' }, { CRO: 0 }, { SUBSERIE: '' },
    { CODCOLCFOAUX: null }, { CODTMV: 'invalid' }]) invalidContract([match(change)]);
});

test('contrato completo impede TOP/truncamento, linhas repetidas e metadados divergentes', () => {
  for (const data of [null, {}, [], [native(), native()], [match({ DOC_MATCH_COUNT: 2 })],
    [match({ DOC_MATCH_COUNT: 2 }), match({ DOC_MATCH_COUNT: 2 })],
    [match({ DOC_MATCH_COUNT: 2 }), match({ DOC_MATCH_COUNT: 1, IDMOV: 78498 })],
    [match({ DOC_MATCH_COUNT: 2 }), match({ DOC_MATCH_COUNT: 2, IDMOV: 78498, REQUEST_COMPANY: 11 })]]) invalidContract(data);
  typed([match({ DOC_MATCH_COUNT: 2 }), match({ DOC_MATCH_COUNT: 2, IDMOV: 78498 })], 'DOCUMENTO_RM_DUPLICADO');
});

test('contagens/tipos/metadados ausentes e campos extras com dados pessoais falham sem ecoar conteúdo', () => {
  for (const field of ['DOC_MATCH_COUNT', 'PRINCIPAL_COUNT', 'SERIES_MATCH_COUNT', 'REQUEST_SERIES', 'HAS_MOVEMENT_TYPE']) {
    const missing = native(); delete missing[field]; invalidContract([missing]);
  }
  for (const change of [{ DOC_MATCH_COUNT: true }, { DOC_MATCH_COUNT: '01' }, { DOC_MATCH_COUNT: -1 },
    { HAS_MOVEMENT_TYPE: 2 }, { SERIES_MATCH_COUNT: 9007199254740992 }, { PRIVATE_BANK: 'PRIVATE_ACCOUNT' }]) invalidContract([native(change)]);
});
