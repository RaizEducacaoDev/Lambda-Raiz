"""Narrow alternate original-closure proof. Never authorizes a financial write.

Only seven reviewed legacy roots and two fully identified other-ticket chains.
Every empty observation is coupled to a completed native return (or proven
pre-dispatch RESERVED), original source contract, full window census and CAS.
"""
import copy
import datetime as dt
import hashlib
from pathlib import Path
import re
import unicodedata

CODE_PROOF={'version':1,'commit':'40f5cf1','filesSha256':{
 'pagamentoIdentidade.ts':'39c4e7b977eec63a1da2b7d21b21e4ca6bec2018f46b8bd7ee6e529485e776bf',
 'solicitacaoDePagamentoSeguro.ts':'ca7dcc7ee852de452583304e9e54d991eb3e3e80ca4cca432c530daa6428779c',
 'solicitacaoDePagamentoLegado.ts':'453f36b4873d47778fe7acdc8599bb2f4b38fb968826ed2eb37a766d14373d70'},
 'builderDoesNotEmitCreationOrModificationAuditTimestamp':True,'identityDestinationFromCompany2OrCompany':True,
 'rootCompanyUsesPaymentDestination':True,'xmlDestinationAndTicketCheckedBeforeDispatch':True,
 'nonKeyLiteralRequiresAwaitedNativeReturn':True}
CASES={
 (26,223885):('79edb92c-f7f5-4592-8243-cd2859ef6437',[]),
 (2,226025):('aef54ce5-42f8-435c-9e13-00ca997fe72e',[]),
 (8,226348):('8381883b-ec91-4d9a-bea8-3be30b2cdf10',[{'company':8,'idMov':565041,'ticket':228527,'idLans':[870693]}]),
 (11,226530):('7380a79c-0189-495d-81bc-8c3b93718ef2',[]),
 (12,227585):('ca3b06a7-0dd0-4463-9f1f-3ecd0d9ce953',[]),
 (9,226455):('4a422f5f-566c-4f32-895a-00ad2d72041e',[{'company':9,'idMov':100018,'ticket':226412,'idLans':[188576]}]),
 (8,226698):('02598a6b-8a26-496e-bb72-e64cd4ae37d7',[]),
}
OTHER_FIELDS=['codigoDaColigada2','codigoDaFilial2','codigoDoFornecedor','numeroDaNF','serieDaNF',
 'dataDeEmissao','dataDeEntrada','dataDeVencimento','valorTotalDoPagamento','idDoMovimento','idDoLancamento',
 'tipoDoPagamento','tipoDeItem','outrosGastos','tipoDoLocador','contasDeConsumo']

