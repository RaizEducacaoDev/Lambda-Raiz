# Raizapp Serverless Service

Este projeto utiliza o Serverless Framework com AWS, Node.js e TypeScript.

## Deployment

O deploy é realizado automaticamente via GitHub Actions. O fluxo consiste em:
- Fazer checkout do código.
- Instalar dependências.
- Preparar um arquivo `.env` com variáveis de ambiente provenientes dos secrets do GitHub.
- Realizar o deploy para AWS conforme a branch:
  - `main` para produção (`--stage prod`)
  - `dev` para desenvolvimento (`--stage dev`)

## Environment Variables e Secrets

Todas as credenciais e dados sensíveis são configurados como secrets (Repository ou Environment Secrets) e injetados no workflow em tempo de deploy.  
No arquivo `serverless.ts`, as variáveis são referenciadas usando a sintaxe `${env:NOME_DA_VARIAVEL}`, garantindo que os valores não fiquem hardcoded.

## Instalação e Testes

1. Instale as dependências:
   - `npm install` ou `yarn`
2. Para realizar testes locais:
   - Execute: `npx serverless invoke local -f hello --path src/functions/hello/mock.json`

## Estrutura do Projeto

```
.
├── src
│   ├── functions               # Lambda configuration and source code folder
│   │   ├── hello
│   │   │   ├── handler.ts      # `Hello` lambda source code
│   │   │   ├── index.ts        # `Hello` lambda Serverless configuration
│   │   │   ├── mock.json       # `Hello` lambda input parameter, if any, for local invocation
│   │   │   └── schema.ts       # `Hello` lambda input event JSON-Schema
│   │   │
│   │   └── index.ts            # Import/export of all lambda configurations
│   │
│   └── libs                    # Lambda shared code
│       └── apiGateway.ts       # API Gateway specific helpers
│       └── handlerResolver.ts  # Sharable library for resolving lambda handlers
│       └── lambda.ts           # Lambda middleware
│
├── package.json
├── serverless.ts               # Serverless service file
├── tsconfig.json               # Typescript compiler configuration
├── tsconfig.paths.json         # Typescript paths
└── webpack.config.js           # Webpack configuration
```

### 3rd party libraries

- [json-schema-to-ts](https://github.com/ThomasAribart/json-schema-to-ts) - uses JSON-Schema definitions used by API Gateway for HTTP request validation to statically generate TypeScript types in your lambda's handler code base
- [middy](https://github.com/middyjs/middy) - middleware engine for Node.Js lambda. This template uses [http-json-body-parser](https://github.com/middyjs/middy/tree/master/packages/http-json-body-parser) to convert API Gateway `event.body` property, originally passed as a stringified JSON, to its corresponding parsed object
- [@serverless/typescript](https://github.com/serverless/typescript) - provides up-to-date TypeScript definitions for your `serverless.ts` service file

### Advanced usage

Any tsconfig.json can be used, but if you do, set the environment variable `TS_NODE_CONFIG` for building the application, eg `TS_NODE_CONFIG=./tsconfig.app.json npx serverless webpack`

Instalar AWS CLI
https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

Configurar CLIENT e SECRET do suporte:
https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html

Instalar Node JS
ATENÇÃO: ANTES DE INSTALAR, CERTIFIQUE-SE DA ÚLTIMA VERSÃO ACEITA PELO AWS. VOCÊ VERÁ ISSO AO TENTAR CRIAR UMA NOVA FUNÇÃO LAMBDA, EXIBIRÁ A ÚLTIMA VERSÃO. NESSA DATA DE 30/05/2022 POR EXEMPLO, É A VERSÃO 16.x.

Instalar serverless:
npm install -G serverless

Também instalar Serverless-offline
npm install serverless-offline

Se linux ubuntu:
sudo apt install node-typescript

Windows instalamos diretamente com npm.
https://www.typescriptlang.org/download

