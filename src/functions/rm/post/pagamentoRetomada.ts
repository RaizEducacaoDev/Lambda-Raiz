import { dataCanonica, valorCanonico, type PlanoParcela } from './pagamentoIdentidade';
import { registroUnico, registrosRm } from './pagamentoV2Rm';

export type CensoRetomada = {
  movimentos: Array<{ coligada: string; idMov: string }>;
  lancamentos: Array<{ coligada: string; idMov: string; idLan: string; boletos: number }>;
};
const falhar = (): never => { throw new Error('Não foi possível confirmar todos os movimentos e lançamentos da solicitação'); };
const inteiro = (v: unknown, zero = false): string => {
  if (!['string', 'number'].includes(typeof v) || !/^(?:0|[1-9]\d*)$/.test(String(v)) ||
      !Number.isSafeInteger(Number(v)) || Number(v) < (zero ? 0 : 1)) return falhar();
  return String(v);
};
const campos = new Set(['RETOMADA_VERSION', 'REQUEST_COMPANY', 'REQUEST_TICKET', 'TOTAL_MOVEMENTS', 'TOTAL_LAUNCHES',
  'ROW_KIND', 'CODCOLIGADA', 'IDMOV', 'IDLAN', 'BOLETO_COUNT']);

// A zero observation never authorizes recreating an uncertain native request.
export function parsearCensoRetomada(retorno: unknown, coligada: string, ticket: string): CensoRetomada {
  inteiro(coligada); inteiro(ticket);
  if (!Array.isArray(retorno) || retorno.length === 0 || retorno.length > 10000) return falhar();
  const result: CensoRetomada = { movimentos: [], lancamentos: [] }, ids = new Set<string>();
  let signature: string | undefined, totalM = 0, totalF = 0;
  for (const item of retorno) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return falhar();
    const r = item as Record<string, unknown>;
    if (Object.keys(r).some(k => !campos.has(k)) || ![1, '1'].includes(r.RETOMADA_VERSION as number | string) ||
        inteiro(r.REQUEST_COMPANY) !== coligada || inteiro(r.REQUEST_TICKET) !== ticket) return falhar();
    totalM = Number(inteiro(r.TOTAL_MOVEMENTS, true)); totalF = Number(inteiro(r.TOTAL_LAUNCHES, true));
    if (totalM + totalF > 10000) return falhar();
    const current = `${totalM};${totalF}`;
    if (signature !== undefined && signature !== current) return falhar();
    signature = current;
    if (r.ROW_KIND === 'EMPTY') {
      if (retorno.length !== 1 || totalM !== 0 || totalF !== 0 ||
          ['CODCOLIGADA', 'IDMOV', 'IDLAN', 'BOLETO_COUNT'].some(k => r[k] != null)) return falhar();
      continue;
    }
    const company = inteiro(r.CODCOLIGADA), idMov = inteiro(r.IDMOV);
    if (r.ROW_KIND === 'MOV') {
      if (r.IDLAN != null || r.BOLETO_COUNT != null) return falhar();
      const key = `M;${company};${idMov}`;
      if (ids.has(key)) return falhar(); ids.add(key);
      result.movimentos.push({ coligada: company, idMov });
    } else if (r.ROW_KIND === 'LAN') {
      const idLan = inteiro(r.IDLAN), boletos = Number(inteiro(r.BOLETO_COUNT, true)), key = `F;${company};${idLan}`;
      if (ids.has(key)) return falhar(); ids.add(key);
      result.lancamentos.push({ coligada: company, idMov, idLan, boletos });
    } else return falhar();
  }
  if (result.movimentos.length !== totalM || result.lancamentos.length !== totalF ||
      result.lancamentos.some(f => !result.movimentos.some(m => m.coligada === f.coligada && m.idMov === f.idMov))) return falhar();
  return result;
}

