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

### Reprodução isolada e prevenção da natureza incompatível

- RM_DEV foi confirmado como C3U7RQ_160289_RM_DV, diferente de PROD160286.
  A intenção reconstruída bateu o digest original. Na base de homologação,
  600 campos de cadastro/configuração e 144 de natureza/geografia coincidiram
  com os valores selecionados em produção. O XML original recebeu rejeição
  Natureza inválida e não gerou movimento. O texto histórico PROD descartado
  não foi recuperado; a reprodução não deve ser descrita como aquele log.
- Fornecedor RJ e filial11/1 RS, ambos Brasil. Natureza11/121 é interna;
  alterando apenas IDNAT para a candidata interestadual11/166 em HML, o serviço
  aceitou 90767/148481. O item herdou166, afastando a ausência de IDNAT no item
  como causa necessária neste caso. Nenhuma seleção fiscal PROD foi alterada.
- A proteção consulta RAIZ.PG.FISC antes de reservar novas solicitações1.2.03.
  Não altera entrada/digest/CFOP. Falha de contrato é503 sem reserva; seleção
  incompatível é422 específico. PG durável e PG remoto comprovado retomam sem
  reaplicar validação de criação; CREATING incerto continua sem reabertura.
- RAIZ.PG.RECON substitui o TOP1 exclusivamente no transporte seguro. O parser
  exige total/lista completa/echo/identidade de todas as linhas; aceita os
  metadados SQLNULL de SC/OC não alvo e exige ownership completo do alvo.
- Segundo teste HML percorreu a fonte completa: 989900310 inválido422 com0
  reservas/efeitos; corrigido cria apenas90769/148482 e grava banco2/11; replay
  retorna os mesmos IDs. ReadRecord independente e contadores confirmaram1MOV,
  1FLAN,0órfãos/baixa/boleto, principal1 e baixa0. Valor auxiliar nativo3 segue
  pendente de análise separada, sem correção artificial de valor.
- Verificação final:102 testes, typecheck, bundle e diff check aprovados.
  Definições SELECT isoladas RAIZ.PG.FISC e RAIZ.PG.RECON registradas em PROD
  pelo GlbConsSQLData com ReadRecord e GET conferidos. Não alteram naturezas,
  lançamentos ou a consulta compartilhada antiga. Publicação AWS e canário da
  requisição original ficam a cargo do responsável da sessão; não inferir
  publicação a partir deste registro. A reserva original228310 foi preservada.

- **Publicação confirmada:** commit28a314d, execução41143863601, somente a função
  de pagamento, SHA r0ACtmx4cuGdCAaexa2P6RHkXAEnO5lctl4tiP1iqkk=, revisão
  e959f76b-7707-4d85-9b13-7a0a27784f81.102 testes/ZIP/config/checkpoints aprovados;
  segundo job e sua repetição pós-canário confirmaram código/core/HTTP/estados.
- **Canário original:** intenção/digest exatos de228310 retornaram422 específico
  de natureza internaRJ→RS. READ COMMITTED posterior semNOLOCK nas tabelas de
  negócio confirmou0MOV/0FLAN; CREATING/digest/owner/lease originais intactos.
  Isso previne nova reserva indevida, mas não reconcilia a tentativa histórica.
- **Limite:** chave única possui nove componentes, seis derivados pelo nativo.
  Sem prova de invariância ou rollback correlacionado e aprovação fiscal, não
  liberar sucessor. Não fazer reset/delete. Ver operations/payment-fiscal-release-20261030.md.

## 2026-11-03 — Aliases bancários no Zeev: candidato offline, não publicado

- Incidente224773: CloudWatch às12:24:13 BRT correlacionado ao request
  a279a8f8-3b94-405c-a064-25ff19fe284a. O payload apresentava IDPGTO5 e chave
  composta terminada em1; o guard rejeitou antes da criação nessa chamada.
  Leitura posterior já tinha5/5 por alteração externa; este trabalho não mudou
  o ticket. Não atribuir uma sequência exata de eventos de tela sem captura.
