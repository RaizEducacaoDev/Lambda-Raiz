# Lambda-Raiz

Sistema serverless AWS Lambda para integrações empresariais da Raiz Educação.

## 🚀 Visão Geral

O **Lambda-Raiz** é um hub de integrações corporativas que conecta diversos sistemas empresariais através de funções AWS Lambda. Desenvolvido em TypeScript, oferece APIs padronizadas para automação de processos de negócio.

### Integrações Disponíveis:
- **🎫 GLPI**: Gestão de chamados de TI
- **📊 Google APIs**: Integração com planilhas e Drive
- **💼 RM/TOTVS**: Sistema ERP corporativo
- **🔄 Zeev**: Plataforma de workflows

## 📁 Estrutura do Projeto

```
Lambda-Raiz/
├── src/
│   ├── functions/          # Funções Lambda organizadas por integração
│   │   ├── glpi/           # Integrações com GLPI
│   │   │   └── post/       # Endpoints POST para criação de chamados
│   │   ├── google/         # Integrações com Google APIs
│   │   │   └── get/        # Endpoints GET para tokens e arquivos
│   │   ├── rm/             # Integrações com RM/TOTVS
│   │   │   ├── get/        # Consultas SQL e relatórios
│   │   │   └── post/       # Operações de criação/atualização
│   │   └── others/         # Outras integrações
│   └── utils/              # Classes e utilitários compartilhados
├── package.json            # Dependências e scripts
├── serverless.yml          # Configuração do Serverless Framework
├── tsconfig.json          # Configuração TypeScript
├── esbuild.config.js      # Configuração do bundler
└── Dockerfile             # Container para deploy
```

## 🛠️ Tecnologias

- **Runtime**: Node.js 22.x
- **Linguagem**: TypeScript
- **Framework**: Serverless Framework
- **Bundler**: ESBuild
- **Arquitetura**: AWS Lambda ARM64
- **Deploy**: AWS CloudFormation

## 📋 Funções Disponíveis

### 🎫 Integrações GLPI

| Função | Endpoint | Descrição |
|--------|----------|-----------|
| `aberturaDeChamados` | POST `/aberturaDeChamados` | Criação de tickets genéricos |
| `chamadoAdmissao` | POST `/chamadoAdmissao` | Tickets para novas contratações |
| `chamadoDesligamento` | POST `/chamadoDesligamento` | Tickets para desligamentos |
| `chamadoMovimentacao` | POST `/chamadoMovimentacao` | Tickets para alterações cadastrais |

### 📊 Integrações Google

| Função | Endpoint | Descrição |
|--------|----------|-----------|
| `tokenGoogle` | GET `/tokenGoogle` | Obtenção de tokens de acesso |
| `buscaCnabDrive` | GET `/buscaCnabDrive` | Busca arquivos CNAB no Drive |

### 💼 Integrações RM/TOTVS

#### Consultas (GET):
| Função | Endpoint | Descrição |
|--------|----------|-----------|
| `consultaTOTVS` | GET `/consultaTOTVS` | Consultas SQL genéricas |
| `consultaAlunosPorGrade` | GET `/consultaAlunosPorGrade` | Relatórios acadêmicos |
| `consultaDePagamento` | GET `/consultaDePagamento` | Consultas financeiras |
| `consultaDeHorarios` | GET `/consultaDeHorarios` | Consultas de horários |

#### Operações (POST):
| Função | Endpoint | Descrição |
|--------|----------|-----------|
| `cancelaCotacao` | POST `/cancelaCotacao` | Cancelamento de cotações |
| `cotacao` | POST `/cotacao` | Criação de cotações |
| `ordemDeCompra` | POST `/ordemDeCompra` | Geração de ordens de compra |
| `solicitacaoDeCompra` | POST `/solicitacaoDeCompra` | Criação de solicitações |
| `solicitacaoDePagamento` | POST `/solicitacaoDePagamento` | Solicitações de pagamento |
| `comunicaFornecedor` | POST `/comunicaFornecedor` | Comunicação com fornecedores |
| `geraQuadroComparativo` | POST `/geraQuadroComparativo` | Geração de relatórios |
| `fileQuadroComparativo` | POST `/fileQuadroComparativo` | Download de arquivos PDF |
| `gravaOrcamento` | POST `/gravaOrcamento` | Gravação de orçamentos |
| `gravaNaturezaOrcamentaria` | POST `/gravaNaturezaOrcamentaria` | Classificação orçamentária |

