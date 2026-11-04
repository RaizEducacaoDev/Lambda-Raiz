# Remoção da checagem geográfica da natureza fiscal

Em 04/11/2026, Felipe autorizou expressamente retirar a validação customizada
que comparava a classificação interna/interestadual da natureza com as UFs do
fornecedor e da filial. O caso relatado era fornecedor SP e filial RJ.

A integração passa a encaminhar a seleção fiscal original para o RM, sujeito às
demais validações existentes. Permanecem os controles de identidade da consulta,
existência dos cadastros, natureza ativa, correspondência ID/código, documento,
identidade bancária e idempotência. Nenhuma natureza é substituída automaticamente.

O teste integrado simulado SP/RJ comprova a passagem pela criação com entrada e
digest preservados. A suite completa passou com 160 testes, typecheck e bundle.
Houve revisão independente do runtime, testes e publicação.

A publicação é exclusiva da função `lambda-raiz-prod-solicitacaoDePagamento`,
conta 757843862365, região sa-east-1. O executor exige o hash/revisão ativos
previamente identificados e o módulo fiscal anterior exatamente igual à fonte
revisada. Substitui somente esse módulo no JavaScript ativo; conserva o restante
do bundle, core, demais entradas ZIP e configuração. Uma segunda execução
independente baixa o pacote e verifica todos os hashes. Os artefatos contêm
somente metadados, sem ambiente, credenciais ou ZIPs.

O canário contém apenas tipoDaSolicitacao=PG, sem identidade ou dados financeiros;
deve receber a mesma rejeição antes/depois da mudança. Não se executa um pagamento
nem se altera Zeev, RM ou reservas DynamoDB. A remoção não libera automaticamente
reservas antigas nem comprova que o RM aceitará um documento fiscal específico.

Estado da publicação e links de evidência serão registrados após a releitura.
