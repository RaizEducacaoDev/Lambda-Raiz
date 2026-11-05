# Remote existing-launch bank repair

`repair-payment-bank-backlog.py` defaults to read-only and is restricted to the eight exact ticket/company/MOV/FLAN chains in `TARGETS`. It uses the installed native `RAIZ.PG.BANK2` and `RAIZ.PG.DOC2` contracts, verified against the repository text, and independent `MovMovimentoTBCData` / `FinLanDataBR` reads. Full RM records and banking values stay in memory; output contains identifiers, status, field names and fingerprints.

The executor requires Python3.12, Node dependencies used by `tests/load-ts.cjs`, AWS CLI credentials for the existing production account, and the temporary `RECONCILE_ZEEV_TOKEN` environment secret. RM credentials are read from the exact production Lambda configuration in memory. The helper observer checks account, function state, production stage/table, RM/Zeev hosts, native query text, active flow299, two complete bounded Zeev field sweeps, native bank identity and current payment plans.

## Prepare

```sh
python scripts/repair-payment-bank-backlog.py --ticket 228007 --output-dir .payment-bank-repair
```

Review `plan-228007.json` and `summary-228007.json`. `planSha256` is SHA256 of canonical JSON using the operator's `digest()` function, not SHA256 of pretty-printed file bytes. Prepare all required tickets separately. A local Windows plan is not interchangeable with a remote plan: form representation, raw record representation, DOC2, template, active runtime, SQL contract and operator fingerprints are pinned.

## Apply one case under an acquired lease

The orchestrator first uses `lease-payment-bank-backlog.py.acquire()` with the independently current audit; create its `OUT` directory before calling the helper. It archives the original root and obtains a conditional20minute lease, preserving state, digest and movement ID. It supplies the resulting lease proof to this operator. The proof must include `before`, `leasedRoot` and `archiveKey` in addition to the exact case, UUID owner and expiry in epoch **seconds**.

```sh
python scripts/repair-payment-bank-backlog.py --ticket 228007 \
  --output-dir .payment-bank-repair \
  --apply --review .prior-review/plan-228007.json \
  --expect-plan-sha CANONICAL_REVIEW_SHA256 \
  --lease-proof .payment-bank-lease/lease-228007.json \
  --expect-lease-sha EXACT_LEASE_FILE_BYTES_SHA256
```

The current form is authoritative only for the authorized bank fields. Native/SQL ownership, supplier, destination, fiscal document, values, emission, every parcel, open/unpaid status and no boleto/payment dependencies must still match. An omitted entry date preserves RM; an explicitly supplied entry date must match. Eight fixed before/target ID pairs are enforced. The first228007 canary sends only IDPGTO and CODCOLPGTO plus CODCOLIGADA/IDLAN keys. Boleto cases may send the exact current plan's CODIGOBARRA/IPTE. No amount/date/document field enters SaveRecord XML.

Before dispatch, two complete fresh snapshots must exactly reproduce the approved plan within60seconds. The operator checks the archive and current root, then conditionally creates a **durable, one-shot** `prod#PG#<company>#<ticket>#BANK_REPAIR_ATTEMPT` record with a unique nonce, owner, plan/target hashes. A second workflow process cannot acquire the same attempt. A lost conditional-write response is reconciled by one consistent read, never retried.

The last external operation immediately before the native POST is a consistent DynamoDB GetItem requiring exact equality to `leasedRoot`. A file alone never authorizes a POST. The lease must remain valid with at least120seconds left. Replacing or revoking its owner blocks the POST. Cross-system atomicity against simultaneous manual RM editing is not implied; immediate preconditions and strict native/SQL postconditions remain mandatory.

## Results and no retry

After dispatch, same-client and independent-client snapshots are both attempted, even if the save response is lost or malformed. Every SQL TMOV/FLAN column is fingerprinted. Source movement/payment links and all nonpayment FLAN fields must remain unchanged; only selected payment fields and FLAN RECMODIFIEDBY/RECMODIFIEDON may change. Per-column hashes are emitted for diagnosis without bank values. Decimal JSON is parsed with Decimal, and decimal/date serialization is normalized without normalizing textual identifiers.

`VERIFIED` requires the exact native return key and both full readbacks. Any short write, response uncertainty, stale state or failed readback stops without another SaveRecord. Keep the DynamoDB attempt record and local artifacts permanently; do not delete/reset them to retry. The orchestrator may restore the original root via `lease-payment-bank-backlog.py.release()` only after separately reviewing the result and control state. This operator never releases or mutates the root.

Tests: `python -m unittest discover -s tests -p test_payment_bank_repair.py -v` (20 synthetic tests; no network or production data).
