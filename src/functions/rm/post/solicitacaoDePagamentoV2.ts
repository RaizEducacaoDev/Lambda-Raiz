import { createHash } from 'node:crypto';
import type { Context } from 'aws-lambda';
import axios from 'axios';
import { formatResponse } from '../../../utils/response';
import { montaTag } from '../../../utils/xml';
import { idPositivo, montarCamposDadoPagamento, obterDadosBoleto, resolverChaveDadoPagamento, texto, validarAliasesBancarios } from './solicitacaoDePagamentoBancario';
import { ConflitoPagamento, DynamoPagamento, OperacaoPagamento, RepositorioPagamento } from './pagamentoV2Idempotencia';
import { PrazoPagamento, registroUnico, registrosRm, TransportePagamentoV2, TransporteRm } from './pagamentoV2Rm';

type Campos = Record<string, unknown>;
type CriarLegado = (campos: Campos, transporte: Pick<TransporteRm, 'saveRecord' | 'buscarEstoque'>) => Promise<ReturnType<typeof formatResponse>>;
type Dependencias = { repositorio: RepositorioPagamento; rm: TransporteRm };
class EntradaInvalida extends Error {}

const ordenar = (v: unknown): unknown => Array.isArray(v) ? v.map(ordenar) :
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordenar(x)])) : v;
export const digestPagamento = (campos: Campos): string => {
  const copia = { ...campos };
  // O IDMOV pode ser devolvido pelo Zeev na repetição; não altera a intenção.
  delete copia.idDoMovimento; delete copia.movimentoExistente;
  return createHash('sha256').update(JSON.stringify(ordenar(copia))).digest('hex');
};

