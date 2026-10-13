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

## Revisão de 13/10/2026

- Cadastro bancário ativo/forma N agora é validado antes de criar a reserva.
  Uma rejeição sem efeito no RM não bloqueia a correção dos dados no mesmo ticket.
- Repetição de operação já concluída consulta o estado durável e retorna o PG
  confirmado mesmo se o cadastro bancário foi desativado depois da conclusão.
- `CODCOLCFO` explícito, no topo ou na parcela, deve coincidir com a chave
  bancária selecionada. Divergência retorna 422 antes de reservar.
- `npm run verify:pagamento` passou com 22 testes, typecheck e bundle Node 22.
- O hash ativo da Lambda ainda coincide com o backup anterior; a V2 segue sem
  implantação. Na conta AWS atual, `dynamodb:ListTables` foi negado, portanto a
  existência da tabela e o acesso efetivo da função ainda não foram validados.
- Exportados para evidência privada a automação completa e o BPMN da versão 4
  publicada em 13/10. A tarefa `Activity_1rwfdkq` recebe três caminhos; a outra
  tarefa TS03 de pagamento no desenho não tem entrada. A integração 1209 é
  compartilhada também com prestação de contas; a 1639 continua sem dependência
  e com flag N. O roteamento PG/CC segue pendente.
- Gerado ZIP candidato isolado da função, com handler Node 22/CommonJS e source
  map. Importação e resposta 503 com flag de servidor N foram verificadas
  offline; o pacote ainda não foi publicado na AWS.
- Na integração dedicada 1639, cache da consulta foi desativado e a alteração
  foi conferida após recarregar a página. Ela segue sem dependências e com a
  flag N. A configuração da integração original 1209 não foi alterada.
- A integração original 1209 exibe cache de `999.999` horas. A
  [documentação do Zeev](https://kb.stoque.com.br/zeev/integracoes/como-criar-integracoes/como-utilizar-o-cache-em-integracoes)
  explica que um retorno em cache pode dispensar nova chamada externa, mas não
  esclarece o efeito específico nessa tarefa POST. Não atribuir a falha ao cache
  sem evidência de execução; tampouco alterar a integração compartilhada sem
  proteger as tentativas financeiras de repetição.

## Revisão complementar — origem da permissão DynamoDB

Após confirmar no console que a execution role é compartilhada, foi adicionada
condição `ArnEquals/lambda:SourceFunctionArn` à política de acesso à tabela.
A revisão independente aprovou o delta sem bloqueios: ARN sem qualificador,
mesma região/conta/stage e apenas GetItem/PutItem/UpdateItem na tabela específica.
YAML e diff verificados. Simulação IAM e teste em ambiente real continuam
pendentes antes do provisionamento; nenhuma política foi aplicada na AWS.

## Retomada de 13/10 — contrato da integração e bloqueio AWS

- A integração dedicada Zeev 1639, ainda sem dependências, envia `idPagamento`
  numérico, `CODCOLPGTO={Form.codigoDaColigada2}` e `CODCOLCFO=0`. Sua flag
  `integracaoBancariaV2` permanece `N`; a tarefa TS03 publicada ainda usa a
  integração compartilhada 1209.
- O contrato numérico acima foi exercitado de ponta a ponta na suíte local com
  RM e DynamoDB emulados: criação, atualização e confirmação retornaram sucesso.
  `npm run verify:pagamento` passou com 23 testes, typecheck e bundle Node 22.
- No console AWS da conta de produção, `cloudformation:ValidateTemplate` e
  `cloudformation:CreateUploadBucket` foram negados ao usuário atual. O editor
  do CloudFormation aceitou a sintaxe, mas não houve validação de serviço,
  upload do template, criação de stack/tabela ou anexação de política IAM.
- A sessão de navegador usada para tentar o console DynamoDB pediu login IAM;
  sua existência e o acesso efetivo da Lambda continuam sem confirmação.
