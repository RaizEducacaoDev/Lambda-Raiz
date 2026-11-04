# Decisão de duplicidade pelo TOTVS RM

Autorização explícita de04/11/2026: remover a camada adicional de duplicidade da Lambda e deixar essa decisão no TOTVS. Implementação executada pelo Codex.

O caminho de nova criação não consultaRAIZ.PG.DOC2,RAIZ.PG.RECON ouRAIZ.PG.RETRY, nem exige prova de ausência de movimento/parcelas. O número e a série informados são preservados; valores omitidos seguem o comportamento do montador e os defaults nativos, sem seleção de série principal pela Lambda. Uma tentativa expirada semPG pode ser reenviada com dados corrigidos, preservando o snapshot anterior e adquirindo a execução por atualização condicional.

O RM recebeSaveRecord e decide aceitar ou rejeitar o documento, inclusive por duplicidade. Um identificador válido continua obrigatório para conferir o movimento e vincular as parcelas. PG informado ou já persistido e operaçãoCOMPLETE são reutilizados, com verificação de unidade/fornecedor e dados bancários; o lease de execução simultânea permanece. Não há retry automático deSaveRecord dentro da mesma chamada.

A mensagem que dizia que o resultado não autorizava nova criação foi removida. Quando for seguro, o Zeev recebe uma síntese do motivo nativo (máximo300caracteres, sem stack/SQL/credenciais/dados pessoais). Se não houver trecho seguro, recebe uma mensagem objetiva de retorno nativo sem identificador. O resumo não é escrito em logs ou no diagnóstico persistido.

O incidente225136 às17:53 chegou aoSaveRecord e recebeu diagnóstico nativo em1,176s, contendo referência aSERIE. O texto completo daquele retorno não foi preservado, portanto a nova política não é prova de correção de uma eventual inconsistência nativa. Também não foi verificado que todas as parametrizações de todos os tipos RM garantem a mesma prevenção de duplicidade. A escolha de delegar essa decisão ao RM é a política autorizada.

Publicação restrita à função de pagamento: a compilação da base deve coincidir byte a byte com o wrapper ativo; somente quatro fontes runtime podem mudar. O pacote mantém o core dos outros fluxos e todas as demais entradas, configurações e permissões. Publicação condicionada a hash/revisão AWS, canário sem identidade financeira, releitura independente e observação de cinco minutos. Nenhum ticket é reprocessado pelo deploy.

Verificação antes da publicação:190 testesNode aprovados, typecheck e build aprovados,6 testesPython do release aprovados e revisão independente sem bloqueadores. A compilação da base coincidiu com o wrapper ativoSHA256`0u132fDr2uHv1IIb1Z7Majoqn7cBJCrvC8fj/OOC2n8=`.
