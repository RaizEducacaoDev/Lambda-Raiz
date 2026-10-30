# Histórico de erros — pagamento

## 2026-10-29 — vínculo obrigatório para PG

- Causa confirmada na AWS: entrada sem IDPGTO podia criar movimento e retornar
  sucesso; falha de associação financeira era capturada fora do canário.
- Correção: identidade exata validada antes dos efeitos, protocolo PG geral,
  reserva durável, checkpoint por IDLAN e confirmação por leitura oficial.
- Regressões resolvidas na revisão: CODCOLCFO deve acompanhar o fornecedor no
  XML; digest precisa incluir composição de aluguel/tributos/modalidade; IDMOV
  informado precisa ser validado antes da reserva; datas reais do Zeev são BR.
- Testes de DynamoDB emulado aguardam tabela ACTIVE, evitando corrida no setup.
  Ao copiar ZipInfo entre arquivos, usar copy.copy para não modificar os offsets
  do arquivo de origem e gerar falso BadZipFile na cópia do núcleo original.
- Verificação local: 58 testes, typecheck, bundle e importação do pacote com
  rede bloqueada. Evidência operacional/publicação fica no relatório privado.

## 2026-10-08 — ag-depurar-erro

### Erro: conta de consumo criada sem associação bancária, código e IPTE

- **Sintoma:** movimento existe, mas lançamento financeiro pode permanecer
  incompleto e a integração considerar a operação concluída.
- **Número de causas:** múltiplas; correção local, ativação ainda NO-GO.
- **Pré-condição:** não existia errors-log nem regra root-cause-debugging no
  worktree. Lido o registro de retomada privado antes da investigação.
- **Causa 1 — contrato:** idPagamento/idpgto ambíguos; número do cadastro e forma
  de pagamento confundidos. ID numérico exige chave completa explícita e leitura
  do cadastro exato, ativo e forma N. Mais de um N possível; não inferir escolha.
- **Causa 2 — gate:** versão preparatória ativava apenas CC+S, fora de PG/TS03.
  Gate agora exige quatro condições e flag adicional do servidor.
- **Causa 3 — integridade:** aceitar código44 sem IPTE ou linha sem DV dava falso
  sucesso. Exigidos48 dígitos, quatro DVs e geral; aliases em parcelas não podem
  sobrepor dados validados. Diferentes campos preexistentes bloqueiam escrita.
- **Causa 4 — concorrência/timeout:** faltava reserva durável. Preparado DynamoDB
  condicional antes dos efeitos e checkpoint IDMOV; criação incerta nunca reabre
  criação; atualização incerta permite somente confirmar por leitura.
- **Causa 5 — históricos:** tabela nova não conhece tickets antigos. Consulta
  existente por ticket/CODTMV antes de criar; erro ou ambiguidade bloqueiam.
- **Causa 6 — falso sucesso:** pendente HTTP200 fazia o consumidor poder avançar.
  V2 retorna422/409/503 e só confirma200 após leitura e checkpoint final.
- **Causa 7 — parser:** mocks usavam FDADOSPGTO; envelope real utiliza FDadosPgto.
  Parser dedicado V2 preserva strings, namespaces e registros separados. Fixtures
  sanitizadas de ReadRecord real e casos de duplicidade/Fault verificam contrato.
- **Causa 8 — deploy gap:** Git não continha as correções ativas de PIX QR,
  vencimentos, internet e recuperação por ticket. Pacote de backup recuperado pelo
  responsável da sessão; fonte AWS preservada como legado e protegida por hash.
  Nenhum deploy realizado; hash atual da função ainda precisa ser reconfirmado.
- **Causa 9 — prazo:** reutilização do getLOC legado mantinha timeout30s fora do
  orçamento. V2 injeta consulta de estoque com mesmo deadline/abort das demais.
- **Tentativa 1:** implementação anterior tinha51 verificações locais verdes,
  porém nenhuma reserva durável, gate incompleto e mocks irreais; revisão rejeitou.
- **Tentativa 2:** isolamento do legado AWS + V2 com parser real sanitizado,
  validações, reserva e CI. Revisão detectou override em parcela e estoque sem
  deadline; ambos corrigidos com regressão antes de publicação.
- **Verificação:** `npm run verify:pagamento`: testes com DynamoDB emulado local,
  typecheck da árvore pagamento e bundle Node22. CI executa verify sem segredos
  antes de deploy, e PR não pode publicar. Typecheck global falha em módulos
  preexistentes fora do escopo; não foi ocultado como verificação global verde.
- **Dependências externas:** tabela/IAM não provisionados; flags OFF; contrato Zeev
  pendente; backup atual/configuração e canário ainda necessários. SaveRecord real
  não foi executado. Emulação local não comprova IAM ou comportamento AWS real.
- **Lição:** sucesso precisa representar persistência confirmada; abort local não
  garante cancelamento remoto. Preservar reserva e parar para reconciliação é mais
  seguro que repetir uma criação de resultado incerto.

