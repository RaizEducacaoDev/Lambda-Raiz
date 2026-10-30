# Payment fiscal validation — production evidence

Payment code commit 28a314d2d4d299befc8b668812b15cfaa414db36 was published only to
`lambda-raiz-prod-solicitacaoDePagamento`, account 757843862365, sa-east-1.
[Release and independent readback](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41143863601)
completed successfully on 30 October 2026, 23:21 UTC; the readback job alone was then
repeated successfully after the original-intent canary. No broad service deploy.

Active package SHA256/base64: `r0ACtmx4cuGdCAaexa2P6RHkXAEnO5lctl4tiP1iqkk=`.
Revision: `e959f76b-7707-4d85-9b13-7a0a27784f81`.
Legacy core and every other ZIP entry were preserved byte for byte. Configuration
and existing checkpoints were independently verified. The release passed 102 tests,
typecheck, bundle, offline package smoke and independent source/release review.

Native SELECT contracts were registered using GlbConsSQLData and read back with
the deployed function's own credentials before publication:

| Query | Canonical SQL SHA256 |
| --- | --- |
| RAIZ.PG.RECON | 38676f42ebbfe0ec9f15f55d86aa1239e5c41860762057d47ff621d5090d1ea1 |
| RAIZ.PG.FISC | 6f6d5e93e11ccf8f5af5716e9a0958face95f7c3acd8c8cb6151efdee1994985 |

The old shared TOP1 query and fiscal master data were not modified.

## Observed behavior

The original case contains an internal fiscal nature for a Brazilian supplier
in RJ and branch in RS. In verified, separate development database160289, that
XML received Natureza inválida without a movement. Changing only IDNAT to an
interstate candidate succeeded. The lost historical production response was not
recovered; the development diagnostic is not represented as that original log.

A second native development test ran the entire handler source: the incompatible
nature returned 422 with zero reservations/effects; a compatible selection created
exactly one movement 90769 / title 148482 and persisted IDPGTO 2 / CODCOLPGTO 11; replay
returned the same IDs. Independent DataServer readback and counts confirmed one
movement/title, no orphan/settlement/boleto links, principal 1 and settled 0. Native
VALORAUXILIAR became 3 during bank save; its separate rule is still unresolved
and was not overwritten.

At 23:22:34–23:22:36 UTC the exact original business digest was submitted through
the attested production API route. The existing uncertain reservation fenced
the attempt; only the original incompatible selection was sent. It returned 422
NATUREZA_FISCAL_INCOMPATIVEL, naming RJ/RS. No replacement fiscal selection or
new production ticket was submitted. A subsequent READ COMMITTED statement,
without NOLOCK on business tables, found zero matching movements/titles by
ticket/document/supplier creation windows in both BRT and UTC. Independent AWS
readback confirmed the original state/digest/owner/lease unchanged and previous
operational cases COMPLETE.

## Remaining operational boundary

The old uncertain case remains unreleased. A valid fiscal successor requires
approval by the fiscal owner and separate one-time reconciliation. Current
absence, a unique index and a duplicate probe of the corrected XML do not prove
invariance of all nine effective original/successor keys: six are derived by
native defaults/customization not fully visible to the integration account.
Require native correlated rollback evidence or demonstrated key invariance,
fresh consistent reads, immutable original snapshot and a reviewed single-use
CAS protocol. No reset/delete/RESERVED transition or generic retry was published.

The guard covers the confirmed geographic/configuration conditions for new
1.2.03 movements with a supplied nature. It is not a complete fiscal validator.
Foreign routes and other native rules remain subject to RM validation. Creating
uncertain outcomes remain protected; when the guard detects invalid fiscal
input first it may return 422 without changing the old CREATING reservation.

The Zeev selector is integration 1203 in flow 299/v4. Form metadata did not expose
its transport/mapping, and Windows automation stopped because it could not
confidently identify the browser URL. No UI or fiscal approval was changed.
Production operational retest and other modality cases remain pending. No
settlement, remittance or bank payment was performed.

[Post-release audit](https://github.com/RaizEducacaoDev/Lambda-Raiz/actions/runs/41144743561)
at 23:29 UTC confirmed the same active package/revision, exact original
reservation and zero child checkpoints in a complete consistent scan. Complete
CloudWatch windows confirmed original END/REPORT without timeout, and only the
controlled422 responses after release, with no unexpected server failures in
the inspected interval. This supplies termination/child-state evidence, but
does not replace the outstanding native identity/rollback and fiscal approval.
