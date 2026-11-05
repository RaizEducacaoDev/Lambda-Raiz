import { PagamentoInvalido } from './pagamentoIdentidade';
import { idPositivo, texto } from './solicitacaoDePagamentoBancario';

export type ChaveContextoFiscal = {
  codColigada: string; codFilial: string; codColCfo: string; codCfo: string; idNat: string;
};
export type ContextoFiscalEsperado = ChaveContextoFiscal & { codigoNatureza?: string };
export class NaturezaFiscalInvalida extends PagamentoInvalido {
  readonly code = 'NATUREZA_FISCAL_INCOMPATIVEL';
  constructor(mensagem: string) { super(mensagem); this.name = 'NaturezaFiscalInvalida'; }
}

export function prepararContextoFiscal(entrada: Record<string, unknown>, chave: Omit<ChaveContextoFiscal, 'idNat'>): ContextoFiscalEsperado | undefined {
  const id = texto(entrada.idDaNaturezaFiscal), codigo = texto(entrada.codigoDaNaturezaFiscal);
  if (!id && !codigo) return undefined;
  if (!idPositivo(id)) throw new NaturezaFiscalInvalida('Informe uma natureza fiscal válida na tarefa Fiscal antes de integrar o pagamento.');
  return { ...chave, idNat: String(Number(id)), ...(codigo ? { codigoNatureza: codigo } : {}) };
}

const contratoInvalido = (): never => { throw new Error('Consulta fiscal não confirmou o contexto completo; integração mantida pendente'); };
const inteiro = (valor: unknown, zero = false): string => {
  if (!['number', 'string'].includes(typeof valor) || !/^\d+$/.test(String(valor)) ||
    !Number.isSafeInteger(Number(valor)) || Number(valor) < (zero ? 0 : 1)) return contratoInvalido();
  return String(Number(valor));
};
const flag = (valor: unknown): string => {
  return [0, 1, '0', '1'].includes(valor as string | number) ? String(valor) : contratoInvalido();
};
// Confirm identity and availability only. Fiscal geography is validated by RM;
// never select a CFOP, change the input or authorize an uncertain creation retry.
export function validarContextoFiscal(retorno: unknown, esperado: ContextoFiscalEsperado): void {
  if (!Array.isArray(retorno) || retorno.length !== 1 || !retorno[0] || typeof retorno[0] !== 'object' || Array.isArray(retorno[0])) return contratoInvalido();
  const row = retorno[0] as Record<string, unknown>;
  if (![1, '1'].includes(row.FISCAL_VERSION as string | number) || inteiro(row.REQUEST_COMPANY) !== inteiro(esperado.codColigada) ||
    inteiro(row.REQUEST_BRANCH) !== inteiro(esperado.codFilial) || inteiro(row.REQUEST_SUPPLIER_COMPANY, true) !== inteiro(esperado.codColCfo, true) ||
    typeof row.REQUEST_SUPPLIER !== 'string' || row.REQUEST_SUPPLIER !== esperado.codCfo || inteiro(row.REQUEST_NATURE) !== esperado.idNat) contratoInvalido();
  const supplier = flag(row.HAS_SUPPLIER), branch = flag(row.HAS_BRANCH), nature = flag(row.HAS_NATURE);
  if ([supplier, branch, nature].includes('0')) {
    throw new NaturezaFiscalInvalida('Fornecedor, filial ou natureza fiscal não localizado no destino. Revise os dados na tarefa Fiscal.');
  }
  if (inteiro(row.NATURE_COMPANY) !== inteiro(esperado.codColigada) || inteiro(row.NATURE_ID) !== esperado.idNat) contratoInvalido();
  if (flag(row.NATURE_ACTIVE) !== '1') throw new NaturezaFiscalInvalida('A natureza fiscal selecionada está inativa no destino. Revise a seleção na tarefa Fiscal.');
  if (typeof row.NATURE_CODE !== 'string' || !/^[A-Za-z0-9._-]+$/.test(row.NATURE_CODE)) contratoInvalido();
  if (esperado.codigoNatureza && esperado.codigoNatureza !== row.NATURE_CODE) {
    throw new NaturezaFiscalInvalida('O código informado não corresponde à natureza fiscal selecionada no destino. Revise a natureza na tarefa Fiscal.');
  }
}
