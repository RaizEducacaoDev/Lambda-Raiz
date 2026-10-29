import type { Context } from 'aws-lambda';
import { handlerLegado } from './solicitacaoDePagamentoLegado';
import { executarPagamentoSeguro } from './solicitacaoDePagamentoSeguro';
import { formatResponse } from '../../../utils/response';

export const handler = async (event: any, context?: Pick<Context, 'getRemainingTimeInMillis'>) => {
  let campos;
  try { campos = JSON.parse(event.body); } catch { return formatResponse(422, { message: 'Corpo JSON inválido' }); }
  // Non-payment workflows retain the exact downloaded production bundle.
  if (campos?.tipoDaSolicitacao !== 'PG') return require('./solicitacaoDePagamento.core.cjs').handler(event, context);
  return executarPagamentoSeguro(campos, context, (canonicos, transporte) =>
    handlerLegado({ ...event, body: JSON.stringify(canonicos) }, { transporte, getLOC: transporte.buscarEstoque }));
};
