# Reconhecer pagamento existente antes de consultar a reserva

Status: publicado e verificado em produção; reconhecimento do225374 confirmado sem avanço de tarefa Zeev.
Base: `504311b8f9f7b90fdf5332da644ee53eb0d2698e`, branch `fix/idpgto-vinculo-obrigatorio`.

## Problema e comportamento

Uma operação já concluída no RM podia continuar bloqueada por uma reserva antiga
`CREATING` sem `pg`, por divergência de digest ou pela ausência de `IDLAN` no
`TMOVPAGTO`. A solicitação de 225374 exemplifica os dois últimos caminhos: Zeev
contém os IDs 45178/69912 e a cadeia nativa está completa, mas o DataServer do
movimento omite IDLAN nas parcelas. O estado CREATING foi observado em artefato
histórico, não relido da AWS nesta alteração.

Antes de consultar a reserva, a Lambda consulta `RAIZ.PG.RETRY` pelo ticket e
coligada. Quando encontra uma única cadeia compatível e o vínculo bancário já
persistido, retorna o contrato normal HTTP 200 com os IDs existentes e
`integracaoBancaria=ja_gravada`. Não chama o criador, SaveRecord ou métodos do
repositório Dynamo nesse caminho. A reserva histórica permanece intacta; um novo
pedido relê o RM e reconhece novamente a operação. O evento
`existing_payment_confirmed_readonly` registra ticket, coligada e IDs, sem dados
bancários.

O comportamento permite que a integração do Zeev receba sucesso. Não aprova a
análise fiscal nem conclui tarefas por conta própria.

## Conferências e limites

- A cadeia deve pertencer ao mesmo ticket, coligada, filial, fornecedor e tipo.
  Compara número, série explícita, emissão explícita, valor bruto, centro de custo,
  natureza fiscal explícita, itens manuais e tributos explicitamente informados.
- Usa o censo e `FLAN.IDMOV` para obter os lançamentos quando TMOVPAGTO omite IDLAN.
  Confere todas as parcelas, vencimentos, valores nativos e campos de pagamento
  esperados. Retenções seguem a associação por vencimento já usada pela integração;
  quando o líquido difere do bruto, destinos bancários distintos no mesmo grupo
  continuam ambíguos e são rejeitados.
- Datas de entrada/processamento não são identidade da nota e não são regravadas.
  No 225374, entrada RM é 25/10/2026 e o formulário informa 27/10/2026. O aceite
  reconhece o movimento existente; não resolve essa diferença cadastral.
- Lançamentos cancelados, cadeia múltipla/incompleta ou divergência de identidade
  não recebem sucesso. Banco ainda incompleto segue o protocolo anterior de
  continuação, com recibo/selo/CAS quando aplicáveis; não cria outro movimento.
  Histórico inconsistente pode continuar pendente até reparo específico.
- Baixa/remessa posterior não impede reconhecer uma operação já completa. Esse
  reconhecimento não modifica o lançamento, seus valores, cadastro ou pagamento.
- Nenhum movimento de outro ticket é adotado por coincidência de número de nota.
  DOC2 e RECON continuam fora do caminho de submissão; duplicidade documental
  continua sendo decisão do RM.
- Para novas operações, a consulta do ticket ocorre no início e novamente antes
  do checkpoint de criação. Falha em qualquer leitura bloqueia o envio. Se uma
  cadeia aparecer na segunda leitura, o pedido fica pendente sem SaveRecord; o
  próximo pedido poderá reconhecê-la. Essas leituras não são um bloqueio atômico
  contra escritores externos no RM. Zero observado, isoladamente, não prova que
  uma chamada antiga em trânsito não irá concluir.
- A consulta oficial passa a ser dependência de disponibilidade e consome tempo
  do orçamento da Lambda. O controle de prazo já existente continua valendo.

## Validação

`npm run verify:pagamento`: 226/226 testes, TypeScript e build aprovados.
Não existe script de lint no projeto. `git diff --check` aprovado.

Os 13 testes adicionais cobrem o caso 225374, replay sem escrita, IDs vazios,
cadeias incompatíveis, retenções, múltiplas parcelas, banco incompleto, efeito
observado após timeout, consulta indisponível antes do envio e continuação própria
com recibo. Os testes anteriores de política de duplicidade foram atualizados
para exigir a consulta por ticket, mantendo a proibição de DOC2/RECON e os testes
de exclusão mútua, ownership, fiscal e segurança bancária.

Em 05/11/2026 01:07:14 UTC (04/11 22:07:14 BRT), foram lidos o formulário atual
do Zeev, `RAIZ.PG.RETRY`, `MovMovimentoTBCData` e `FinLanDataBR`. O payload foi
reconstruído com o template do repositório; o placeholder de DataSource foi
omitido. O código local executou duas vezes com criação, SaveRecord e Dynamo
substituídos por funções que recusam qualquer acesso. Ambas retornaram:

```json
{"PG":"45178","LF":"69912","idLans":["69912"],"integracaoBancaria":"ja_gravada"}
```

Contadores: duas consultas, quatro leituras, zero criação, zero SaveRecord e zero
acesso ao repositório. O ticket continua em T07 - Realizar Análise fiscal.
Evidência sanitizada: Desktop/Analise-62-Tickets-Zeev-TOTVS-20261104/
225374-validacao-reuso.json. XML e dados bancários não foram adicionados ao Git.

Essa etapa confirmou o código local com dados reais. A publicação e a execução
controlada da função de produção foram autorizadas e concluídas em seguida,
conforme a evidência abaixo. O avanço da tarefa pelo Zeev permanece com o usuário.

## Publicação e verificação em produção

- Run41947569458, commit67c1a9b79b15760e0b3f4aeee6f8c6ea2da404c5: publicação em
  05/11/2026 01:19:08UTC (04/11 22:19BRT), após226 testes, typecheck, build e três
  testes de integridade da publicação. O preparo Linux reproduziu o hash exato
  do bundle anterior e alterou somente o entrypoint de pagamento.
- Função: `lambda-raiz-prod-solicitacaoDePagamento`, região `sa-east-1`.
  CodeSha256: `YL4vIKotm0GuMQC1sMC8ellzldxJgi7tu9rT9m8EO2Q=`.
  RevisionId: `1e5b7eb2-1e94-4706-981c-466734da49d7`.
  Núcleo legado, demais entradas e configurações preservados.
- Leitura independente confirmou todos os hashes. Nova conferência após305s
  manteve o mesmo pacote e registrou zero LambdaErrors. Essa métrica não mede
  todos os erros de negócio tratados.
- Run41947819299: formulário atual do225374 reconstruído pelo template, cadeia
  completa relida, validação local com toda escrita bloqueada e uma única
  invocação da função publicada em05/11 01:25:10UTC. Resposta200:
  PG45178/LF69912, `integracaoBancaria=ja_gravada`.
- Releituras concluídas às01:25:21UTC confirmaram censo/MOV/FLAN integralmente
  iguais, raízes Dynamo iguais e formulário/tarefa Zeev iguais. Nenhum novo
  lançamento, SaveRecord, aprovação de tarefa ou alteração bancária ocorreu.
- Os dois workflows pontuais foram arquivados depois da confirmação para evitar
  republicação ou repetição automática do teste. Evidências sanitizadas no Desktop,
  pasta `Analise-62-Tickets-Zeev-TOTVS-20261104/publicacao-reuso`.
