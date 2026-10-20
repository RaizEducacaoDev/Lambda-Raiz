# Contas de consumo — implantação, reconciliação e rollback

Estado: código publicado apenas na função de pagamento, com V2 desligada;
**NO-GO de ativação** até concluir dependências abaixo.
Este documento público não contém tickets, dados bancários nem configuração privada.

## Baseline e escopo

O handler legado e a alteração de `classRm` foram recuperados do sourcemap do
pacote AWS preservado em backup privado. A versão AWS possuía correções ausentes
no Git: PIX QR, vencimentos, internet e recuperação por ticket. O módulo
`solicitacaoDePagamentoLegado.ts` conserva essa lógica; o teste de hash compara
seu conteúdo à fonte recuperada, descontando apenas pontos explícitos de injeção
usados pela V2. Axios 1.8.3, XML2JS 0.6.2 e parser 5.7.3 foram preservados para
não promover atualizações transversais de dependências nesta correção.

O hash do ZIP identifica o artefato preservado; sozinho não prova quando, por
quem ou por qual pipeline foi publicado. Em 19/10, o hash ativo foi relido e
coincidiu com o backup anterior antes de publicar o novo código apenas na
função `lambda-raiz-prod-solicitacaoDePagamento`. O hash após upload coincidiu
com o ZIP novo; o gate de servidor permanece desligado. Não tratar `main` nem
um commit histórico como rollback equivalente à AWS.

## Contrato e ativação

A V2 exige simultaneamente `tipoDaSolicitacao=PG`, `atividadeAtual=TS03`,
`tipoDoPagamento=CC` (ou Conta/Contas de consumo) e `integracaoBancariaV2=S`.
Os aliases aceitos são canonicalizados para CC **dentro** da V2. Outros tipos,
tarefas ou flag ausente mantêm o handler AWS legado.

Mesmo com o gate do payload, o servidor exige `PAGAMENTO_V2_ENABLED=S` e
`PAGAMENTO_V2_TABLE` configurada. Ausência retorna HTTP 503 sem gravar no RM.
Referências de `numeroDaNF` acima de 9 dígitos exigem ainda a flag de servidor
`PAGAMENTO_V2_NUMEROMOV_COMPLETO_ENABLED=S`, o ticket exato em
`PAGAMENTO_V2_NUMEROMOV_TICKET` e o campo de payload
`numeroMovimentoCompletoCC=S`. Os defaults são N e ticket vazio; sem as três
condições, a V2 retorna 422 antes de qualquer efeito no RM. Não ativar até homologar tipo de movimento,
efeitos fiscais e conciliação por referência completa.
Os defaults de Serverless são N e vazio. GitHub Actions obtém os valores de
`PAGAMENTO_V2_ENABLED_PROD`, `PAGAMENTO_V2_TABLE_PROD` e correspondentes `_DEV`
nos passos de deploy de cada stage. Estas variáveis ainda não foram configuradas;
a configuração de ativação deve persistir nessa fonte antes de uma publicação.

O payload precisa de ticket estável, fornecedor, coligada, filial e tipo de conta.
`idPagamento` pode conter a chave composta `CODCOLPGTO$_$CODCOLCFO$_$CODCFO$_$IDPGTO`
ou ID numérico. Para numérico, enviar explicitamente `CODCOLPGTO`, `CODCOLCFO` e
`codigoDoFornecedor`. O ID deve ser positivo; aliases concorrentes precisam
coincidir. Não escolher um ID só porque a forma é N: pode haver vários cadastros.
Ler o registro exato e exigir titularidade, ativo 1 e forma N.

Exigir linha de arrecadação com 48 dígitos e quatro DVs de bloco mais DV geral.
44/47 dígitos não são aceitos na V2. A regra segue a [FEBRABAN versão 8,
seções 07–10](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%208%20-%2011_05_2026.pdf).
Parcela única; todos os aliases bancários no topo e na parcela devem coincidir
antes de reservar o ticket. A criação recebe apenas o código validado.

