# Contrato preparado para TS03 de contas de consumo

Estado: especificação baseada no design e nos logs reais; ainda não aplicada
ao Zeev. Manter ativação desligada até validar interface, infraestrutura e canário.

## Isolamento do ramo

O campo de formulário `atividadeAtual` conserva a etapa humana anterior nas
execuções observadas. Ele não comprova que a tarefa em execução é TS03.
A integração existente também atende prestação de contas e outros pagamentos.
Não substituir globalmente esse campo por TS03 nem enviar a flag S globalmente.

Preparar uma integração dedicada, derivada da configuração atual, utilizada
somente pelas tarefas de gravação de pagamento no ramo PG + CC autorizado.
Nesse ramo, enviar `atividadeAtual=TS03` de forma explícita e
`integracaoBancariaV2=S` somente durante o canário liberado. Demais rotas
continuam na integração original. Conferir todos os pontos de uso antes de
alterar o desenho; há mais de uma tarefa TS03 de pagamento no processo.

## Mapeamentos de entrada

| Campo | Origem/regra |
|---|---|
| `ticketRaiz` | Mesmo número estável da solicitação em todas as tentativas |
| `tipoDaSolicitacao` | PG no ramo dedicado |
| `tipoDoPagamento` | CC no ramo dedicado |
| `atividadeAtual` | TS03, determinado pela tarefa de serviço |
| `integracaoBancariaV2` | S somente após liberação; preservar em pendências V2 |
| `idPagamento` | Chave do dado bancário efetivamente selecionado |
| `idpgto` e aliases | Ausentes ou coerentes com o mesmo dado selecionado |
| `CODCOLPGTO` | Coligada do dado de pagamento; igual à coligada do movimento |
| `CODCOLCFO` | Coligada do fornecedor confirmada; a criação atual suporta 0 |
| `codigoDoFornecedor` | Fornecedor da chave bancária e do movimento |
| `codigoDeBarrasBoleto` | Linha de arrecadação válida com 48 dígitos |
| `codigoDaColigada2`, `codigoDaFilial2` | Coligada/filial de destino do movimento |
| `idDoMovimento`, `movimentoExistente` | Preservar o ID já retornado; ambos devem coincidir quando presentes |

Preferir chave composta `CODCOLPGTO$_$CODCOLCFO$_$CODCFO$_$IDPGTO` quando a
seleção disponibilizar todos os componentes. Se enviar ID numérico, os outros
componentes são obrigatórios no payload. Confirmar o retorno real da integração
de cadastro e a gravação do campo no formulário: renomear o identificador da
resposta, sozinho, não prova que o campo foi preenchido.

O registro selecionado deve estar ativo e ter forma N. Não reaproveitar o
ID de boleto I nem escolher automaticamente um registro N quando existem
vários. Ao trocar fornecedor/coligada/forma, invalidar a seleção anterior e
exigir uma nova seleção válida no ramo de consumo.

A V2 aceita parcela única. Omitir `listaDeParcelas`/enviar lista vazia quando
o fluxo utiliza apenas vencimento e valor do topo. Se enviar uma parcela,
ela deve ter valor e vencimento preenchidos. A linha histórica com vencimento
vazio não atende esse contrato. Aliases na parcela também devem coincidir.

## Resultado e avanço

O corpo HTTP retornado pela API contém `PG`, `integracaoBancaria` e, em falha,
`avisoIntegracaoBancaria`. Validar no editor Zeev se o corpo é exposto diretamente
ou envolvido por outro envelope antes de configurar os JSONPaths.

| Resultado HTTP e corpo | Comportamento da tarefa |
|---|---|
| 200 + `gravada` ou `ja_gravada` + PG válido | Persistir PG e avançar |
| 422/409/503, timeout ou resposta sem status final | Manter pendente e exibir motivo |
| 200 apenas com PG ou conteúdo inválido | Manter pendente |

Não converter erro em sucesso e não avançar apenas porque o movimento existe.
Preservar o mesmo ticket/IDMOV nas tentativas; não criar outra solicitação para
repetir. Reservas CREATING/UPDATING incertas exigem reconciliação conforme o
[roteiro de implantação e rollback](rollback-solicitacao-pagamento-contas-consumo.md).

## Validações pendentes na interface

1. Backup da integração original, scripts e configuração das tarefas.
2. Campo selecionado e retorno de cadastro associados à chave N correta.
3. Payload dedicado com os mapeamentos acima e parcela coerente.
4. Respostas finais e de erro mapeadas, com TS03 bloqueada em falha.
5. Canário único autorizado e conferência posterior no RM.

Não executar “Salvar e testar” nas integrações de produção durante a preparação.
