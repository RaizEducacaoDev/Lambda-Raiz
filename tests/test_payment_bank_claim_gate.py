"""Offline boundaries for the single manually adjudicated bank retry."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_claim_gate_test', ROOT / 'scripts/payment_bank_claim_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
c = gate.receipt_contract


def fixture():
    claim = {'pk':{'S':c.OLD_ATTEMPT_KEY},'nonce':{'S':'11111111-1111-1111-1111-111111111111'},
      'ticket':{'N':'228007'},'company':{'N':'5'},'idlan':{'N':'634500'},'leaseOwner':{'S':c.LEASE_OWNER},
      'planSha256':{'S':c.PLAN_SHA},'targetFieldsSha256':{'S':c.sha({'IDPGTO':'1','CODCOLPGTO':'5'})},
      'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},'observedUtc':{'S':'2026-11-04T20:22:00+00:00'}}
    receipt = c.make_receipt(claim, '2026-11-04T20:45:00+00:00',
      'https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41909999999')
    return {c.OLD_ATTEMPT_KEY:claim, c.receipt_key(claim):receipt}


class Tests(unittest.TestCase):
    def test_original_claim_is_preserved_and_distinct_second_key_requires_receipt(self):
        data=fixture();before=copy.deepcopy(data)
        key=gate.assert_ready(lambda key:data.get(key,{}),5,228007)
        self.assertEqual(key,c.NEXT_ATTEMPT_KEY)
        self.assertNotEqual(key,c.OLD_ATTEMPT_KEY)
        self.assertEqual(data,before)

    def test_missing_or_changed_old_claim_never_allows_retry(self):
        for replacement in ({},{'state':{'S':'EXPIRED'}}):
            data=fixture();data[c.OLD_ATTEMPT_KEY]=replacement
            with self.assertRaises(c.GuardError): gate.assert_ready(lambda key:data.get(key,{}),5,228007)

    def test_missing_receipt_blocks_even_when_old_lease_has_expired(self):
        data=fixture();data.pop(c.receipt_key(data[c.OLD_ATTEMPT_KEY]))
        with self.assertRaises(c.GuardError): gate.assert_ready(lambda key:data.get(key,{}),5,228007)

    def test_changed_receipt_and_automatic_retry_permission_are_rejected(self):
        for field,value in [('state',{'S':'UNKNOWN'}),('automaticRetryAllowed',{'BOOL':True}),
                            ('nextAttemptKey',{'S':c.OLD_ATTEMPT_KEY}),('oldClaimSha256',{'S':'0'*64})]:
            data=fixture();data[c.receipt_key(data[c.OLD_ATTEMPT_KEY])][field]=value
            with self.subTest(field=field),self.assertRaises(c.GuardError):
                gate.assert_ready(lambda key:data.get(key,{}),5,228007)

    def test_second_attempt_is_one_shot_even_after_another_unknown_outcome(self):
        data=fixture();data[c.NEXT_ATTEMPT_KEY]={'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'}}
        with self.assertRaisesRegex(RuntimeError,'ALREADY_EXISTS'):
            gate.assert_ready(lambda key:data.get(key,{}),5,228007)

    def test_other_seven_targets_use_original_one_shot_key(self):
        for ticket,company in gate.TARGETS.items():
            if ticket==228007: continue
            expected=f'prod#PG#{company}#{ticket}#BANK_REPAIR_ATTEMPT'
            self.assertEqual(gate.assert_ready(lambda key:{},company,ticket),expected)
            with self.assertRaisesRegex(RuntimeError,'ALREADY_EXISTS'):
                gate.assert_ready(lambda key:{'exists':True},company,ticket)

    def test_unknown_ticket_wrong_company_and_boolean_id_are_rejected(self):
        for company,ticket in [(5,999999),(18,228007),(True,228007),(5,True)]:
            with self.assertRaisesRegex(RuntimeError,'SCOPE_INVALID'): gate.attempt_key(company,ticket)


if __name__=='__main__': unittest.main()
