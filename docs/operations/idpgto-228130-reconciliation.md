# Ticket 228130 — reconcile only the existing movement

The RM payment identity was linked by the official FinLanDataBR service and
independently reread through SOAP and SQL SELECT: company31, branch1, supplier
0000173261/company0, movement455, financial470, bankID4/company31. One movement
and financial exist for this ticket; both remain open with original amount1,
zero settlement and no FLANBOLETO/FLANBAIXA records. No movement or payment was
created by the repair.

The original creation HTTP call aborted after8s; RM committed later. The root
reservation remains CREATING with its original digest and owner. It must not
be deleted, reset to RESERVED, or followed by another movement SaveRecord.

The code fix is commit37b714c: creation gets up to15s while preserving12s after
the call, with a pre-checkpoint time check and safe diagnostics. It passed63
tests, typecheck, bundle and ZIP-import smoke with zero network effects.
The function-only release is pending GitHub runner allocation in run41102006254.
Read its actual deployment artifact and independently verify AWS before adoption;
a queued workflow or local package hash is not deployment evidence.

## Exact operational procedure

1. Confirm the deployed function hash and revision for
   lambda-raiz-prod-solicitacaoDePagamento in account757843862365/sa-east-1.
   The release guard permits only the verified baseline revision; competing
   queued releases cannot overwrite a changed revision.
2. Reread the current Zeev fields, exact native bank record, TMOV455/TMOVCOMPL,
   its sole TMOVPAGTO/FLAN470, ownership, document9212564/series1, totals1 and
   due2026-12-31. Independently SELECT all movements by company+ticket and
   count both financial bridge tables. No SQL writes.
3. Replace idpgto-228130-bank-readback.json with the fresh safe evidence, no raw
   bank details. Require IDPGTO4/CODCOLPGTO31 and all guards still true.
4. Pin IDPGTO_EXPECTED_CODE_SHA to the independently verified active release.
   The prepared workflow example is intentionally not executable. Refresh and
   review it before installation; do not publish the placeholder.
5. Run reconcile-idpgto-228130.py first with its default read-only mode, then
   IDPGTO_RECONCILE_MODE=apply only with evidence at most15min old. The script
   adopts PG455 by CAS requiring the exact original state, digest, owner and
   expired lock, absent PG and absent child checkpoint. It preserves digest,
   owner, lock and reservation; no Lambda or RM invocation occurs.
6. Independently reread the root CREATED/PG455 and current RM bank identity.
   Then release a retry of the same Zeev fiscal task with unchanged fields.
   The bank already matches, so the normal handler needs only reads and
   checkpoints, with no new movement or bank SaveRecord.
7. Confirm root and child COMPLETE, same455/470, and native bank4/31. Stop
   before settlement/remittance/payment. Keep A03's final acceptance pending
   the auxiliary-field review below and the actual resumed workflow proof.

## Native auxiliary-field observation

The bank-only service update also changed VALORAUXILIAR1→3; native audit
1234104160 confirms this. Original amount remains1, settlement0, and optional
amounts/charges read remain0. Eighty-five earlier titles in the same company
already have auxiliary3, with different originals and before this AWS fix.
This does not prove the exact meaning of the transition. TR_FLAN is active;
the read-only SQL account cannot view its definition. The schema only labels
the field Valor Auxiliar. Do not force it back by another write. Its rule
and final payment acceptance need the RM/database owner or TOTVS confirmation.

Local safe evidence is in artifacts/zeev-228130-a03-20261030/ under the operator's
workspace. No secrets or raw bank details are included here.
