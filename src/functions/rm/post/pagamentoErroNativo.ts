import { XMLParser, XMLValidator } from 'fast-xml-parser';

const xmlParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
const camposMensagem = ['Message', 'message', 'Mensagem', 'mensagem', 'ExceptionMessage', 'exceptionMessage',
  'errorMessage', 'ErrorMessage', 'detailedMessage', 'DetailedMessage', 'faultstring', 'Text'];
const camposErro = ['error', 'Error', 'erro', 'Erro', 'errors', 'Errors', 'detail', 'Detail', 'details', 'Details',
  'Reason', 'reason', 'Fault', 'ExceptionDetail', 'InnerException', 'innerException'];
const decodificar = (texto: string): string => texto.replace(/&(?:#(x[0-9a-f]+|\d+)|(lt|gt|amp|quot|apos));/gi, (todo, numero: string, nome: string) => {
  if (numero) {
    const valor = numero[0].toLowerCase() === 'x' ? parseInt(numero.slice(1), 16) : Number(numero);
    return valor > 0 && valor <= 0x10ffff ? String.fromCodePoint(valor) : '';
  }
  return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[nome.toLowerCase()] || todo;
});
const retirarXmlFinanceiro = (texto: string): string => texto
  .replace(/<(?:[\w.-]+:)?(?:NewDataSet|DataSet|MovMovimento|FinLAN|FinDadosPgto|TMOV|TMOVCOMPL|TITMMOV|TMOVPAGTO|FLAN|FDadosPgto)\b[^>]*\/>/gi, '[XML FINANCEIRO OCULTO]')
  .replace(/<(?:[\w.-]+:)?(NewDataSet|DataSet|MovMovimento|FinLAN|FinDadosPgto|TMOV|TMOVCOMPL|TITMMOV|TMOVPAGTO|FLAN|FDadosPgto)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?\1\s*>/gi, '[XML FINANCEIRO OCULTO]')
  // An incomplete dataset cannot safely be reflected as text either.
  .replace(/<(?:[\w.-]+:)?(?:NewDataSet|DataSet|MovMovimento|FinLAN|FinDadosPgto|TMOV|TMOVCOMPL|TITMMOV|TMOVPAGTO|FLAN|FDadosPgto)\b[\s\S]*$/gi, '[XML FINANCEIRO OCULTO]');

/** Redact values, never discard the useful diagnostic because it contains an
 * operational identifier, an unfamiliar phrase, SQL names or replacement chars.
 * This accepts native error text only, never an Axios exception/config object. */
