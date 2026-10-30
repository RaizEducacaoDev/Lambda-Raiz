export type MovimentoReconciliado = {
  CODCOLIGADA: string; IDMOV: string; CODFILIAL: string | null; CODCFO: string | null;
  CODCOLCFO: string | null; CODTMV: string; STATUS: string; TICKET: string;
};
const metadados = ['RECON_VERSION', 'REQUEST_COMPANY', 'REQUEST_TICKET', 'TOTAL_MOVEMENTS'];
const camposMovimento = ['CODCOLIGADA', 'IDMOV', 'CODFILIAL', 'CODCFO', 'CODCOLCFO', 'CODTMV', 'STATUS', 'TICKET'];
const camposPermitidos = new Set([...metadados, ...camposMovimento]);
const possui = (row: Record<string, unknown>, nome: string): boolean => Object.prototype.hasOwnProperty.call(row, nome);
const invalido = (): never => { throw new Error('Consulta de reconciliação não confirmou a lista completa de movimentos'); };
const inteiro = (valor: unknown, zero = false): string => {
  if (!['number', 'string'].includes(typeof valor) || !/^(?:0|[1-9]\d*)$/.test(String(valor)) ||
    !Number.isSafeInteger(Number(valor)) || Number(valor) < (zero ? 0 : 1)) return invalido();
  return String(valor);
};
const ticketTexto = (valor: unknown): string => {
  if (typeof valor === 'string' && /^\d+$/.test(valor) && Number.isSafeInteger(Number(valor)) && Number(valor) > 0) return valor;
  if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0) return String(valor);
  return invalido();
};

// A complete zero is only a current observation. This parser never authorizes
// a retry, chooses a movement or changes a durable idempotency state.
export function parsearReconciliacaoPagamento(retorno: unknown, coligada: string, ticket: string, codTmvAlvo: string): MovimentoReconciliado[] {
  const empresa = inteiro(coligada), ticketEsperado = ticketTexto(ticket);
  if (!/^\d+\.\d+\.\d+$/.test(codTmvAlvo)) return invalido();
  if (!Array.isArray(retorno) || retorno.length === 0 || retorno.length > 10000) return invalido();
  const movimentos: MovimentoReconciliado[] = [], ids = new Set<string>();
  let total: number | undefined;
  for (const item of retorno) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalido();
    const row = item as Record<string, unknown>;
    if (metadados.some(campo => !possui(row, campo)) || Object.keys(row).some(campo => !camposPermitidos.has(campo)) ||
      ![1, '1'].includes(row.RECON_VERSION as number | string) || inteiro(row.REQUEST_COMPANY) !== empresa ||
      ticketTexto(row.REQUEST_TICKET) !== ticketEsperado) return invalido();
    const quantidade = Number(inteiro(row.TOTAL_MOVEMENTS, true));
    if (quantidade > 10000 || (total !== undefined && total !== quantidade)) return invalido();
    total = quantidade;
    if (quantidade === 0) {
      // Native JSON omits SQL NULL columns on the zero sentinel.
      if (retorno.length !== 1 || camposMovimento.some(campo => possui(row, campo) && row[campo] !== null)) return invalido();
      continue;
    }
    if (['CODCOLIGADA', 'IDMOV', 'CODTMV', 'STATUS', 'TICKET'].some(campo => !possui(row, campo))) return invalido();
    const empresaMov = inteiro(row.CODCOLIGADA), id = inteiro(row.IDMOV), ticketMov = ticketTexto(row.TICKET);
    if (empresaMov !== empresa || ticketMov !== ticketEsperado || ids.has(`${empresaMov};${id}`) ||
      typeof row.CODTMV !== 'string' || !/^\d+\.\d+\.\d+$/.test(row.CODTMV) ||
      typeof row.STATUS !== 'string' || !/^[A-Z0-9]$/.test(row.STATUS)) return invalido();
    // TMOV permits nullable supplier/branch metadata on other movement types.
    // The selected type requires these fields and still needs official ownership
    // verification; nullable SC/OC metadata never selects a financial movement.
    if (row.CODTMV === codTmvAlvo && ['CODFILIAL', 'CODCFO', 'CODCOLCFO'].some(campo => !possui(row, campo) || row[campo] == null)) return invalido();
    if (row.CODCFO != null && (typeof row.CODCFO !== 'string' || !/^[A-Za-z0-9._-]+$/.test(row.CODCFO))) return invalido();
    ids.add(`${empresaMov};${id}`);
    movimentos.push({ CODCOLIGADA: empresaMov, IDMOV: id, CODFILIAL: row.CODFILIAL == null ? null : inteiro(row.CODFILIAL),
      CODCFO: row.CODCFO == null ? null : row.CODCFO as string, CODCOLCFO: row.CODCOLCFO == null ? null : inteiro(row.CODCOLCFO, true),
      CODTMV: row.CODTMV as string, STATUS: row.STATUS as string, TICKET: ticketMov });
  }
  if (total !== movimentos.length) return invalido();
  return movimentos;
}