- Nos scripts arquivados299/386 de28/10, seis testes reproduziram: reabertura
  troca cadastro salvo5 pelo primeiro1; escrita tardia pode divergir os aliases;
  preservação pós-cadastro mantém somente ID numérico sem reconstruir composta.
- Candidato local coordena os três campos, conserva seleção validada, invalida
  mudanças reais e reconstrói identidade por leitura. O preenchimento automático
  sem seletor foi preservado. Revisão corrigiu invalidação indevida de versão
  antes do onchange do tipoPIX; teste executa capture e depois onchange.
-124 testes locais aprovados:35identidade/45cadastro/26consulta/18preservaçãoV2.
  Seis reproduções negativas e sintaxe dos dois scripts conferidas; nova leitura
  independente dos arquivos confirmou hashes e caudas não relacionadas intactas.
- **Não publicado:** conexão do editor/navegador indisponível; APIs oficiais
  retornaram metadados e exportação opaca, sem baseline JS atual. Não importar
  aplicação completa nem colar candidato arquivado sobre configuração desconhecida.
- Pendente: baseline atual, validação no DOM real e contrato/hook imediato após
  inclusão no386. NewBankInformations/POST estão intactos e nenhum retry foi
  introduzido. Publicar/reler hashes e depois confirmar em ticket teste/FLAN.
- Pacote: C:\Users\felipe.martins\artifacts\zeev-bank-identity-sync-20261103.
  Nenhuma escrita operacional Zeev/RM/AWS, mudança SQL ou reprocessamento nesta etapa.
- Complemento confirmado pela API atual: tarefas de serviço18245/18246/18761
  `Gravar IDPGTO` usam1611 no fluxo299. Escrita depois do envio não passa por
  listener/observer/submit da tela; o candidato frontend é insuficiente nesse
  caminho. Ler/corrigir configuração atual1611 e coerência com a identidade
  selecionada antes de publicar/declarar solução. O mapeamento arquivado só
  atualiza idpgto/codcolpgto; não afirmar execução1611 na tela sem comprovação.

## 2026-11-03 — Análise de parcelas: limite de retomada reproduzido, sem correção

- Leitura nativa de228424/224343/227787/227193 conferiu10FLANs, todos com o
  IDPGTO/CODCOLPGTO da identidade selecionada e cadastro ativo. O caso228424
  tem alias numérico vazio no Zeev, porém composta válida6/18 e3FLANs corretos.
  Não confundir campo oculto vazio com ausência de vínculo financeiro.
- Fonte PG aplica a chave global em todos os planos e confirma cada IDLAN
  antes de COMPLETE.4testes relevantes existentes e8cenários adicionais passaram.
- **Limite reproduzido offline:**3parcelas com default nativo1, desejado6,
  interrupção após a primeira associação:503; retomada409 porque criadoAgora
  é falso e as restantes ainda têm1.1MOV/1gravação; sem duplicidade ou falso200.
  Não encontrado esse cenário nos4casos reais; testes usam RM/Dynamo emulados.
- Tratar retomada só com prova do default da própria criação, preservando
  título histórico/alterado e sem relaxar sobrescrita/reset/CREATING.
  Repetir IDPGTO no payload de cada linha não resolve esse limite.
- Fontes conferidas iguais ao commit28a314d. Última verificação AWS disponível
  é03/11 12h28BRT; nenhuma nova confirmação do pacote neste exercício.
- Evidência: C:\Users\felipe.martins\artifacts\installments-idpgto-audit-20261103.
  Relatório na pasta Desktop/Problemas Tesouraria2.0. Sem escrita operacional,
  alteração de fonte produtiva, publicação ou reprocessamento.

## 2026-11-03 — NovoConflict0609:226374 correlacionado ao minuto, usuário não confirmou

- Localizador202611030609-67 sem número de ticket. Falha409 no226374 às18:09:25
  BRT, requestb032cc53-ab5e-4075-9892-99b02fd7093e.228634 era outro candidato de
  falha às17:58, sem409 no minuto; não confundir os dois nem suas datas/cadastros.
