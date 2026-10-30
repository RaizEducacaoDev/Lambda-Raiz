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
const ufs = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const ufBrasileira = (valor: unknown): string => {
  const uf = typeof valor === 'string' ? valor.trim().toUpperCase() : '';
  return ufs.has(uf) ? uf : contratoInvalido();
};

// This only rejects a confirmed geographic mismatch; it never selects a CFOP,
// changes the input or authorizes retry of an uncertain RM creation.
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
  if (typeof row.NATURE_ROUTE !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(row.NATURE_ROUTE)) contratoInvalido();
  const paisFornecedor = inteiro(row.SUPPLIER_COUNTRY_ID), paisFilial = inteiro(row.BRANCH_COUNTRY_ID);
  // Other countries/routes remain under native fiscal validation. A foreign UF
  // may be SQL NULL and therefore omitted by the native JSON serializer.
  if (paisFornecedor !== '1' || paisFilial !== '1' || !['D', 'F'].includes(row.NATURE_ROUTE as string)) return;
  const origem = ufBrasileira(row.SUPPLIER_UF), destino = ufBrasileira(row.BRANCH_UF);
  if (row.NATURE_ROUTE === 'D' && origem !== destino) {
    throw new NaturezaFiscalInvalida(`A natureza fiscal selecionada é interna, mas o fornecedor está em ${origem} e a filial em ${destino}. Revise a natureza na tarefa Fiscal antes de integrar.`);
  }
  if (row.NATURE_ROUTE === 'F' && origem === destino) {
    throw new NaturezaFiscalInvalida(`A natureza fiscal selecionada é interestadual, mas fornecedor e filial estão em ${origem}. Revise a natureza na tarefa Fiscal antes de integrar.`);
  }
}
