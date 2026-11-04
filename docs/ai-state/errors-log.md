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


## 2026-11-04 — 4220912 correlacionado e causa documental confirmada

- Localizador202611040912-4→226374às09:12:24.586BRT,requestc6e2528c-685b-42dc-84a3-c4d66e7165a6.
  Workflowreadonly41827758931,fonte12d47f0,novaLambdaSHA6Mf0...mxQ=ativa/revision61c06...1d22.
  Apenas1eventopendente422,nãohouvecheckpoint/despachoRMnajanela;guardexecutaantesreserva.
- Zeev atual:NF114/serieDaNFvazia,IDNAT23/CODNAT1.949.01/receita17080agorapersistidos,
  IDPGTO3/CODCOLPGTO9/chavecompostacoerentes,PIXativo. RMretorna0MOVpor226374.
- Colisãoatualrelidanativa:default1+114→MOV78497,ticket110229,01/12/2025,5100,
  LAN161973STATUSLAN1/VALORBAIXADO5100. Nãoéolançamentonovo;indexTXMOVCFXsemANO
  (9componentesrelidos). Buscar114/data22Oct2026/fornecedoremqualquersériesóachouohistórico.
- NFNjávinculada1.2.03masusoatual9éemissão2.2.26/2.2.29.10descritaDPSusadaem
  emissão2.1.26. NomenãoconfirmaMAPincomingNFS-e;nemtesteDEVaprovaNFNnesse226374.
- Reserva9/226374CREATING/digestf6d5...3932/owner/leaseinalterados. Correçãosérie
  mudarádigest;apenaspreenchereaprovarpodegerar409. Ajustefiscal+reconciliaçãodevem
  sercoordenados;semresetgenéricoouSaveRecordsemprova/autorizaçãonecessária.
- FaltaFiscalconfirmarsérieRMcorretadaentrada(70000continuaSérieDPS). NãoalterarNF114,
  registropagode2025nemremoverguardparaavançar. DocumentadoemDesktop/ProblemasTesouraria2.0
  eartifacts/zeev-422-20261104-0912. Nenhumaescritafiscal/financeira/AWS/Dynamo/Zeevnestaanálise.


## 2026-11-04 — 4090941: NF alterada114→1141; aguardar número fiscal verdadeiro

- Localizador202611040941-30→22637409:41:25.310BRT,requestd93a9e18-59bc-4b06-9912-95c8d1122fa8.
  AuditoriaAWSreadonly41831845093success;mesmoSHA6Mf...mxQ=,reservaoriginalCREATINGf6d5...3932inalterada.
- ZeevNF1141/sérievazia;0MOVdoticket,IDPGTO3/9ativo/coerente. Offline,mudarapenasonúmero
  atualde1141para114fazdigestvoltaraooriginalexato. Novo409édivergênciadaintenção,antesdeSaveRecord.
- Pergunta factual obrigatória pendente:1141é número real ou sótesteparaavançar? Nãousarnúmero
  fictício,nãoreverter1141semconfirmaçãodoconteúdo,nãoliberarfinanceiroantesdadosverdadeiros.
- Auditoriaoriginal:JOINcorretoAUDITID(nãoPARENTLOGID). PrimeiraconsultaauditFLANexpirou
  em12s;NÃOézero. Consultaindexada/sargávelviaprópriosíndicesAUDITDATE/AUDITIDretornou
  0FLANeventosdasjanelasoriginais02Nov11:38–11:49/14:38–14:49,scope9/CFO0/0000154129,
  todasfiliais. FlagFLANINSUPDDELativasdesde2022;Configativaantesoriginal,retention0sem
  inferênciaautomática. Sérieprincipal1últimamodificação2024-12-19. TMOVatualemqualquer
  filialnasjanelasoudata22Octtambém0. Ausênciaaudittriggerisoladanãoprovarollback.
- Recuperaçãoplanejada:manifestoexclusivo+snapshotoriginalimutável+transaçãoCASúnica,
  somentedepoisdeprovasuficienteedadosfiscaisverdadeiros. Semoperaçãoaplicada,semnovo
  códigoLambda/deploynesteturno. ReportDesktop/ProblemasTesouraria2.0eartefatos0941.


## 2026-11-04 — confirmação do número real e restauração comprovada

- Felipe confirmou que acrescentou o 1 apenas para tentar passar. O número real é 114.
- Em 13:18:55 UTC, PATCH oficial de formvalues/226374 alterou somente numeroDaNF, de 1141 para 114. HTTP 200, success true. Uma nova sessão GET sem cache comprovou a persistência.
- Único campo selecionado alterado: numeroDaNF. Ticket ativo e tarefa T07 preservados; IDMOV/IDLAN vazios; aliases de pagamento 3/9 preservados.
- Nenhuma conclusão de tarefa, invocação financeira, gravação RM, alteração Lambda ou escrita Dynamo nesta restauração.
- A pendência de confirmação do número está encerrada. Continuam pendentes a série fiscal de entrada da NFS-e nacional e a recuperação coordenada da reserva original; não aprovar para testar antes desses ajustes.
- Solicitada a orientação de série ao Fiscal via Felipe. NFN/10 não foram adotadas por inferência; DPS70000 não foi confundida com série de entrada.
- Prova em artifacts/zeev-conflict-20261104-0941/restore-real-invoice-confirmed.json e relatório atualizado no Desktop/Problemas Tesouraria 2.0.