export const executarPagamentoV2 = async (entrada: Campos, context: Pick<Context, 'getRemainingTimeInMillis'> | undefined,
  criarLegado: CriarLegado, dependencias?: Dependencias) => {
  let op: OperacaoPagamento | undefined;
  try {
    if (!dependencias && (process.env.PAGAMENTO_V2_ENABLED !== 'S' || !process.env.PAGAMENTO_V2_TABLE)) {
      throw new Error('V2 indisponível: ativação de servidor e armazenamento durável obrigatórios');
    }
    if (!context) throw new Error('Contexto de prazo da Lambda obrigatório');
    const prazo = new PrazoPagamento(() => context.getRemainingTimeInMillis());
    prazo.exigir(10000);
    let chave, boleto;
    try {
      chave = resolverChaveDadoPagamento(entrada); boleto = obterDadosBoleto(entrada.codigoDeBarrasBoleto);
      validarAliasesBancarios(entrada, chave, boleto);
      if (entrada.listaDeParcelas != null && !Array.isArray(entrada.listaDeParcelas)) throw new Error('Lista de parcelas inválida');
      for (const parcela of (entrada.listaDeParcelas || []) as Campos[]) {
        if (!parcela || !texto(parcela.valorDaParcela) || !texto(parcela.vencimentoDaParcela)) throw new Error('Parcela incompleta');
        validarAliasesBancarios(parcela, chave, boleto);
      }
    }
    catch (e) { throw new EntradaInvalida(e instanceof Error ? e.message : 'Dados bancários inválidos'); }
    const coligada = texto(entrada.codigoDaColigada2 || entrada.codigoDaColigada);
    const ticket = texto(entrada.ticketRaiz);
    const pgEntrada = texto(entrada.idDoMovimento || entrada.movimentoExistente) || undefined;
    if (!idPositivo(ticket) || !idPositivo(coligada) || (pgEntrada && !idPositivo(pgEntrada)) ||
      (entrada.idDoMovimento && entrada.movimentoExistente && texto(entrada.idDoMovimento) !== texto(entrada.movimentoExistente))) {
      throw new EntradaInvalida('Ticket, coligada ou movimento inválido/ambíguo');
    }
    if (chave.codColPgto !== String(Number(coligada)) || chave.codColCfo !== '0') {
      throw new EntradaInvalida('Chave bancária incompatível com a coligada e CODCOLCFO do movimento');
    }
    if (Array.isArray(entrada.listaDeParcelas) && entrada.listaDeParcelas.length > 1) {
      throw new EntradaInvalida('V2 exige parcela única; dados bancários por parcela não foram definidos');
    }
    const conta = ['I', 'INTERNET'].includes(texto(entrada.contasDeConsumo).toUpperCase()) ? 'T' : texto(entrada.contasDeConsumo);
    const codTmv = ({ A: '1.2.09', E: '1.2.10', T: '1.2.11', G: '1.2.12' } as Record<string, string>)[conta];
    if (!codTmv) throw new EntradaInvalida('Tipo de conta de consumo inválido');
    const campos: Campos = { ...entrada, tipoDoPagamento: 'CC', atividadeAtual: 'TS03', integracaoBancariaV2: 'S',
      codigoDeBarrasBoleto: boleto.ipte };
    const repositorio = dependencias?.repositorio || new DynamoPagamento(process.env.PAGAMENTO_V2_TABLE!);
    const rm = dependencias?.rm || new TransportePagamentoV2(prazo);
    const pk = `${process.env.STAGE || 'dev'}#PG#${Number(coligada)}#${Number(ticket)}`;
    op = await repositorio.reservar(pk, digestPagamento(campos), pgEntrada, prazo.disponivel());
    if (op.state === 'COMPLETE') return formatResponse(200, { PG: op.pg, integracaoBancaria: 'ja_gravada' });
    const contextoF = `CODSISTEMA=F;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
    const contextoT = `CODSISTEMA=T;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
    prazo.exigir(8000);
    const dado = registroUnico(await rm.readReacord(
      `${chave.codColPgto};${chave.codColCfo};${chave.codCfo};${chave.idPgto}`, 'FinDadosPgtoDataBR', contextoF), 'FDadosPgto');
    if (dado.CODCOLIGADA !== chave.codColPgto || dado.CODCOLCFO !== chave.codColCfo || dado.CODCFO !== chave.codCfo ||
      dado.IDPGTO !== String(chave.idPgto) || dado.ATIVO !== '1' || dado.FORMAPAGAMENTO !== 'N') {
      throw new EntradaInvalida('FDADOSPGTO exige chave correta, registro ativo e forma N');
    }
    if (!op.pg) {
      // Protege também tickets anteriores à criação da tabela DynamoDB.
      prazo.exigir(10000);
      const existentes = await rm.buscarMovimentosPorTicket(coligada, ticket, codTmv);
      if (existentes.length > 1) throw new ConflitoPagamento('Ticket possui múltiplos movimentos; reconciliar sem criar');
      if (existentes.length === 1) op = await repositorio.avancar(op, 'CREATED', existentes[0]);
    }
    if (!op.pg) {
      prazo.exigir(18000);
      const resposta = await criarLegado({ ...campos, codigoDeBarrasBoleto: boleto.codigoBarras,
        ...(Array.isArray(campos.listaDeParcelas) ? { listaDeParcelas: campos.listaDeParcelas.map(p => ({ ...p, codigoDeBarrasBoleto: boleto.codigoBarras })) } : {}),
      }, {
        buscarEstoque: (col, filial) => { prazo.exigir(18000); return rm.buscarEstoque(col, filial); },
        saveRecord: async (xml, servidor, contexto) => {
          prazo.exigir(14000);
          if (servidor !== 'MovMovimentoTBCData' || op!.state !== 'RESERVED') throw new Error('Criação fora do estado esperado');
          // O estado irreversível vem ANTES do efeito externo. Timeout nunca reabre criação.
          op = await repositorio.avancar(op!, 'CREATING');
          const retorno = await rm.saveRecord(xml, servidor, contexto);
          const match = retorno.trim().match(/^(\d+);([1-9]\d*)$/);
          if (!match || Number(match[1]) !== Number(coligada) || !idPositivo(match[2])) throw new Error('Resultado de criação RM incerto; reconciliar ticket');
          op = await repositorio.avancar(op!, 'CREATED', match[2]);
          return retorno;
        },
      });
      if (resposta.statusCode !== 200 || !op.pg) throw new Error('Criação não confirmada; consultar reserva antes de repetir');
    }
    const pg = op.pg!;
    prazo.exigir(8000);
    const movimento = await rm.readReacord(`${coligada};${pg}`, 'MovMovimentoTBCData', contextoT);
    const tmov = registroUnico(movimento, 'TMOV');
    const compl = registroUnico(movimento, 'TMOVCOMPL');
    if (tmov.CODCOLIGADA !== coligada || tmov.IDMOV !== pg || tmov.CODCFO !== chave.codCfo || tmov.CODCOLCFO !== chave.codColCfo ||
        tmov.CODTMV !== codTmv || tmov.CODFILIAL !== texto(entrada.codigoDaFilial2 || entrada.codigoDaFilial) ||
        compl.CODCOLIGADA !== coligada || compl.IDMOV !== pg || compl.TICKET !== ticket) {
      throw new ConflitoPagamento('Movimento não pertence ao ticket/fornecedor/coligada de conta de consumo');
    }
    const parcelas = registrosRm(movimento, 'TMOVPAGTO');
    if (parcelas.length !== 1 || !idPositivo(parcelas[0].IDLAN) || parcelas[0].CODCOLIGADA !== coligada || parcelas[0].IDMOV !== pg) {
      throw new ConflitoPagamento('Esperado um único IDLAN válido do movimento');
    }
    const idLan = parcelas[0].IDLAN;
    const esperado: Array<[string, string]> = [...montarCamposDadoPagamento(chave), ['CODIGOBARRA', boleto.codigoBarras], ['IPTE', boleto.ipte]];
    const lerLan = async () => {
      prazo.exigir(5000);
      const lan = registroUnico(await rm.readReacord(`${coligada};${idLan}`, 'FinLanDataBR', contextoF), 'FLAN');
      if (lan.CODCOLIGADA !== coligada || lan.IDLAN !== idLan || lan.IDMOV !== pg || lan.CODCFO !== chave.codCfo || lan.CODCOLCFO !== chave.codColCfo) {
        throw new ConflitoPagamento('FLAN não pertence ao movimento/fornecedor esperado');
      }
      if (lan.STATUSLAN !== '0') throw new ConflitoPagamento('Lançamento não está em aberto; atualização bloqueada');
      return lan;
    };
    const antes = await lerLan();
    const completo = (lan: Record<string, string>) => esperado.every(([k, v]) => lan[k] === v);
    if (!completo(antes)) {
      if (esperado.some(([k, v]) => antes[k] && antes[k] !== v)) throw new ConflitoPagamento('FLAN contém dados bancários diferentes; não sobrescrever');
      // Uma escrita de resultado incerto só admite leitura de confirmação; não há fencing no RM.
      if (op.state === 'UPDATING') throw new ConflitoPagamento('Atualização RM incerta; campos ainda não confirmados, requer reconciliação');
      prazo.exigir(13000);
      op = await repositorio.avancar(op, 'UPDATING');
      const xml = `<![CDATA[<FinLAN><FLAN>${[['CODCOLIGADA', coligada], ['IDLAN', idLan], ...esperado]
        .map(([k, v]) => montaTag(k, v)).join('')}</FLAN></FinLAN>]]>`;
      const resultado = await rm.saveRecord(xml, 'FinLanDataBR', contextoF);
      if (resultado.trim() !== `${coligada};${idLan}`) throw new Error('Resultado da atualização RM incerto');
      if (!completo(await lerLan())) throw new ConflitoPagamento('Verificação pós-gravação falhou; manter TS03 pendente');
    }
    op = await repositorio.avancar(op, 'COMPLETE');
    return formatResponse(200, { PG: pg, integracaoBancaria: completo(antes) ? 'ja_gravada' : 'gravada' });
  } catch (erro) {
    const codigo = erro instanceof EntradaInvalida ? 422 : erro instanceof ConflitoPagamento ? 409 : 503;
    const mensagem = axios.isAxiosError(erro) ? 'Comunicação RM interrompida; consultar estado durável' : erro instanceof Error ? erro.message : 'Falha de integração';
    console.warn('[RM-V2] Pagamento pendente', { codigo, estado: op?.state });
    return formatResponse(codigo, { ...(op?.pg ? { PG: op.pg } : {}), integracaoBancaria: 'pendente', avisoIntegracaoBancaria: mensagem });
  }
};
