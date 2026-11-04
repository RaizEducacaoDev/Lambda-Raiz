import { createHash } from 'node:crypto';
import { dataCanonica, valorCanonico, type CamposPagamento, type PlanoParcela } from './pagamentoIdentidade';
import type { DocumentoValidado } from './pagamentoDocumento';
import { diagnosticarRetornoRm } from './pagamentoDiagnosticoSeguro';

export type EvidenciaPagamento = {
  version: 1; phase: 'prepared' | 'native_result'; xmlSha256: string;
  movementType: string; company: string; branch: string; ticket: string;
  supplierCompany: string; supplier: string; paymentId: string; paymentCompany: string;
  number: string; series: string; documentType: string; issueDate: string; entryDate: string; total: string;
  installments: Array<{ dueDate: string; amount: string; destinationSha256: string }>;
  diagnostic?: ReturnType<typeof diagnosticarRetornoRm>;
};
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');

export function prepararEvidencia(xml: string, entrada: CamposPagamento, tipo: string,
  chave: { codColPgto: string; codColCfo: string; codCfo: string; idPgto: number },
  filial: string, ticket: string, planos: PlanoParcela[], documento?: DocumentoValidado): EvidenciaPagamento {
  return { version: 1, phase: 'prepared', xmlSha256: sha(xml), movementType: tipo,
    company: chave.codColPgto, branch: filial, ticket, supplierCompany: chave.codColCfo, supplier: chave.codCfo,
    paymentId: String(chave.idPgto), paymentCompany: chave.codColPgto,
    number: entrada.numeroDaNF, series: documento?.serie || '', documentType: documento?.tipoDocumento || '',
    issueDate: entrada.dataDeEmissao ? dataCanonica(entrada.dataDeEmissao) : '',
    entryDate: entrada.dataDeEntrada ? dataCanonica(entrada.dataDeEntrada) : '', total: valorCanonico(entrada.valorTotal),
    installments: planos.map(p => ({ dueDate: p.vencimento, amount: p.valor, destinationSha256: sha(JSON.stringify(p.campos)) })) };
}

// Defense in depth at the persistence boundary: no arbitrary object, response
// text, bank value, XML, URL, header or exception can be written as evidence.
export function validarEvidencia(e: EvidenciaPagamento): void {
  const keys = ['version', 'phase', 'xmlSha256', 'movementType', 'company', 'branch', 'ticket', 'supplierCompany',
    'supplier', 'paymentId', 'paymentCompany', 'number', 'series', 'documentType', 'issueDate', 'entryDate', 'total', 'installments', 'diagnostic'];
  const bad = () => { throw new Error('Evidência sanitizada inválida'); };
  if (!e || Object.keys(e).some(k => !keys.includes(k)) || e.version !== 1 || !['prepared', 'native_result'].includes(e.phase)) return bad();
  if (keys.filter(k => !['version', 'phase', 'installments', 'diagnostic'].includes(k)).some(k =>
    typeof (e as unknown as Record<string, unknown>)[k] !== 'string')) return bad();
  for (const k of ['company', 'branch', 'ticket', 'paymentId', 'paymentCompany'] as const) if (!/^[1-9]\d*$/.test(e[k])) return bad();
  if (!/^(?:0|[1-9]\d*)$/.test(e.supplierCompany) || !/^[A-Za-z0-9._-]{1,30}$/.test(e.supplier) ||
    !/^1\.2\.\d{2}$/.test(e.movementType) || !/^[a-f0-9]{64}$/.test(e.xmlSha256) || !/^\d{1,35}$/.test(e.number) ||
    !/^[A-Za-z0-9._-]{0,5}$/.test(e.series) || !/^[A-Za-z0-9._-]{0,10}$/.test(e.documentType) ||
    !/^\d+\.\d+$/.test(e.total) || ![e.issueDate, e.entryDate].every(d => d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d))) return bad();
  if (!Array.isArray(e.installments) || !e.installments.length || e.installments.length > 1000 || e.installments.some(p =>
    !p || Object.keys(p).sort().join(',') !== 'amount,destinationSha256,dueDate' ||
    !Object.values(p).every(v => typeof v === 'string') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) || !/^\d+\.\d+$/.test(p.amount) || !/^[a-f0-9]{64}$/.test(p.destinationSha256))) return bad();
  if (e.phase === 'prepared' && e.diagnostic !== undefined) return bad();
  if (e.phase === 'native_result') {
    const d = e.diagnostic;
    // Generate the set of allowed keys/names from the diagnostic's fixed contract.
    const empty = diagnosticarRetornoRm('');
    const reasons = ['RM_PRIMARY_KEY_COMPANY_MISMATCH', 'RM_INVALID_REFERENCE', 'RM_DUPLICATE_RECORD', 'RM_REQUIRED_FIELD',
      'RM_PERIOD_CLOSED', 'RM_PERMISSION_DENIED', 'RM_INVALID_DATE', 'RM_INVALID_FORMAT', 'RM_SQL_EXCEPTION', 'RM_UNCLASSIFIED_REJECTION', 'RM_UNEXPECTED_RESULT'];
    const fields = diagnosticarRetornoRm('CODTRB CODTRBBASE CODIGOIRRF IDNAT CODTMV IDPRD CODCCUSTO SERIE DATAEMISSAO DATASAIDA DATAVENCIMENTO NUMEROMOV IDPGTO CODCOLPGTO').mentionedFields;
    const types = diagnosticarRetornoRm('SqlException ConstraintException NoNullAllowedException FormatException InvalidCastException NullReferenceException InvalidOperationException ArgumentException').nativeErrorTypes;
    if (!d || Object.keys(d).sort().join(',') !== Object.keys(empty).sort().join(',') || !reasons.includes(d.reasonCode) ||
      !['rm_rejection_or_diagnostic', 'unexpected_result'].includes(d.category) || d.reasonSource !== 'allowlist_v1' ||
      !/^[a-f0-9]{64}$/.test(d.responseSha256) || !Number.isSafeInteger(d.length) || d.length < 0 || !Number.isSafeInteger(d.lineCount) || d.lineCount < 1 ||
      !Array.isArray(d.mentionedFields) || d.mentionedFields.some(f => !fields.includes(f)) ||
      !Array.isArray(d.nativeErrorTypes) || d.nativeErrorTypes.some(t => !types.includes(t))) return bad();
  }
}

export function mensagemDiagnostico(code: string): string {
  const motivos: Record<string, string> = {
    RM_DUPLICATE_RECORD: 'O RM indicou documento ou registro duplicado. Revise número e série do documento fiscal.',
    RM_INVALID_REFERENCE: 'O RM indicou uma referência cadastral inválida. Revise os cadastros fiscal, de itens e de destino.',
    RM_REQUIRED_FIELD: 'O RM indicou um campo obrigatório ausente. Revise os dados do documento na tarefa de origem.',
    RM_PERIOD_CLOSED: 'O RM indicou período fechado. Solicite a conferência do período ao responsável pelo RM.',
    RM_PERMISSION_DENIED: 'O RM indicou falta de permissão para esta operação. Solicite a revisão do acesso da integração.',
    RM_INVALID_DATE: 'O RM indicou data inválida. Revise as datas do documento.',
    RM_INVALID_FORMAT: 'O RM indicou formato inválido em um campo do documento.',
  };
  return (motivos[code] || 'O RM não confirmou a chave do movimento.') +
    ' A integração conferirá um movimento existente antes de continuar; este resultado não autoriza uma nova criação.';
}
