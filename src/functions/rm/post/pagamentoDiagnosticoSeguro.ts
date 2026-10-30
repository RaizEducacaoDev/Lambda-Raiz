import { createHash } from 'node:crypto';

// Only fixed codes/names leave this module. Never emit a response excerpt,
// exception message, SQL constraint name or a captured regular-expression group.
const campos = ['CODTRB', 'CODTRBBASE', 'CODIGOIRRF', 'IDNAT', 'CODTMV', 'IDPRD', 'CODCCUSTO',
  'SERIE', 'DATAEMISSAO', 'DATASAIDA', 'DATAVENCIMENTO', 'NUMEROMOV', 'IDPGTO', 'CODCOLPGTO'];
const tiposNativos = ['SqlException', 'ConstraintException', 'NoNullAllowedException', 'FormatException',
  'InvalidCastException', 'NullReferenceException', 'InvalidOperationException', 'ArgumentException'];
const motivos: Array<[string, RegExp]> = [
  ['RM_INVALID_REFERENCE', /FOREIGN KEY|CHAVE ESTRANGEIRA|CONFLITO[^\r\n]{0,80}REFERENC|REFERENCE CONSTRAINT/],
  ['RM_DUPLICATE_RECORD', /DUPLICATE (?:KEY|RECORD|ENTRY)|CHAVE DUPLICADA|VIOLATION OF UNIQUE|REGISTRO[^\r\n]{0,60}JA EXISTE/],
  ['RM_REQUIRED_FIELD', /CANNOT INSERT THE VALUE NULL|NO NULL ALLOWED|(?:CAMPO|COLUNA|FIELD)[^\r\n]{0,120}(?:OBRIGATOR|REQUIRED|NAO (?:FOI )?(?:INFORMAD|PREENCHID)|CANNOT BE NULL)/],
  ['RM_PERIOD_CLOSED', /PERIODO[^\r\n]{0,80}FECHAD|CLOSED[^\r\n]{0,40}PERIOD|PERIOD[^\r\n]{0,40}CLOSED/],
  ['RM_PERMISSION_DENIED', /ACCESS DENIED|ACESSO NEGADO|SEM PERMISSAO|NAO (?:TEM|POSSUI) PERMISSAO/],
  ['RM_INVALID_DATE', /(?:DATA|DATE)[^\r\n]{0,70}INVALID|INVALID[^\r\n]{0,40}(?:DATA|DATE)/],
  ['RM_INVALID_FORMAT', /INPUT STRING WAS NOT IN A CORRECT FORMAT|ERRO DE CONVERSAO|CONVERSION FAILED|FORMATO[^\r\n]{0,40}INVALID/],
  ['RM_SQL_EXCEPTION', /\bSQLEXCEPTION\b/],
];

export function diagnosticarRetornoRm(retorno: string, chaveDeOutraColigada = false) {
  const normalizado = retorno.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const categoria = /=+|\bat RM\./.test(retorno) ? 'rm_rejection_or_diagnostic' : 'unexpected_result';
  return {
    category: categoria,
    reasonCode: chaveDeOutraColigada ? 'RM_PRIMARY_KEY_COMPANY_MISMATCH' :
      motivos.find(([, padrao]) => padrao.test(normalizado))?.[0] ||
        (categoria === 'rm_rejection_or_diagnostic' ? 'RM_UNCLASSIFIED_REJECTION' : 'RM_UNEXPECTED_RESULT'),
    reasonSource: 'allowlist_v1',
    responseSha256: createHash('sha256').update(retorno).digest('hex'),
    length: retorno.length,
    lineCount: retorno.split(/\r\n|\r|\n/).length,
    mentionedFields: campos.filter(campo => new RegExp(`\\b${campo}\\b`).test(normalizado)),
    nativeErrorTypes: tiposNativos.filter(tipo => new RegExp(`\\b${tipo.toUpperCase()}\\b`).test(normalizado)),
  };
}

const tiposErro = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AxiosError', 'CanceledError',
  'TimeoutError', 'AbortError', 'ConditionalCheckFailedException', 'ProvisionedThroughputExceededException',
  'ThrottlingException', 'UnknownError'];
export const tipoErroSeguro = (erro: unknown): string =>
  erro instanceof Error && tiposErro.includes(erro.name) ? erro.name : 'UnknownError';
