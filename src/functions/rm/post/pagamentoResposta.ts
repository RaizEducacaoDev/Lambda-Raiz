import { PagamentoInvalido } from './pagamentoIdentidade';
import { ConflitoPagamento } from './pagamentoV2Idempotencia';
import { FalhaContratoRm, PrazoPagamentoInsuficiente } from './pagamentoV2Rm';
import { diagnosticarRetornoRm } from './pagamentoDiagnosticoSeguro';
import { mensagemDiagnostico } from './pagamentoEvidencia';

export type EtapaPagamento = 'inicio' | 'identidade_bancaria' | 'validacao_solicitacao' | 'consulta_existente' |
  'validacao_bancaria' | 'validacao_documento' | 'validacao_fiscal' | 'controle_tentativa' | 'criacao_movimento' |
  'controle_criacao' | 'leitura_movimento' | 'leitura_lancamento' | 'preparacao_vinculo' | 'gravacao_vinculo' |
  'confirmacao_vinculo' | 'confirmacao_final';
type ContextoResposta = {
  erro: unknown; etapa: EtapaPagamento; pgConfirmado?: string; criacaoIncerta: boolean;
  diagnostico?: ReturnType<typeof diagnosticarRetornoRm>; mensagemNativa?: string;
};
const rejeicoes = new Set(['RM_DUPLICATE_RECORD', 'RM_INVALID_FISCAL_NATURE', 'RM_INVALID_REFERENCE',
  'RM_REQUIRED_FIELD', 'RM_PERIOD_CLOSED', 'RM_PERMISSION_DENIED', 'RM_INVALID_DATE', 'RM_INVALID_FORMAT']);
const codigosFormulario = new Set(['DADOS_PAGAMENTO_INVALIDOS', 'NATUREZA_FISCAL_INCOMPATIVEL',
  'DOCUMENTO_RM_DUPLICADO', 'NUMERO_DOCUMENTO_INVALIDO', 'SERIE_DOCUMENTO_INVALIDA']);

