import copy, importlib.util, pathlib, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('lease',pathlib.Path(__file__).resolve().parents[1]/'scripts/lease-payment-bank-backlog.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LeaseTests(unittest.TestCase):
 def setUp(self):
  self.before={'pk':{'S':'prod#PG#5#228007'},'owner':{'S':'old'},'lockUntil':{'N':'1000'},'state':{'S':'CREATED'},'pg':{'S':'165611'},'digest':{'S':'a'*64}}
 def test_only_lease_fields_change_and_every_before_field_is_guarded(self):
  r=m.request(self.before,'new',2000)
  self.assertEqual(r['UpdateExpression'],'SET #owner = :newOwner, lockUntil = :newUntil')
  self.assertIn('attribute_not_exists(protocolVersion)',r['ConditionExpression'])
  self.assertEqual(set(v for k,v in r['ExpressionAttributeNames'].items() if k.startswith('#b')),set(self.before))
  for i,v in enumerate(sorted(self.before.items())):self.assertEqual(r['ExpressionAttributeValues'][f':b{i}'],v[1])
 def test_lost_ack_reads_back_without_second_update(self):
  expected={**self.before,'owner':{'S':'new'},'lockUntil':{'N':'2000'}}
  with patch.object(m,'aws',side_effect=TimeoutError) as call,patch.object(m,'get',return_value=expected):
   actual,lost=m.checked_update(self.before,'new',2000)
  self.assertEqual(actual,expected);self.assertTrue(lost);self.assertEqual(call.call_count,1)
 def test_unknown_result_does_not_retry(self):
  changed={**self.before,'state':{'S':'COMPLETE'}}
  with patch.object(m,'aws',side_effect=TimeoutError) as call,patch.object(m,'get',return_value=changed):
   with self.assertRaisesRegex(RuntimeError,'NOT_CONFIRMED'):m.checked_update(self.before,'new',2000)
  self.assertEqual(call.call_count,1)
 def proof(self):
  return {'ticket':228007,'company':5,'idmov':165611,'idlan':634500,'archiveKey':'archive','before':self.before,
   'leasedRoot':{**self.before,'owner':{'S':'new'},'lockUntil':{'N':'2000'}}}
 def test_release_rejects_business_mutation(self):
  p=self.proof();p['leasedRoot']['digest']={'S':'b'*64}
  with patch.object(m,'aws') as call:
   with self.assertRaisesRegex(RuntimeError,'BUSINESS_CHANGED'):m.release(p)
  call.assert_not_called()
 def test_release_never_overwrites_concurrent_progress(self):
  p=self.proof();archive={'original':{'M':p['before']},'leaseOwner':p['leasedRoot']['owner'],'leaseUntil':p['leasedRoot']['lockUntil']}
  with patch.object(m,'get',side_effect=[archive,{**p['leasedRoot'],'state':{'S':'COMPLETE'}}]),patch.object(m,'checked_update') as update:
   with self.assertRaisesRegex(RuntimeError,'LEASE_CHANGED'):m.release(p)
  update.assert_not_called()
if __name__=='__main__':unittest.main()
