# Contrato preparado para TS03 de contas de consumo

Estado em 13/10/2026: integração dedicada 1639 criada com flag N, sem dependências;
roteamento do processo e ativação ainda não aplicados. Manter a flag desligada
até validar interface, infraestrutura e canário.

## Formulário da versão 4 publicada

O script publicado foi salvo em backup privado em 13/10. Na função
`buscarDadosBancarios`, ele descartava todos os cadastros com forma I ou N.
Na função `preencherDadosPagamento`, selecionar Boleto limpava `idPagamento`.
As quatro instâncias CC examinadas (212989, 216412, 216999 e 217891) tinham
`idPagamento` vazio. Essa combinação impede fornecer a chave exigida pelo RM.

O candidato preparado por `node scripts/prepare-zeev-form-v4.cjs <backup.js>
<candidato.js>` altera apenas esses pontos: inclui N ativo para CC quando seu
identificador é válido, mantém I fora da lista, preenche a chave do cadastro
selecionado e limpa a chave antiga ao trocar fornecedor, coligada ou tipo.
Quando existem vários N ativos, a lista exige escolha explícita. O candidato
privado passou na verificação de sintaxe e nos cenários locais de N único,
múltiplos N, N sem ID, I e troca de fornecedor. Ainda não foi publicado.

A automação `08 - Nova transferencia Bancaria` da versão 4 exibe
`contasCadastradas` apenas para Transferência Bancária e a oculta nos demais
casos. Sua condição precisa contemplar também `formaDePagamento=Boleto` **e**
`tipoDoPagamento=CC`, mantendo a exibição nos casos existentes de transferência.
Sem isso, um fornecedor com vários cadastros N não consegue escolher o registro.
Conferir o resultado no formulário real antes de publicar.

A integração de leitura 1529 (`Totvs : Dados bancarios de fornecedor V2`) mapeia
`idPagamento` de `$.data.id`. O teste sem parâmetros retorna `data: null` e não
comprova o valor de um registro N. Validar uma resposta real de leitura, sem
gravação, para confirmar que ela fornece um ID numérico ou a chave composta
coerente com coligada e fornecedor. Caso o campo venha vazio, corrigir o
JSONPath antes de associar a integração de gravação dedicada.

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

Na versão 4 publicada, a integração 1209 também atende a tarefa de prestação de
contas e versões anteriores/posteriores do aplicativo. O BPMN exportado em
13/10 mostra a tarefa de pagamento `Activity_1rwfdkq` com três entradas de
aprovação; `Activity_0srdonk` tem saída, mas nenhuma entrada no desenho
exportado. Confirmar o caminho efetivo antes de configurar ambas. Backup
privado da automação completa e do BPMN foi preservado nessa data.

No BPMN publicado, as três entradas da `Activity_1rwfdkq` vêm de
`Gateway_173xdj8` (fiscal aprovado), `Gateway_14yz7sb` (pular análise fiscal)
e `Gateway_11bw6q3` (adiantamento aprovado). O destino atual é
`Activity_0quuoe6` (Parcelas pagas). O desenho candidato deve reunir essas
entradas e decidir por `tipoDaSolicitacao=PG` **e** `tipoDoPagamento=CC`:
nesse caso usar uma nova tarefa com a integração 1639; nos demais, manter a
tarefa e integração 1209. Ambos os caminhos voltam ao destino atual somente
após resultado final válido. Conferir no editor Zeev as condições e o
comportamento em falha antes de publicar a versão do processo.

A integração 1639, `AWS: Grava pagamento PG/CC TS03 V2 (preparo)`, já envia
`atividadeAtual=TS03`, `CODCOLCFO=0` e `integracaoBancariaV2=N`, sem `idpgto`.
Ela ainda não está associada a tarefas. O cache da integração dedicada foi
desligado em 13/10, para não reutilizar retorno de gravação. Validar o
mapeamento de resposta e o bloqueio de avanço antes de associá-la ao ramo PG + CC.

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

1. Conferir backup atualizado da integração original, scripts e tarefas.
2. Campo selecionado e retorno de cadastro associados à chave N correta.
3. Payload dedicado com os mapeamentos acima e parcela coerente.
4. Respostas finais e de erro mapeadas, com TS03 bloqueada em falha.
5. Canário único autorizado e conferência posterior no RM.

Não executar “Salvar e testar” nas integrações de produção durante a preparação.
