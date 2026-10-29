import { createHash } from 'node:crypto';
import { montaTag } from '../../../utils/xml';
import { ChaveDadoPagamento, idPositivo, obterDadosBoleto, texto } from './solicitacaoDePagamentoBancario';

export type CamposPagamento = Record<string, any>;
export class PagamentoInvalido extends Error {}
export const normalizar = (v: unknown) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const inteiro = (v: unknown, zero = false): string => {
  if (!/^\d+$/.test(texto(v)) || !Number.isSafeInteger(Number(v)) || Number(v) < (zero ? 0 : 1)) {
    throw new PagamentoInvalido('Identificador bancário ou de destino ausente/inválido');
  }
  return String(Number(v));
};

export function identidadePagamento(c: CamposPagamento): ChaveDadoPagamento {
  const fornecedor = texto(c.codigoDoFornecedor);
  if (!/^[A-Za-z0-9._-]+$/.test(fornecedor)) throw new PagamentoInvalido('Fornecedor ausente/inválido');
  const destino = inteiro(c.codigoDaColigada2 || c.codigoDaColigada);
  const ids: string[] = [], coligadas: string[] = [], fornecedores: string[] = [], colCfos: string[] = [];
  for (const nome of ['idpgto', 'idPgto', 'IDPGTO', 'idPagamento', 'idpagamento']) {
    const valor = texto(c[nome]);
    if (!valor) continue;
    if (valor.includes('$_$')) {
      const partes = valor.split('$_$');
      if (partes.length !== 4) throw new PagamentoInvalido('Chave composta bancária inválida');
      coligadas.push(inteiro(partes[0])); colCfos.push(inteiro(partes[1], true));
      fornecedores.push(partes[2]); ids.push(inteiro(partes[3]));
    } else ids.push(inteiro(valor));
  }
  for (const n of ['CODCOLPGTO', 'codcolpgto', 'codColPgto']) if (texto(c[n])) coligadas.push(inteiro(c[n]));
  for (const n of ['CODCOLCFO', 'codcolcfo', 'codColCfo']) if (texto(c[n])) colCfos.push(inteiro(c[n], true));
  if (!ids.length || !coligadas.length) throw new PagamentoInvalido('IDPGTO e CODCOLPGTO são obrigatórios antes de criar o movimento');
  if (new Set(ids).size !== 1 || coligadas.some(v => v !== destino) || new Set(colCfos).size > 1 ||
      fornecedores.some(v => v !== fornecedor)) throw new PagamentoInvalido('Aliases/chave bancária divergem do fornecedor ou destino');
  return { idPgto: Number(ids[0]), codColPgto: destino, codColCfo: colCfos[0] || '0', codCfo: fornecedor };
}

export function codigoMovimento(c: CamposPagamento): string {
  const tipo = normalizar(c.tipoDoPagamento);
  if (['CC', 'CONTAS DE CONSUMO', 'CONTA DE CONSUMO'].includes(tipo)) {
    const conta = normalizar(c.contasDeConsumo);
    const codigo = ({ A: '1.2.09', E: '1.2.10', T: '1.2.11', I: '1.2.11', INTERNET: '1.2.11', G: '1.2.12' } as Record<string, string>)[conta];
    if (codigo) return codigo;
  } else if (tipo === 'TM') return '1.2.25';
  else if (tipo === 'NF') {
    if (normalizar(c.tipoDeItem) === 'MATERIAL') return '1.2.01';
    if (normalizar(c.tipoDeItem) === 'SERVICO') return '1.2.03';
  } else {
    if (texto(c.outrosGastos) === 'FR') return '1.2.16';
    if (texto(c.tipoDoLocador) === 'PJ') return '1.2.17';
    if (texto(c.tipoDoLocador) === 'PF') return '1.2.08';
  }
  throw new PagamentoInvalido('Tipo de pagamento/movimento inválido');
}

