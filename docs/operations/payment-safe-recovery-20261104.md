# Safe recovery of corrected service payments

The service-invoice integration previously rejected every changed digest and
could leave a pre-dispatch failure waiting for manual reconciliation. It now
distinguishes an invocation that never dispatched a native creation from one
whose native result is genuinely uncertain.

- A duplicate/invalid document still fails before reserving a new operation.
- New root operations carry `protocolVersion:2`. A failed build/preflight fences
  its owner and expires only a still-RESERVED operation. A remotely committed
  CREATING checkpoint makes that CAS fail, even if its response was lost.
- A corrected digest can replace only an expired, pg-absent RESERVED/v2 root,
  after complete native observation of zero ticket movements/financial entries
  and validation of the corrected document, bank and fiscal context. An immutable
  snapshot is written before the exact state/owner/digest/lease CAS. Its orphaning
  after a failed CAS is harmless; it never grants creation rights.
- A CREATING invocation can recover the same digest only after identifying one
  native movement and ALL its financial installments. DataServer readback must
  match ticket, company/branch, supplier, document number/series/type, dates,
  gross/net amounts, installment amounts/dates, open/unsettled status and absence
  of boleto links. The recovered marker persists and enforces verification again
  before bank writes, including subsequent cold starts. No second SaveMOV occurs.
- A current zero never releases CREATING or changes its digest. Unknown results,
  timeouts, partial observations, paid/canceled entries and foreign documents do
  not authorize creation or adoption.
- Normal creation preserves SC/OC handling through the existing complete RECON
  classification. The final check additionally rejects any financial entry
  already linked to the ticket. Global zero remains mandatory for a corrected
  RESERVED recovery, and globally unique positive identity for CREATING recovery.

`RAIZ.PG.RETRY` is a new SELECT-only native query registered using GlbConsSQLData.
It reads movements for the ticket across companies, all linked FLANs, and native
FLANBOLETO links. `READCOMMITTEDLOCK` is intentional: uncommitted deletion of a
boleto link must not appear as proof of its absence. Native API/lock timeouts fail
closed. There are no new IAM operations, TTLs, deletes, fiscal-series changes,
schema/index changes or parameter changes.

## Verification

Tests cover corrected pre-dispatch intent, immediate retry, concurrent owners,
immutable history, active leases, lost checkpoint/CAS replies, every matching
field, missing installments, paid/boleto cases, zero-after-uncertain, SC/OC and
native changes after recovery but before bank association.

DEV160289 read-only verification used the pre-existing synthetic movement
99863/title188433 for ticket989926374. A local Dynamo emulation started in
CREATING; recovery reached COMPLETE with one history record, while EVERY native
SaveRecord was disabled and attemptedNativeWrites remained zero. A negative
226374 fixture retained CREATING and returned DOCUMENTO_RM_DUPLICADO without any
history or native write. The NFN series belongs solely to that old DEV fixture;
it is not a production mapping decision.

## Ticket 226374 boundary

Its original legacy CREATING operation lacks historical no-effect confirmation.
It is not reset, deleted or automatically upgraded to a pre-dispatch v2 attempt.
Its true invoice114/series1 collides with the separate paid2025 document
78497/161973. The current form was last observed as1141 after user edits. This
release neither invents a replacement invoice nor resolves the native fiscal
identity collision; the ticket is not declared ready for approval.

Publication targets only the payment Lambda entrypoint and preserves the legacy
core, other ZIP entries and function configuration, with baseline/revision
guards, backup, negative canaries, checkpoint preservation and code rollback.