def policy(company,ticket,m):
    m.require((company,ticket) in CASES,'WINDOW_ROOT_NOT_ALLOWLISTED')
    request,exclusions=CASES[(company,ticket)]
    return {'version':1,'contract':'original-return-window-v1','codeProofSha256':m.sha(CODE_PROOF),
      'implementationSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'originalRequestId':request,'exclusions':copy.deepcopy(exclusions)}

def validate_policy(plan,m):
    m.require(plan.get('alternativeOriginalClosure')==policy(plan['company'],plan['ticket'],m) and
      plan.get('action')=='RESERVE_NEW' and 'historicalIdentity' not in plan,'ALTERNATIVE_ORIGINAL_POLICY_INVALID')

def stamp(value,m):
    m.require(isinstance(value,str) and bool(value),'WINDOW_TIMESTAMP_MISSING')
    try:
        parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        # RAIZ.PG.WINDOW returns SQL datetime/datetime2, never datetimeoffset.
        # Independent SQL readback of 226348/226455 proved the RM JSON serializer
        # appends exactly -03:00 without changing those naive wall-clock values.
        # Evidence SHA256: 939716f678f175a645c34aad83cc2a1f213cbea289796fcb3d28b068d97bebea.
        # Do not astimezone(): REQUEST_*_UTC would incorrectly move by +3 hours.
        proven_rm_suffix=value.endswith('-03:00') and parsed.utcoffset()==dt.timedelta(hours=-3)
        m.require(parsed.tzinfo is None or parsed.utcoffset()==dt.timedelta(0) or proven_rm_suffix,'WINDOW_TIMESTAMP_ZONE_INVALID')
        return parsed.replace(tzinfo=None).isoformat(timespec='milliseconds')
    except ValueError:raise m.GateError('WINDOW_TIMESTAMP_INVALID') from None

def epoch_stamp(value):
    return dt.datetime.fromtimestamp(value/1000,dt.timezone.utc).replace(tzinfo=None).isoformat(timespec='milliseconds')

def query_sha():
    text=(Path(__file__).resolve().parents[1]/'sql/pagamento-janela-criacao.sql').read_text(encoding='utf-8-sig').strip()
    return hashlib.sha256(text.encode()).hexdigest()

def original_evidence(original,live,fixed,m):
    ordered=lambda values:sorted(values,key=lambda row:(row['timestamp'],m.sha(row)))
    before=ordered(original['events']);after=ordered(live)
    m.require(original['coverage']['complete'] and before==after and
      sorted(original.get('fixedCodeIndicators',[]))==sorted(fixed),'ORIGINAL_NATIVE_RETURN_NOT_REOBSERVED')
    return {'observedUtc':m.utc(),'sourceCode':copy.deepcopy(CODE_PROOF),'requestId':original['requestId'],
      'originalEvents':before,'readbackEvents':after,'fixedCodeIndicators':sorted(fixed)}

def validate_original(plan,closure,evidence,m):
    m.fresh(evidence.get('observedUtc'));validate_policy(plan,m)
    m.require(evidence.get('sourceCode')==CODE_PROOF and evidence.get('requestId')==closure['originalRequestId']==plan['alternativeOriginalClosure']['originalRequestId'],'ORIGINAL_CODE_OR_REQUEST_MISMATCH')
    events=evidence.get('originalEvents');m.require(isinstance(events,list) and events and events==evidence.get('readbackEvents'),'ORIGINAL_LOG_EVIDENCE_MISSING')
    m.require(all(row.get('requestId')==evidence['requestId'] and type(row.get('timestamp')) is int and
      closure['originalStartMs']<=row['timestamp']<=closure['originalReportMs'] for row in events),'ORIGINAL_EVENT_SCOPE_MISMATCH')
    m.require([r['timestamp'] for r in events if r.get('kind')=='lambda_start']==[closure['originalStartMs']] and
      [r['timestamp'] for r in events if r.get('kind')=='lambda_end']==[closure['originalEndMs']] and
      [r['timestamp'] for r in events if r.get('kind')=='lambda_report']==[closure['originalReportMs']],'ORIGINAL_EVENT_LIFECYCLE_MISMATCH')
    starts=[r for r in events if r.get('event')=='transport_call_started']
    returns=[r for r in events if r.get('event')=='transport_call_returned']
    diagnostics=[r for r in events if r.get('kind')=='non_key_result']
    fixed=evidence.get('fixedCodeIndicators',[])
    m.require(isinstance(fixed,list) and set(fixed)<={'RM_RETURN_WITHOUT_EXPECTED_KEY','CREATION_UNCERTAIN'},'ORIGINAL_FIXED_MARKER_INVALID')
    if plan['expectedRoot']['state']['S']=='RESERVED':
        m.require(not starts and not returns and not diagnostics and not fixed and
          not any(r.get('event') in ('creating_checkpoint_confirmed','primary_key_received','created_checkpoint_confirmed') for r in events) and
          any(r.get('kind')=='payment_pending' and r.get('state')=='RESERVED' and r.get('creationStage')=='preflight' for r in events),'RESERVED_DISPATCH_NOT_EXCLUDED')
    else:
        m.require(plan['expectedRoot']['state']['S']=='CREATING','ORIGINAL_STATE_INVALID')
        m.require(('RM_RETURN_WITHOUT_EXPECTED_KEY' in fixed) or
          (len(starts)==len(returns)==len(diagnostics)==1 and starts[0]['timestamp']<=returns[0]['timestamp']<=diagnostics[0]['timestamp'] and
           re.fullmatch(m.HEX,diagnostics[0].get('responseSha256','')) and diagnostics[0].get('nonKeyResult') is True),'NATIVE_RESPONSE_COMPLETION_NOT_PROVEN')
        m.require(not any(r.get('event') in ('primary_key_received','created_checkpoint_confirmed') for r in events),'ORIGINAL_SUCCESS_MARKER_PRESENT')

def window_rows(rows,plan,closure,m):
    m.require(isinstance(rows,list) and 0<len(rows)<1001,'WINDOW_CENSUS_TRUNCATED')
    start=dt.datetime.fromisoformat(epoch_stamp(closure['originalStartMs']));end=dt.datetime.fromisoformat(epoch_stamp(closure['originalReportMs']))
    expected_times={'REQUEST_START_UTC':start,'REQUEST_END_UTC':end,
      'WINDOW_START_UTC':start-dt.timedelta(seconds=120),'WINDOW_END_UTC':end+dt.timedelta(seconds=120),
      'WINDOW_START_LOCAL':start-dt.timedelta(hours=3,seconds=120),'WINDOW_END_LOCAL':end-dt.timedelta(hours=3)+dt.timedelta(seconds=120)}
    movements=[];launches=[];totals=None
    for row in rows:
        m.require(row.get('WINDOW_VERSION')==1 and row.get('REQUEST_COMPANY')==plan['company'] and row.get('REQUEST_TICKET')==str(plan['ticket']),'WINDOW_PARAMETER_ECHO_MISMATCH')
        m.require(all(stamp(row.get(k),m)==value.isoformat(timespec='milliseconds') for k,value in expected_times.items()),'WINDOW_INTERVAL_MISMATCH')
        counts=(row.get('TOTAL_MOVEMENTS'),row.get('TOTAL_LAUNCHES'))
        m.require(all(type(n) is int and n>=0 for n in counts) and sum(counts)<1001 and (totals is None or counts==totals),'WINDOW_TOTALS_INVALID');totals=counts
        if row.get('ROW_KIND')=='MOV':movements.append(row)
        elif row.get('ROW_KIND')=='LAN':launches.append(row)
        else:m.require(len(rows)==1 and counts==(0,0) and row.get('ROW_KIND') is None and not row.get('IDMOV') and not row.get('IDLAN'),'WINDOW_EMPTY_SENTINEL_INVALID')
    m.require(totals==(len(movements),len(launches)),'WINDOW_COUNT_MISMATCH')
    m.require(len({(r['CODCOLIGADA'],r['IDMOV']) for r in movements})==len(movements) and len({(r['CODCOLIGADA'],r['IDLAN']) for r in launches})==len(launches),'WINDOW_DUPLICATE_IDS')
    move_keys={(r['CODCOLIGADA'],r['IDMOV']) for r in movements}
    for row in movements+launches:
        m.identifier(row.get('CODCOLIGADA'));m.identifier(row.get('IDMOV'));m.identifier(row.get('IDLAN')) if row['ROW_KIND']=='LAN' else None
        m.require(str(row.get('TICKET'))!=str(plan['ticket']),'WINDOW_OWN_TICKET_EFFECT')
        m.require(row['CODCOLIGADA']==plan['company'] and row.get('ORFAO')==0,'WINDOW_FOREIGN_OR_ORPHAN_EFFECT')
        created=dt.datetime.fromisoformat(stamp(row.get('RECCREATEDON'),m))
        inside=expected_times['WINDOW_START_UTC']<=created<=expected_times['WINDOW_END_UTC'] or expected_times['WINDOW_START_LOCAL']<=created<=expected_times['WINDOW_END_LOCAL']
        m.require(inside or row['ROW_KIND']=='LAN' and (row['CODCOLIGADA'],row['IDMOV']) in move_keys,'WINDOW_RECORD_OUTSIDE_SCOPE')
    return movements,launches

def date(value,m):
    m.require(isinstance(value,str) and value.strip(),'OTHER_DATE_MISSING');text=value.strip().split('T')[0].split(' ')[0]
    if re.fullmatch(r'\d{2}/\d{2}/\d{4}',text):text='-'.join(text.split('/')[::-1])
    try:return dt.date.fromisoformat(text).isoformat()
    except ValueError:raise m.GateError('OTHER_DATE_INVALID') from None

def amount(value,m):
    text=str(value)
    if ',' in text:text=text.replace('.','').replace(',','.')
    return m.money(text)

def canonical_movement(row,m,native=False):
    document=row.get('CODTDO');document=None if document in (None,'') else document
    identity=m.identity({'company':row['CODCOLIGADA'],'branch':row['CODFILIAL'],'supplierCompany':row['CODCOLCFO'],
      'supplier':row['CODCFO'],'movementType':row['CODTMV'],'number':row['NUMEROMOV'] if native else row['DOCUMENTO'],
      'series':row['SERIE'],'documentType':document if document is not None else 'NULL-SENTINEL',
      'issueDate':date(row['DATAEMISSAO'],m),'entryDate':date(row['DATASAIDA'],m),'total':amount(row['VALORLIQUIDO'],m)})
    identity['documentType']=document
    return {**identity,'idMov':m.identifier(row['IDMOV']),'ticket':str(row['TICKET']),'status':row['STATUS'],
      'gross':amount(row['VALORBRUTO'],m),'createdOn':stamp(row['RECCREATEDON'],m),'modifiedOn':stamp(row['RECMODIFIEDON'],m)}

def canonical_launch(row,m,native=False):
    optional=lambda v:None if v in (None,'','0',0) else m.identifier(v)
    return {'company':m.identifier(row['CODCOLIGADA']),'branch':m.identifier(row['CODFILIAL']),
      'supplierCompany':m.identifier(row['CODCOLCFO'],True),'supplier':row['CODCFO'],'idMov':m.identifier(row['IDMOV']),
      'idLan':m.identifier(row['IDLAN']),'ticket':str(row['TICKET']),'number':row['NUMERODOCUMENTO'] if native else row['DOCUMENTO'],
      'issueDate':date(row['DATAEMISSAO'],m),'dueDate':date(row['DATAVENCIMENTO'],m),
      'amount':amount(row['VALORORIGINAL'] if native else row['VALOR'],m),'status':str(row['STATUSLAN'] if native else row['STATUS']),
      'paid':amount(row['VALORBAIXADO'],m),'bankId':optional(row.get('IDPGTO')),'bankCompany':optional(row.get('CODCOLPGTO')),
      'createdOn':stamp(row['RECCREATEDON'],m),'modifiedOn':stamp(row['RECMODIFIEDON'],m)}

def other_zeev(data,observed,m):
    values={}
    for row in data['formFields']:
        m.require((row.get('row') or 1)==1 and row['name'] not in values,'OTHER_FORM_AMBIGUOUS');values[row['name']]=row.get('value') or ''
    return {'observedUtc':observed,'ticket':data['id'],'flowId':data['flow']['id'],'active':data['active'],
      'form':values,'workflowSha256':m.sha({k:v for k,v in data.items() if k!='formFields'})}

def other_movement_type(form,m):
    norm=lambda value:''.join(c for c in unicodedata.normalize('NFD',str(value or '').strip()) if not unicodedata.combining(c)).upper()
    kind=norm(form.get('tipoDoPagamento'));code=None
    if kind=='NF':code={'MATERIAL':'1.2.01','SERVICO':'1.2.03'}.get(norm(form.get('tipoDeItem')))
    elif kind=='TM':code='1.2.25'
    elif kind in ('CC','CONTA DE CONSUMO','CONTAS DE CONSUMO'):code={'A':'1.2.09','E':'1.2.10','T':'1.2.11','I':'1.2.11','INTERNET':'1.2.11','G':'1.2.12'}.get(norm(form.get('contasDeConsumo')))
    elif form.get('outrosGastos')=='FR':code='1.2.16'
    else:code={'PF':'1.2.08','PJ':'1.2.17'}.get(form.get('tipoDoLocador'))
    m.require(code is not None,'OTHER_MOVEMENT_TYPE_INVALID');return code

def validate_exclusion(proof,declared,mov,children,m):
    m.fresh(proof.get('observedUtc'));m.require(proof.get('declared')==declared,'OTHER_DECLARATION_CHANGED')
    expected=canonical_movement(mov,m);native=proof.get('movement',{})
    m.require(native==expected and expected['ticket']==str(declared['ticket']) and expected['company']==str(declared['company']) and
      expected['idMov']==str(declared['idMov']) and expected['createdOn']==expected['modifiedOn'],'OTHER_MOVEMENT_NOT_PROVEN')
    complement=proof.get('complement',{})
    m.require(complement=={'company':expected['company'],'idMov':expected['idMov'],'ticket':expected['ticket'],
      'createdOn':stamp(mov.get('COMPLEMENT_CREATED'),m),'modifiedOn':stamp(mov.get('COMPLEMENT_MODIFIED'),m)} and
      complement['createdOn']==complement['modifiedOn']==expected['createdOn'],'OTHER_TICKET_LINK_WAS_MODIFIED')
    normalized=sorted([canonical_launch(row,m) for row in children],key=lambda row:int(row['idLan']))
    m.require(normalized==proof.get('launches') and [int(row['idLan']) for row in normalized]==sorted(declared['idLans']),'OTHER_CHILDREN_NOT_COMPLETE')
    payments=proof.get('payments');m.require(isinstance(payments,list) and len(payments)==len(normalized),'OTHER_PAYMENTS_INCOMPLETE')
    expected_payments=[{'company':row['company'],'idMov':row['idMov'],'idLan':row['idLan'],'dueDate':row['dueDate'],'amount':row['amount']} for row in normalized]
    m.require(payments==expected_payments and all(row['ticket']==expected['ticket'] and row['company']==expected['company'] and row['idMov']==expected['idMov'] for row in normalized),'OTHER_FINANCIAL_CHAIN_MISMATCH')
    m.require(all(all(row[key]==expected[key] for key in ('company','branch','supplierCompany','supplier','issueDate')) for row in normalized),'OTHER_CHILD_IDENTITY_MISMATCH')
    z=proof.get('zeev',{});m.fresh(z.get('observedUtc'));form=z.get('form',{})
    m.require(z.get('ticket')==declared['ticket'] and z.get('flowId')==299 and z.get('active') is True and set(form)<=set(OTHER_FIELDS),'OTHER_ZEEV_CONTEXT_INVALID')
    m.require(len(normalized)==1 and str(form.get('idDoMovimento'))==expected['idMov'] and str(form.get('idDoLancamento'))==normalized[0]['idLan'] and
      str(form.get('codigoDaColigada2'))==expected['company'] and str(form.get('codigoDaFilial2'))==expected['branch'] and form.get('codigoDoFornecedor')==expected['supplier'],'OTHER_ZEEV_LINK_MISMATCH')
    m.require(other_movement_type(form,m)==expected['movementType'],'OTHER_ZEEV_TYPE_MISMATCH')
    number=form.get('numeroDaNF','');m.require(re.fullmatch(r'\d{1,35}',number) and re.fullmatch(r'\d{1,35}',expected['number']) and int(number)==int(expected['number']),'OTHER_ZEEV_DOCUMENT_MISMATCH')
    m.require((not form.get('serieDaNF') or form['serieDaNF']==expected['series']) and date(form.get('dataDeEmissao'),m)==expected['issueDate'] and
      (not form.get('dataDeEntrada') or date(form['dataDeEntrada'],m)==expected['entryDate']) and amount(form.get('valorTotalDoPagamento'),m)==expected['gross']==expected['total'] and
      date(form.get('dataDeVencimento'),m)==normalized[0]['dueDate'] and normalized[0]['amount']==expected['total'],'OTHER_ZEEV_OBLIGATION_MISMATCH')

def validate(plan,proof,closure,m):
    validate_policy(plan,m);m.fresh(proof.get('observedUtc'))
    validate_original(plan,closure,closure.get('originalOutcome',{}),m)
    m.require(proof.get('querySha256')==query_sha() and proof.get('complete') is True and proof.get('committedRead') is True,'WINDOW_SOURCE_NOT_PROVEN')
    movements,launches=window_rows(proof.get('rows'),plan,closure,m)
    declared=plan['alternativeOriginalClosure']['exclusions'];exclusions=proof.get('exclusions')
    m.require(isinstance(exclusions,list) and len(exclusions)==len(declared)==len(movements),'WINDOW_UNEXPLAINED_MOVEMENT')
    allowed_mov={(row['company'],row['idMov']) for row in declared};allowed_lan={(row['company'],lan) for row in declared for lan in row['idLans']}
    m.require({(row['CODCOLIGADA'],row['IDMOV']) for row in movements}==allowed_mov and
      {(row['CODCOLIGADA'],row['IDLAN']) for row in launches}==allowed_lan,'WINDOW_UNEXPLAINED_FINANCIAL_EFFECT')
    for declaration in declared:
        item=[p for p in exclusions if p.get('declared')==declaration];m.require(len(item)==1,'OTHER_PROOF_NOT_UNIQUE')
        mov=next(r for r in movements if (r['CODCOLIGADA'],r['IDMOV'])==(declaration['company'],declaration['idMov']))
        children=[r for r in launches if (r['CODCOLIGADA'],r['IDMOV'])==(declaration['company'],declaration['idMov'])]
        validate_exclusion(item[0],declaration,mov,children,m)
    # Keep every removed current-census row in the immutable proof. Only exact
    # window rows already proven as another ticket may be excluded.
    current=proof.get('currentCensusBefore');m.require(isinstance(current,dict) and set(current)=={'movements','launches'},'CURRENT_CENSUS_BEFORE_MISSING')
    for kind,normalize,window in [('movements',canonical_movement,movements),('launches',canonical_launch,launches)]:
        m.require(isinstance(current[kind],list),'CURRENT_CENSUS_BEFORE_INVALID')
        id_field='IDMOV' if kind=='movements' else 'IDLAN'
        m.require(len({(row['CODCOLIGADA'],row[id_field]) for row in current[kind]})==len(current[kind]),'CURRENT_CENSUS_DUPLICATE_IDS')
        allowed=[normalize(row,m) for row in window]
        m.require(all(normalize(row,m) in allowed for row in current[kind]),'UNEXPLAINED_CURRENT_CENSUS_RECORD')
    return allowed_mov,allowed_lan

def collect(obs,plan,closure,current_mov,current_lan,m,unique,records):
    """Live native query + ReadRecord + other ticket GET, only fixed declarations."""
    validate_policy(plan,m)
    params={'CODCOLIGADA':str(plan['company']),'TICKET':str(plan['ticket']),
      'INICIOUTC':epoch_stamp(closure['originalStartMs']),'FIMUTC':epoch_stamp(closure['originalReportMs'])}
    rows=obs.query('RAIZ.PG.WINDOW',params);observed=m.utc()
    moves,lans=window_rows(rows,plan,closure,m);declared=plan['alternativeOriginalClosure']['exclusions']
    m.require({(row['CODCOLIGADA'],row['IDMOV']) for row in moves}=={(row['company'],row['idMov']) for row in declared} and
      {(row['CODCOLIGADA'],row['IDLAN']) for row in lans}=={(row['company'],lan) for row in declared for lan in row['idLans']},'WINDOW_UNEXPLAINED_EFFECT')
    proofs=[]
    for candidate in declared:
        company,mov=candidate['company'],candidate['idMov'];dataset=obs.read_record('MovMovimentoTBCData',f'{company};{mov}',company)
        header=unique(dataset,'TMOV');compl=unique(dataset,'TMOVCOMPL');header={**header,'TICKET':compl.get('TICKET')}
        complement={'company':m.identifier(compl.get('CODCOLIGADA')),'idMov':m.identifier(compl.get('IDMOV')),'ticket':compl.get('TICKET'),
          'createdOn':stamp(compl.get('RECCREATEDON'),m),'modifiedOn':stamp(compl.get('RECMODIFIEDON'),m)}
        native_lan=[]
        for lan in sorted(candidate['idLans']):
            record=unique(obs.read_record('FinLanDataBR',f'{company};{lan}',company),'FLAN')
            native_lan.append(canonical_launch({**record,'TICKET':compl.get('TICKET')},m,True))
        payments=sorted([{'company':m.identifier(row['CODCOLIGADA']),'idMov':m.identifier(row['IDMOV']),'idLan':m.identifier(row['IDLAN']),
          'dueDate':date(row['DATAVENCIMENTO'],m),'amount':amount(row['VALOR'],m)} for row in records(dataset,'TMOVPAGTO')],key=lambda row:int(row['idLan']))
        # A separate read-only surface is scoped to the one predeclared other
        # ticket; it cannot select an arbitrary ticket from an RM response.
        child=type(obs).__new__(type(obs));child.plan={'ticket':candidate['ticket']};child.zeev_token=obs.zeev_token;child.opener=obs.opener
        data,ztime=child.zeev_snapshot(OTHER_FIELDS)
        proofs.append({'observedUtc':m.utc(),'declared':copy.deepcopy(candidate),'movement':canonical_movement(header,m,True),
          'complement':complement,'launches':native_lan,'payments':payments,'zeev':other_zeev(data,ztime,m)})
    proof={'observedUtc':observed,'querySha256':query_sha(),'complete':True,'committedRead':True,
      'rows':rows,'exclusions':proofs,'currentCensusBefore':{'movements':copy.deepcopy(current_mov),'launches':copy.deepcopy(current_lan)}}
    validate(plan,proof,closure,m)
    # For RESERVE_NEW every current-census result must have been explained by
    # this positive other-ticket proof. Otherwise validate() rejects above.
    return proof,[],[]
