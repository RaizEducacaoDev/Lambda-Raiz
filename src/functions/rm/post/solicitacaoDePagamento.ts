import type { Context } from 'aws-lambda';
import { deveExecutarV2 } from './solicitacaoDePagamentoBancario';
import { executarPagamentoV2 } from './solicitacaoDePagamentoV2';
import { handlerLegado } from './solicitacaoDePagamentoLegado';

export const handler = async (event: any, context?: Pick<Context, 'getRemainingTimeInMillis'>) => {
  let campos;
  try { campos = JSON.parse(event.body); } catch { return handlerLegado(event); }
  if (!deveExecutarV2(campos)) return handlerLegado(event);
  return executarPagamentoV2(campos, context, (canonicos, transporte) =>
    handlerLegado({ ...event, body: JSON.stringify(canonicos) }, { transporte, getLOC: transporte.buscarEstoque }));
};