## ⚙️ Configuração e Instalação

### Pré-requisitos
- **Node.js** 18+ (recomendado 22.x)
- **AWS CLI** configurado
- **Serverless Framework** (opcional global)

### Instalação
```bash
# 1. Clonar o repositório
git clone https://github.com/RaizEducacaoDev/Lambda-Raiz.git
cd Lambda-Raiz

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais
```

### Configuração de Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```ini
# Estágio de deployment
STAGE=dev

# Google Cloud Service Account
GOOGLE_CLIENT_EMAIL=service-account@projeto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_PROJECT_ID=seu-projeto-id

# GLPI - Produção
GLPI_PROD=https://glpi.empresa.com/apirest.php
APPTOKEN_GLPI_PROD=seu_app_token_prod
USERTOKEN_GLPI_PROD=seu_user_token_prod

# GLPI - Desenvolvimento
GLPI_DEV=https://glpi-dev.empresa.com/apirest.php
APPTOKEN_GLPI_DEV=seu_app_token_dev
USERTOKEN_GLPI_DEV=seu_user_token_dev

# RM/TOTVS
RM_PROD=https://servidor-prod.totvs.com.br
RM_DEV=https://servidor-dev.totvs.com.br
USERNAME_TOTVS=usuario_totvs
PASSWORD_TOTVS=senha_totvs

# Zeev CRM
ZEEV_PROD=https://api.zeev.com
TOKEN_ZEEV=seu_token_zeev
```

⚠️ **Dados Sensíveis:** Nunca comitar arquivos .env no versionamento!

## 🧪 Desenvolvimento

### Servidor Local
```bash
# Iniciar serverless offline
npm run dev

# Com logs detalhados
npm run debug
```

O servidor local estará disponível em `http://localhost:3000` com endpoints:
- `http://localhost:3000/dev/aberturaDeChamados`
- `http://localhost:3000/dev/cotacao`
- etc.

### Adicionando Nova Função

1. **Criar arquivo da função**:
```typescript
// src/functions/categoria/metodo/minhaFuncao.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const dados = JSON.parse(event.body || '{}');
        
        // Sua lógica aqui
        
        return formatResponse(200, { 
            message: 'Sucesso', 
            data: dados 
        });
    } catch (error) {
        return formatResponse(500, { 
            error: error.message 
        });
    }
};
```

2. **Registrar no serverless.yml**:
```yaml
functions:
  minhaFuncao:
    handler: src/functions/categoria/metodo/minhaFuncao.handler
    events:
      - http:
          path: /minhaFuncao
          method: post
          cors: true
```

## 🚀 Deploy

### Comandos de Deploy
```bash
# Deploy para desenvolvimento
npm run deploy
# ou
serverless deploy --stage dev

# Deploy para produção
npm run deploy:prod
# ou
serverless deploy --stage prod

# Deploy de função específica
serverless deploy function -f nomeDaFuncao --stage prod
```

### URLs de Produção
Após deploy, as URLs seguem o padrão:
```
https://xxxxxxxxxx.execute-api.sa-east-1.amazonaws.com/dev/nomeDaFuncao
https://xxxxxxxxxx.execute-api.sa-east-1.amazonaws.com/prod/nomeDaFuncao
```

## 🏗️ Classes e Utilitários

### ConfigManagerGlpi (`src/utils/classGlpi.ts`)
Gerenciamento de configurações e autenticação GLPI:
```typescript
class ConfigManagerGlpi {
    getSessionToken(ambiente: string): Promise<string>
    getUserToken(ambiente: string): string
    getAppToken(ambiente: string): string
    buscaIdDoUsuario(email: string, token: string): Promise<number>
}
```

