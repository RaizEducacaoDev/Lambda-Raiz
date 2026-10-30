import type { Context } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import { idPositivo, texto, preservarNumeroMovimentoContaConsumo } from './solicitacaoDePagamentoBancario';
import { ConflitoPagamento, DynamoPagamento, OperacaoPagamento, RepositorioPagamento } from './pagamentoV2Idempotencia';
import { PrazoPagamento, registroUnico, registrosRm, TransportePagamentoV2, TransporteRm } from './pagamentoV2Rm';
import { diagnosticarRetornoRm, tipoErroSeguro } from './pagamentoDiagnosticoSeguro';
import { CamposPagamento, codigoMovimento, dataCanonica, dataLegado, hashIntencao, identidadePagamento, intencaoPagamento,
  normalizar, PagamentoInvalido, planosPagamento, PlanoParcela, validarCadastro, valorCanonico, xmlLancamento } from './pagamentoIdentidade';

type Criar = (campos: CamposPagamento, transporte: Pick<TransporteRm, 'saveRecord' | 'buscarEstoque'>) => Promise<{ statusCode: number; body: string }>;
type Dependencias = { repositorio: RepositorioPagamento; rm: TransporteRm };

export async function executarPagamentoSeguro(entrada: CamposPagamento, context: Pick<Context, 'getRemainingTimeInMillis'> | undefined,
  criar: Criar, deps?: Dependencias) {
  let op: OperacaoPagamento | undefined;
  let criadoAgora = false;
  let etapaCriacao: 'preflight' | 'checkpoint_creating' | 'transport_call' | 'transport_result' | 'checkpoint_created' | undefined;
  let chaveRmRecebida: string | undefined;
  try {
    if (!context) throw new Error('Prazo da Lambda indisponível');
    const prazo = new PrazoPagamento(() => context.getRemainingTimeInMillis());
    prazo.exigir(6000);
    const chave = identidadePagamento(entrada);
    const coligada = chave.codColPgto, ticket = texto(entrada.ticketRaiz);
    const filial = texto(entrada.codigoDaFilial2 || entrada.codigoDaFilial);
    const pgEntrada = texto(entrada.idDoMovimento || entrada.movimentoExistente) || undefined;
    if (!idPositivo(ticket) || !idPositivo(filial) || (pgEntrada && !idPositivo(pgEntrada)) ||
      (texto(entrada.idDoMovimento) && texto(entrada.movimentoExistente) && texto(entrada.idDoMovimento) !== texto(entrada.movimentoExistente))) {
      throw new PagamentoInvalido('Ticket, filial ou movimento inválido/ambíguo');
    }
    const codTmv = codigoMovimento(entrada);
    const planos = planosPagamento(entrada, chave);
    const pk = `${process.env.STAGE || 'dev'}#PG#${coligada}#${ticket}`;
    const digest = hashIntencao(intencaoPagamento(entrada, chave, planos, codTmv));
    if (!deps && !process.env.PAGAMENTO_IDPGTO_TABLE) throw new Error('Armazenamento durável do vínculo bancário indisponível');
    const repo = deps?.repositorio || new DynamoPagamento(process.env.PAGAMENTO_IDPGTO_TABLE!);
    const rm = deps?.rm || new TransportePagamentoV2(prazo);
    const contextoF = `CODSISTEMA=F;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
    const contextoT = `CODSISTEMA=T;CODCOLIGADA=${coligada};CODUSUARIO=p_heflo`;
    const conferirMovimento = async (pg: string) => {
      const movimento = await rm.readReacord(`${coligada};${pg}`, 'MovMovimentoTBCData', contextoT);
      const mov = registroUnico(movimento, 'TMOV'), compl = registroUnico(movimento, 'TMOVCOMPL');
      if (mov.CODCOLIGADA !== coligada || mov.IDMOV !== pg || mov.CODFILIAL !== filial || mov.CODCFO !== chave.codCfo ||
        mov.CODCOLCFO !== chave.codColCfo || mov.CODTMV !== codTmv || mov.STATUS === 'C' || compl.CODCOLIGADA !== coligada ||
        compl.IDMOV !== pg || compl.TICKET !== ticket) throw new ConflitoPagamento('Movimento não pertence ao ticket/fornecedor/destino ativo esperado');
      return movimento;
    };
    const concluida = await repo.concluida(pk, digest, pgEntrada);
    // A confirmação de replay também relê o RM. Cadastro desativado depois do
    // pagamento não invalida um vínculo já persistido, mas nunca autoriza escrita.
    if (!concluida) {
      const dado = registroUnico(await rm.readReacord(`${chave.codColPgto};${chave.codColCfo};${chave.codCfo};${chave.idPgto}`,
        'FinDadosPgtoDataBR', contextoF), 'FDadosPgto');
      validarCadastro(dado, chave, entrada, planos);
      if (pgEntrada) await conferirMovimento(pgEntrada);
    }
    op = concluida || await repo.reservar(pk, digest, pgEntrada, prazo.disponivel());
    if (!op.pg) {
      prazo.exigir(8000);
      const existentes = await rm.buscarMovimentosPorTicket(coligada, ticket, codTmv);
      if (existentes.length > 1 || existentes.some(v => !idPositivo(v))) throw new ConflitoPagamento('Movimentos ambíguos; conciliar sem criar outro');
      if (existentes.length) {
        await conferirMovimento(existentes[0]);
        op = await repo.avancar(op, 'CREATED', existentes[0]);
      }
    }
    if (!op.pg) {
      prazo.exigir(16000);
      const contaConsumo = ['CC', 'CONTA DE CONSUMO', 'CONTAS DE CONSUMO'].includes(normalizar(entrada.tipoDoPagamento));
      const campos: CamposPagamento = { ...entrada, tipoDoPagamento: contaConsumo ? 'CC' : entrada.tipoDoPagamento,
        idpgto: String(chave.idPgto), CODCOLPGTO: chave.codColPgto, CODCOLCFO: chave.codColCfo,
        dataDeEntrada: dataLegado(entrada.dataDeEntrada), dataDeEmissao: dataLegado(entrada.dataDeEmissao),
        dataDeVencimento: dataLegado(entrada.dataDeVencimento),
        ...(Array.isArray(entrada.listaDeParcelas) ? { listaDeParcelas: entrada.listaDeParcelas.map((p: CamposPagamento) =>
          ({ ...p, vencimentoDaParcela: dataLegado(p.vencimentoDaParcela) })) } : {}) };
      const resposta = await criar(campos, {
        buscarEstoque: (col, fil) => { prazo.exigir(15000); return rm.buscarEstoque(col, fil); },
        saveRecord: async (xml, servidor, contexto) => {
          etapaCriacao = 'preflight';
          // Check the HTTP window before making the reservation irreversible.
          // DynamoDB is bounded at 2s; reserve another 500ms for local overhead.
          prazo.timeoutCriacao(2500);
          if (servidor !== 'MovMovimentoTBCData' || op!.state !== 'RESERVED') throw new Error('Criação fora do estado autorizado');
          const puro = xml.startsWith('<![CDATA[') && xml.endsWith(']]>') ? xml.slice(9, -3) : '';
          const mov = registroUnico(puro, 'TMOV'), compl = registroUnico(puro, 'TMOVCOMPL');
          if (mov.CODCOLIGADA !== coligada || mov.CODFILIAL !== filial || mov.CODCFO !== chave.codCfo ||
              mov.CODCOLCFO !== chave.codColCfo || mov.CODTMV !== codTmv ||
              compl.TICKET !== ticket) throw new ConflitoPagamento('XML do movimento diverge da obrigação validada');
          if (contaConsumo) xml = preservarNumeroMovimentoContaConsumo(xml, texto(entrada.numeroDaNF));
          // A reserva irreversível antecede o SaveRecord. Nem timeout nem falha
          // de checkpoint podem permitir uma segunda criação automática.
          etapaCriacao = 'checkpoint_creating';
          let inicioEtapa = Date.now();
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'creating_checkpoint_started' });
          op = await repo.avancar(op!, 'CREATING');
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'creating_checkpoint_confirmed', durationMs: Date.now() - inicioEtapa });
          etapaCriacao = 'transport_call';
          inicioEtapa = Date.now();
          // This marks the transport invocation, not proof of an HTTP dispatch.
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'transport_call_started' });
          const retorno = await rm.saveRecord(xml, servidor, contexto);
          etapaCriacao = 'transport_result';
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'transport_call_returned', durationMs: Date.now() - inicioEtapa });
          const match = retorno.trim().match(/^(\d+);([1-9]\d*)$/);
          if (!match || match[1] !== coligada) {
            console.warn('[RM-IDPGTO] Retorno de criação sem chave confirmada', { ticket, coligada,
              ...diagnosticarRetornoRm(retorno, Boolean(match)) });
            throw new Error('Criação RM de resultado incerto; consultar movimento do ticket');
          }
          chaveRmRecebida = match[2];
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'primary_key_received', idMov: chaveRmRecebida });
          etapaCriacao = 'checkpoint_created';
          inicioEtapa = Date.now();
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'created_checkpoint_started', idMov: chaveRmRecebida });
          op = await repo.avancar(op!, 'CREATED', match[2]);
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'created_checkpoint_confirmed', idMov: chaveRmRecebida, durationMs: Date.now() - inicioEtapa });
          etapaCriacao = undefined;
          criadoAgora = true;
          return retorno;
        },
      });
      if (resposta.statusCode !== 200 || !op.pg) throw new Error('Criação não confirmada; preservar reserva para conciliação');
    }
    const pg = op.pg!;
    prazo.exigir(5000);
    const movimento = await conferirMovimento(pg);
    const pagamentos = registrosRm(movimento, 'TMOVPAGTO');
    if (pagamentos.length !== planos.length || new Set(pagamentos.map(p => p.IDLAN)).size !== pagamentos.length ||
      pagamentos.some(p => !idPositivo(p.IDLAN) || p.CODCOLIGADA !== coligada || p.IDMOV !== pg)) {
      throw new ConflitoPagamento('Parcelas/IDLANs não correspondem ao pagamento esperado');
    }
    // Resolve the complete mapping before the first bank write. A net amount
    // must never accidentally match another installment's gross amount.
    const planosPorId = new Map<string, PlanoParcela>();
    for (const vencimento of new Set(pagamentos.map(p => dataCanonica(p.DATAVENCIMENTO)))) {
      const nativas = pagamentos.filter(p => dataCanonica(p.DATAVENCIMENTO) === vencimento);
      const grupo = planos.filter(p => p.vencimento === vencimento);
      if (nativas.length !== grupo.length) throw new ConflitoPagamento('Parcelas divergem por vencimento');
      const valoresIguais = JSON.stringify(nativas.map(p => valorCanonico(p.VALOR)).sort()) ===
        JSON.stringify(grupo.map(p => p.valor).sort());
      if (!valoresIguais && new Set(grupo.map(p => JSON.stringify(p.campos))).size !== 1) {
        throw new ConflitoPagamento('Retenções tornam ambígua a associação de boletos no mesmo vencimento');
      }
      const restantes = grupo.slice();
      for (const nativa of nativas) {
        const matches = restantes.filter(p => !valoresIguais || p.valor === valorCanonico(nativa.VALOR));
        if (!matches.length || matches.some(p => JSON.stringify(p.campos) !== JSON.stringify(matches[0].campos))) {
          throw new ConflitoPagamento('Parcela financeira ambígua por valor/vencimento');
        }
        planosPorId.set(nativa.IDLAN, matches[0]); restantes.splice(restantes.indexOf(matches[0]), 1);
      }
    }
    let gravou = false;
    const ids: string[] = [];
    for (const pagamento of pagamentos) {
      prazo.exigir(5000);
      const idLan = pagamento.IDLAN;
      const plano = planosPorId.get(idLan)!;
      const esperado = plano.campos;
      const completo = (lan: Record<string, string>) => esperado.every(([k, v]) => lan[k] === v);
      const ler = async () => {
        prazo.exigir(4000);
        const lan = registroUnico(await rm.readReacord(`${coligada};${idLan}`, 'FinLanDataBR', contextoF), 'FLAN');
        if (lan.CODCOLIGADA !== coligada || lan.IDLAN !== idLan || lan.IDMOV !== pg || lan.CODCFO !== chave.codCfo ||
          lan.CODCOLCFO !== chave.codColCfo || lan.CODFILIAL !== filial || dataCanonica(lan.DATAVENCIMENTO) !== plano.vencimento ||
          valorCanonico(lan.VALORORIGINAL) !== valorCanonico(pagamento.VALOR)) throw new ConflitoPagamento('FLAN diverge do movimento/fornecedor/parcela esperado');
        return lan;
      };
      const antes = await ler();
      if (concluida) {
        if (!completo(antes)) throw new ConflitoPagamento('Vínculo bancário alterado após confirmação; conciliar sem sobrescrever');
        ids.push(idLan); continue;
      }
      // Checkpoint por IDLAN: a conclusão da primeira parcela não impede
      // processar as demais na retomada após o término do orçamento da Lambda.
      const pkLan = `${pk}#FLAN#${idLan}`, digestLan = hashIntencao({ digest, idLan, esperado });
      const concluidaLan = await repo.concluida(pkLan, digestLan, pg);
      if (concluidaLan) {
        if (!completo(antes)) throw new ConflitoPagamento('Vínculo de parcela confirmada foi alterado; conciliar');
        ids.push(idLan); continue;
      }
      let opLan = await repo.reservar(pkLan, digestLan, pg, prazo.disponivel());
      if (!completo(antes)) {
        if (opLan.state === 'UPDATING' || opLan.state === 'COMPLETE') {
          throw new ConflitoPagamento('Associação anterior incerta/divergente; confirmar sem repetir escrita');
        }
        if (antes.STATUSLAN !== '0' || (texto(antes.VALORBAIXADO) && valorCanonico(antes.VALORBAIXADO) !== '0.0') ||
          !['', '0'].includes(texto(antes.BAIXAPENDENTE)) || (idPositivo(antes.IDBOLETO))) {
          throw new ConflitoPagamento('Lançamento já baixado, pendente ou com boleto; atualização bloqueada');
        }
        // O RM pode preencher o cadastro padrão ao criar o título. Só esta
        // chamada que acabou de criá-lo pode substituí-lo pelo cadastro validado.
        // Movimentos históricos ou recuperados nunca recebem esse privilégio.
        if (esperado.some(([k, v]) => texto(antes[k]) && antes[k] !== v &&
          !(['IDPGTO', 'CODCOLPGTO'].includes(k) && Number(antes[k]) === 0) && !(k === 'IDPGTO' && criadoAgora))) {
          throw new ConflitoPagamento('FLAN possui dados bancários diferentes; não sobrescrever');
        }
        prazo.exigir(11000);
        opLan = await repo.avancar(opLan, 'UPDATING');
        const result = await rm.saveRecord(xmlLancamento(coligada, idLan, esperado), 'FinLanDataBR', contextoF);
        if (result.trim() !== `${coligada};${idLan}`) throw new Error('Resultado da associação bancária incerto');
        if (!completo(await ler())) throw new ConflitoPagamento('IDPGTO/dados bancários não persistidos no lançamento');
        gravou = true;
      }
      await repo.avancar(opLan, 'COMPLETE'); ids.push(idLan);
    }
    if (!concluida) op = await repo.avancar(op, 'COMPLETE');
    console.info('[RM-IDPGTO] Vínculo financeiro confirmado', { ticket, coligada, idMov: pg, idLans: ids, idPgto: chave.idPgto });
    return formatResponse(200, { PG: pg, LF: ids.length === 1 ? ids[0] : '', idLans: ids,
      integracaoBancaria: gravou ? 'gravada' : 'ja_gravada' });
  } catch (erro) {
    const status = erro instanceof PagamentoInvalido ? 422 : erro instanceof ConflitoPagamento ? 409 : 503;
    // Axios/SOAP exceptions may contain credentials and full bank data.
    const mensagem = erro instanceof PagamentoInvalido || erro instanceof ConflitoPagamento
      ? erro.message : 'Integração bancária não confirmada; consultar o estado antes de reenviar';
    console.warn('[RM-IDPGTO] Integração pendente', { ticket: idPositivo(texto(entrada?.ticketRaiz)) ? texto(entrada.ticketRaiz) : undefined,
      status, state: op?.state, pg: op?.pg, errorType: tipoErroSeguro(erro), creationStage: etapaCriacao, receivedPg: chaveRmRecebida });
    return formatResponse(status, { message: mensagem, error: mensagem, code: 'IDPGTO_NAO_CONFIRMADO',
      integracaoBancaria: 'pendente', ...(op?.pg ? { PG: op.pg } : {}) });
  }
}
