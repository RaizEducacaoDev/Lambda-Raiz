# Service-invoice document identity preflight

Ticket 226374 uses NFS-e number 114. The reported 70000 belongs to its DPS;
it is not automatically mapped to an RM series.

The original business input was reconstructed with an exact match to its
durable SHA256, including blank series, nature 23 / 1.949.01 and receipt 17080.
In verified DEV160289, this input reproduced the native rejection that the
issuer already has that number and series. The principal series is 1 and the
colliding movement is 78497, ticket 110229, dated December 2025. The production
native response text was not retained; its response hash differs from DEV.

For new service movements 1.2.03, the integration now checks the native series
configuration and document identity before reserving a new operation. The
read-only RAIZ.PG.DOC contract uses the nine TXMOVCFX components, complete counts
and echoed input. It does not filter collisions by year or movement type.

An invalid series or confirmed collision returns a specific 422 without a new
reservation or SaveRecord. An unavailable or inconsistent lookup returns 503
before creation. The observed native series is pinned to the builder's copy;
number/series are checked again in the XML before CREATING. The caller's input
and existing business digest stay unchanged. Numbers are never trimmed or
silently truncated by this service preflight.

The diagnostic allowlist also recognizes the documented native duplicate-note
message. This classification is logging only and never proves rollback.

## Verification

- 129 automated tests, typecheck and payment bundle passed locally.
- Native DEV negative tests returned DOCUMENTO_RM_DUPLICADO and
  SERIE_DOCUMENTO_INVALIDA with zero reservations and zero native saves.
- A separate synthetic DEV ticket 989926374, using explicitly configured NFN
  only as a test fixture, created movement 99863 / title 188433 once. Replay
  returned the same IDs. Independent DataServer reads confirmed NF114, NFN,
  value 5273.40, IDPGTO3 / CODCOLPGTO9, open title and no settlement/boleto.
- The native SELECT contract was registered through GlbConsSQLData and read
  back in DEV and production. No fiscal series/master data was registered.

## Operational boundary

The NOLOCK preflight is preventive. It does not prove historical absence,
eliminate races, authorize recreation or release an existing CREATING item.
The reservation for 226374 remains protected and requires separate evidence
for reconciliation. NFN is already configured, but the DEV test does not approve
it as the fiscal mapping for the production document. Its selection must be
confirmed rather than inferred from its description or the DPS number.

Only the payment Lambda entrypoint is included in the scoped release. Its
immutable legacy core, other package entries and function configuration are
preserved, with revision guards, backup, negative canaries and code rollback.
