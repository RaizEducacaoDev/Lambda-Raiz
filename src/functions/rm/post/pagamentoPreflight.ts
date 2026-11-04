import { dataCanonica, PagamentoInvalido, valorCanonico, type CamposPagamento } from './pagamentoIdentidade';

export class DadosPagamentoInvalidos extends PagamentoInvalido {
  readonly code = 'DADOS_PAGAMENTO_INVALIDOS';
}

// Validate only facts used by this builder. Missing optional fiscal fields keep
// their native defaults; this does not invent a fiscal rule or change the input.
export function validarDadosAntesDaCriacao(c: CamposPagamento, tipo: string): void {
  const consumo = ['1.2.09', '1.2.10', '1.2.11', '1.2.12'].includes(tipo);
  if (typeof c.numeroDaNF !== 'string' || !(consumo ? /^\d{1,35}$/ : /^\d{1,9}$/).test(c.numeroDaNF)) {
    throw new DadosPagamentoInvalidos(`Revise o número do documento: informe até ${consumo ? 35 : 9} dígitos, sem espaços nem truncamento.`);
  }
  for (const [campo, nome] of [['dataDeEmissao', 'emissão'], ['dataDeEntrada', 'entrada']] as const) {
    if (c[campo] == null || c[campo] === '') continue;
    try { dataCanonica(c[campo]); }
    catch { throw new DadosPagamentoInvalidos(`Revise a data de ${nome}: o formulário contém uma data inválida.`); }
  }
  try { valorCanonico(c.valorTotal); }
  catch { throw new DadosPagamentoInvalidos('Revise o valor total do documento antes de integrar.'); }
  if (!Array.isArray(c.tributos) || c.tributos.some((t: unknown) => !t || typeof t !== 'object' || Array.isArray(t))) {
    throw new DadosPagamentoInvalidos('Revise a lista de tributos no formulário; sua estrutura está inválida.');
  }
  const itemAutomatico = consumo || ['1.2.08', '1.2.17'].includes(tipo);
  if (!itemAutomatico && (!Array.isArray(c.itens) || c.itens.some((t: unknown) => !t || typeof t !== 'object' || Array.isArray(t)))) {
    throw new DadosPagamentoInvalidos('Revise a lista de itens do documento; sua estrutura está inválida.');
  }
  // These fields are consumed through .replace/.trim in the legacy builder.
  // Report their invalid type before any reservation instead of a TypeError.
  const strings = ['valorTotal', 'numeroDaNF', 'codigoDaFormaPagamento', 'codigoDoCentroDeCusto',
    'informacoes', 'linkDaSolicitacao', 'tributosCodigoDaReceita', 'idDaNaturezaFiscal'];
  if (['1.2.01', '1.2.25'].includes(tipo)) {
    strings.push('chaveDeAcesso', 'tipoDeFrete', 'valorDoFrete', 'outrasDespesas');
    if (typeof c.chaveDeAcesso !== 'string') throw new DadosPagamentoInvalidos('Revise a chave de acesso do documento: o campo deve ser texto.');
  }
  if (['1.2.08', '1.2.17'].includes(tipo)) strings.push('valorDoAluguel', 'valorDoIPTU', 'valorDoCondominio',
    'valorTaxaDeIncendio', 'valorContaDeEnergia', 'valorContaDeAgua', 'ValorContaDeGas');
  if (strings.some(k => c[k] != null && typeof c[k] !== 'string')) {
    throw new DadosPagamentoInvalidos('Revise os campos do documento: há valores com formato incompatível com a integração.');
  }
  const itens: CamposPagamento[] = itemAutomatico ? [] : c.itens;
  const semProduto = itens.flatMap((item, i) => typeof item.codigoDoItem !== 'string' ||
    !/^[0-9]+$/.test(item.codigoDoItem.trim()) || !Number.isSafeInteger(Number(item.codigoDoItem)) || Number(item.codigoDoItem) <= 0 ? [i + 1] : []);
  if (semProduto.length) {
    throw new DadosPagamentoInvalidos(`Revise os itens do documento: linha(s) ${semProduto.slice(0, 30).join(', ')} sem código de produto válido. Selecione o produto antes de integrar.`);
  }
  for (const item of itens) {
    // IDPRD is the item identifier sent to RM, not its description. Blank
    // product lines were confirmed to produce a native IDPRD rejection.
    for (const campo of ['codigoDoItem', 'qtdDoItem', 'valorDoItem', 'desconto', 'coligadaDaNatureza', 'codigoDaNatureza']) {
      if (item[campo] != null && typeof item[campo] !== 'string') throw new DadosPagamentoInvalidos('Revise o formato dos campos dos itens do documento.');
    }
    for (const campo of ['qtdDoItem', 'valorDoItem', 'desconto']) {
      if (item[campo]) { try { valorCanonico(item[campo]); } catch { throw new DadosPagamentoInvalidos('Revise quantidade, preço e desconto dos itens do documento.'); } }
    }
  }
}