## 2026-11-04 — preservar a série original por instrução expressa

- Felipe determinou manter a série original da integração e questionou a causalidade das mudanças da Lambda. Retirada a escolha pendente de outra série fiscal; não cadastrar 70000 nem selecionar NFN/10.
- Fresh GET Zeev e DataServers/RAIZ.PG.DOC/RECON às 13:28 UTC: 226374 permanece NF114/série vazia, efetiva1, IDPGTO3/9 e zero movimentos pelo ticket. Movimento78497/ticket110229 ocupa 114/série1; financeiro161973 permanece pago.
- Auditoria AWS41831845093, tentativa2, sucesso: SHA6Mf0...mxQ e reserva original preservadas. Somente operações de leitura.
- b95599a acrescentou encaminhamento de série explícita; 3199579 acrescentou preflight422 e fixação da série nativa observada. Para o caso vazio, a série efetiva não mudou:1.
- Reprodução HML original sem tag SERIE já recebeu rejeição nativa de número/série; hash diferente do retorno original PROD. Não confundir reprodução com recuperação do texto de produção ou prova de rollback.
- Nenhum deploy/escrita operacional nesta verificação. Não declarar resolvido. Preservar original1/114 e reconciliar a operação histórica com prova; não criar identidade fiscal fictícia para passar.


## 2026-11-04 — novos localizadores 1049/1050 correlacionados

- 202611041049-73 → 226374,13:49:17.429 UTC,request c366056a-01b8-4945-8400-498712b4e992,422 antes de criação.
- 202611041050-34 → 226374,13:50:09.583 UTC,request fbb0cc26-42dc-4f2b-8700-bb7474aed5c3,409 antes de criação.
- Workflow somente leitura41841953901 passou; commit e3e0d70 não altera/deploya Lambda. SHA ativo6Mf...mxQ e reserva original CREATING/f6d5...3932 preservados.
- GET atual13:51:43 UTC mostra NF1141 novamente; original real confirmado114. Série vazia/default1, IDPGTO3/9ativo/coerente,0MOV oficial pelo ticket. Sem restauração durante edição ativa e sem presumir nova nota verdadeira.
- Estudo nativo: CRO não é exercício; subsérie não pode ser inventada; não identificado parâmetro anual focal. 9/1.2.03 CODTDO002/CRONULL/SUBSERIENULL em1798MOV desde2025, sem SEGUNDONUMERO. FTDO054 existe mas uso observado é emissão2.*; nome não aprova mudança. PermiteNFRepetida Fiscal não libera índiceTMOV.
- Minuta técnica local pronta para Fiscal/TOTVS: confirmar contrato de entrada NFS-e nacional TTMV.CODTDOLANDUP+TTMVEXT.CODTDO→TMOV.CODTDO ou rotina nativa para coexistência2025/2026 mantendo1/114 e histórico pago. Não enviada.
- Reconciliação não concluída; nenhuma escrita operacional/financeira, nenhum reset/reserva liberada. Evidências em artifacts/zeev-errors-20261104-1049-1050 e relatório no Desktop/Problemas Tesouraria2.0.

## 2026-11-04 — retomada segura implementada e verificada

- Novas raízes protocolVersion2: falha antes de envio invalida owner e expira apenas RESERVED com CAS exato. CheckpointCREATING remoto impede encerramento mesmo quando resposta se perde.
- Correção de digest só em RESERVED2 expirado, pg realmente ausente, com censo completo MOV/FLAN vazio e entrada/documento/banco/fiscal válidos. Snapshot integral imutável preservado antesCAS; semdelete/TTL/IAMnovo.
- CREATING pode adotar apenas criação própria positivamente comprovada com mesmo digest. Confere documento/série/tipo, fornecedor/destino, datas, BRUTO=LIQ=esperado, TODASparcelas/IDLANs, aberto/sembaixa/semboletovinculado. Markerpersistente força nova conferência antesbankwrites. Zero nunca liberaCREATING.
- Novo SELECT nativo RAIZ.PG.RETRY usa READCOMMITTEDLOCK. Registrado porGlbConsSQLData emHML/PROD e relido com parser;0MOV/0LAN226374,1/1fixtureHML989926374 eprodtest228063. Nenhum financeiro/parâmetro fiscal alterado.
- 159testes+typecheck+bundle passaram. Revisão detectou bloqueio indevidoSC/OCno último censo; corrigido preservando RECONcompleto+filtroPG e bloqueando qualquerLANprévio. Novo testeverde.
- HML real readonly: reserva simulada emDynamoLOCALCREATING recuperou MOV99863/LAN188433 existente, COMPLETE/histórico1, SaveRecordnativoTOTALMENTEdesabilitado,0tentativaswrites. Original226374fixtureficou422/CREATINGsemalteração.
- Publicação escopada preparada, ainda pendente no momento deste registro. Sem nova criação financeira. 226374não está liberado: NF114/série1colide com2025; reserva original não é ressetada/convertida emRESERVED2.