## Dependência durável nova, provisionamento não confirmado

`infra/pagamento-v2.yml` prepara DynamoDB em região única com chave `pk`,
escritas condicionais, criptografia, PITR e retenção. Não há TTL nem DeleteItem.
O template é separado do deploy e não foi executado nesta entrega. A conta IAM
atual não possui `dynamodb:DescribeTable` nem `dynamodb:ListTables`; portanto
a existência da tabela é desconhecida. Validar a role da função,
provisionar a tabela do stage e conceder somente GetItem/PutItem/UpdateItem nela.
Não habilitar Global Tables: o protocolo assume escrita numa única região.

A política preparada restringe a origem por `lambda:SourceFunctionArn` ao ARN
sem alias/versão de `solicitacaoDePagamento` no stage. Isso é necessário porque
a role atual é compartilhada pelo serviço: anexar acesso à tabela sem essa
condição concederia o mesmo acesso às demais funções. A condição segue a
[documentação AWS](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html).
Antes de provisionar, simular permissão para a função correta e negação para
outra função/ausência da chave. Essa simulação não substitui teste real de IAM.

Chave lógica: stage + PG + coligada + ticket. O digest inclui a intenção inteira
canonicalizada; IDMOV devolvido posteriormente não muda o digest. Payload
financeiro alterado no mesmo ticket exige reconciliação; não apagar a reserva
para contornar conflito. Tabela indisponível, erro de escrita, leitura ambígua ou
lock concorrente bloqueiam efeitos externos.

Estados:

| Estado | Repetição permitida |
|---|---|
| RESERVED | Após lock: validar novamente, consultar ticket, criar somente se consulta válida vazia |
| CREATING | Nunca criar automaticamente; resultado incerto exige reconciliação |
| CREATED | Após lock: usar IDMOV persistido, validar titularidade e concluir financeiro |
| UPDATING | Após lock: apenas reler e confirmar; nunca repetir escrita incerta |
| COMPLETE | Retornar sucesso armazenado para mesma intenção/IDMOV |

O lock dura o prazo restante da execução mais margem de 60 segundos. Mudanças de
estado verificam owner, estado anterior, digest e prazo. O estado CREATING é
persistido antes de SaveRecord; CREATED é persistido assim que o RM devolve a
chave. Se perder a resposta ou o checkpoint, a reserva permanece incerta.
Isto bloqueia duplicação; não é transação distribuída ou promessa de recuperação
automática de todos os timeouts. UPDATING pode concluir por leitura se os valores
já persistiram, mas divergência exige decisão operacional.

A consulta existente `TICKET.RAIZ.0059` é usada antes de criar para localizar
tickets anteriores à tabela. HTTP inválido, erro, resposta não-array ou múltiplos
resultados bloqueiam criação. O filtro é coligada/ticket/CODTMV; não mudar a
categoria histórica do ticket durante reprocessamento. Interromper execuções
legadas em curso durante o corte para evitar criação fora da reserva. A consulta
não oferece transação com SaveRecord. A recuperação automática do estado
CREATING ainda não foi implementada, mesmo com consulta disponível.

Validar TMOV, TMOVCOMPL/TICKET, fornecedor/coligada/filial/CODTMV, parcela única e
FLAN/IDMOV. Só STATUSLAN=0 pode ser processado; baixado/cancelado/desconhecido é
bloqueado. Não sobrescrever campos bancários divergentes. Gravar por FinLanDataBR
e reler todos os campos antes de COMPLETE. Não há UPDATE SQL.

## Prazo e resposta Zeev

Todas as chamadas V2 — SOAP, consulta de ticket e estoque — usam orçamento da
Lambda, timeout e AbortSignal. Antes de novo efeito há margem explícita. Abort
local não prova cancelamento no RM: a reserva incerta é preservada.

