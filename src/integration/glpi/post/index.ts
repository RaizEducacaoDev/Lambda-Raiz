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

exports.admissao = createEvent('admissao');
exports.desligamento = createEvent('desligamento');
exports.movimentacao = createEvent('movimentacao');
exports.aberturaDeChamados = createEvent('aberturaDeChamados');