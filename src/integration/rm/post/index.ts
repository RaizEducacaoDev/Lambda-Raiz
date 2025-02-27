import schemaExecution from '@libs/schema';
import { handlerPath } from '@libs/handlerResolver';

const createEvent = (name) => ({
  handler: `${handlerPath(__dirname)}/handler.${name}`,
  events: [
    {
      http: {
        method: 'post',
        path: name,
        request: {
          schema: {
            'application/json': schemaExecution,
          },
        },
      },
    },
  ],
});

exports.solicitacaoDeCompra = createEvent('solicitacaoDeCompra');
exports.ordemDeCompra = createEvent('ordemDeCompra');
exports.cotacao = createEvent('cotacao');
exports.cancelaCotacao = createEvent('cancelaCotacao');
exports.fileQuadroComparativo = createEvent('fileQuadroComparativo');
exports.geraQuadroComparativo = createEvent('geraQuadroComparativo');
exports.comunicaFornecedor = createEvent('comunicaFornecedor');
exports.gravaNaturezaOrcamentaria = createEvent('gravaNaturezaOrcamentaria');