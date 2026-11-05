"""Correlate a fixed error-minute window across pending payment logs. Read-only."""
import datetime as dt,importlib.util,json,time
from pathlib import Path
s=importlib.util.spec_from_file_location('a',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
codes={'OPERACAO_EM_CONFLITO','DADOS_SOLICITACAO_ALTERADOS','MOVIMENTO_RESERVA_DIVERGENTE','OPERACAO_EM_PROCESSAMENTO',
       'ESTADO_TENTATIVA_INVALIDO','NATUREZA_FISCAL_INCOMPATIVEL','IDPGTO_NAO_CONFIRMADO','DADOS_PAGAMENTO_INVALIDOS',
       'FALHA_INTEGRACAO_PAGAMENTO','COMUNICACAO_NAO_CONFIRMADA','FALHA_COMUNICACAO_TOTVS','RESPOSTA_TOTVS_INVALIDA',
       'PRAZO_INTEGRACAO_INSUFICIENTE','FALHA_TECNICA','CONCORRENCIA_DETECTADA','TIMEOUT_OU_CANCELAMENTO','FALHA_COMUNICACAO'}|a.REASONS
a.ENUMS.update(code=codes,reason=codes,origem={'INTEGRACAO','FORMULARIO','TOTVS'},
    etapa={'inicio','identidade_bancaria','validacao_solicitacao','consulta_existente','validacao_bancaria','validacao_documento',
           'validacao_fiscal','controle_tentativa','criacao_movimento','controle_criacao','leitura_movimento','leitura_lancamento',
           'preparacao_vinculo','gravacao_vinculo','confirmacao_vinculo','confirmacao_final'},
    efeito={'MOVIMENTO_CONFIRMADO','CRIACAO_NAO_CONFIRMADA','SEM_MOVIMENTO_CONFIRMADO'})
deadline=time.monotonic()+100
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
out={'localizer':'202611050511-97','readOnly':True,'lambdaInvoked':False,'awsWrites':False,'windows':[]}
for hour in [8,20]:
    start=dt.datetime(2026,11,5,hour,10,tzinfo=dt.timezone.utc);end=start+dt.timedelta(minutes=3)
    events,cov=a.read_log_window('"[RM-IDPGTO]" "Integração pendente"',int(start.timestamp()*1000),int(end.timestamp()*1000),deadline)
    rows=[r for e in events if (r:=a.sanitize(e)) is not None]
    out['windows'].append({'utcStart':start.isoformat(),'utcEnd':end.isoformat(),'coverage':cov,'events':rows})
Path('.0511-readonly').mkdir(exist_ok=True)
Path('.0511-readonly/readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False,indent=2))
