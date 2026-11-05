import base64,copy,importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('timing_probe',ROOT/'scripts/probe-payment-runtime-timing.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def tail():return base64.b64encode(b'PRIVATE_TOKEN bank=PRIVATE_BANK\nREPORT RequestId: 00000000-0000-0000-0000-000000000001\tDuration: 1550.25 ms\tBilled Duration: 1600 ms\tMemory Size: 512 MB\tMax Memory Used: 179 MB\tInit Duration: 211.43 ms\n').decode()
class Fake:
 def __init__(self,mode='ok'):self.mode=mode;self.calls=0
 def config(self):
  return {'FunctionName':m.FUNCTION,'CodeSha256':'changed'if self.mode=='drift'and self.calls else m.BASELINE,'RevisionId':m.REVISION,'State':'Active','LastUpdateStatus':'Successful','Timeout':30,'MemorySize':512,'Environment':{'Variables':{'STAGE':'prod','PAGAMENTO_IDPGTO_TABLE':m.TABLE,'RM_PROD':m.HOST.replace(':8051','')}}}
 def root(self):return {'state':'unexpected'}if self.mode=='mutation'and self.calls else None
 def invoke(self):
  self.calls+=1
  if self.mode=='timeout':raise TimeoutError('PRIVATE_NETWORK')
  return {'StatusCode':200,'LogResult':tail()},{'statusCode':503,'body':json.dumps({'code':'PRE_VALIDACAO_INDISPONIVEL','message':'PRIVATE_MESSAGE'})}

class TimingSafety(unittest.TestCase):
 def test_fixed_scope_and_source_order(self):
  self.assertTrue(m.static_fence()['documentBeforeReservation']);p=m.payload()
  self.assertEqual(p['codigoDaFilial2'],'2147483648');self.assertEqual(p['ticketRaiz'],'999999990048')
  self.assertEqual(p['tipoDeItem'],'Serviço');self.assertNotIn('idDoMovimento',p)
 def test_real_source_reaches_document_without_any_write(self):
  proof=m.offline_proof(m.payload());self.assertTrue(proof['reachedDocument']);self.assertEqual(proof['creatorCalls'],0)
 def test_current_built_code_fails_before_core_or_mutation(self):
  path=ROOT/'.build/solicitacaoDePagamento.cjs'
  if not path.exists():self.skipTest('npm run build:pagamento is required for bundle proof')
  proof=m.offline_proof(m.payload(),path.read_text(encoding='utf-8'));self.assertTrue(proof['reachedDocument']);self.assertEqual(proof['legacyCoreLoads'],0)
 def test_active_legacy_generic_503_code_preserves_the_same_negative_fence(self):
  path=ROOT/'.build/solicitacaoDePagamento.cjs'
  if not path.exists():self.skipTest('npm run build:pagamento is required for bundle proof')
  legacy_code=path.read_text(encoding='utf-8').replace('PRE_VALIDACAO_INDISPONIVEL','IDPGTO_NAO_CONFIRMADO')
  proof=m.offline_proof(m.payload(),legacy_code)
  self.assertEqual(proof['code'],'IDPGTO_NAO_CONFIRMADO');self.assertTrue(proof['reachedDocument']);self.assertEqual(proof['dynamoMutationCalls'],0)
  result=m.safe_response({'StatusCode':200},{'statusCode':503,'body':'{"code":"IDPGTO_NAO_CONFIRMADO"}'})
  self.assertEqual(result['code'],'IDPGTO_NAO_CONFIRMADO')
 def test_report_exports_numbers_only(self):
  value=m.parse_report(tail());self.assertEqual(value['durationMs'],1550.25);self.assertEqual(value['initDurationMs'],211.43)
  self.assertNotIn('PRIVATE',json.dumps(value));self.assertNotIn('RequestId',json.dumps(value))
 def test_three_guarded_invocations_and_no_raw_logs_in_evidence(self):
  client=Fake();evidence={'iterations':[]};m.run_guarded(client,evidence,lambda _:None)
  self.assertEqual(client.calls,3);self.assertTrue(all(x['rootAbsentAfter']for x in evidence['iterations']))
  self.assertNotIn('PRIVATE',json.dumps(evidence));self.assertNotIn('LogResult',json.dumps(evidence))
 def test_any_mutation_drift_or_lost_response_stops_after_one(self):
  for mode in('mutation','drift','timeout'):
   client=Fake(mode)
   with self.assertRaises(m.ProbeError):m.run_guarded(client,{'iterations':[]},lambda _:None)
   self.assertEqual(client.calls,1)
 def test_successful_financial_response_is_forbidden(self):
  with self.assertRaises(m.ProbeError):m.safe_response({'StatusCode':200},{'statusCode':200,'body':'{"PG":"123"}'})
  with self.assertRaises(m.ProbeError):m.safe_response({'StatusCode':200},{'statusCode':503,'body':'{"PG":"123","code":"PRE_VALIDACAO_INDISPONIVEL"}'})
 def test_arbitrary_aws_write_cannot_be_called(self):
  with self.assertRaises(m.ProbeError):m.Client().aws('dynamodb','put-item')
  with self.assertRaises(m.ProbeError):m.Client().aws('lambda','update-function-code')

if __name__=='__main__':unittest.main(verbosity=2)