- Primeira tentativa226374:02/11 11:43:50BRT,4efffdfd-b6d7-4a87-857f-fe99421654d3.
  Transporte retornou975ms, diagnóstico RM_UNCLASSIFIED_REJECTION/1389chars/
  14linhas, campoSERIE. Sem chave;503/CREATING, semPG. Hash seguro do retorno
  a7da2aded467e342de27827516f8f7f5e93418042cd65504ce79966fc65e7138.
- Reserva9/226374 consistente permaneceCREATING, digest
  f6d5bff690ca5fe785705ea08e586f3f4fb4454f9c191ccb77ca450ed1ed3932.
  Retentativas409 têmstateUndefined no log porop não atribuído. Não é gap parcelado.
- Identidade PIX3/9 ativa/coerente. RM recon por ticket0. Busca READ COMMITTED
  pelo documento atual114/fornecedor0000154129/filial9/3 encontrou MOV78497,
  série1/000000114, emissão01/12/2025, ticket110229, FLAN161973 já baixado.
  Formulário atual é22/10/2026, série vazia. Série principal9/1.2.03=1.
  Indício de série/numeração; não inferir causa exata ou alterar registro antigo.
- Falta confirmar ticket com usuário e conferir NF/série/intenção original antes
  de qualquer reconciliação. Sem reset/Put/UpdateDynamo, SaveRecord ou aprovação.
- Somente diagnósticos readonly adicionados/push: c35eaa3/4f48b9b/727ff33;
  execução41723121930. Função ativa continuaSHA r0ACtmx4cuGdCAaexa2P6RHkXAEnO5lctl4tiP1iqkk=.
  Artefatos C:\Users\felipe.martins\artifacts\zeev-conflict-20261103-0609.

### Continuação: ticket confirmado, série informada70000 e omissão do XML reproduzida

- Usuário confirmou226374 e informouSERIE70000 na NF. A série não existe em
  TSERIE0/9 nem no vínculo TTMVSERIE9/1.2.03. CampoTMOV.SERIEvarchar8 comporta.
  ZeevserieDaNF persistida ainda vazia; não inferir ausência na tela não salva.
- SourceLegado só enviavaSERIE em1.2.01/1.2.25: NFserviço1.2.03 ignorava até
  valor explícito70000. Teste doXML real falhou antes. Fix local1linha inclui
  SERIE informada em1.2.03.6novos testes passaram; gates completos108/108,
  typecheck e bundle. Commit LOCALb95599a, sem push ou deploy dessa correção.
- Na fonte Zeev arquivada de28/10, FIELD_MAP de serieDaNF aceita sóMaterial,
  apesar do comentárioServiço; hipótese adicional de captura. Exigir baseline
  atual antes de alterar. Metadados vivos mostram campo obrigatório emT07.
- Proposto cadastro nativo70000 na coligada9 e vínculo adicional em1.2.03,
  principal1 preservada; gravação somente do campoSérie do226374, sem concluir
  tarefa. Parametrização produtiva ainda não autorizada/aplicada. CREATING
  permanece; não usar cadastro/série nova como autorização para outra criação.
- Plano/evidências emseries-70000-change-plan.json e relatório Desktop. O
  suporteTOTVS orienta cadastro+vínculo; para NFS-e conferir sérieRPS nSerieRPS.


### Retificação: 70000 é SÉRIE DA DPS, mapeamento para RM ainda não comprovado

- O usuário esclareceu que 70000 é a série da DPS. A recomendação anterior de
  cadastrar/vincular esse valor em TSERIE/TTMVSERIE e preencher serieDaNF foi
  retirada. Não inferir equivalência entre DPS, nSerieRPS e TMOV.SERIE.
- Fonte primária municipal confirma série70.000 do Emissor Nacional Web:
  https://nfem.joinville.sc.gov.br/index.jsp?mens=SI . Ainda falta identificar
  no documento o Número da NFS-e separado do Número/Série da DPS e confirmar
  a correspondência no recebimento de serviço pelo RM. Origem do114 pendente.
- b95599a permanece apenas local, sem push/deploy; testes de XML não validam
  semântica fiscal. Plano JSON e relatório Desktop retificados. Rejeição que
  menciona SERIE não comprova ausência de cadastro70000 como causa raiz.
- Sem alteração operacional, reset de reserva, SaveRecord ou reprocessamento.


