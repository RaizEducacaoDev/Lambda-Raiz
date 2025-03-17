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
npm install

# Ambiente de desenvolvimento
npm run dev
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
sls deploy --stage production
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
2. Build: `npm run build`
3. Deploy: `sls deploy --stage prod`

⚠️ **Important:** Never commit sensitive credentials to version control!