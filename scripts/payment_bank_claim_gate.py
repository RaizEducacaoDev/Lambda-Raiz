"""One-shot bank claims, including one explicitly adjudicated manual correction.

No write operations. The original 228007 claim stays intact. Its second key is
available only after the immutable no-effect receipt validates the exact old
attempt; neither a missing claim nor expiry of its lease authorizes a retry.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_no_effect_receipt_contract', ROOT / 'scripts/adjudicate-payment-bank-no-effect.py')
receipt_contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt_contract)
TARGETS = {228007:5,227386:18,226610:25,228103:8,228158:8,228198:8,228275:8,228793:2}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def attempt_key(company, ticket):
    require(type(ticket) is int and type(company) is int and TARGETS.get(ticket) == company,
            'BANK_CLAIM_SCOPE_INVALID')
    if ticket == 228007:
        return receipt_contract.NEXT_ATTEMPT_KEY
    return f'prod#PG#{company}#{ticket}#BANK_REPAIR_ATTEMPT'


def assert_ready(get, company, ticket):
    key = attempt_key(company, ticket)
    if ticket == 228007:
        old_claim = get(receipt_contract.OLD_ATTEMPT_KEY)
        # Receipt key is derived from the complete immutable old claim.
        receipt_key = receipt_contract.receipt_key(old_claim)
        receipt = get(receipt_key)
        receipt_contract.validate_manual_retry_receipt(receipt, old_claim)
        require(receipt.get('nextAttemptKey') == {'S': key}, 'MANUAL_BANK_ATTEMPT_KEY_MISMATCH')
    require(get(key) == {}, 'DURABLE_BANK_ATTEMPT_ALREADY_EXISTS_NO_RETRY')
    return key


def assert_diagnostic_ready(get, company, ticket, proof, before_lease=False):
    require(type(company)is int and type(ticket)is int and(company,ticket)==(5,228007), 'DIAGNOSTIC_EXACT_TARGET_REQUIRED')
    spec=importlib.util.spec_from_file_location('bank_diagnostic_contract',ROOT/'scripts/payment_bank_diagnostic_contract.py')
    contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
    return contract.assert_controls(get,proof,before_lease)