### Continuação: NFS-e114 confirmada, intenção original reconstruída, preflight verificado

- Usuário confirmou114 comoNúmeroNFS-e,70000comoSérieDPS e pediu correção definitiva.
- Enumeração offline de91.530 representações encontrou exato digestf6d5...3932:
  IDNAT23/CODNAT1.949.01,receita17080,sérievazia,27/10entrada,22/10emissão,
  tributosblank_row. Não atribuir o vazio atual da Natureza à tentativa original.
- Reprodução nativaDEV160289 da intenção exata: JáExisteNota...Número eSérie,
  sérieprincipal1;78497/110229/2025conflita. ZeroMOVantes/depois. O hash nativo
  HML difere dePROD; o texto histórico dePROD continua não recuperado.
- PreflightRAIZ.PG.DOCnovoSELECTcompleto+eco9componentesSEMfiltroano/CODTMV,
  registrado viaGlbConsSQLData emDEV/PROD. SERIEsemparâmetro usa sentinela~.
  Correção de compatibilidade nativa: CAST(:SERIE AS VARCHAR(16)) antes da
  comparação com~; parâmetro isolado seguido de= causavaFE011. ReadbacksOK.
- Novo serviço1.2.03 valida docantesRESERVED/CREATING; fixa série observada na
  cópia do builder e confere XMLsérie/número. Rejeita whitespace no número
  para evitar divergência entre trim preflight e slice9 no legado. Input/digest
  preservados. Classifierreconhece a mensagemduplicidade, seminferirrollback.
- 129testes+typecheck+bundle. HarnessRMrealnegativos422 com0reservas/0saves.
  PositivoDEVsynthetic989926374NFN→99863/188433,IDPGTO3/CODCOLPGTO9,5273,40,
  aberto/sembaixa/boleto;replaymesmosIDs1MOV1bankwrite. ReadbackindependenteOK.
- Fontecommit3199579pushed,release41732226686emexecução. Nenhuma série fiscal,
  tarefaZeev,reservaDynamooufinanceiroPRODalterado. NFNnãoatribuidono226374.
- A reserva originalpermaneceCREATING. PreflightNOLOCKnãoéprovadeausência,
  não resolvecorridasnemautorizareset. Falta confirmação sérieRM e evidência
  para reconciliação histórica controlada.


### Publicação concluída e prova pela rota PROD do ticket original

- Release41732226686success,fonte3199579,03/11/202622:37:41UTC. SHAativo
  6Mf0NJD8HIyDhId6FzbAGKqWu13Strj23mIvnBhKmxQ=,revision
  61c06ae6-76ad-4e20-95c9-a06d9eae1d22.129testesCI+typecheck+bundle.
- NovasérieefetivafixadanaCÓPIAdobuilder,validarDocumentoretornasérie/número/
  tipodocumento;série/númeroXMLconferidosantesCREATING. Nadaalterounodigest.
- Config/core/outrosarquivosZIPpreservados.4canáriosPROD422esperados;
  DOCUMENTO_RM_DUPLICADOeSERIE_DOCUMENTO_INVALIDAsemreservas.
- Prova adicional pela rotaAPIattestada comhashoriginalf6d5...3932 recebeu422
  DOCUMENTO_RM_DUPLICADO.0MOVpeloticketantes/depois. Chamadanãoéautorização
  pararetentativaSaveRecord;reservaCREATINGfoipreservada.
- Auditoriareadonly41732855399success22:40:47UTC:
  mesmoSHA/revision,reserva9/226374state/digest/owner/leaseintocados;janela
  completade10minmostra1pendente422e0despachosSaveRecordpara226374.
- GCRITICALLOGnativo,p_heflo,duasjanelasdetempooriginais:0registros. Texto
  históricodePRODaindanãorecuperado;HMLnãosubstituiprovade rollbackhistórico.
- Ticket226374NÃOliberadoparaconcluir:confirmarsériefiscalRMereconciliar
  reservahistóricacomprovaadequada. Nenhumafiscalaprovação,reset/PUTDynamo
  oufinanceiroPRODaplicado. RelatórioatualizadonapastaDesktopinformada.
