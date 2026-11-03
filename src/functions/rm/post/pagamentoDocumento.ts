import { PagamentoInvalido } from './pagamentoIdentidade';

export type ChaveDocumento = {
  codColigada: string; codFilial: string; codColCfo: string; codCfo: string;
  codTmv: string; numero: string; serie: string;
};
export type DocumentoValidado = { serie: string; numero: string; tipoDocumento: string };
type CodigoDocumento = 'SERIE_DOCUMENTO_INVALIDA' | 'DOCUMENTO_RM_DUPLICADO' | 'NUMERO_DOCUMENTO_INVALIDO';
export class DocumentoPagamentoInvalido extends PagamentoInvalido {
  constructor(readonly code: CodigoDocumento, mensagem: string) {
    super(mensagem); this.name = 'DocumentoPagamentoInvalido';
  }
}

export function prepararDocumento(entrada: Record<string, unknown>, chave: Omit<ChaveDocumento, 'numero' | 'serie'>): ChaveDocumento | undefined {
  if (chave.codTmv !== '1.2.03') return undefined;
  if (typeof entrada.numeroDaNF !== 'string' || !/^\d{1,9}$/.test(entrada.numeroDaNF)) {
    throw new DocumentoPagamentoInvalido('NUMERO_DOCUMENTO_INVALIDO', 'Informe o número da NFS-e com até nove dígitos, sem truncar o documento.');
  }
  const ausente = entrada.serie == null;
  if (!ausente && typeof entrada.serie !== 'string') {
    throw new DocumentoPagamentoInvalido('SERIE_DOCUMENTO_INVALIDA', 'Revise a série do documento fiscal no formulário.');
  }
  const serie = ausente ? '' : (entrada.serie as string).trim();
  if (!/^[A-Za-z0-9._-]{0,5}$/.test(serie)) {
    throw new DocumentoPagamentoInvalido('SERIE_DOCUMENTO_INVALIDA', 'Revise a série do documento fiscal: informe até cinco caracteres válidos.');
  }
  // No DPS/RPS inference, alternative series, numeric conversion or input mutation.
  return { ...chave, numero: entrada.numeroDaNF, serie };
}

const indisponivel = (): never => { throw new Error('Consulta do documento não confirmou o contrato completo; criação mantida pendente'); };
const inteiro = (valor: unknown, zero = false): number => {
  if (!['number', 'string'].includes(typeof valor) || !/^(?:0|[1-9]\d*)$/.test(String(valor)) ||
    !Number.isSafeInteger(Number(valor)) || Number(valor) < (zero ? 0 : 1)) return indisponivel();
  return Number(valor);
};
const texto = (valor: unknown, padrao: RegExp): string => typeof valor === 'string' && padrao.test(valor) ? valor : indisponivel();
const codigo = /^[A-Za-z0-9._-]+$/;
const metadados = ['DOC_VERSION', 'REQUEST_COMPANY', 'REQUEST_BRANCH', 'REQUEST_SUPPLIER_COMPANY', 'REQUEST_SUPPLIER',
  'REQUEST_MOVEMENT_TYPE', 'REQUEST_NUMBER', 'REQUEST_SERIES', 'HAS_MOVEMENT_TYPE', 'PRINCIPAL_COUNT', 'SERIES_MATCH_COUNT', 'DOC_MATCH_COUNT'];
const configuracao = ['MASK', 'EFFECTIVE_SERIES', 'EFFECTIVE_NUMBER', 'EFFECTIVE_DOCUMENT_TYPE'];
const movimento = ['CODCOLIGADA', 'IDMOV', 'CODFILIAL', 'CODCOLCFO', 'CODCFO', 'CODTMV', 'SERIE', 'NUMEROMOV',
  'CODTDO', 'CODCOLCFOAUX', 'CODCFOAUX', 'CRO', 'SUBSERIE', 'TICKET'];
const permitidos = new Set([...metadados, ...configuracao, ...movimento]);
const possui = (row: Record<string, unknown>, nome: string): boolean => Object.prototype.hasOwnProperty.call(row, nome);

