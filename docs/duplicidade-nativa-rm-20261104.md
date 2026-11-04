# Decisão de duplicidade pelo TOTVS RM

Autorização explícita de 04/11/2026: remover a camada adicional de duplicidade da Lambda e deixar essa decisão no TOTVS. Implementação executada pelo Codex.

O caminho de nova criação não consulta `RAIZ.PG.DOC2`, `RAIZ.PG.RECON` ou `RAIZ.PG.RETRY`, nem exige prova de ausência de movimento/parcelas. O número e a série informados são preservados; valores omitidos seguem o comportamento do montador e os defaults nativos, sem seleção de série principal pela Lambda. Uma tentativa expirada sem PG pode ser reenviada com dados corrigidos, preservando o snapshot anterior e adquirindo a execução por atualização condicional.

O RM recebe `SaveRecord` e decide aceitar ou rejeitar o documento, inclusive por duplicidade. Um identificador válido continua obrigatório para conferir o movimento e vincular as parcelas. PG informado ou já persistido e operação `COMPLETE` são reutilizados, com verificação de unidade/fornecedor e dados bancários; o lease de execução simultânea permanece. Não há retry automático de `SaveRecord` dentro da mesma chamada.

A mensagem que dizia que o resultado não autorizava nova criação foi removida. Quando for seguro, o Zeev recebe uma síntese do motivo nativo (máximo 300 caracteres, sem stack/SQL/credenciais/dados pessoais). Se não houver trecho seguro, recebe uma mensagem objetiva de retorno nativo sem identificador. O resumo não é escrito em logs ou no diagnóstico persistido.

O incidente 225136 às 17:53 chegou ao `SaveRecord` e recebeu diagnóstico nativo em 1,176 s, contendo referência a `SERIE`. O texto completo daquele retorno não foi preservado, portanto a nova política não é prova de correção de uma eventual inconsistência nativa. Também não foi verificado que todas as parametrizações de todos os tipos RM garantem a mesma prevenção de duplicidade. A escolha de delegar essa decisão ao RM é a política autorizada.

Publicação restrita à função de pagamento: a compilação da base deve coincidir byte a byte com o wrapper ativo; somente quatro fontes runtime podem mudar. O pacote mantém o core dos outros fluxos e todas as demais entradas, configurações e permissões. Publicação condicionada a hash/revisão AWS, canário sem identidade financeira, releitura independente e observação de cinco minutos. Nenhum ticket é reprocessado pelo deploy.

Verificação antes da publicação: 190 testes Node aprovados, typecheck e build aprovados, 6 testes Python do release aprovados e revisão independente sem bloqueadores. A compilação da base coincidiu com o wrapper ativo SHA256 `0u132fDr2uHv1IIb1Z7Majoqn7cBJCrvC8fj/OOC2n8=`.

## Publicação em produção

A função `lambda-raiz-prod-solicitacaoDePagamento` foi atualizada em 04/11/2026 às 18:18:37 (Brasília), pelo [run 41914704189](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41914704189), a partir do commit `464267d4da455d6bea26ae0a1b2586dbc5fa88e3`. Alteração registrada no [PR 30](https://github.com/RaizEducacaoDev/Lambda-Raiz/pull/30).

- Código ativo AWS SHA256: `f4driLg+9qhXQN4A7hvgLvKrmpotW1EtSsk35lIVVVM=`.
- Revisão AWS: `08becd62-7243-43b3-b7c2-e2adb52215d7`.
- Única entrada alterada no ZIP: `src/functions/rm/post/solicitacaoDePagamento.js`.
- Configuração preservada; o canário sem dados financeiros retornou o esperado `422 / IDPGTO_NAO_CONFIRMADO` antes de qualquer gravação financeira.
- Nenhum ticket foi reprocessado; nenhuma gravação financeira, no DynamoDB ou no Zeev foi executada pelo procedimento de publicação.

A releitura independente do pacote ativo passou às 18:18:55. Após 304 segundos, uma nova leitura às 18:23:40 confirmou o mesmo código, revisão e hashes de todas as entradas. A métrica AWS/Lambda `Errors` retornou soma zero no período. Essa métrica mede falhas de execução da Lambda; não comprova sucesso de uma nova tentativa financeira nem ausência de respostas HTTP de erro de negócio. O workflow terminou com sucesso em ambos os jobs.

As evidências estão em `Desktop/Lambda-Duplicidade-Nativa-RM-20261104/release` e `Desktop/Lambda-Duplicidade-Nativa-RM-20261104/readback`.
