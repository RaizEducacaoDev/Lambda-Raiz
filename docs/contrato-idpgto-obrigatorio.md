# Vínculo bancário obrigatório nos pagamentos

Toda chamada PG da função de solicitação de pagamento usa o protocolo seguro,
independentemente da atividade que disparou a integração ou de flags antigas.
Outras modalidades de solicitação são delegadas ao bundle original de produção,
preservado integralmente no pacote. O deploy é restrito a esta função.

## Contrato

- IDPGTO positivo, coligada bancária igual ao destino, fornecedor e coligada de
  fornecedor coerentes entre todos os aliases/chave composta.
- Cadastro exato ativo confirmado por FinDadosPgtoDataBR antes dos efeitos.
  Dados PIX e modalidade enviados não podem contradizer esse cadastro.
- Para uma nova NF de serviço (1.2.03) com natureza informada, a consulta nativa
  RAIZ.PG.FISC confirma cadastro, natureza ativa e coerência do trajeto brasileiro
  antes da reserva. Uma natureza interna com UFs distintas, ou interestadual com
  UFs iguais, retorna 422 NATUREZA_FISCAL_INCOMPATIVEL sem criar ou reservar.
  Nenhum CFOP é escolhido ou substituído pelo código. Outros países e regras
  fiscais continuam sujeitos à validação nativa do RM.
- O preflight não impede retomar PG durável ou movimento remoto único cujo
  fornecedor, filial e ticket tenham sido confirmados pelo ReadRecord. A lista
  remota completa vem de RAIZ.PG.RECON e exige versão, contagem e identidade de
  todas as linhas antes de filtrar o tipo. A consulta compartilhada TOP 1 não é
  alterada. Cache perdido/divergente nunca autoriza criar outro movimento.
- Reserva DynamoDB por ticket antes de criar. CREATING de resultado incerto
  nunca autoriza nova criação automática. Movimento informado é validado antes
  da primeira reserva; históricos encontrados são conferidos antes de recuperar.
- Checkpoint independente por IDLAN para retomada de múltiplas parcelas.
- Parcelas pareadas por valor e vencimento; líquido de retenções é aceito por
  vencimento somente quando todas as alternativas têm os mesmos dados bancários.
  O valor original do FLAN deve coincidir com a parcela nativa do movimento.
- Gravação exclusiva de campos bancários pelo FinLanDataBR; nenhum valor,
  vencimento, baixa ou pagamento é escrito por este protocolo.
- Um IDPGTO preexistente diferente só pode ser substituído pelo cadastro validado
  na mesma chamada que acabou de criar o movimento, em título aberto, sem baixa,
  sem boleto e sem divergência nos demais campos bancários. Histórico bloqueia.
- Releitura oficial do FLAN obrigatória antes do sucesso, inclusive em replay.
  Sucesso retorna PG, LF quando único, idLans e integracaoBancaria gravada/ja_gravada.
  Falha retorna 422/409/503 e integracaoBancaria pendente, com PG quando conhecido.

## Infraestrutura e operação

Tabela dedicada, sob demanda, criptografada, PITR e sem TTL. A permissão adicional
da role limita GetItem/PutItem/UpdateItem a esta tabela e à SourceFunctionArn
da função de pagamento. Os demais acessos da role são preservados.

A publicação compara hash e RevisionId da baseline, conserva o ambiente existente
e confirma o hash final. O ZIP original permanece disponível para rollback.
Restaurar código não desfaz gravações no RM. Reservas não devem ser apagadas para
destravar uma criação incerta; é necessário reconciliar ticket/movimento primeiro.

## Verificação

`npm run verify:pagamento`: 102 testes, typecheck da árvore de pagamento e bundle.
Teste de importação do ZIP com rede bloqueada e entradas bancárias inválidas.
O pipeline repete as verificações antes da publicação e confirma a execução por
um lançamento de teste existente, seguida de replay sem nova criação.
Persistência deve ser conferida também por leitura independente do RM.

A publicação fiscal exige ReadRecord das duas definições SELECT, hash idêntico
aos arquivos em sql/ e canários somente leitura com as credenciais da própria
função. O script scripts/deploy-pagamento-fiscal.py conserva ambiente, role e
demais entradas do ZIP e relê os checkpoints existentes sem alterá-los. Os
artefatos registram hash, revisão e resultado. Falha na verificação tenta
restaurar somente o pacote que o próprio script acabou de publicar, por revisão.

Em homologação C3U7RQ_160289_RM_DV, o teste sintético 989900310 comprovou:
natureza 121 rejeitada antes de reserva; natureza 166 validada, uma única criação
90769/148482, IDPGTO 2 e CODCOLPGTO 11 persistidos; replay com os mesmos IDs e sem
outra criação. Principal 1, baixa 0, sem ponte de boleto/baixa ou título órfão.
O RM recalculou VALORAUXILIAR para 3 ao salvar o banco; a origem dessa regra
nativa permanece separada e não foi sobrescrita. Esses IDs são de homologação.

As provas locais não equivalem à execução de uma nova solicitação pelo Zeev nem
a testes de remessa, baixa ou pagamento bancário.
