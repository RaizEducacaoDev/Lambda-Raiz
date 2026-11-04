# Remoção do bloqueio permanente de criação sem confirmação

Autorização em 04/11/2026: remover a regra que mantinha o ticket bloqueado por uma tentativa anterior em `CREATING`.

Em um novo envio com a mesma intenção, uma reserva `CREATING` expirada e sem `pg` retorna a `RESERVED`. O snapshot anterior é arquivado e a troca de dono usa atualização condicional. A nova execução faz as consultas e validações nativas existentes; um movimento localizado é reaproveitado. Nenhum ticket é reprocessado pelo deploy.

O bloqueio permanente e a mensagem que exigia conferência manual foram removidos. Reserva ainda em execução, mudança de intenção, documento duplicado encontrado, identidade bancária e confirmação dos lançamentos mantêm seus comportamentos. Não há repetição automática dentro da mesma execução.

Impacto aceito: uma nova solicitação pode enviar outro `SaveRecord` após resultado incerto, caso as consultas não localizem o efeito da tentativa anterior. A ausência de resultado nessas consultas não garante rollback do RM.

Validação: 184 testes Node, typecheck e build aprovados; 5 testes do empacotamento; revisão independente com 93 testes. Testes cobrem retry, lease ativo, concorrência, histórico, intenção divergente, reaproveitamento do movimento e replay concluído.

Publicação: workflow `remove-uncertain-creation-release.yml`, somente os módulos compilados `pagamentoV2Idempotencia` e `solicitacaoDePagamentoSeguro`, com comparação byte a byte da base ativa, proteção por revisão AWS, preservação dos demais arquivos/configuração, canário sem identidade financeira e releitura independente. Evidência de publicação/monitoramento é produzida pelo workflow. O script mantém o pacote anterior para rollback condicionado à versão candidata, sem apagar reservas.

Publicação confirmada em 04/11/2026 às 17:37:55 (Brasília), execução https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41908274896. CodeSha256 ativo: `ECffjgl6BpvRQrtHh3+O++D7/SAvTGAe8r9XTJqJIKE=`, revisão `29524d8b-327d-4389-a7ed-cab0b04aae2e`. Código implementado e publicado pelo Codex mediante a autorização acima. Evidências locais: `Desktop/Lambda-Remocao-Bloqueio-Criacao-20261104`.