### ConfigManagerRm (`src/utils/classRm.ts`)
Gerenciamento de configurações RM/TOTVS:
```typescript
class ConfigManagerRm {
    getUrl(): string
    getCredentials(): string
    getCotacao(movimentId: string, codColigada: string): Promise<string>
    consultaSQL(codigo: string, sistema: string, params: string): Promise<any>
    getQuadroComparativo(...): Promise<string>
}
```

### ConfigManagerGoogle (`src/utils/classGoogle.ts`)
Gerenciamento de configurações Google APIs:
```typescript
class ConfigManagerGoogle {
    getAccessToken(): Promise<string>
    getRetFileFromFolder(folderId: string, namePart: string): Promise<string>
}
```

### Utilitários Auxiliares

| Arquivo | Descrição |
|---------|-----------|
| `response.ts` | Formatação padronizada de respostas HTTP |
| `date.ts` | Funções de manipulação de datas |
| `function.ts` | Funções auxiliares genéricas |
| `json.ts` | Manipulação de objetos JSON |
| `xml.ts` | Processamento de XML para webservices |
| `wsDataserver.ts` | Cliente para DataServer TOTVS |

## 📖 Exemplos de Uso

### Criação de Chamado GLPI
```bash
curl -X POST https://api.lambda-raiz.com/dev/chamadoAdmissao \
  -H "Content-Type: application/json" \
  -d '{
    "emailDoSolicitante": "usuario@empresa.com",
    "nomeCompletoDoFuncionario": "João Silva",
    "cargoDoFuncionario": "Analista",
    "dataDeAdmissao": "2024-10-15"
  }'
```

### Consulta RM/TOTVS
```bash
curl -X GET "https://api.lambda-raiz.com/dev/consultaTOTVS?cc=CODIGO&cs=S&p=PARAM1%3BPARAM2"
```

### Geração de Cotação
```bash
curl -X POST https://api.lambda-raiz.com/dev/cotacao \
  -H "Content-Type: application/json" \
  -d '{
    "codigoDaColigada": "1",
    "codigoDaFilial": "01",
    "tipoDeSolicitacao": "P",
    "motivoDaSolicitacao": "Compra de equipamentos",
    "itens": [...]
  }'
```

## 🔧 Monitoramento

### Logs
```bash
# Ver logs em tempo real
serverless logs -f nomeDaFuncao --stage prod --tail

# Logs no CloudWatch
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/lambda-raiz"
```

### Métricas Importantes
- **Cold Start Time**: < 3 segundos
- **Execution Duration**: < 30 segundos  
- **Error Rate**: < 1%
- **Memory Usage**: Otimizar baseado em uso real

## 🐛 Solução de Problemas

### Erro de Deploy
```
Error: The CloudFormation template is invalid
```
**Solução**: Verificar sintaxe do `serverless.yml` e permissões AWS

### Timeout de Função
```
Task timed out after 30.00 seconds
```
**Solução**: Aumentar timeout no `serverless.yml`:
```yaml
functions:
  minhaFuncao:
    timeout: 60  # segundos
```

### Erro de Memória
```
Process out of memory
```
**Solução**: Aumentar memória alocada:
```yaml
provider:
  memorySize: 512  # MB
```

## 📚 Recursos Adicionais

### Documentação
- [Serverless Framework](https://www.serverless.com/framework/docs/)
- [AWS Lambda](https://docs.aws.amazon.com/lambda/)
- [TypeScript](https://www.typescriptlang.org/docs/)

### Ferramentas
- **Postman**: Testar APIs
- **AWS CLI**: Gerenciar recursos
- **VS Code**: Editor recomendado

## 📄 Licença

Este projeto é propriedade da **Raiz Educação S.A.** - Todos os direitos reservados.

---

**Última atualização**: 02 de outubro de 2025  
**Versão**: 1.0  
**Mantenedor**: Antonio Silva (antonio.silva@raizeducacao.com.br)