export function valorCanonico(v: unknown): string {
  let t = texto(v);
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(t)) throw new PagamentoInvalido('Valor de parcela ausente/inválido');
  const [a, b = ''] = t.split('.');
  return `${a.replace(/^0+(?=\d)/, '')}.${b.replace(/0+$/, '') || '0'}`;
}
export const dataCanonica = (v: unknown): string => {
  let t = texto(v).split(/[T ]/)[0];
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) t = t.split('/').reverse().join('-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new PagamentoInvalido('Vencimento ausente/inválido');
  const validacao = new Date(`${t}T00:00:00Z`);
  if (!Number.isFinite(validacao.getTime()) || validacao.toISOString().slice(0, 10) !== t) throw new PagamentoInvalido('Data inexistente');
  return t;
};
export const dataLegado = (v: unknown): string => {
  if (!texto(v) || texto(v).includes('/')) return texto(v);
  return dataCanonica(v).split('-').reverse().join('/');
};

export type PlanoParcela = { vencimento: string; valor: string; campos: Array<[string, string]> };
export function planosPagamento(c: CamposPagamento, chave: ChaveDadoPagamento): PlanoParcela[] {
  if (c.listaDeParcelas != null && !Array.isArray(c.listaDeParcelas)) throw new PagamentoInvalido('Lista de parcelas inválida');
  const parcelas: CamposPagamento[] = c.listaDeParcelas || [];
  const completas = parcelas.filter(p => p && (texto(p.valorDaParcela) || texto(p.vencimentoDaParcela)));
  if (completas.some(p => !texto(p.valorDaParcela) || !texto(p.vencimentoDaParcela)) ||
      (completas.length && completas.length !== parcelas.length)) throw new PagamentoInvalido('Parcelas incompletas');
  return (completas.length ? completas : [undefined]).map(p => {
    if (p) {
      const alias = { ...c, ...p };
      if (JSON.stringify(identidadePagamento(alias)) !== JSON.stringify(chave)) {
        throw new PagamentoInvalido('Identidade bancária por parcela divergente do pagamento');
      }
    }
    const campos: Array<[string, string]> = [['CODCOLPGTO', chave.codColPgto], ['IDPGTO', String(chave.idPgto)]];
    const fontes = [p, c].filter(Boolean) as CamposPagamento[];
    let boleto = '';
    for (const fonte of fontes) {
      const candidatos = ['codigoDeBarrasBoleto', 'codigoDeBarras', 'linhaDigitavelBoleto', 'linhaDigitavel']
        .map(n => texto(fonte[n])).filter(Boolean);
      if (!candidatos.length) continue;
      const normalizados = candidatos.map(v => {
        if (!/^[\d\s.-]+$/.test(v)) throw new PagamentoInvalido('Boleto inválido');
        return v.replace(/[\s.-]/g, '');
      });
      const convertido = normalizados.map(v => dadosBoleto(v));
      if (convertido.some(v => v.codigo !== convertido[0].codigo)) throw new PagamentoInvalido('Aliases de boleto divergentes');
      boleto = normalizados.find(v => v.length === 47 || v.length === 48) || normalizados[0];
      break;
    }
    if (boleto) {
      const dados = dadosBoleto(boleto);
      campos.push(['CODIGOBARRA', dados.codigo]);
      if (dados.ipte) campos.push(['IPTE', dados.ipte]);
    }
    if (texto(c.codigoTipoChavePIX) === '6') {
      const qr = texto(c.chavePIX);
      if (!qr || qr.length > 500) throw new PagamentoInvalido('QR PIX ausente/inválido');
      campos.push(['QRCODEPIX', qr]);
    }
    return { vencimento: dataCanonica(p?.vencimentoDaParcela || c.dataDeVencimento),
      valor: valorCanonico(p?.valorDaParcela || c.valorTotal), campos };
  });
}

function dadosBoleto(v: string): { codigo: string; ipte: string } {
  if (v.length === 48) {
    try { const b = obterDadosBoleto(v); return { codigo: b.codigoBarras, ipte: b.ipte }; }
    catch { throw new PagamentoInvalido('Linha digitável de concessionária inválida'); }
  }
  if (v.length === 44) return { codigo: v, ipte: '' };
  if (v.length !== 47) throw new PagamentoInvalido('Boleto exige código de 44 ou linha de 47/48 dígitos');
  // Conversão da linha de cobrança, conservando a linha completa para o IPTE.
  return { codigo: v.slice(0, 4) + v[32] + v.slice(33) + v.slice(4, 9) + v.slice(10, 20) + v.slice(21, 31), ipte: v };
}