export type ExpectativaRetomada = {
  coligada: string; filial: string; fornecedor: string; coligadaFornecedor: string; ticket: string;
  idMov: string; tipo: string; numero: string; serie: string; tipoDocumento: string;
  emissao: string; entrada: string; valor: string; planos: PlanoParcela[];
};

// Positive recovery only. Every installment is read natively before any CAS/bank write.
export function validarCriacaoEncontrada(censo: CensoRetomada, xmlMov: string, xmlLans: string[], e: ExpectativaRetomada): void {
  if (censo.movimentos.length !== 1 || censo.movimentos[0].coligada !== e.coligada ||
      censo.movimentos[0].idMov !== e.idMov || censo.lancamentos.length !== e.planos.length ||
      xmlLans.length !== e.planos.length || censo.lancamentos.some(f => f.boletos !== 0 || f.coligada !== e.coligada || f.idMov !== e.idMov)) return falhar();
  const mov = registroUnico(xmlMov, 'TMOV'), compl = registroUnico(xmlMov, 'TMOVCOMPL');
  if (mov.CODCOLIGADA !== e.coligada || mov.CODFILIAL !== e.filial || mov.IDMOV !== e.idMov || mov.CODTMV !== e.tipo ||
      mov.CODCOLCFO !== e.coligadaFornecedor || mov.CODCFO !== e.fornecedor || !/^[A-Z0-9]$/.test(mov.STATUS || '') || mov.STATUS === 'C' ||
      compl.CODCOLIGADA !== e.coligada || compl.IDMOV !== e.idMov || compl.TICKET !== e.ticket ||
      !/^\d{1,9}$/.test(mov.NUMEROMOV || '') || BigInt(mov.NUMEROMOV) !== BigInt(e.numero) ||
      mov.SERIE !== e.serie || mov.CODTDO !== e.tipoDocumento ||
      dataCanonica(mov.DATAEMISSAO) !== dataCanonica(e.emissao) || dataCanonica(mov.DATASAIDA) !== dataCanonica(e.entrada) ||
      valorCanonico(mov.VALORLIQUIDO) !== valorCanonico(e.valor) || valorCanonico(mov.VALORBRUTO) !== valorCanonico(e.valor)) return falhar();
  const pagamentos = registrosRm(xmlMov, 'TMOVPAGTO');
  if (pagamentos.length !== e.planos.length || new Set(pagamentos.map(p => p.IDLAN)).size !== pagamentos.length) return falhar();
  const remaining = e.planos.map(p => `${p.vencimento};${p.valor}`).sort();
  const seen = new Set<string>();
  for (const xml of xmlLans) {
    const lan = registroUnico(xml, 'FLAN');
    const p = pagamentos.find(p => p.IDLAN === lan.IDLAN);
    if (seen.has(lan.IDLAN) || !censo.lancamentos.some(f => f.idLan === lan.IDLAN) || !p ||
        p.CODCOLIGADA !== e.coligada || p.IDMOV !== e.idMov ||
        lan.CODCOLIGADA !== e.coligada || lan.CODFILIAL !== e.filial || lan.IDMOV !== e.idMov ||
        lan.CODCFO !== e.fornecedor || lan.CODCOLCFO !== e.coligadaFornecedor || lan.STATUSLAN !== '0' ||
        valorCanonico(lan.VALORBAIXADO) !== valorCanonico('0') || valorCanonico(lan.BAIXAPENDENTE) !== valorCanonico('0') ||
        (lan.IDBOLETO != null && !['', '0'].includes(lan.IDBOLETO)) ||
        dataCanonica(lan.DATAVENCIMENTO) !== dataCanonica(p.DATAVENCIMENTO) || valorCanonico(lan.VALORORIGINAL) !== valorCanonico(p.VALOR)) return falhar();
    seen.add(lan.IDLAN);
    const key = `${dataCanonica(lan.DATAVENCIMENTO)};${valorCanonico(lan.VALORORIGINAL)}`;
    const at = remaining.indexOf(key);
    if (at < 0) return falhar(); remaining.splice(at, 1);
  }
  if (remaining.length) return falhar();
}