// Pure presentation policy. No calls, retries, state transitions or financial writes.
// A native rejection, a local time budget and a bank failure must never share a
// diagnosis just because a reservation happens to contain an IDMOV.
export function respostaErroPagamento(c: ContextoResposta) {
  const erro = c.erro;
  const codeNativo = c.diagnostico?.reasonCode;
  const rejeicaoNativa = c.diagnostico?.category === 'rm_rejection_or_diagnostic' &&
    (rejeicoes.has(codeNativo!) || (codeNativo === 'RM_UNCLASSIFIED_REJECTION' && Boolean(c.mensagemNativa)));
  const pg = c.pgConfirmado && /^[1-9]\d*$/.test(c.pgConfirmado) ? c.pgConfirmado : undefined;
  const reasonConflito = erro instanceof ConflitoPagamento ? erro.reason : undefined;
  let status = 503, origem: 'TOTVS' | 'FORMULARIO' | 'INTEGRACAO' = 'INTEGRACAO';
  let code = 'FALHA_INTEGRACAO_PAGAMENTO', motivo = 'FALHA_TECNICA', detalhe: string;
  if (rejeicaoNativa) {
    // The pre-bank-change backup returned 400 for a native business rejection.
    // Keep that distinction, with one sanitized message for both Zeev fields.
    status = 400; origem = 'TOTVS'; code = codeNativo!; motivo = code;
    detalhe = `Erro ao gravar no TOTVS: ${c.mensagemNativa || mensagemDiagnostico(code)} Corrija os dados indicados e envie novamente.`;
  } else if (erro instanceof PagamentoInvalido) {
    status = 422; origem = 'FORMULARIO';
    const declared = (erro as PagamentoInvalido & { code?: string }).code;
    code = declared && codigosFormulario.has(declared) ? declared :
      c.etapa === 'identidade_bancaria' || c.etapa === 'validacao_bancaria' ? 'IDPGTO_NAO_CONFIRMADO' : 'DADOS_PAGAMENTO_INVALIDOS';
    motivo = code; detalhe = erro.message;
  } else if (erro instanceof PrazoPagamentoInsuficiente) {
    code = 'PRAZO_INTEGRACAO_INSUFICIENTE'; motivo = erro.reason;
    detalhe = 'O tempo disponível para concluir esta etapa da integração terminou. Envie novamente para continuar a conferência do pagamento.';
  } else if (erro instanceof ConflitoPagamento) {
    status = 409; code = reasonConflito || 'OPERACAO_EM_CONFLITO'; motivo = code;
    // Preserve actionable business conflicts. Keep internal lease/hash/baseline
    // vocabulary in the logs rather than asking a requester to reconcile it.
    detalhe = reasonConflito === 'OPERACAO_EM_PROCESSAMENTO' || /^Ticket em processamento/.test(erro.message)
      ? 'O envio anterior ainda está sendo finalizado. Aguarde alguns instantes e envie novamente.'
      : /reserva|baseline|recibo|lease|snapshot|digest|reconcil|conciliar|owner|estado|\bFLAN\b/i.test(erro.message)
        ? 'Não foi possível confirmar o estado desta tentativa. Aguarde alguns instantes e envie novamente; se persistir, informe o ticket ao suporte.'
        : erro.message;
  } else {
    const e = erro && typeof erro === 'object' ? erro as { name?: string; code?: string } : {};
    if (erro instanceof FalhaContratoRm) { code = 'RESPOSTA_TOTVS_INVALIDA'; motivo = erro.reason; }
    else if (['ETIMEDOUT', 'ECONNABORTED', 'ERR_CANCELED'].includes(e.code || '') ||
      ['TimeoutError', 'AbortError', 'CanceledError'].includes(e.name || '')) {
      code = 'COMUNICACAO_NAO_CONFIRMADA'; motivo = 'TIMEOUT_OU_CANCELAMENTO';
    } else if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK', 'ERR_BAD_RESPONSE', 'ERR_BAD_REQUEST'].includes(e.code || '')) {
      code = 'FALHA_COMUNICACAO_TOTVS'; motivo = 'FALHA_COMUNICACAO';
    } else if (e.name === 'ConditionalCheckFailedException') {
      status = 409; code = 'OPERACAO_EM_PROCESSAMENTO'; motivo = 'CONCORRENCIA_DETECTADA';
    } else if (codeNativo) { code = codeNativo; motivo = codeNativo; }
    detalhe = c.criacaoIncerta ?
      'O resultado da gravação no TOTVS ainda não foi confirmado. Aguarde alguns instantes e envie novamente para a integração conferir o resultado.' :
      'Não foi possível concluir a comunicação ou a confirmação desta etapa. Envie novamente para a integração conferir o resultado.';
  }
  // Effect is independent of cause. A confirmed key is never described as a
  // failed creation, and a lost checkpoint is never called a missing bank ID.
  const efeito = pg ? 'MOVIMENTO_CONFIRMADO' : c.criacaoIncerta ? 'CRIACAO_NAO_CONFIRMADA' : 'SEM_MOVIMENTO_CONFIRMADO';
  const mensagem = pg ? `O movimento ${pg} já está gravado no TOTVS. A integração ainda não foi concluída. ${detalhe}` : detalhe;
  return { status, body: { message: mensagem, error: mensagem, code, reason: motivo, origem, etapa: c.etapa,
    efeito, integracaoBancaria: 'pendente', ...(pg ? { PG: pg } : {}) },
    log: { code, reason: motivo, origem, etapa: c.etapa, efeito,
      ...(erro instanceof PrazoPagamentoInsuficiente ? { necessarioMs: erro.necessarioMs,
        disponivelMs: Math.max(0, Math.floor(erro.disponivelMs)) } : {}) } };
}