## 2026-11-04 — publicação bloqueada por drift identificado e incorporado

- Run41862532529 terminou failure15:55UTC noassertbaseline/revision, ANTESUpdateCode. Statusqueuedanteriorera informação desatualizada; novalogcompletaconfirmafalha, nãofila.
- Auditreadonly41867431178 confirmou novoCodeSHArRubhd20rr3yhbQkdzbyCvDJrnAtozxO/Q8sN0XpJtA=,revisiona2cf38ea-8857-4e06-847e-614b57f9d844,publicado14:47:43UTC. Correlation202611040125-5→226374às16:25:20.768UTC,request190edb2e-9862-4931-9a03-eea1c7737f3c,409antescriação,reservaoriginalintocada.
- ComparaçãoJSreal×pacote6Mf:únicohunknormalizaCNPJTIPOPIX4removendomáscarasóparacomparação,rejeitavazio. IncorporadonafonteTScomteste; valor/digestoriginaispreservados. Core/package.json/mapbytesiguais. SourceMapestáobsoletoe NÃOrepresentaJSativo.
- NovoZIPativo temnomesbackslash; montadornormalizaapenasnomes, rejeitacolisaonormalizada,preservatodosbytesforaentry/core. Buildrealatual+smoke0networkpassaram.
- 160testes+typecheck+bundle+2Pythonpassaram. Retargetbaseline/revisionatualaprovadoporrevisãoindependente. Ainda nãoéliberaçãofinanceirado226374.
- Usuárioconfirmouusar226374comoteste;perguntafactualpendentesobre114realvs1141testeemprodução, pois1141foraexplicitamentedeclaradocontorno.

## 2026-11-04 — versão publicada e conferência após alerta sobre Sara

- Publicação 41869523543 concluída às 13:41 BRT e relida independentemente. SHA `Pt8n1Td1BarRUJWuGaQnMcNY5bYXcS8b3TvUaY28U0U=`, revisão `8e19007a-a781-4bad-b4c9-3c749e5b9318`. A alteração de PIX CNPJ da publicação das 11:47 foi preservada; 160 testes, typecheck, bundle e proteções de deploy passaram.
- Nova auditoria do run 41873429982 observou o mesmo pacote ativo às 14:01:49 BRT. Nenhum UpdateFunction posterior encontrado até essa leitura. Repositório consultado ao vivo: main/dev sem publicação de código posterior às bases já conhecidas; a branch de correção está em 274a0a7.
- O dry-run da regularização excepcional da reserva antiga parou em `HTTP RM_READRECORD status=NETWORK_ERROR`, antes de qualquer escrita. Endpoint local 8051 respondeu HTTP 400 sem autenticação; 443 falhou na verificação de nome do certificado. Não mudar porta nem desabilitar TLS para contornar. Diagnóstico do executor deve distinguir rede/TLS sem revelar mensagens remotas ou credenciais.
- 226374 continua sem liberação. Não aplicar a reserva nova com NF1141 enquanto permanece pendente a definição entre o documento real114 e um teste controlado1141 na produção.

## 2026-11-04 — autorização da regularização específica do 226374

- Usuário determinou executar a correção 2 e prosseguir com o número informado no formulário para o ticket de teste 226374. Foi explicitado no retorno que será usado o valor atual 1141, mantendo a série original 1. A regularização não conclui a tarefa Zeev nem cria financeiro.
- Releitura do formulário e renderização local em 17:20 UTC preservaram o digest `dc1348992b3d67d49485a1ab8aef3b9dd7af7c51c0eef2e8f2817766cd1a0d9e`. Não é captura de um corpo HTTP real; o runtime continua validando a requisição completa.
- Causa do 401 da manutenção: credencial do executor. Configurado secret temporário exclusivo RECONCILE_226374_ZEEV_TOKEN com a credencial local já validada, sem alterar TOKEN_ZEEV global nem ambiente Lambda. Remover ao terminar a operação e sua releitura independente.
- Dry-run 41876425609 avançou após autenticação e parou com ValueError antes de qualquer escrita. A data nativa real contém fração de duas casas (15:15:27.53), aceita no Python local, mas incompatível com o parser ISO antigo. Executor fixado em Python 3.12, guard 3.11+ e teste com o dado real, mantendo o bloqueio para alteração posterior à tentativa.
- Preparados workflow de aplicação única e releitura em executor independente. Todos os controles de ausência, fechamento, histórico imutável e CAS permanecem obrigatórios. Não repetir CAS após resposta incerta.