Os identificadores, dados bancários, logs brutos e configuração de ambiente ficam
somente no registro privado da sessão; este arquivo é adequado ao repositório público.

## 2026-10-13 — revisão da retomada

- **Causa adicional:** o cadastro bancário era lido depois da reserva. Rejeitar
  forma I ou titularidade incorreta deixava `RESERVED` fixando o digest, mesmo
  sem escrita no RM, e impedia corrigir a seleção bancária do ticket.
- **Correção:** leitura e validação do cadastro antes da reserva; estado
  `COMPLETE` é consultado primeiro para preservar replay confirmado sem depender
  da situação atual do cadastro. `CODCOLCFO` explícito divergente é rejeitado.
- **Verificação:** regressão com cadastro inválido e correção no mesmo ticket,
  replay após desativação, aliases no topo/parcela e suite de pagamento verde.
- **Dependência:** provisionamento DynamoDB/IAM e contrato da TS03 no Zeev ainda
  pendentes; a versão de produção não recebeu esta mudança.

## 2026-10-30 — ag-depurar-erro

### Erro: criação remota concluída depois do timeout deixou o vínculo bancário pendente

- **Sintoma:** TS03 retornou Conflict de criação incerta; o RM já possuía o
  movimento e o lançamento em aberto, ainda sem IDPGTO/CODCOLPGTO.
- **Número de causas:** múltiplas, confirmadas pela correlação independente de
  CloudWatch, reserva durável e leitura do movimento/lançamento no RM.
- **Causa 1 — prazo HTTP:** o transporte limitava também a criação de movimento
  a 8 segundos. O cliente abortou antes do commit remoto, que ocorreu depois.
  Abort local não representou cancelamento da operação no RM.
- **Causa 2 — recuperação:** o estado CREATING bloqueava antes da consulta de
  movimento existente, inclusive depois da expiração do lease. Evitava duplicar,
  mas não oferecia reconciliação verificável de uma criação já concluída.
- **Causa 3 — observabilidade:** o legado injetado convertia o erro em resposta
  genérica e podia registrar o objeto Axios inteiro. Retorno sem chave primária
  tampouco recebia uma classificação segura no protocolo externo.
- **Correção 1:** criação recebe teto de 15 segundos, reserva 12 segundos para
  checkpoint/vínculo/leitura e exige janela mínima de 9 segundos. O pré-checkpoint
  guarda mais 2,5 segundos para o DynamoDB limitado a 2 segundos. Nova verificação
  ocorre antes do HTTP. Uma falha excepcional depois do checkpoint continua
  conservadoramente em CREATING; nenhum reset é feito por timeout/rejeição.
- **Correção 2 — reconciliação operacional:** o caso existente deve ser tratado
  pontualmente, depois de confirmar por SQL SELECT e SOAP independentes o único
  movimento, proprietário, coligada/filial, fornecedor, tipo, documento, totais,
  parcelas em aberto e ausência de pontes de baixa/boleto. Apenas o IDMOV já
  comprovado pode ser vinculado por CAS preservando digest e reserva; a correção
  bancária usa o serviço oficial. Nenhuma nova criação ou exclusão é necessária.
- **Correção 3:** o caminho injetado registra classe/código/etapa/duração, sem
  config, headers, corpo ou mensagem bruta; resultado sem chave tem categoria e
  tamanho seguros. O núcleo original e o caminho sem injeção foram preservados.
- **Revisão:** FinLanDataBR não expõe FLANBOLETO/FLANBAIXA; ReadView rejeitou
  subconsulta e a consulta cadastrada de ticket utiliza TOP 1 sem filtrar coligada.
  Esses contratos não provam ausência de pontes nem unicidade global. O protótipo
  de recuperação automática foi retirado antes da publicação; CREATING continua
  bloqueado na Lambda e exige reconciliação operacional independente.
- **Verificação local:** regressões cobrem timeout de criação, janela insuficiente
  antes do checkpoint, logs seguros e preservação de CREATING sem segunda criação.
  Um SaveRecord simulado respondeu após 9 segundos sem abort. A execução final
  de `npm run verify:pagamento` passou nos 63 testes, typecheck e bundle.
- **Deploy Gap:** publicação e canário com releitura persistida ficam sob a
  execução do responsável da sessão; verificação local não comprova produção.
- **Lição:** preservar idempotência na incerteza e recuperar somente o registro
  remoto comprovado; sucesso exige reler o IDPGTO no lançamento correto.

### Publicação: ERESOLVE antes dos efeitos AWS

- A execução 41102006254 falhou no npm ci: serverless-dotenv-plugin6 exige
  peer Serverless1/2/3, enquanto o lock existente usa Serverless4.
- Os workflows anteriores já usam npm ci --legacy-peer-deps. A publicação
  de recuperação foi alinhada à mesma instalação, preservando o lock e as
  versões; nenhuma alteração AWS ocorreu na execução que falhou.
