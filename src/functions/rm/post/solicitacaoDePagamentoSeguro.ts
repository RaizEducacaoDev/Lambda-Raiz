import type { Context } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import { idPositivo, texto, preservarNumeroMovimentoContaConsumo } from './solicitacaoDePagamentoBancario';
import { ConflitoPagamento, DynamoPagamento, OperacaoPagamento, RepositorioPagamento } from './pagamentoV2Idempotencia';
import { PrazoPagamento, registroUnico, registrosRm, TransportePagamentoV2, TransporteRm } from './pagamentoV2Rm';
import { diagnosticarRetornoRm, resumirMensagemNegocioRm, tipoErroSeguro } from './pagamentoDiagnosticoSeguro';
import { prepararContextoFiscal, validarContextoFiscal } from './pagamentoFiscal';
import { prepararDocumento } from './pagamentoDocumento';
import { validarDadosAntesDaCriacao } from './pagamentoPreflight';
import { prepararEvidencia } from './pagamentoEvidencia';
import { baselineParcela, hashSnapshot, lerContinuacao, type BaselineParcela } from './pagamentoContinuacao';
import { consultarPagamentoExistente } from './pagamentoExistente';
import { respostaErroPagamento, type EtapaPagamento } from './pagamentoResposta';
import { CamposPagamento, codigoMovimento, dataCanonica, dataLegado, hashIntencao, identidadePagamento, intencaoPagamento,
  normalizar, PagamentoInvalido, planosPagamento, PlanoParcela, validarCadastro, validarFilialBancaria, valorCanonico, xmlLancamento } from './pagamentoIdentidade';

type Criar = (campos: CamposPagamento, transporte: Pick<TransporteRm, 'saveRecord' | 'buscarEstoque'>) => Promise<{ statusCode: number; body: string }>;
type Dependencias = { repositorio: RepositorioPagamento; rm: TransporteRm };

