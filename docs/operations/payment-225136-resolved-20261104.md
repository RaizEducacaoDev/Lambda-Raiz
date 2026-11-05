# Ticket 225136 — lançamento criado e verificado

Em 04/11/2026 às 18:37:41 (Brasília), a execução autorizada criou o movimento **45370** e o lançamento **70183**, coligada/filial **1.1**, com valor **R$ 20.000,00** e vencimento **10/11/2026**. A leitura oficial e o censo SQL independente confirmaram um movimento e uma parcela, em aberto, sem baixa, com IDPGTO/CODCOLPGTO **1/1**. O DynamoDB terminou em `COMPLETE`, com PG 45370. Os dois identificadores foram registrados no Zeev por API e relidos sem cache. A tarefa permanece em T07 — Realizar Análise fiscal; nenhuma tarefa de aprovação ou pagamento foi concluída pelo operador.

## Causa comprovada

O retorno do RM era `Movimento 000000018 - Série 1: Natureza inválida.` O diagnóstico completo de 1.586 caracteres teve SHA256 `316c645568f40266d1e85e0ff78977d19df3a0c1843b715a7896f6afa6a6d258`, exatamente igual ao registrado na tentativa das 17:53. A menção a SERIE estava no cabeçalho do diagnóstico; não indicava defeito de série. O RM respondeu à tentativa de diagnóstico em 1.528 ms.

O ticket selecionava **1.949.01 / ID 3**, natureza interna, apesar do fornecedor estar em SP e a filial em RJ. O cadastro oficial confirmou que **2.949.01 / ID 9** está ativa, é interestadual e tem a mesma descrição `Prestação de Serviço  - S/ Retenção`. Os movimentos anteriores do mesmo fornecedor, unidade e TMV — **43847, 44537 e 44651**, NFs 15, 16 e 17 — usam IDNAT 9.

Foram corrigidos somente os três campos de natureza do ticket (`naturezaFiscal`, `codigoDaNaturezaFiscal`, `idDaNaturezaFiscal`). A nota 18, os valores, as datas e a seleção bancária foram preservados. Nenhum parâmetro fiscal do RM foi alterado. O RM aplicou sua série principal 1 e aceitou a criação.

## Execução e evidências

- [Diagnóstico protegido — run 41917095471](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41917095471): uma chamada nativa, rejeição fiscal, zero movimentos/parcelas após a tentativa. O retorno completo foi criptografado com chave pública; a chave privada permaneceu local.
- [Criação com natureza corrigida — run 41917751922](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41917751922): HTTP 200, `PG=45370`, `LF=70183`, vínculo bancário gravado. `SaveRecord` retornou `1;45370` e `1;70183`.
- Verificação independente local às 18:38:49: `MovMovimentoTBCData`, `FinLanDataBR` e `RAIZ.PG.CENSO` concordaram sobre identidade, contagens, valor, vencimento e vínculo bancário.
- IDs persistidos no Zeev foram relidos; a tarefa T07 foi preservada.
- Credencial temporária exclusiva removida; workflow de execução financeira desativado para impedir repetição acidental.
- Evidências operacionais sanitizadas: `Desktop/TOTVS-225136-Correcao-20261104`.

## Correção da mensagem

Foi implementado `RM_INVALID_FISCAL_NATURE` no classificador, na validação de evidências e no coletor de diagnóstico. O Zeev passa a receber o motivo fiscal concreto quando o RM devolver essa recusa; não há seleção automática de natureza nem reintrodução das consultas de duplicidade removidas.

Validação local: **193 testes Node**, typecheck e build aprovados; **3 testes específicos e 6 testes reutilizados do publicador** aprovados. Revisão independente sem bloqueadores. A compilação da base corresponde integralmente ao wrapper ativo.

A correção foi publicada em 04/11/2026 às 18:41:50, pelo [run 41918344032](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41918344032), commit `19a29d16a565759029bbb7c903649a6c6707dce0`, e conferida em executor independente. Código AWS SHA256 `nP8Tf7PTJVjQcqhA+QwqCkA69wFPlJ+kYe/8QHKR5/A=`, revisão `6aec6184-80d8-47eb-b386-32cab252c086`. Somente o wrapper de pagamento foi atualizado; core, demais entradas, configuração e permissões foram preservados. A publicação não reprocessou o ticket. Após 305 segundos, a leitura às 18:46:54 confirmou novamente todos os hashes e a revisão, com soma zero da métrica AWS/Lambda Errors. Essa métrica mede falhas de execução, não respostas HTTP de negócio; a criação financeira foi comprovada separadamente pelas leituras RM/SQL/Zeev. O workflow terminou com sucesso e foi arquivado para não republicar a versão pontual.

Uma nova reconstrução do formulário já vinculado confirmou o mesmo digest da operação `COMPLETE`, `399e880f584800e075911e1978391e9af75e11c2a040d545f9f143d9c86483bd`, e PG 45370. Essa verificação foi somente leitura, sem repetir a criação nem concluir a tarefa Fiscal.
