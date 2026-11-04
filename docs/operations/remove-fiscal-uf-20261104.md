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

## Publicação e evidências

- Fonte: `c0509053f8c520eaeff44f51870dab26712cede2`.
- Publicado em 04/11/2026 às 16:25:40 BRT, com configuração preservada.
- SHA256/base64 ativo: `oHgRl53dlYR3Z/98HuB1GRelxAvWFUIKth0WHagkRnc=`.
- Revisão: `00ae2c0f-6801-4c07-8ff3-6b74497b2614`.
- [Publicação, releitura independente e monitoramento](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41896696773).
- [PR de integração da fonte](https://github.com/RaizEducacaoDev/Lambda-Raiz/pull/28).

A releitura independente baixa o ZIP ativo e confirma todos os hashes. O mapa de
fontes antigo é preservado como os demais arquivos; o JavaScript ativo é a fonte
de verificação do comportamento publicado.
