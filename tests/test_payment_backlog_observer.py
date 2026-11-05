"""Read-only observer contract tests; all external calls are replaced with fixtures."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
import urllib.error
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('observer',ROOT/'scripts/observe-payment-backlog.py')
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)
spec=importlib.util.spec_from_file_location('operator_fixtures',ROOT/'tests/test_payment_backlog_recovery.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

def dataset(name,rows):
    root=o.ET.Element('Dataset')
    for row in rows:
        record=o.ET.SubElement(root,name)
        for k,v in row.items():
            if v is not None:o.ET.SubElement(record,k).text=str(v)
    return root

class FakeObserver(o.Observer):
    def __init__(self,plan,proof):
        self.plan=plan;self.fixture=copy.deepcopy(proof);self.calls=[]
        self.template='{"codigoDaColigada2":"{Form.codigoDaColigada2}","codigoDaFilial2":"{Form.codigoDaFilial2}"}'
        self.rm_auth='fixture';self.zeev_token='fixture';self.rm_user='fixture'

    def config(self):self.calls.append('config');return dict(self.fixture['runtime'])
    def contracts(self):self.calls.append('contracts')
    def closure(self):return copy.deepcopy(self.fixture['closure'])
    def http(self,*args,**kwargs):
        self.calls.append('zeev')
        return json.dumps({'id':self.plan['ticket'],'active':True,'flow':{'id':299},'instanceTasks':[{'id':3,'active':True,'task':{'id':4}}],'formFields':[
            {'name':'codigoDaColigada2','value':str(self.plan['company'])},{'name':'codigoDaFilial2','value':'1'}]}).encode()

    def node(self,payload):
        identity=self.fixture['identity'];bank=self.fixture['bank']
        result={'valid':True,'key':{'codColPgto':identity['company'],'codColCfo':identity['supplierCompany'],'codCfo':identity['supplier'],'idPgto':int(bank['id'])},
            'type':identity['movementType'],'digest':self.fixture['zeev']['currentDigest'],'plans':self.fixture['plans'],
            'issueDate':identity['issueDate'],'entryDate':identity['entryDate'],'total':identity['total'],'fiscalKey':None,
            'documentKey':{'codColigada':identity['company'],'codFilial':identity['branch'],'codColCfo':identity['supplierCompany'],'codCfo':identity['supplier'],'codTmv':identity['movementType'],'numero':identity['number'],'serie':identity['series']}}
        if payload.get('bank'):result['validation']={'payload':True,'bank':True,'document':True,'fiscal':True}
        return result

    def read_record(self,server,key,company):
        self.calls.append(server);identity=self.fixture['identity'];bank=self.fixture['bank']
        if server=='FinDadosPgtoDataBR':return dataset('FDadosPgto',[{'CODCOLIGADA':bank['company'],'CODCOLCFO':bank['supplierCompany'],'CODCFO':bank['supplier'],'IDPGTO':bank['id'],'FORMAPAGAMENTO':bank['paymentCode'],'ATIVO':'1','CHAVEPIX':'private-not-exported'}])
        common={'CODCOLIGADA':identity['company'],'CODFILIAL':identity['branch'],'CODCOLCFO':identity['supplierCompany'],'CODCFO':identity['supplier'],'IDMOV':'165611','DATAEMISSAO':identity['issueDate']+'T00:00:00'}
        if server=='MovMovimentoTBCData':
            root=dataset('TMOV',[{**common,'CODTMV':identity['movementType'],'NUMEROMOV':identity['number'],'SERIE':identity['series'],'CODTDO':identity['documentType'],'DATASAIDA':identity['entryDate']+'T00:00:00','VALORBRUTO':identity['total'],'VALORLIQUIDO':identity['total'],'STATUS':'F'}])
            c=o.ET.SubElement(root,'TMOVCOMPL')
            for k,v in {'CODCOLIGADA':identity['company'],'IDMOV':'165611','TICKET':str(self.plan['ticket'])}.items():o.ET.SubElement(c,k).text=v
            return root
        if server=='FinLanDataBR':
            row=next(x for x in self.fixture['native']['launches'] if x['idLan']==key.split(';')[1])
            return dataset('FLAN',[{**common,'IDLAN':row['idLan'],'DATAVENCIMENTO':row['dueDate'],'VALORORIGINAL':row['amount'],'VALORBAIXADO':'0','STATUSLAN':'0','BAIXAPENDENTE':'0'}])
        raise AssertionError('unexpected fixture server')

    def query(self,code,params):
        self.calls.append(code);identity=self.fixture['identity'];native=self.fixture['native']
        if code=='RAIZ.PG.DOC2':
            row={'EFFECTIVE_NUMBER':identity['number'],'EFFECTIVE_SERIES':identity['series'],'EFFECTIVE_DOCUMENT_TYPE':identity['documentType']}
            if native['movements']:row.update(CODCOLIGADA=self.plan['company'],IDMOV=165611,TICKET=str(self.plan['ticket']))
            return [row]
        if code=='RAIZ.PG.RETRY':
            base={'RETOMADA_VERSION':1,'REQUEST_COMPANY':self.plan['company'],'REQUEST_TICKET':str(self.plan['ticket']),'TOTAL_MOVEMENTS':len(native['movements']),'TOTAL_LAUNCHES':len(native['launches'])}
            return [{**base,'ROW_KIND':'MOV','CODCOLIGADA':self.plan['company'],'IDMOV':165611} for _ in native['movements']]+[{**base,'ROW_KIND':'LAN','CODCOLIGADA':self.plan['company'],'IDMOV':165611,'IDLAN':int(x['idLan']),'BOLETO_COUNT':0} for x in native['launches']] or [{**base,'ROW_KIND':'EMPTY'}]
        if code=='RAIZ.PG.CENSO':
            echo={'OBS_VERSION':1,'REQUEST_COMPANY':self.plan['company'],'REQUEST_SUPPLIER_COMPANY':int(params['CODCOLCFO']),
                'REQUEST_SUPPLIER':params['CODCFO'],'REQUEST_TICKET':str(self.plan['ticket']),'REQUEST_NUMBER':params['NUMERO'],
                'REQUEST_ISSUE':params['EMISSAO'],'REQUEST_START':params['INICIO'],'REQUEST_END':params['FIM'],
                'TOTAL_MOVEMENTS':len(native['movements']),'TOTAL_LAUNCHES':len(native['launches'])}
            common={'CODCOLIGADA':self.plan['company'],'CODFILIAL':int(identity['branch']),'CODCOLCFO':int(identity['supplierCompany']),
                'CODCFO':identity['supplier'],'IDMOV':165611,'CODTMV':identity['movementType'],'SERIE':identity['series'],'CODTDO':identity['documentType'],
                'DATAEMISSAO':identity['issueDate'],'DATASAIDA':identity['entryDate'],'VALORBRUTO':identity['total'],'VALORLIQUIDO':identity['total'],'TICKET':str(self.plan['ticket'])}
            rows=[{**echo,**common,'ROW_KIND':'MOV','DOCUMENTO':identity['number'],'STATUS':'F'} for _ in native['movements']]
            for row in native['launches']:rows.append({**echo,**common,'ROW_KIND':'LAN','DOCUMENTO':identity['number']+'/01','STATUS':'0','IDLAN':int(row['idLan']),
                'DATAVENCIMENTO':row['dueDate'],'VALOR':row['amount'],'VALORBAIXADO':'0','BAIXAPENDENTE':0,'BOLETO_COUNT':0,'IDPGTO':None,'CODCOLPGTO':None,'IDBOLETO':None})
            return rows or [{**echo,'ROW_KIND':None}]
        raise AssertionError('unexpected fixture query')

class ObserverTests(unittest.TestCase):
    def batched_fixture(self):
        observer=o.Observer.__new__(o.Observer);observer.plan={'ticket':225136};observer.zeev_token='fixture';calls=[]
        names=['field'+str(i).zfill(3)+'LongName'*3 for i in range(90)]
        def response(url,*args,**kwargs):
            selected=o.urllib.parse.parse_qs(o.urllib.parse.urlsplit(url).query)['formFieldNames'];calls.append(url)
            return json.dumps({'id':225136,'active':True,'flow':{'id':299},'startDateTime':'2026-10-23T08:00:00',
                'instanceTasks':[{'id':10,'active':True,'task':{'id':40,'name':'Fiscal'}}],
                'formFields':[{'name':name,'row':row,'value':name+str(row)} for name in selected for row in (1,2)]}).encode()
        observer.http=response
        return observer,names,calls,response

    def test_zeev_short_batches_reread_every_field_and_preserve_all_table_rows(self):
        observer,names,calls,_=self.batched_fixture();data,started=observer.zeev_snapshot(names)
        self.assertEqual(len(data['formFields']),180);self.assertGreater(len(calls),2)
        self.assertTrue(all(len(url)<=1400 for url in calls))
        for name in names:self.assertEqual(sum(name in o.urllib.parse.parse_qs(o.urllib.parse.urlsplit(url).query)['formFieldNames'] for url in calls),2)
        self.assertLessEqual(o.dt.datetime.fromisoformat(started),o.dt.datetime.fromisoformat(o.m.utc()))

    def test_zeev_batch_mixed_tasks_fields_and_unrequested_names_fail_closed(self):
        for target in ('task','field','unexpected'):
            with self.subTest(target=target):
                observer,names,calls,response=self.batched_fixture()
                def changed(url,*args,**kwargs):
                    data=json.loads(response(url,*args,**kwargs))
                    if target=='task' and len(calls)==2:data['instanceTasks'][0]['id']=11
                    elif target=='field' and calls.count(url)==2:data['formFields'][0]['value']='changed'
                    elif target=='unexpected':data['formFields'][0]['name']='unrequested'
                    return json.dumps(data).encode()
                observer.http=changed
                with self.assertRaisesRegex(o.m.GateError,{'task':'HEADER_OR_TASKS_CHANGED','field':'FIELDS_CHANGED','unexpected':'UNREQUESTED_FIELD'}[target]):observer.zeev_snapshot(names)

    def closure_fixture(self):
        plan,proof=f.fixtures();observer=o.Observer.__new__(o.Observer)
        closure=proof['closure'];request=closure['originalRequestId'];plan['auditSha256']='e'*64
        observer.plan=plan;observer.request=request;observer.deadline=time.monotonic()+20
        observer.audit_end=int(time.time()*1000)-1000
        events=[{'timestamp':closure['originalStartMs'],'message':f'START RequestId: {request} Version: $LATEST'},
                {'timestamp':closure['originalEndMs'],'message':f'END RequestId: {request}'},
                {'timestamp':closure['originalReportMs'],'message':f'REPORT RequestId: {request} Duration: 2000 ms'}]
        observer.original={'events':[o.a.sanitize(e) for e in events]}
        return observer,events

    def test_closure_reobserves_original_and_refreshes_both_dispatch_markers(self):
        observer,events=self.closure_fixture()
        with patch.object(o.a,'read_log_window',side_effect=[(events,{'complete':True}),([],{'complete':True}),([],{'complete':True})]) as read:
            proof=observer.closure()
        self.assertEqual(proof['laterDispatches'],0);self.assertEqual(read.call_count,3)
        self.assertIn('SaveRecord',read.call_args_list[1].args[0]);self.assertIn('transport_call_started',read.call_args_list[2].args[0])
        self.assertGreaterEqual(read.call_args_list[1].args[1],observer.audit_end-60000)

    def test_later_dispatch_or_incomplete_log_coverage_blocks_recovery(self):
        observer,events=self.closure_fixture()
        later={'timestamp':int(time.time()*1000)-500,'message':'00000000-0000-4000-8000-000000000001 [RM-DIAG] '+json.dumps({'ticket':observer.plan['ticket'],'etapa':'SaveRecord','evento':'inicio'})}
        with patch.object(o.a,'read_log_window',side_effect=[(events,{'complete':True}),([later],{'complete':True})]):
            with self.assertRaisesRegex(o.m.GateError,'LATER_NATIVE_DISPATCH'):observer.closure()
        with patch.object(o.a,'read_log_window',side_effect=[(events,{'complete':True}),([],{'complete':False})]):
            with self.assertRaisesRegex(o.m.GateError,'INCREMENTAL_LOG'):observer.closure()
        with patch.object(o.a,'read_log_window',return_value=(events[:2],{'complete':True})):
            with self.assertRaisesRegex(o.m.GateError,'CLOSURE_NOT_REOBSERVED'):observer.closure()

    def test_audit_baseline_is_immutable_and_covers_full_original_to_cutoff(self):
        observer,events=self.closure_fixture();plan=observer.plan
        start=events[0]['timestamp'];end=observer.audit_end
        audit={'coverageComplete':True,'observedUtc':o.dt.datetime.fromtimestamp(end/1000,o.dt.timezone.utc).isoformat(),
            'tickets':[{'company':plan['company'],'ticket':plan['ticket'],'root':plan['expectedRoot'],'unknownAttributes':[],
                'originalRequestCandidates':[observer.request],'laterDispatchRequestIds':[],
                'allDispatches':[{'requestId':observer.request,'timestamp':start+100}]}],
            'originalRequests':[{'requestId':observer.request,'coverage':{'complete':True},'events':observer.original['events']}],
            'logWindows':[{'pattern':pattern,'startMs':start-1000,'endMs':end,'coverage':{'complete':True}}
                          for pattern in ('"[RM-DIAG]" "SaveRecord"','"transport_call_started"')]}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'audit.json';path.write_text(json.dumps(audit),encoding='utf-8')
            plan.update(auditFile=str(path),auditSha256=o.hashlib.sha256(path.read_bytes()).hexdigest(),templateSha256=o.template_sha())
            o.Observer(plan)
            audit['logWindows'][0]['startMs']=start+1000;path.write_text(json.dumps(audit),encoding='utf-8')
            with self.assertRaisesRegex(o.m.GateError,'AUDIT_SOURCE_CHANGED'):o.Observer(plan)
            plan['auditSha256']=o.hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(o.m.GateError,'AUDIT_WINDOW_GAP'):o.Observer(plan)

    def test_render_keeps_quotes_unicode_and_distinct_table_rows(self):
        template='{"text":"{Form.note}","ticket":"{Instance.Id}","rows":[{Form.Loop.amount}{"amount":"{Form.amount}"}{/Form.Loop.amount}],"lookup":"{DataSource.x}"}'
        data={'id':225573,'formFields':[{'name':'note','value':'A "nota" ação\\fim'},
          {'name':'amount','row':1,'value':'10,00'},{'name':'amount','row':2,'value':'20,00'}]}
        payload,form=o.render(data,template)
        self.assertEqual(payload['text'],data['formFields'][0]['value']);self.assertEqual(payload['rows'],[{'amount':'10,00'},{'amount':'20,00'}]);self.assertEqual(payload['lookup'],'')
        data['formFields'].append({'name':'amount','row':1,'value':'100'})
        with self.assertRaisesRegex(o.m.GateError,'DUPLICATE'):o.render(data,template)

    def test_xml_duplicate_fields_or_entities_are_rejected(self):
        with self.assertRaises(o.m.GateError):o.xml_dataset('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]><x/>')
        with self.assertRaises(o.m.GateError):o.unique(o.xml_dataset('<x><TMOV><IDMOV>1</IDMOV><IDMOV>2</IDMOV></TMOV></x>'),'TMOV')

    def test_composed_live_observation_normalizes_both_sources_for_operator(self):
        for adopt in (False,True):
            with self.subTest(adopt=adopt):
                plan,proof=f.fixtures(adopt);observer=FakeObserver(plan,proof)
                result=observer.observe(plan)
                plan['expectedObservationSha256']=result['sourceReadbackSha256']
                o.m.validate_observation(plan,result)
                self.assertNotIn('private-not-exported',json.dumps(result));self.assertFalse(result['reconstruction']['capturedHttp'])
                self.assertIn('RAIZ.PG.CENSO',observer.calls)
                if adopt:self.assertIn('MovMovimentoTBCData',observer.calls);self.assertEqual(observer.calls.count('FinLanDataBR'),2)

    def test_independent_extra_candidate_stops_before_an_adoptable_proof(self):
        plan,proof=f.fixtures(True);observer=FakeObserver(plan,proof);original=observer.query
        def extra(code,params):
            rows=original(code,params)
            if code=='RAIZ.PG.CENSO':
                candidate=copy.deepcopy(rows[0]);candidate.update(IDMOV=45178,TICKET=None);rows.append(candidate)
                for row in rows:row['TOTAL_MOVEMENTS']=2
            return rows
        observer.query=extra
        with self.assertRaisesRegex(o.m.GateError,'CENSUS_DIFFERS'):observer.observe(plan)

    def test_native_bank_key_change_alters_proof_even_with_same_id_and_modality(self):
        plan,proof=f.fixtures();observer=FakeObserver(plan,proof);original=observer.read_record
        current=['first-private-key']
        def read(server,key,company):
            result=original(server,key,company)
            if server=='FinDadosPgtoDataBR':o.ET.SubElement(result.find('FDadosPgto'),'CHAVE').text=current[0]
            return result
        observer.read_record=read
        before=observer.observe(plan);current[0]='changed-private-key';after=observer.observe(plan)
        self.assertNotEqual(before['bankDetailsSha256'],after['bankDetailsSha256'])
        plan['expectedObservationSha256']=before['sourceReadbackSha256']
        with self.assertRaisesRegex(o.m.GateError,'CONTENT_CHANGED'):o.m.validate_observation(plan,after)
        self.assertNotIn('changed-private-key',json.dumps(after))

    def test_census_rejects_partial_pages_and_wrong_parameter_echo(self):
        plan,proof=f.fixtures();observer=FakeObserver(plan,proof)
        params={'CODCOLIGADA':'1','CODCOLCFO':'0','CODCFO':'0000157430','TICKET':'225136','NUMERO':'18','EMISSAO':'2026-10-23','INICIO':'2026-10-29T12:00:00','FIM':'2026-10-29T15:00:00'}
        rows=observer.query('RAIZ.PG.CENSO',params)
        self.assertEqual(o.census_rows(rows,params),([],[]))
        rows[0]['REQUEST_TICKET']='another'
        with self.assertRaises(o.m.GateError):o.census_rows(rows,params)
        rows=observer.query('RAIZ.PG.CENSO',params);rows[0]['TOTAL_LAUNCHES']=1
        with self.assertRaises(o.m.GateError):o.census_rows(rows,params)
        with self.assertRaises(o.m.GateError):o.census_rows([rows[0]]*1001,params)

    def test_write_routes_are_rejected_before_open_and_http_errors_are_sanitized(self):
        observer=o.Observer.__new__(o.Observer);observer.plan={'ticket':225136};observer.opener=Mock()
        with self.assertRaises(o.m.GateError):observer.http(o.HOST+'/wsDataServer/IwsDataServer','RM_READRECORD',b'<SaveRecord/>')
        with self.assertRaises(o.m.GateError):observer.http(o.ZEEV+'/api/2/instances/225136/approve','ZEEV',b'{}')
        observer.opener.open.assert_not_called()
        observer.opener.open.side_effect=urllib.error.HTTPError('https://private/?token=SECRET',401,'private SECRET',{},io.BytesIO(b'SECRET'))
        with self.assertRaises(o.m.GateError) as caught:observer.http(o.ZEEV+'/api/2/instances/225136?x=y','ZEEV')
        self.assertEqual(str(caught.exception),'HTTP_ZEEV_401');self.assertNotIn('SECRET',str(caught.exception))

    def test_node_uses_real_identity_and_document_preflight_without_network(self):
        observer=o.Observer.__new__(o.Observer)
        form={'codigoDaColigada2':'1','codigoDaFilial2':'1','codigoDoFornecedor':'0000157430','idpgto':'1',
          'idPagamento':'1$_$0$_$0000157430$_$1','codcolpgto':'1','qtdParcelas':'1','formaDePagamento':'Transferência Bancária','codigoPagamento':'Y'}
        payload={**form,'CODCOLPGTO':'1','tipoDaSolicitacao':'PG','tipoDoPagamento':'NF','tipoDeItem':'Serviço','numeroDaNF':'18','serie':'',
          'ticketRaiz':'225136','dataDeEmissao':'23/10/2026','dataDeEntrada':'23/10/2026','dataDeVencimento':'10/11/2026','valorTotal':'100,00',
          'itens':[{'codigoDoItem':'4538','codigoDaNatureza':'02.10.00008','qtdDoItem':'1','valorDoItem':'100,00'}]}
        result=observer.node({'payload':payload,'form':form})
        self.assertTrue(result['valid']);self.assertEqual(result['type'],'1.2.03');self.assertEqual(result['plans'][0]['dueDate'],'2026-11-10')
        payload['dataDeEntrada']=''
        self.assertEqual(observer.node({'payload':payload,'form':form})['entryDate'],'')
        payload['dataDeEmissao']=''
        with self.assertRaises(o.m.GateError):observer.node({'payload':payload,'form':form})

if __name__=='__main__':unittest.main()
