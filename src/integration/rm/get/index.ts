import schemaExecution from '@libs/schema';
import { handlerPath } from '@libs/handlerResolver';

const createEvent = (name) => ({
  handler: `${handlerPath(__dirname)}/handler.${name}`,
  events: [
    {
      http: {
        method: 'get',
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

exports.tokenGoogle = createEvent('tokenGoogle');