- A adoção pontual de455 é executada somente após a publicação confirmada,
  com hash ativo obtido do readback e evidência RM de no máximo15min.
- **Resultado confirmado:** execução41103551412 passou63 testes, typecheck,
  bundle, preservação do núcleo/ZIP e dois negativos422; publicou somente a
  função e adotou455 por CAS. Leitura independente41103814622 confirmou novo
  SHA/revision e CREATED/PG455. SOAP+SQL posteriores confirmaram470 com banco4/31,
  principal1 e baixa0, sem duplicação/pontes. Reteste Zeev e aceiteA03 pendentes.
- **Observabilidade do CI:** status agregado/job pode atrasar em relação aos
  artefatos e logs. Conferir artefatos reais da execução antes de concluir que
  uma publicação ainda não ocorreu apenas porque a API informa queued.
- **Retomada real confirmada:** após a aprovação fiscal pelo usuário, o Zeev
  recebeu455/470 e avançou a T15 — Baixar Lançamento. Leitura41106685665 confirmou
  raiz e FLAN COMPLETE e CloudWatch com455/470/4/31; SOAP e SQL confirmaram banco
  ativo e coincidente, um único movimento/financeiro, principal1 e baixa0.
  Essa prova é de retomada após reconciliação; A04 testará uma criação nova.
  Regra auxiliar e aceite de pagamento continuam pendentes.

## 2026-10-30 — recorrência PIX E-mail, causa específica ainda pendente

- O aviso CREATING pode reaparecer por causas diferentes. A nova tentativa
  respondeu em1398ms com diagnóstico RM sem chave, tamanho1586; não foi timeout.
  A versão corrigida cnvkNpnJIWED49S7GpDSpy2oFQfkZo+vPtKnL50xL24= estava ativa.
- Banco PIX E-mail ativo e coincidente com o formulário, mas nenhum movimento
  foi encontrado nas consultas por ticket/documento. A reserva foi preservada.
- Leituras delimitadas confirmaram produto, natureza orçamentária, CC, condição,
  local, filial e fornecedor válidos. Nenhuma FK inválida foi comprovada.
- A mensagem nativa foi descartada pelo wrapper que guarda apenas categoria e
  tamanho. Logs nativos acessíveis não permitiram recuperá-la. Não repetir
  SaveRecord para descobrir o motivo nem resetar CREATING por inferência.
- Divergência de aliases PIX no montador foi reproduzida, mas não atribuída
  como causa desta resposta sem evidência. Nenhuma fonte da aplicação ou dado
  operacional foi alterado nessa investigação; apenas auditoria e documentação.
- Evidência somente leitura: execuções41130570993 e41131174223. Dados do caso
  e reproduções ficam nos artefatos privados. Rejeição específica ainda pendente.
- Usuário confirmou ticket228310/coligada11/filial1. O template1209 real foi
  lido sem salvar/testar e a reconstrução offline reproduziu o digest exato da
  reserva. Natureza121, receita17080 e FKs conferidas; a linha tributária vazia
  também existia no contrato do caso anterior aceito. Não atribuir causalidade.
- Perfis T/F ativos do usuário técnico são os mesmos em11/31. Leituras às19:07
  ainda não encontraram movimento pelo ticket/NF; cadastro2/11 continua ativo.
  Isso não autoriza repetir criação. Logs nativos foram conferidos tanto na
  janela18:16–18:20 quanto21:16–21:20, sem recuperar o retorno original.
- Próxima evidência necessária: log do RM.Host/WebService às18:17:35–18:17:37
  de30/10/2026 BRT (21:17:35–21:17:37 UTC), requisição AWS
  0087563c-cd5e-4baf-956b-67b290f1ab14. Acesso solicitado ao usuário.
- Preparação local de diagnóstico: motivos de allowlist, SHA256/tamanho/linhas,
  campos/tipos nativos fixos e etapas de checkpoint/chamada ao transporte/chave
  recebida. Não conserva texto bruto nem recupera a mensagem histórica; não
  altera digest, estados, HTTP ou autoriza retry. Publicação permanece pendente.
- Recuperação de log: host efetivo confirmado na TOTVS Cloud, ambiente160286;
  SMB/WinRM não acessíveis. Após login do usuário e acesso pelo aplicativo
  oficial PortalTcloud disponível no catálogo da própria conta, o seletor de
  cliente retornou `Nenhum cliente encontrado` nas buscas pelo prefixo da base
  e pelo nomeRaiz. Os arquivos do servidor ainda não foram listados; não confundir
  esse limite de acesso com ausência do log. Solicitado acesso por conta que já
  administra160286. Nenhuma chamada financeira, trace ou restart foi executado.
- Swagger/WSDL não expuseram consulta de logs gerais deSaveRecord. JobExecution
  cobre jobs, sem vínculo temporal/síncrono documentado para este incidente;
  apenas seu schema foi lido. Não consultar logs de outros módulos como se fossem
  a resposta descartada. Solicitação de extração local preparada, sem envio.