export function validarCadastro(dado: Record<string, string>, chave: ChaveDadoPagamento, c: CamposPagamento, planos: PlanoParcela[]): void {
  if (dado.CODCOLIGADA !== chave.codColPgto || dado.CODCOLCFO !== chave.codColCfo || dado.CODCFO !== chave.codCfo ||
      dado.IDPGTO !== String(chave.idPgto) || dado.ATIVO !== '1') throw new PagamentoInvalido('IDPGTO não pertence ao cadastro ativo do fornecedor/destino');
  const forma = texto(dado.FORMAPAGAMENTO);
  const modalidade = normalizar(c.formaPagamentoIdpgto ||
    (normalizar(c.formaDePagamento).includes('ADICIONAR') ? c.novaFormaDePagamento : c.formaDePagamento));
  if ((texto(c.codigoPagamento) && texto(c.codigoPagamento) !== forma) ||
      (modalidade === 'PIX' && forma !== 'S') ||
      (modalidade.includes('TRANSFERENCIA') && !'DTPXYZM'.includes(forma)) ||
      (modalidade.includes('BOLETO') && !['N', 'I'].includes(forma))) throw new PagamentoInvalido('Modalidade diverge do cadastro bancário selecionado');
  if (planos.some(p => p.campos.some(([n]) => n === 'CODIGOBARRA')) && !['N', 'I'].includes(forma)) {
    throw new PagamentoInvalido('Boleto informado para cadastro de outra modalidade');
  }
  if (texto(c.chavePIX)) {
    if (forma !== 'S' || (texto(c.codigoTipoChavePIX) && texto(dado.TIPOPIX) !== texto(c.codigoTipoChavePIX)) ||
        (texto(c.codigoTipoChavePIX) !== '6' && texto(dado.CHAVE) !== texto(c.chavePIX))) {
      throw new PagamentoInvalido('Chave/tipo PIX diverge do cadastro selecionado');
    }
  }
  if (!forma) throw new PagamentoInvalido('Cadastro sem modalidade nativa de pagamento');
}

const ordenar = (v: any): any => Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenar(v[k])])) : v;
export const hashIntencao = (v: unknown): string => createHash('sha256').update(JSON.stringify(ordenar(v))).digest('hex');
export function intencaoPagamento(c: CamposPagamento, chave: ChaveDadoPagamento, planos: PlanoParcela[], codTmv: string) {
  const negocio = ['codigoDaFilial2', 'codigoDaFilial', 'numeroDaNF', 'serie', 'dataDeEmissao', 'dataDeEntrada',
    'valorTotal', 'itens', 'tributos', 'codigoDaFormaPagamento', 'codigoDaNaturezaFiscal', 'idDaNaturezaFiscal',
    'tributosCodigoDaReceita', 'tipoDeFrete', 'valorDoFrete', 'outrasDespesas', 'codigoDoCentroDeCusto',
    'chaveDeAcesso', 'idDaNatureza', 'ratCCusto', 'codigoDoEstado', 'codigoDoMunicipio', 'valorDoAluguel',
    'valorDoIPTU', 'valorDoCondominio', 'valorTaxaDeIncendio', 'valorContaDeEnergia', 'valorContaDeAgua',
    'ValorContaDeGas', 'remetente', 'inicioDaPrestacao', 'destinatario', 'terminoDaPrestacao', 'informacoes',
    'codigoPagamento', 'codigoTipoChavePIX', 'chavePIX', 'Banco', 'Agencia', 'Conta', 'digitoAgencia', 'digitoConta',
    'codigoTipoDaChavePix', 'chavePix'];
  const modalidade = normalizar(c.formaPagamentoIdpgto ||
    (normalizar(c.formaDePagamento).includes('ADICIONAR') ? c.novaFormaDePagamento : c.formaDePagamento));
  return { chave, planos, codTmv, modalidade, campos: Object.fromEntries(negocio.filter(k => c[k] !== undefined).map(k => [k, c[k]])) };
}

export const xmlLancamento = (coligada: string, idLan: string, campos: Array<[string, string]>) =>
  `<![CDATA[<FinLAN><FLAN>${[['CODCOLIGADA', coligada], ['IDLAN', idLan], ...campos].map(([k, v]) => montaTag(k, v)).join('')}</FLAN></FinLAN>]]>`;
export const idValido = (v: unknown): boolean => idPositivo(v);
