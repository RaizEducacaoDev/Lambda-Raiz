import { texto, type ChaveDadoPagamento } from './solicitacaoDePagamentoBancario';
import { dataCanonica, valorCanonico, type CamposPagamento, type PlanoParcela } from './pagamentoIdentidade';
import { ConflitoPagamento } from './pagamentoV2Idempotencia';
import { registroUnico, registrosRm, type TransporteRm } from './pagamentoV2Rm';

type Registro = Record<string, string>;
type LeituraRm = Pick<TransporteRm, 'consultarRetomada' | 'readReacord'>;
export type PagamentoExistente = { pg: string; idLans: string[]; completo: boolean };
const conflito = (mensagem: string): never => { throw new ConflitoPagamento(mensagem); };
const igual = (a: unknown, b: unknown) => valorCanonico(a) === valorCanonico(b);
const ordenar = (valores: string[]) => JSON.stringify(valores.slice().sort());
const numero = (valor: unknown): string => {
  const v = texto(valor);
  if (!/^\d{1,35}$/.test(v)) return conflito('Documento do movimento existente não confirmado.');
  return BigInt(v).toString();
};
const soma = (valores: unknown[]): string => {
  const partes = valores.map(v => valorCanonico(v).split('.'));
  const casas = Math.max(1, ...partes.map(p => p[1].length));
  const total = partes.reduce((s, p) => s + BigInt(p[0] + p[1].padEnd(casas, '0')), 0n).toString().padStart(casas + 1, '0');
  return valorCanonico(total.slice(0, -casas) + '.' + total.slice(-casas));
};

function conferirItens(xml: string, entrada: CamposPagamento, tipo: string): void {
  // These types generate their items in RM's existing builder, regardless of form rows.
  if (['1.2.09', '1.2.10', '1.2.11', '1.2.12', '1.2.08', '1.2.17'].includes(tipo)) return;
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0) return;
  const nativos = registrosRm(xml, 'TITMMOV');
  const assinatura = (r: Registro, nativo: boolean) => JSON.stringify([
    numero(nativo ? r.IDPRD : r.codigoDoItem),
    valorCanonico(nativo ? r.QUANTIDADE : r.qtdDoItem),
    valorCanonico(nativo ? r.PRECOUNITARIO : r.valorDoItem),
    valorCanonico((nativo ? r.VALORDESC : r.desconto) || '0'),
    texto(nativo ? r.CODTBORCAMENTO : r.codigoDaNatureza),
    texto((nativo ? r.CODCOLTBORCAMENTO : r.coligadaDaNatureza) || '0'),
  ]);
  if (ordenar(nativos.map(r => assinatura(r, true))) !== ordenar(entrada.itens.map((r: Registro) => assinatura(r, false)))) {
    conflito('O ticket já possui movimento, mas os itens ou a natureza orçamentária diferem. Confira o registro existente; não será criado outro.');
  }
}

function conferirTributos(xml: string, entrada: CamposPagamento): void {
  if (!Array.isArray(entrada.tributos)) return;
  const informados = entrada.tributos.filter((t: Registro) => texto(t.codigoDoTributo));
  if (!informados.length) return;
  const nativos = registrosRm(xml, 'TTRBITMMOV');
  for (const t of informados) {
    const rows = nativos.filter(r => r.CODTRB === t.codigoDoTributo);
    if (!rows.length || (texto(t.baseDeCalculo) && soma(rows.map(r => r.BASEDECALCULO)) !== valorCanonico(t.baseDeCalculo)) ||
        (texto(t.aliquota) && rows.some(r => !igual(r.ALIQUOTA, t.aliquota))) ||
        (texto(t.valorDaAliquota) && soma(rows.map(r => r.VALOR)) !== valorCanonico(t.valorDaAliquota))) {
      conflito('O ticket já possui movimento, mas os tributos informados diferem. Confira a análise fiscal do registro existente.');
    }
  }
}

/** Positive native acknowledgement. Reads only: no financial or reservation writes.
 * An obsolete Dynamo digest cannot turn an already completed native operation into
 * a new creation. A matching document from another ticket is never adopted here.
 */