// A read-only observation can prevent a new creation. It cannot authorize
// recreation, release CREATING, reuse a colliding movement or prove rollback.
export function validarDocumento(retorno: unknown, esperado: ChaveDocumento): DocumentoValidado {
  if (esperado.codTmv !== '1.2.03' || !/^\d{1,9}$/.test(esperado.numero) || !/^[A-Za-z0-9._-]{0,5}$/.test(esperado.serie)) indisponivel();
  const empresa = inteiro(esperado.codColigada), filial = inteiro(esperado.codFilial), empresaFornecedor = inteiro(esperado.codColCfo, true);
  texto(esperado.codCfo, codigo);
  if (!Array.isArray(retorno) || retorno.length === 0 || retorno.length > 10000) return indisponivel();
  let primeira: Record<string, unknown> | undefined;
  let assinatura: string | undefined;
  const ids = new Set<number>();
  for (const item of retorno) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return indisponivel();
    const row = item as Record<string, unknown>;
    if (metadados.some(nome => !possui(row, nome)) || Object.keys(row).some(nome => !permitidos.has(nome)) ||
      ![1, '1'].includes(row.DOC_VERSION as number | string) || inteiro(row.REQUEST_COMPANY) !== empresa ||
      inteiro(row.REQUEST_BRANCH) !== filial || inteiro(row.REQUEST_SUPPLIER_COMPANY, true) !== empresaFornecedor ||
      row.REQUEST_SUPPLIER !== esperado.codCfo || row.REQUEST_MOVEMENT_TYPE !== esperado.codTmv ||
      row.REQUEST_NUMBER !== esperado.numero || row.REQUEST_SERIES !== esperado.serie) return indisponivel();
    const has = inteiro(row.HAS_MOVEMENT_TYPE, true), principal = inteiro(row.PRINCIPAL_COUNT, true),
      vinculos = inteiro(row.SERIES_MATCH_COUNT, true), total = inteiro(row.DOC_MATCH_COUNT, true);
    if (has > 1 || total > 10000) return indisponivel();
    for (const nome of configuracao) {
      if (row[nome] != null && typeof row[nome] !== 'string') return indisponivel();
      if (has === 1 && !possui(row, nome)) return indisponivel();
    }
    const atual = JSON.stringify([has, principal, vinculos, total, ...configuracao.map(nome => row[nome] ?? null)]);
    if (assinatura !== undefined && assinatura !== atual) return indisponivel();
    assinatura = atual; primeira = row;
    if (total === 0) {
      // SQL JSON may omit NULL fields on the one-row zero sentinel.
      if (retorno.length !== 1 || movimento.some(nome => possui(row, nome) && row[nome] !== null)) return indisponivel();
      continue;
    }
    if (!has || total !== retorno.length) return indisponivel();
    const id = inteiro(row.IDMOV);
    if (ids.has(id) || inteiro(row.CODCOLIGADA) !== empresa || inteiro(row.CODFILIAL) !== filial ||
      inteiro(row.CODCOLCFOAUX, true) !== empresaFornecedor || row.CODCFOAUX !== esperado.codCfo ||
      row.SERIE !== row.EFFECTIVE_SERIES || row.NUMEROMOV !== row.EFFECTIVE_NUMBER || row.CODTDO !== row.EFFECTIVE_DOCUMENT_TYPE ||
      row.CRO != null || row.SUBSERIE != null) return indisponivel();
    texto(row.SERIE, /^[A-Za-z0-9._-]{1,5}$/); texto(row.NUMEROMOV, /^\d{1,9}$/);
    texto(row.CODTDO, /^[A-Za-z0-9._-]{1,10}$/); texto(row.CODTMV, /^\d+\.\d+\.\d+$/);
    // The native index uses AUX, not these nullable descriptive main fields.
    if (row.CODCOLCFO != null) inteiro(row.CODCOLCFO, true);
    if (row.CODCFO != null) texto(row.CODCFO, codigo);
    if (row.TICKET != null) texto(row.TICKET, /^\d{1,50}$/);
    ids.add(id);
  }
  const row = primeira!;
  if (inteiro(row.DOC_MATCH_COUNT, true) !== ids.size) return indisponivel();
  if (inteiro(row.HAS_MOVEMENT_TYPE, true) === 0) {
    throw new DocumentoPagamentoInvalido('SERIE_DOCUMENTO_INVALIDA', 'Tipo de movimento não localizado no destino. Revise o documento fiscal.');
  }
  const mascara = texto(row.MASK, /^#{1,9}$/);
  const numeroCabe = esperado.numero.length <= mascara.length;
  if (row.EFFECTIVE_NUMBER !== (numeroCabe ? esperado.numero.padStart(mascara.length, '0') : '')) return indisponivel();
  if (!numeroCabe) throw new DocumentoPagamentoInvalido('NUMERO_DOCUMENTO_INVALIDO', 'O número da NFS-e excede a máscara configurada no RM. Revise o documento sem truncar o número.');
  const principal = inteiro(row.PRINCIPAL_COUNT, true);
  if (!esperado.serie && principal !== 1) {
    if (row.EFFECTIVE_SERIES !== '' || principal > 1) return indisponivel();
    throw new DocumentoPagamentoInvalido('SERIE_DOCUMENTO_INVALIDA', 'Informe uma série fiscal válida: o tipo de movimento não possui série principal definida.');
  }
  const serie = texto(row.EFFECTIVE_SERIES, /^[A-Za-z0-9._-]{1,5}$/);
  if (esperado.serie && serie !== esperado.serie) return indisponivel();
  const tipoDocumento = texto(row.EFFECTIVE_DOCUMENT_TYPE, /^[A-Za-z0-9._-]{1,10}$/);
  const vinculos = inteiro(row.SERIES_MATCH_COUNT, true);
  if (vinculos > 1) return indisponivel();
  if (vinculos === 0) throw new DocumentoPagamentoInvalido('SERIE_DOCUMENTO_INVALIDA', 'A série informada não está vinculada ao tipo de movimento no RM. Revise a série fiscal do documento.');
  if (ids.size > 0) {
    throw new DocumentoPagamentoInvalido('DOCUMENTO_RM_DUPLICADO', 'Já existe documento no RM com a mesma identidade de numeração e série. Revise a NFS-e; o lançamento existente não será reutilizado.');
  }
  return { serie, numero: esperado.numero, tipoDocumento };
}
