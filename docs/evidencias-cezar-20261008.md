# Evidências sanitizadas da correção de contas de consumo

## Referência de produção

Foi recuperado o pacote observado em produção em 07/10/2026. O SHA-256 do ZIP
coincide com o hash registrado naquele levantamento:

```text
545ff3d5fd92562146d9f43f8fc9871b0b311644e3079e630358790cd3c3e234
```

O sourcemap permitiu recuperar a referência de código: handler e `classRm.ts`
diferem do Git HEAD, enquanto `response.ts`, `xml.ts`, `wsDataserver.ts` e
`date.ts` coincidem após normalização de quebras de linha. O legado recuperado
inclui correções de vencimentos, QR Code PIX, internet e consulta por ticket.
Preservar apenas o Git HEAD removeria comportamento já publicado.

As dependências do snapshot também foram identificadas: Axios `1.8.3` pela
constante de versão no sourcemap, `xml2js 0.6.2` por igualdade dos seis fontes
incluídos e `fast-xml-parser 5.7.3` por igualdade dos nove fontes incluídos com
os tarballs oficiais do npm. O parser do lock antigo (`5.0.9`) não corresponde
ao runtime recuperado.

A configuração e o hash atualmente ativos ainda precisam ser reconsultados.
O ZIP é backup de código da observação anterior, não backup de configuração.
O artefato, seus metadados operacionais e dados financeiros reais permanecem
em armazenamento local privado e não fazem parte deste repositório público.

## Leituras de referência

Foram consultados quatro casos históricos nas APIs do Zeev/RM, sem gravações.
Três permanecem sem associação bancária e/ou dados de boleto; um já apresenta
os campos preenchidos, divergindo do relatório anterior. Há lançamentos com
status diferentes de aberto; eles não devem ser atualizados automaticamente.

Os formulários mostram ambiguidade entre `idpgto` e `idPagamento`. Os cadastros
consultados incluem tanto forma `I` quanto `N`, com mais de um registro ativo
`N` para a mesma combinação de fornecedor/coligada. A modalidade sozinha não
identifica um registro: a entrada deve indicar a chave sem ambiguidade.

As quatro linhas recebidas possuem 48 dígitos. Validação independente local
confirmou os quatro dígitos de bloco e o dígito geral. O cálculo foi conferido
nas seções 07–10 do [layout FEBRABAN versão 8, de
11/05/2026](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%208%20-%2011_05_2026.pdf).
Não foram incluídos números de boleto reais nos testes ou neste documento.

## Estrutura real do contrato RM

Envelopes SOAP `ReadRecord` confirmaram estas tabelas:

- `FinDadosPgtoBR / FDadosPgto`, com a capitalização indicada.
- `FinLAN / FLAN`, com outras tabelas e imagens no mesmo dataset.
- `MovMovimento / TMOV`, `TMOVPAGTO / IDLAN` e `TMOVCOMPL / TICKET`.

O parser deve selecionar a tabela e validar sua identidade, não a primeira
tag encontrada em todo o XML. As fixtures versionadas preservam essa
estrutura com valores sintéticos e omissão de informações pessoais.

A consulta cadastrada `TICKET.RAIZ.0059/0/T` retornou o movimento esperado para
um ticket real. Ela recebe `CODCOLIGADA`, `TICKET` e `CODTMV`. Uma consulta
com sucesso não comprova unicidade universal. Erros, respostas inválidas ou
múltiplos resultados impedem criação; após escrita incerta, resultado vazio
não comprova ausência de gravação.

## Condições ainda necessárias para ativar

- Revalidar pacote/configuração AWS e analisar logs.
- Confirmar o payload e a seleção bancária no Zeev.
- Garantir que a TS03 permaneça pendente em falha ou status não final.
- Provisionar e testar o armazenamento durável de idempotência.
- Revisar o changeset e executar o canário autorizado antes de ampliar o uso.

Nenhum deploy, provisionamento, atualização de cadastro ou reprocessamento
financeiro foi realizado durante a coleta dessas evidências.