export async function executarPagamentoSeguro(entrada: CamposPagamento, context: Pick<Context, 'getRemainingTimeInMillis'> | undefined,
  criar: Criar, deps?: Dependencias) {
  let op: OperacaoPagamento | undefined;
  let criadoAgora = false;
  let etapaCriacao: 'preflight' | 'checkpoint_creating' | 'transport_call' | 'transport_result' | 'checkpoint_created' | undefined;
  let chaveRmRecebida: string | undefined;
  let movimentoFiscalConhecido: string | undefined;
  let diagnosticoCriacao: ReturnType<typeof diagnosticarRetornoRm> | undefined;
  let mensagemNativa: string | undefined;
  let etapa: EtapaPagamento = 'inicio';
  let movimentoConfirmado: string | undefined;
  try {
    if (!context) throw new Error('Prazo da Lambda indisponível');
    const prazo = new PrazoPagamento(() => context.getRemainingTimeInMillis());
    prazo.exigir(6000);
    etapa = 'identidade_bancaria';
    const chave = identidadePagamento(entrada);
    etapa = 'validacao_solicitacao';
    const coligada = chave.codColPgto, ticket = texto(entrada.ticketRaiz);
    const filial = texto(entrada.codigoDaFilial2 || entrada.codigoDaFilial);
    // DataSource may find the same invoice number in another year/ticket. The
    // native census below resolves automatic references by this ticket only.
    let pgEntrada = texto(entrada.idDoMovimento) || undefined;
    if (!idPositivo(ticket) || !idPositivo(filial) || (pgEntrada && !idPositivo(pgEntrada))) {
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
    // A positive native read takes precedence over stale reservation metadata.
    // This branch never writes RM/Dynamo or turns a partial integration into success.
    etapa = 'consulta_existente';
    const existente = await consultarPagamentoExistente(rm, entrada, chave, planos, codTmv, pgEntrada);
    movimentoConfirmado = existente?.pg;
    if (existente?.completo) {
      console.info('[RM-IDPGTO] Operação existente confirmada', { ticket, coligada, idMov: existente.pg,
        idLans: existente.idLans, event: 'existing_payment_confirmed_readonly' });
      return formatResponse(200, { PG: existente.pg, LF: existente.idLans.length === 1 ? existente.idLans[0] : '',
        idLans: existente.idLans, integracaoBancaria: 'ja_gravada' });
    }
    // Partial native chains can only continue the existing bank-association path.
    // They must never fall through into a new movement creation.
    if (existente) pgEntrada = existente.pg;
    const conferirMovimento = async (pg: string) => {
      etapa = 'leitura_movimento';
      const movimento = await rm.readReacord(`${coligada};${pg}`, 'MovMovimentoTBCData', contextoT);
      const mov = registroUnico(movimento, 'TMOV'), compl = registroUnico(movimento, 'TMOVCOMPL');
      if (mov.CODCOLIGADA !== coligada || mov.IDMOV !== pg || mov.CODFILIAL !== filial || mov.CODCFO !== chave.codCfo ||
        mov.CODCOLCFO !== chave.codColCfo || mov.CODTMV !== codTmv || mov.STATUS === 'C' || compl.CODCOLIGADA !== coligada ||
        compl.IDMOV !== pg || compl.TICKET !== ticket) throw new ConflitoPagamento('Movimento não pertence ao ticket/fornecedor/destino ativo esperado');
      movimentoConfirmado = pg;
      return movimento;
    };
    // An explicit form movement requires native identity confirmation before
    // comparing reservation digests or changing a lease.
    // A document from another ticket must not masquerade as a digest conflict.
    if (pgEntrada) await conferirMovimento(pgEntrada);
    const validarBanco = async () => {
      etapa = 'validacao_bancaria';
      const dado = registroUnico(await rm.readReacord(`${chave.codColPgto};${chave.codColCfo};${chave.codCfo};${chave.idPgto}`,
        'FinDadosPgtoDataBR', contextoF), 'FDadosPgto');
      validarCadastro(dado, chave, entrada, planos);
      validarFilialBancaria(dado, filial);
    };
    const validarNovaNota = async () => {
      etapa = 'validacao_documento';
      validarDadosAntesDaCriacao(entrada, codTmv);
      prepararDocumento(entrada, { codColigada: coligada, codFilial: filial,
        codColCfo: chave.codColCfo, codCfo: chave.codCfo, codTmv });
      // Only the service builder emits IDNAT. A field from another flow cannot
      // justify applying a fiscal rule that its native XML does not use.
      if (codTmv === '1.2.03') etapa = 'validacao_fiscal';
      const fiscal = codTmv === '1.2.03' ? prepararContextoFiscal(entrada, { codColigada: coligada, codFilial: filial,
        codColCfo: chave.codColCfo, codCfo: chave.codCfo }) : undefined;
      if (fiscal) {
        etapa = 'validacao_fiscal';
        validarContextoFiscal(await rm.consultarContextoFiscal(fiscal), fiscal);
      }
    };
    // RM owns duplicate-document decisions. An expired attempt without a known
    // movement may be corrected and submitted again, preserving its history.
    if (!pgEntrada) {
      etapa = 'controle_tentativa';
      const anterior = await repo.consultar(pk);
      if (anterior && !Object.prototype.hasOwnProperty.call(anterior, 'pg') && anterior.lockUntil <= Date.now()) {
        if (['RESERVED', 'CREATING'].includes(anterior.state) && anterior.digest !== digest) {
          await validarBanco();
          await validarNovaNota();
          etapa = 'controle_tentativa';
          prazo.exigir(18000);
          op = await repo.corrigirReserva(anterior, digest, prazo.disponivel());
          console.info('[RM-IDPGTO] Retomada confirmada', { ticket, coligada, event: 'corrected_for_native_submission' });
        }
      }
    }
    etapa = 'controle_tentativa';
    const concluida = await repo.concluida(pk, digest, pgEntrada);
    // A confirmação de replay também relê o RM. Cadastro desativado depois do
    // pagamento não invalida um vínculo já persistido, mas nunca autoriza escrita.
    if (!concluida) {
      await validarBanco();
      if (!pgEntrada) {
        etapa = 'controle_tentativa';
        movimentoFiscalConhecido = await repo.movimentoConhecido(pk, digest, pgEntrada);
        if (!movimentoFiscalConhecido) {
          await validarNovaNota();
        }
      }
    }
    etapa = 'controle_tentativa';
    op = op || concluida || await repo.reservar(pk, digest, pgEntrada, prazo.disponivel());
    if (movimentoFiscalConhecido && op.pg !== movimentoFiscalConhecido) {
      throw new ConflitoPagamento('Movimento durável alterado durante a retomada; reconciliar sem criar outro');
    }
    if (!op.pg) {
      etapa = 'criacao_movimento';
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
          etapa = 'criacao_movimento';
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
          const final = registroUnico(xml.slice(9, -3), 'TMOV');
          const serieInformada = ['1.2.01', '1.2.03', '1.2.25'].includes(codTmv) ? texto(entrada.serie) : '';
          if (final.NUMEROMOV !== entrada.numeroDaNF || (serieInformada && final.SERIE !== serieInformada)) {
            throw new ConflitoPagamento('XML final não preservou a identidade do documento; nenhuma criação foi enviada');
          }
          const antesDoEnvio = await rm.consultarRetomada(coligada, ticket);
          if (antesDoEnvio.movimentos.length || antesDoEnvio.lancamentos.length) {
            throw new ConflitoPagamento('Foi identificado um movimento do ticket antes do envio. Reenvie para confirmar a operação existente; nenhuma nova criação foi enviada.');
          }
          // Persist only an allowlisted intent summary and hashes. A failure is
          // still pre-dispatch and can safely close this RESERVED lease.
          prazo.timeoutCriacao(4500);
          const evidencia = prepararEvidencia(xml, entrada, codTmv, chave, filial, ticket, planos,
            { serie: final.SERIE || '', numero: final.NUMEROMOV, tipoDocumento: final.CODTDO || '' });
          if (repo.registrarEvidencia) await repo.registrarEvidencia(op!, evidencia);
          prazo.timeoutCriacao(2500);
          // Record the attempt before SaveRecord. A later request may resume
          // it after this lease expires. RM decides document duplication.
          etapaCriacao = 'checkpoint_creating';
          etapa = 'controle_criacao';
          let inicioEtapa = Date.now();
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'creating_checkpoint_started' });
          op = await repo.avancar(op!, 'CREATING');
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'creating_checkpoint_confirmed', durationMs: Date.now() - inicioEtapa });
          etapaCriacao = 'transport_call';
          etapa = 'criacao_movimento';
          inicioEtapa = Date.now();
          // This marks the transport invocation, not proof of an HTTP dispatch.
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'transport_call_started' });
          const retorno = await rm.saveRecord(xml, servidor, contexto);
          etapaCriacao = 'transport_result';
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'transport_call_returned', durationMs: Date.now() - inicioEtapa });
          const match = retorno.trim().match(/^(\d+);([1-9]\d*)$/);
          if (!match || match[1] !== coligada) {
            diagnosticoCriacao = diagnosticarRetornoRm(retorno, Boolean(match));
            mensagemNativa = resumirMensagemNegocioRm(retorno);
            console.warn('[RM-IDPGTO] Retorno de criação sem chave confirmada', { ticket, coligada,
              ...diagnosticoCriacao });
            try {
              if (repo.registrarEvidencia) await repo.registrarEvidencia(op!, { ...evidencia, phase: 'native_result', diagnostic: diagnosticoCriacao });
            } catch {
              console.warn('[RM-IDPGTO] Evidência do retorno não confirmada', { ticket, coligada, reasonCode: diagnosticoCriacao.reasonCode });
            }
            const rejeicaoNegocio = diagnosticoCriacao.category === 'rm_rejection_or_diagnostic' &&
              ['RM_DUPLICATE_RECORD', 'RM_INVALID_FISCAL_NATURE', 'RM_INVALID_REFERENCE', 'RM_REQUIRED_FIELD',
                'RM_PERIOD_CLOSED', 'RM_PERMISSION_DENIED', 'RM_INVALID_DATE', 'RM_INVALID_FORMAT'].includes(diagnosticoCriacao.reasonCode);
            if (!match && rejeicaoNegocio) {
              try {
                const aposRejeicao = await rm.consultarRetomada(coligada, ticket);
                if (!aposRejeicao.movimentos.length && !aposRejeicao.lancamentos.length) {
                  op = await repo.encerrarRejeicao(op!);
                  console.info('[RM-IDPGTO] Rejeição encerrada para correção no formulário', { ticket, coligada,
                    event: 'native_rejection_closed', reasonCode: diagnosticoCriacao.reasonCode });
                }
              } catch {
                console.warn('[RM-IDPGTO] Encerramento da rejeição não confirmado', { ticket, coligada });
              }
            }
            throw new Error('RM retornou diagnóstico sem chave de movimento');
          }
          chaveRmRecebida = match[2];
          movimentoConfirmado = chaveRmRecebida;
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'primary_key_received', idMov: chaveRmRecebida });
          etapaCriacao = 'checkpoint_created';
          etapa = 'controle_criacao';
          inicioEtapa = Date.now();
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'created_checkpoint_started', idMov: chaveRmRecebida });
          op = await repo.confirmarCriacaoPropria(op!, match[2], evidencia.xmlSha256);
          console.info('[RM-IDPGTO] Etapa de criação', { ticket, coligada, event: 'created_checkpoint_confirmed', idMov: chaveRmRecebida, durationMs: Date.now() - inicioEtapa });
          etapaCriacao = undefined;
          criadoAgora = true;
          return retorno;
        },
      });
      if (resposta.statusCode !== 200 || !op.pg) throw new Error('RM não devolveu um identificador de movimento válido');
    }
    const pg = op.pg!;
    etapa = 'leitura_movimento';
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
    const lerLancamento = async (pagamento: Record<string, string>, plano: PlanoParcela,
      fase: EtapaPagamento = 'leitura_lancamento') => {
      etapa = fase;
      prazo.exigir(4000);
      const idLan = pagamento.IDLAN;
      const lan = registroUnico(await rm.readReacord(`${coligada};${idLan}`, 'FinLanDataBR', contextoF), 'FLAN');
      if (lan.CODCOLIGADA !== coligada || lan.IDLAN !== idLan || lan.IDMOV !== pg || lan.CODCFO !== chave.codCfo ||
        lan.CODCOLCFO !== chave.codColCfo || lan.CODFILIAL !== filial || dataCanonica(lan.DATAVENCIMENTO) !== plano.vencimento ||
        valorCanonico(lan.VALORORIGINAL) !== valorCanonico(pagamento.VALOR)) throw new ConflitoPagamento('FLAN diverge do movimento/fornecedor/parcela esperado');
      return lan;
    };
    const validarAlteracao = (lan: Record<string, string>, target: Array<[string, string]>, ownDefault: boolean) => {
      if (lan.STATUSLAN !== '0' || (texto(lan.VALORBAIXADO) && valorCanonico(lan.VALORBAIXADO) !== '0.0') ||
        !['', '0'].includes(texto(lan.BAIXAPENDENTE)) || idPositivo(lan.IDBOLETO)) {
        throw new ConflitoPagamento('Lançamento já baixado, pendente ou com boleto; atualização bloqueada');
      }
      if (target.some(([k, v]) => texto(lan[k]) && lan[k] !== v &&
        !(['IDPGTO', 'CODCOLPGTO'].includes(k) && Number(lan[k]) === 0) && !(k === 'IDPGTO' && ownDefault))) {
        throw new ConflitoPagamento('FLAN possui dados bancários diferentes; não sobrescrever');
      }
    };
    const movementHash = hashSnapshot({ movement: registroUnico(movimento, 'TMOV'), complement: registroUnico(movimento, 'TMOVCOMPL'),
      installments: pagamentos.slice().sort((a, b) => a.IDLAN.localeCompare(b.IDLAN)) });
    let continuation = op.continuation ? lerContinuacao(op.continuation) : undefined;
    if (continuation) {
      if (continuation.receipt.digest !== digest || continuation.receipt.pg !== pg) {
        throw new ConflitoPagamento('Recibo próprio diverge da intenção/movimento');
      }
    }
    // Only this invocation's positive native ACK grants the initial capture.
    // A later CREATED/ADOPT/readback cannot manufacture a missing baseline.
    if (criadoAgora && continuation && !continuation.baseline) {
      const parcels: Record<string, BaselineParcela> = {};
      for (const payment of pagamentos) {
        const plan = planosPorId.get(payment.IDLAN)!;
        const observed = await lerLancamento(payment, plan);
        if (!plan.campos.every(([k, v]) => observed[k] === v)) validarAlteracao(observed, plan.campos, true);
        parcels[payment.IDLAN] = baselineParcela(observed, plan.campos);
      }
      etapa = 'preparacao_vinculo';
      prazo.exigir(5000);
      op = await repo.selarBaseline(op, { movementHash, parcels });
      continuation = lerContinuacao(op.continuation!);
    }
    const baseline = continuation?.baseline;
    let gravou = false;
    const ids: string[] = [];
    for (const pagamento of pagamentos) {
      prazo.exigir(5000);
      const idLan = pagamento.IDLAN;
      const plano = planosPorId.get(idLan)!;
      const esperado = plano.campos;
      const completo = (lan: Record<string, string>) => esperado.every(([k, v]) => lan[k] === v);
      const ler = (confirmando = false) => lerLancamento(pagamento, plano,
        confirmando ? 'confirmacao_vinculo' : 'leitura_lancamento');
      const antes = await ler();
      const propria = baseline?.parcels[idLan];
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
        if (propria && lerContinuacao(op.continuation!).progress![idLan] !== 'COMPLETE') op = await repo.avancarParcelaPropria(op, idLan, 'COMPLETE');
        ids.push(idLan); continue;
      }
      let opLan = await repo.reservar(pkLan, digestLan, pg, prazo.disponivel());
      if (!completo(antes)) {
        if (opLan.state === 'UPDATING' || opLan.state === 'COMPLETE') {
          throw new ConflitoPagamento('Associação anterior incerta/divergente; confirmar sem repetir escrita');
        }
        if (propria && (lerContinuacao(op.continuation!).progress![idLan] !== 'PREPARED' || propria.nativeHash !== hashSnapshot(antes))) {
          throw new ConflitoPagamento('Baseline bancário alterado ou associação anterior incerta; não repetir escrita');
        }
        if (baseline && (!propria || propria.targetHash !== hashSnapshot(esperado) || baseline.movementHash !== movementHash ||
          Object.keys(baseline.parcels).sort().join(',') !== pagamentos.map(p => p.IDLAN).sort().join(','))) {
          throw new ConflitoPagamento('Movimento/parcelas divergem do baseline próprio');
        }
        // The exact observed baseline preserves this creation's authorization
        // across invocations. Historical/adopted movements have no such grant.
        validarAlteracao(antes, esperado, Boolean(propria));
        // Account for the extra bounded root CAS/read before dispatch.
        etapa = 'gravacao_vinculo';
        prazo.exigir(propria ? 17000 : 11000);
        if (propria) op = await repo.avancarParcelaPropria(op, idLan, 'UPDATING');
        opLan = await repo.avancar(opLan, 'UPDATING');
        if (propria) await repo.conferirEnvioProprio(op, idLan);
        const result = await rm.saveRecord(xmlLancamento(coligada, idLan, esperado), 'FinLanDataBR', contextoF);
        if (result.trim() !== `${coligada};${idLan}`) throw new Error('Resultado da associação bancária incerto');
        const depois = await ler(true);
        if (!completo(depois)) throw new ConflitoPagamento('IDPGTO/dados bancários não persistidos no lançamento');
        gravou = true;
      }
      etapa = 'confirmacao_final';
      if (propria) op = await repo.avancarParcelaPropria(op, idLan, 'COMPLETE');
      await repo.avancar(opLan, 'COMPLETE'); ids.push(idLan);
    }
    etapa = 'confirmacao_final';
    if (!concluida) op = await repo.avancar(op, 'COMPLETE');
    console.info('[RM-IDPGTO] Vínculo financeiro confirmado', { ticket, coligada, idMov: pg, idLans: ids, idPgto: chave.idPgto });
    return formatResponse(200, { PG: pg, LF: ids.length === 1 ? ids[0] : '', idLans: ids,
      integracaoBancaria: gravou ? 'gravada' : 'ja_gravada' });
  } catch (erro) {
    // A failed build/preflight has no native creation effect. Fence this owner
    // before expiring its lease. A remotely persisted CREATING checkpoint makes
    // the CAS fail, preserving uncertainty even if its response was lost.
    if (etapaCriacao !== 'transport_result' && op?.state === 'RESERVED' && op.protocolVersion === 2 && !Object.prototype.hasOwnProperty.call(op, 'pg')) {
      try {
        const repo = deps?.repositorio || new DynamoPagamento(process.env.PAGAMENTO_IDPGTO_TABLE!);
        await repo.encerrarAntesDoEnvio(op);
      } catch {
        console.warn('[RM-IDPGTO] Encerramento antes do envio não confirmado', { ticket: texto(entrada?.ticketRaiz), state: op.state });
      }
    }
    const resposta = respostaErroPagamento({ erro, etapa, pgConfirmado: movimentoConfirmado,
      criacaoIncerta: op?.state === 'CREATING' || etapaCriacao === 'checkpoint_creating',
      diagnostico: diagnosticoCriacao, mensagemNativa });
    // Only fixed diagnostic codes and confirmed effects reach the log. Never
    // serialize Axios/SOAP exceptions, credentials, payloads or native raw text.
    console.warn('[RM-IDPGTO] Integração pendente', { ticket: idPositivo(texto(entrada?.ticketRaiz)) ? texto(entrada.ticketRaiz) : undefined,
      status: resposta.status, state: op?.state, pg: movimentoConfirmado, errorType: tipoErroSeguro(erro),
      creationStage: etapaCriacao, receivedPg: chaveRmRecebida, ...resposta.log });
    return formatResponse(resposta.status, resposta.body);
  }
}