export async function consultarPagamentoExistente(rm: LeituraRm, entrada: CamposPagamento,
  chave: ChaveDadoPagamento, planos: PlanoParcela[], tipo: string, pgInformado?: string): Promise<PagamentoExistente | undefined> {
  const coligada = chave.codColPgto, ticket = texto(entrada.ticketRaiz);
  const filial = texto(entrada.codigoDaFilial2 || entrada.codigoDaFilial);
  const censo = await rm.consultarRetomada(coligada, ticket);
  if (!censo.movimentos.length && !censo.lancamentos.length) return undefined;
  if (censo.movimentos.length !== 1 || censo.movimentos[0].coligada !== coligada) {
    return conflito('O ticket possui movimentos múltiplos ou em outra coligada. Confira os vínculos existentes; não será criado outro.');
  }
  const pg = censo.movimentos[0].idMov;
  if (pgInformado && pgInformado !== pg) return conflito('O movimento informado no Zeev difere do movimento vinculado ao ticket no TOTVS.');
  if (censo.lancamentos.length !== planos.length || new Set(censo.lancamentos.map(l => l.idLan)).size !== planos.length ||
      censo.lancamentos.some(l => l.coligada !== coligada || l.idMov !== pg)) {
    return conflito('O ticket já possui movimento, mas os lançamentos não correspondem às parcelas esperadas. Não será criado outro movimento.');
  }
  const ctxT = `CODSISTEMA=T;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
  const ctxF = `CODSISTEMA=F;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
  const xml = await rm.readReacord(`${coligada};${pg}`, 'MovMovimentoTBCData', ctxT);
  const mov = registroUnico(xml, 'TMOV'), compl = registroUnico(xml, 'TMOVCOMPL');
  if (mov.CODCOLIGADA !== coligada || mov.CODFILIAL !== filial || mov.IDMOV !== pg || mov.CODTMV !== tipo ||
      mov.CODCOLCFO !== chave.codColCfo || mov.CODCFO !== chave.codCfo || !/^[A-Z0-9]$/.test(mov.STATUS || '') || mov.STATUS === 'C' ||
      compl.CODCOLIGADA !== coligada || compl.IDMOV !== pg || compl.TICKET !== ticket) {
    return conflito('O movimento existente diverge do ticket, fornecedor, unidade ou tipo esperado, ou está cancelado.');
  }
  // Keep every original predicate. Report all mismatching fields from the same
  // reads; never log form/native values or use a mismatch to permit a write.
  type Campo = 'NUMEROMOV' | 'SERIE' | 'DATAEMISSAO' | 'VALORBRUTO' | 'CODCCUSTO' | 'IDNAT';
  const divergencias: Array<{ campo: Campo; detalhe: string }> = [];
  const exibirCodigo = (v: unknown): string => /^\d{1,35}(?:\.\d{1,10})*$/.test(texto(v)) ? texto(v) : '(não exibido)';
  const comparar = (campo: Campo, rotulo: string, enviado: string, existente: string) => {
    if (enviado !== existente) divergencias.push({ campo,
      detalhe: `${rotulo}: Zeev ${exibirCodigo(enviado)} / TOTVS ${exibirCodigo(existente)}` });
  };
  const avaliar = (comparacao: () => void) => {
    try { comparacao(); } catch (erro) {
      // The original disjunction stopped at the first mismatch. A later
      // malformed optional value must not replace that known conflict.
      if (!divergencias.length) throw erro;
    }
  };
  comparar('NUMEROMOV', 'número da nota', numero(entrada.numeroDaNF), numero(mov.NUMEROMOV));
  if (['1.2.01', '1.2.03', '1.2.25'].includes(tipo) && texto(entrada.serie)) {
    comparar('SERIE', 'série', texto(entrada.serie), mov.SERIE);
  }
  avaliar(() => {
    if (texto(entrada.dataDeEmissao) && dataCanonica(mov.DATAEMISSAO) !== dataCanonica(entrada.dataDeEmissao)) {
      divergencias.push({ campo: 'DATAEMISSAO', detalhe:
        `emissão: Zeev ${dataCanonica(entrada.dataDeEmissao)} / TOTVS ${dataCanonica(mov.DATAEMISSAO)}` });
    }
  });
  avaliar(() => comparar('VALORBRUTO', 'valor bruto', valorCanonico(entrada.valorTotal), valorCanonico(mov.VALORBRUTO)));
  if (texto(entrada.codigoDoCentroDeCusto)) {
    comparar('CODCCUSTO', 'centro de custo', texto(entrada.codigoDoCentroDeCusto), mov.CODCCUSTO);
  }
  if (tipo === '1.2.03' && texto(entrada.idDaNaturezaFiscal)) {
    comparar('IDNAT', 'natureza fiscal', texto(entrada.idDaNaturezaFiscal), mov.IDNAT);
  }
  if (divergencias.length) {
    console.warn('[RM-IDPGTO] Divergência de movimento existente', { ticket, coligada, idMov: pg,
      camposDivergentes: divergencias.map(d => d.campo) });
    throw new ConflitoPagamento(`O movimento ${pg} já existe no TOTVS. ${divergencias.map(d => d.detalhe).join('; ')}. Confira os campos indicados antes de enviar novamente.`,
      'DADOS_MOVIMENTO_DIVERGENTES');
  }
  // Entry/processing dates are not invoice identity and are never rewritten by
  // this acknowledgement. In 225374 RM recorded entry before the Zeev form date.
  conferirItens(xml, entrada, tipo);
  conferirTributos(xml, entrada);
  const pagamentos = registrosRm(xml, 'TMOVPAGTO');
  if (pagamentos.length !== planos.length || pagamentos.some(p => p.CODCOLIGADA !== coligada || p.IDMOV !== pg)) {
    return conflito('As parcelas do movimento existente não correspondem à solicitação.');
  }
  // FLAN.IDMOV and the scoped census are authoritative when TMOVPAGTO omits IDLAN.
  const lans: Registro[] = [];
  for (const l of censo.lancamentos) {
    const lan = registroUnico(await rm.readReacord(`${coligada};${l.idLan}`, 'FinLanDataBR', ctxF), 'FLAN');
    if (lan.CODCOLIGADA !== coligada || lan.CODFILIAL !== filial || lan.IDMOV !== pg || lan.IDLAN !== l.idLan ||
        lan.CODCOLCFO !== chave.codColCfo || lan.CODCFO !== chave.codCfo || !['0', '1', '3', '4'].includes(lan.STATUSLAN)) {
      return conflito('O lançamento existente diverge do movimento, fornecedor ou unidade, ou está cancelado.');
    }
    lans.push(lan);
  }
  const idLanInformado = texto(entrada.idDoLancamento);
  if (idLanInformado && (lans.length !== 1 || lans[0].IDLAN !== idLanInformado)) {
    return conflito('O lançamento informado no Zeev difere do lançamento vinculado ao ticket.');
  }
  const assinatura = (data: string, valor: string) => `${dataCanonica(data)};${valorCanonico(valor)}`;
  if (ordenar(pagamentos.map(p => assinatura(p.DATAVENCIMENTO, p.VALOR))) !==
      ordenar(lans.map(l => assinatura(l.DATAVENCIMENTO, l.VALORORIGINAL))) ||
      pagamentos.some(p => texto(p.IDLAN) && !lans.some(l => l.IDLAN === p.IDLAN &&
        assinatura(l.DATAVENCIMENTO, l.VALORORIGINAL) === assinatura(p.DATAVENCIMENTO, p.VALOR)))) {
    return conflito('Valores ou vencimentos dos lançamentos existentes divergem das parcelas do movimento.');
  }
  let completo = true;
  for (const data of new Set(lans.map(l => dataCanonica(l.DATAVENCIMENTO)))) {
    const nativas = lans.filter(l => dataCanonica(l.DATAVENCIMENTO) === data);
    const grupo = planos.filter(p => p.vencimento === data);
    if (grupo.length !== nativas.length) return conflito('Vencimentos dos lançamentos existentes diferem da solicitação.');
    const valoresIguais = ordenar(grupo.map(p => p.valor)) === ordenar(nativas.map(l => valorCanonico(l.VALORORIGINAL)));
    if (!valoresIguais && new Set(grupo.map(p => JSON.stringify(p.campos))).size !== 1) {
      return conflito('As retenções tornam ambíguo o vínculo bancário das parcelas existentes.');
    }
    const restantes = grupo.slice();
    for (const lan of nativas) {
      const matches = restantes.filter(p => !valoresIguais || p.valor === valorCanonico(lan.VALORORIGINAL));
      if (!matches.length || matches.some(p => JSON.stringify(p.campos) !== JSON.stringify(matches[0].campos))) {
        return conflito('A associação bancária das parcelas existentes é ambígua.');
      }
      const plano = matches[0]; restantes.splice(restantes.indexOf(plano), 1);
      if (!plano.campos.every(([k, v]) => lan[k] === v)) completo = false;
    }
  }
  return { pg, idLans: lans.map(l => l.IDLAN).sort(), completo };
}