Somente HTTP 200 com `integracaoBancaria=gravada` ou `ja_gravada` autoriza avanço.
Entrada inválida retorna 422; conflito, 409; indisponibilidade/prazo, 503.
Todos retornam `integracaoBancaria=pendente`, com PG quando conhecido. O Zeev deve
manter TS03 pendente em qualquer outra combinação. O contrato Zeev precisa ser
configurado e verificado antes de ativar. Não abrir novo ticket para repetir.

## Verificação e publicação

1. Preservar ZIP/configuração atuais em armazenamento privado; reconfirmar hash
   ativo e comparar contra baseline antes de publicar.
2. Validar infraestrutura nova e acesso com flag de servidor desligada.
3. Executar `npm ci --legacy-peer-deps` e `npm run verify:pagamento`.
4. Revisar PR, validar o contrato Zeev e definir canário único novo; nenhum teste
   unitário cria dados no RM. Fixtures são envelopes reais sanitizados.
5. Publicar com ambas flags desligadas, reconfirmar artefato e testar os fluxos
   legados em ambiente controlado. O pipeline tradicional publica a stack;
   não mergear o PR draft nem acionar esse pipeline até validar implantação
   restrita à função ou reconciliar a baseline do serviço inteiro. Apenas esta
   função teve o snapshot AWS reconstituído; outras funções podem depender de
   versões diferentes das bibliotecas compartilhadas.
6. Configurar gate exato, campos e bloqueio de TS03, e só então liberar canário.
7. Conferir ausência de duplicação, IDPGTO, código de 44 dígitos, IPTE de 48 e
   associação correta no RM antes de ampliação.

Testes locais e a invocação de gate desligado não substituem DynamoDB real, IAM,
rede, latência de produção,
contrato SaveRecord real e confirmação de avanço TS03. O typecheck é restrito à
árvore de pagamento: o repositório contém erros TypeScript prévios em módulos
não relacionados. O ZIP da função foi publicado em 19/10, com hash pós-upload
confirmado; não houve teste canário nem gravação da solicitação 221169 no RM.

Após a publicação inicial, entrou um ZIP restrito ao canário 221169, hash
`/k5fZftfaXGkIn6DIBPrvrWi7eBRO/uTV3EmR5Ws+cg=`. Ele valida FDADOSPGTO,
usa o número completo da conta e confirma o FLAN antes de retornar sucesso.
Uma invocação sintética sem IDPGTO retornou erro antes de acessar o RM. Isso
não comprova o resultado do lançamento real. O ZIP anterior, hash
`ofqFJgmd43lv8DMejsbld0+S1IfcBX4Wvsv2ZJ1q2k0=`, está preservado como
rollback imediato da correção canário; o backup original de 07/10 também está
preservado. Antes de restaurar, reconciliar qualquer movimento já criado para
221169 por coligada, ticket e IDMOV. A consulta de ticket do canário não é uma
reserva durável contra invocações concorrentes.

## Rollback seguro

1. Pausar novas execuções TS03/CC. **Não remover somente a flag Zeev de tickets
   V2 pendentes:** isso os enviaria ao legado, que ignora as reservas duráveis.
2. Desabilitar a flag de servidor mantendo o gate V2 nos tickets pendentes;
   esses tickets devem retornar 503 até reconciliação.
3. Preservar tabela, estados, snapshots e correlação de tickets. Não apagar itens
   nem reduzir lock para destravar sem analisar chamadas RM possivelmente ativas.
4. Se rollback de código for necessário, restaurar o ZIP imutável e a configuração
   capturados antes da implantação, após confirmar compatibilidade e mantendo
   suspensos os tickets V2. Não usar revert de main ou commit antigo às cegas.
5. Testar a versão restaurada e só liberar tickets reconciliados. Alterações no
   RM não são desfeitas pelo rollback de código.

A reversão de mapeamentos Zeev e eventual correção individual de dados exige
seguir o registro privado anterior e confirmação de titularidade. Não fazer
limpeza em massa ou nova criação para compensar uma escrita incerta.
