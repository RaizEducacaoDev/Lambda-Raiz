# Revisão da correção de contas de consumo

Resultado em 08/10/2026: sem bloqueios de código abertos para commit/PR de
rascunho. Ativação em produção continua **NO-GO** pelas dependências do runbook.

A revisão independente comparou o legado com o snapshot AWS, examinou a
orquestração V2, parser, validação bancária, estados duráveis, timeout,
infraestrutura, CI e testes. A auditoria complementar verificou o isolamento
dos segredos e a adequação do conteúdo ao repositório público.

## Achados resolvidos

- **Boleto divergente por parcela:** um campo na parcela podia substituir a
  linha validada no topo. Agora aliases são conferidos antes da reserva e o
  criador recebe o código canonicalizado. Caso divergente retorna 422 sem
  reservar nem escrever. Objeto/string no lugar de lista também são rejeitados.
- **Consulta de estoque fora do prazo:** o caminho V2 herdava timeout de 30s do
  legado. Agora injeta consulta com orçamento e cancelamento, preservando o
  comportamento original fora da V2.
- **Segredos em execução de PR:** validação foi separada do deploy. O job de PR
  não recebe os segredos de produção; deploy continua restrito aos pushes.
- **Configuração de ativação perdida no deploy seguinte:** os passos de deploy
  agora consultam variáveis persistentes distintas por stage, com defaults OFF.
- **Teste de retomada após reinício:** o teste reinstancia repositório e cliente
  contra a mesma tabela emulada, comprovando independência do objeto em memória.

## Evidências de verificação

- `npm ci --legacy-peer-deps` concluído em instalação limpa.
- `npm run verify:pagamento`: 22 testes, typecheck da árvore de pagamento e
  bundle com alvo Node.js 22 aprovados localmente em Node.js 24.
- Integração local V2 + criador legado real, com I/O simulado: entrada bancária
  divergente bloqueada antes de efeitos; entrada válida passa pela consulta de
  estoque controlada e produz somente o código validado.
- Verificação offline adicional com dados privados: quatro linhas reais e
  cinco tabelas dos datasets reais aceitas pelo código final. Os dados brutos
  não foram versionados nem escritos em sistemas externos.
- Scan do changeset não identificou credenciais literais nem os identificadores
  financeiros históricos. Fixtures usam valores sintéticos.
- `git diff --check` aprovado.

O CI do PR confirmou a execução em Node.js 22.
Emulação local não confirma IAM, rede ou latência de produção. A integração
Zeev, o provisionamento e o canário seguem pendentes; nenhum deploy ou teste
com gravação financeira foi realizado.

## Revisão complementar — origem da permissão DynamoDB

Após confirmar no console que a execution role é compartilhada, foi adicionada
condição `ArnEquals/lambda:SourceFunctionArn` à política de acesso à tabela.
A revisão independente aprovou o delta sem bloqueios: ARN sem qualificador,
mesma região/conta/stage e apenas GetItem/PutItem/UpdateItem na tabela específica.
YAML e diff verificados. Simulação IAM e teste em ambiente real continuam
pendentes antes do provisionamento; nenhuma política foi aplicada na AWS.
