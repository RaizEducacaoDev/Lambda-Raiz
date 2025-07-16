# Lambda Raiz - Integração Corporativa

Template Serverless para integrações empresariais com GLPI, Google Sheets e Zeev CRM

## Visão Geral
Solução serverless para automação de:
- Gestão de chamados via GLPI
- Atualização de planilhas Google Sheets
- Integração com CRM Zeev

## Pré-requisitos
- Node.js 18+
- Serverless Framework
- Contas ativas nos serviços integrados

## Features
- 🚀 Serverless Framework deployment
- 🔐 Environment configuration management
- 🔄 Integration with GLPI API
- 📊 Google Sheets API integration
- ⚡ AWS Lambda optimized packaging

## Instalação
```bash
# Clonar repositório
git clone https://github.com/sua-organizacao/lambda-raiz.git

# Instalar dependências
npm install --legacy-peer-deps

# Ambiente de desenvolvimento
npm run dev

# Debug com logs detalhados
npm run debug
```

## Configuração de Ambiente
Crie um arquivo `.env` na raiz do projeto com:

```ini
# AWS
AWS_ACCESS_KEY_ID=SUA_CHAVE_AWS
AWS_SECRET_ACCESS_KEY=SUA_SECRET_AWS

# GLPI
GLPI_API_URL=https://sua-instancia-glpi
GLPI_API_TOKEN=seu_token_aqui

# Google
GOOGLE_CREDENTIALS=base64_service_account_json

# Zeev CRM
ZEEV_API_ENDPOINT=https://api.zeev.com
ZEEV_API_KEY=sua_chave_api
```

⚠️ **Dados Sensíveis:** Nunca comitar arquivos .env no versionamento!

## Deployment
```bash
# Deploy para desenvolvimento
npm run deploy

# Deploy para produção
npm run deploy:prod
```

## Documentação das Integrações

### GLPI (`src/utils/classGlpi.ts`)
- Métodos disponíveis:
  - `criarChamado()`: Abre novo ticket no GLPI
  - `atualizarChamado()`: Atualiza status de chamados

### Google Sheets (`src/utils/classGoogle.ts`)
- Funcionalidades:
  - `lerPlanilha()`: Obtém dados da planilha
  - `atualizarPlanilha()`: Escreve novos registros

### Zeev CRM (`src/utils/classZeev.ts`)
- Integrações:
  - `sincronizarClientes()`: Atualiza base de clientes
  - `registrarVenda()`: Log de transações comerciais

## Fluxo de Deploy
1. Testes locais: `npm run dev`
2. Debug com logs: `npm run debug`
3. Deploy desenvolvimento: `npm run deploy`
4. Deploy produção: `npm run deploy:prod`

⚠️ **Important:** Never commit sensitive credentials to version control!