export function sanitizarTextoErroRm(valor: string, limite = 16000): string {
  let texto = valor.slice(0, 200000);
  for (let n = 0; n < 3; n++) texto = decodificar(texto);
  texto = retirarXmlFinanceiro(texto).normalize('NFC').replace(/\r\n?/g, '\n');
  const senha = process.env.PASSWORD_TOTVS || '';
  const usuario = process.env.USERNAME_TOTVS || '';
  for (const segredo of [senha, usuario && senha ? Buffer.from(`${usuario}:${senha}`).toString('base64') : '']) {
    if (segredo.length >= 4) texto = texto.split(segredo).join('[OCULTO]');
  }
  texto = texto
    .replace(/<(?:\w+:)?(password|passwd|pwd|senha|token|secret|authorization|connectionstring|cpf|cnpj|conta|agencia|chavepix|codigobarra|ipte|qrcodepix|chaveacesso|historico|observacao)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1\s*>/gi, '$1=[OCULTO]')
    .replace(/\b(?:connection\s*string|connectionstring|string\s+de\s+conex[aã]o)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi, 'Conexão=[OCULTO]')
    .replace(/\b(?:server|data\s*source)\s*=\s*[^\r\n]*;[^\r\n]*(?:password|pwd|user\s*id|uid)\s*=[^\r\n]*/gi, 'Conexão=[OCULTO]')
    .replace(/\b(authorization|proxy-authorization|x-api-key|x-amz-security-token)\s*["']?\s*[:=]\s*(?:["'][^"'\r\n]*["']|(?:(?:Basic|Bearer)\s+)?[^\s;,}\r\n]+)/gi, '$1=[OCULTO]')
    .replace(/\b(cookie|set-cookie)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;\r\n]+(?:;[\t ]*[A-Za-z0-9_-]+=[^\s;\r\n]+)*)/gi, '$1=[OCULTO]')
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+\/_=.~-]+/gi, '$1 [OCULTO]')
    .replace(/\b(password|passwd|pwd|senha|secret|segredo|token|access\s*key|client\s*secret|sessionid|user\s*id|uid)\b\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;,}\r\n]+)/gi, '$1=[OCULTO]')
    .replace(/\b((?:cpf|cnpj)\b\s*(?:(?:do|da)\s+(?:fornecedor|titular|cliente)\s*)?["']?\s*[:=]?\s*)["']?\d[\d.\/\s-]{7,}\d["']?/gi, '$1[OCULTO]')
    .replace(/\b((?:conta(?:\s+(?:corrente|banc[aá]ria))?|ag[eê]ncia)\b\s*["']?\s*[:=]?\s*)["']?\d[\d.\/-]{2,}["']?/gi, '$1[OCULTO]')
    .replace(/\b(chave\s*pix\b\s*["']?\s*[:=]\s*)["']?[^\s;,}\r\n]+/gi, '$1[OCULTO]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[DOCUMENTO OCULTO]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL OCULTO]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[TOKEN OCULTO]')
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, '[URL OCULTA]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n<>]+/g, '[CAMINHO OCULTO]')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '[CONTEÚDO REMOVIDO]')
    .replace(/</g, '‹').replace(/>/g, '›')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  return texto.length <= limite ? texto : `${texto.slice(0, limite)}… [retorno truncado]`;
}

/** Extract error fields, not record datasets, request bodies, headers or config. */
export function extrairTextoErroRm(valor: unknown, profundidade = 0): string | undefined {
  if (profundidade > 5 || valor === null || valor === undefined) return undefined;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (!texto || texto.length > 200000) return undefined;
    if (/^<(?:!doctype\s+html|html)\b/i.test(texto)) {
      // HTML is reduced to inert text, never parsed as XML or fetched/rendered.
      return retirarXmlFinanceiro(texto).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(texto)) return undefined;
    if (/^[{[]/.test(texto)) {
      try { return extrairTextoErroRm(JSON.parse(texto), profundidade + 1); } catch { /* Native plain text can start with a bracket. */ }
    }
    if (texto.startsWith('<')) {
      if (XMLValidator.validate(texto) === true) {
        const objeto = xmlParser.parse(texto) as Record<string, unknown>;
        const envelope = objeto.Envelope as Record<string, unknown> | undefined;
        const body = envelope?.Body as Record<string, unknown> | undefined;
        if (body?.Fault) return extrairTextoErroRm(body.Fault, profundidade + 1);
        for (const chave of ['Error', 'error', 'Erro', 'erro', 'Fault']) {
          if (objeto[chave]) return extrairTextoErroRm(objeto[chave], profundidade + 1);
        }
      }
      return undefined;
    }
    return texto;
  }
  if (Array.isArray(valor)) {
    return valor.slice(0, 10).map(v => extrairTextoErroRm(v, profundidade + 1)).filter(Boolean).join('\n') || undefined;
  }
  if (typeof valor !== 'object') return undefined;
  const objeto = valor as Record<string, unknown>;
  const mensagens = camposMensagem.flatMap(campo => typeof objeto[campo] === 'string' ? [objeto[campo] as string] : []);
  for (const campo of camposErro) {
    const texto = extrairTextoErroRm(objeto[campo], profundidade + 1);
    if (texto) mensagens.push(texto);
  }
  return [...new Set(mensagens.map(v => v.trim()).filter(Boolean))].join('\n') || undefined;
}

export function mensagemNegocioRm(valor: unknown): string | undefined {
  const nativo = extrairTextoErroRm(valor);
  if (!nativo) return undefined;
  const texto = sanitizarTextoErroRm(nativo);
  const negocio = texto.split(/(?:^|\r?\n)[\t ]*(?:at|em)[\t ]+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|\s+(?:at|em)\s+(?:RM|System|Microsoft)\./, 1)[0]
    .replace(/={3,}/g, '').trim();
  return negocio ? sanitizarTextoErroRm(negocio.replace(/[\t ]+/g, ' '), 4000) : undefined;
}

export class ErroNativoRm extends Error {
  readonly name = 'ErroNativoRm';
  readonly mensagemNativa?: string;
  readonly diagnosticoNativo?: string;
  constructor(retorno: unknown, readonly codigo = 'RM_ERRO_NATIVO', readonly status: 400 | 503 = 503) {
    const texto = extrairTextoErroRm(retorno);
    const mensagem = mensagemNegocioRm(texto);
    super(mensagem || 'O TOTVS devolveu uma resposta de erro sem descrição utilizável.');
    this.mensagemNativa = mensagem;
    this.diagnosticoNativo = texto ? sanitizarTextoErroRm(texto) : undefined;
  }
}

export function erroHttpRm(erro: unknown): ErroNativoRm | undefined {
  if (!erro || typeof erro !== 'object') return undefined;
  const resposta = (erro as { response?: { status?: unknown; data?: unknown } }).response;
  if (!resposta || typeof resposta.status !== 'number' || resposta.status < 400) return undefined;
  const texto = extrairTextoErroRm(resposta.data);
  return texto ? new ErroNativoRm(texto, 'RM_ERRO_HTTP', resposta.status < 500 ? 400 : 503) : undefined;
}
