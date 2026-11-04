import { createHash } from 'node:crypto';

// Persisted diagnostics contain only fixed codes/names and hashes. The separate
// presentation helper below must never be added to this diagnostic contract.
const campos = ['CODTRB', 'CODTRBBASE', 'CODIGOIRRF', 'IDNAT', 'CODTMV', 'IDPRD', 'CODCCUSTO',
  'SERIE', 'DATAEMISSAO', 'DATASAIDA', 'DATAVENCIMENTO', 'NUMEROMOV', 'IDPGTO', 'CODCOLPGTO'];
const tiposNativos = ['SqlException', 'ConstraintException', 'NoNullAllowedException', 'FormatException',
  'InvalidCastException', 'NullReferenceException', 'InvalidOperationException', 'ArgumentException'];
// Text markers classify diagnostics only; they never prove rollback or allow retry.
const motivos: Array<[string, RegExp]> = [
  ['RM_INVALID_FISCAL_NATURE', /\bNATUREZA(?:\s+(?:FISCAL|DE\s+OPERACAO))?\s+INVALIDA\b/],
  ['RM_INVALID_REFERENCE', /FOREIGN KEY|CHAVE ESTRANGEIRA|CONFLITO[^\r\n]{0,80}REFERENC|REFERENCE CONSTRAINT/],
  ['RM_DUPLICATE_RECORD', /DUPLICATE (?:KEY|RECORD|ENTRY)|CHAVE DUPLICADA|VIOLATION OF UNIQUE|REGISTRO[^\r\n]{0,60}JA EXISTE|\bJA\s+EXISTE\s+NOTA\s+DO\s+EMITENTE\s+COM\s+ESTE\s+NUMERO\s+E\s+SERIE\b/],
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

// Presentation only: never log or persist this excerpt as diagnostic evidence.
// Prefer no excerpt over reflecting a technical response or sensitive identifier.
export function resumirMensagemNegocioRm(retorno: string): string | undefined {
  if (typeof retorno !== 'string' || !retorno.trim() || retorno.length > 100000) return undefined;
  const linha = retorno.replace(/&#(?:x0*d|x0*a|0*13|0*10);/gi, '\n').trimStart()
    .split(/={3,}|\r\n|[\r\n]|\s+(?:at|em)\s+(?:RM|System|Microsoft)\./, 1)[0].trim().normalize('NFKC');
  if (!linha || /[\p{Cc}\p{Cf}]/u.test(linha.replace(/\t/g, ''))) return undefined;
  const mensagem = linha.replace(/\s+/g, ' ');
  if (/[^\p{Script=Latin}\p{M}0-9 .,:;!?"'()\/\-–—“”‘’]/u.test(mensagem)) return undefined;
  if (/^"[\s\S]*"$/.test(mensagem) || /\b(?:content-type|content-length|user-agent|soapaction|accept|location|connection|cache-control|etag|origin|referer|x-[a-z0-9-]+)\s*:/i.test(mensagem)) return undefined;
  if (/@|&(?:#\w+|[a-z]+);/i.test(mensagem)) return undefined;
  if (/\b(?:authorization|cookie|set-cookie|x-api-key|x-amz|password|passwd|senha|secret|segredo|token|bearer|basic|credentials?|credencia\w*|sessionid|connection\s*string|user\s*id|uid|pwd|access\s*key|client\s*secret)\b/i.test(mensagem)) return undefined;
  if (/\b(?:cpf|cnpj|conta|contas|ag[eê]ncia|pix|dados\s+banc[aá]rios)\b/i.test(mensagem) || /(?:\d[ .\/()-]*){6}/.test(mensagem)) return undefined;
  if (/\b(?:select|insert|update|delete|merge|exec(?:ute)?|truncate|alter|drop|create|where|join|from|dbo|sql\w*|constraint|primary\s+key|foreign\s+key|server|database|host|catalog|exception|stacktrace)\b/i.test(mensagem)) return undefined;
  if (/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|\b[a-z0-9-]+\.[a-z]{2,}\b|(?:\d{1,3}\.){3}\d{1,3}|[a-z]:[\/]/i.test(mensagem)) return undefined;
  const palavras = mensagem.match(/[A-Za-z0-9+\/-]{8,}/g) || [];
  if (palavras.some(p => {
    if (p.length >= 24 || /^[a-f0-9]{16,}$/i.test(p) || (p.length >= 16 && /\d|[+/\-]|[a-z][A-Z]|[A-Z]{2}/.test(p))) return true;
    const decodificado = Buffer.from(p, 'base64').toString('utf8');
    return decodificado.length >= 4 && /^[\x20-\x7e]+$/.test(decodificado) &&
      Buffer.from(decodificado).toString('base64').replace(/=+$/, '') === p;
  })) return undefined;
  if ((mensagem.match(/[\p{Script=Latin}\p{M}]{2,}/gu) || []).length < 2 ||
      !/\b(?:s[eé]rie|series|n[uú]mero|number|documento|document|nota|campo|field|natureza|produto|item|per[ií]odo|permiss[aã]o|acesso|data|date|valor|fornecedor|filial|coligada|opera[cç][aã]o|cadastro|lan[cç]amento|registro|record)\b/i.test(mensagem)) return undefined;
  if (mensagem.length <= 300) return mensagem;
  const trecho = mensagem.slice(0, 299).replace(/\s+\S*$/, '').trimEnd();
  return trecho ? `${trecho}…` : undefined;
}

const tiposErro = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AxiosError', 'CanceledError',
  'TimeoutError', 'AbortError', 'ConditionalCheckFailedException', 'ProvisionedThroughputExceededException',
  'ThrottlingException', 'UnknownError'];
export const tipoErroSeguro = (erro: unknown): string =>
  erro instanceof Error && tiposErro.includes(erro.name) ? erro.name : 'UnknownError';
