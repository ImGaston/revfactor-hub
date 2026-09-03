# RevFactor Case-Study Foundation

This command builds an internal, source-backed case-study candidate inventory from the latest completed PriceLabs Report Builder run and Hub lifecycle evidence. It is read-only: its Supabase transport accepts only `GET` and `HEAD`, pins project ref `xpfjjcwgbjsdxdhyrcxd`, and writes only new local artifacts.

## Run

```bash
pnpm case-studies:foundation --as-of 2026-09-03 --template-id REVIEWED_EXACT_TEMPLATE_ID --output /absolute/new/output/directory
```

For a bounded pilot, supply an explicitly reviewed selection file:

```json
{
  "version": "v1",
  "listingIds": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003"
  ],
  "rationale": "Reviewed three-listing formula and classification pilot"
}
```

```bash
pnpm case-studies:foundation --as-of 2026-09-03 --template-id REVIEWED_EXACT_TEMPLATE_ID --output /absolute/new/output/directory --selection-file /absolute/path/selection.json
```

Use server-side environment variables `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The URL name is historical; the key remains server-only and must never be printed or placed in artifacts.

## Evidence rules

- The operator must provide the reviewed exact Report Builder template ID; an arbitrary latest completed template is never accepted.
- The selected completed run must reconcile its exact listing and metric counts, contain zero unresolved listings, and have no error reason.
- An eligible listing is active, client-associated, and uniquely resolved to the Report Builder listing identity.
- The takeover month and current incomplete month are excluded.
- Three supported complete managed months with valid required current metrics are required; raw metric rows are reported separately.
- Management-start proof ranks listing setup date or controlled setup evidence as high; exact onboarding roster plus live/onboarding evidence as medium; Hub creation date alone as low and non-claimable.
- Final-last-year values are used only when the entire prior-year month predates evidenced RevFactor management. The output never calls that period self-operated.
- RevFactor-assisted launches begin analysis in the month after their month-precision launch date, use market evidence only, and do not invent prior-year history.
- Missing, stale, non-USD, ambiguous, inconsistent, small-base, extreme, or implausible-comp-set evidence fails closed into the blocked report.
- Market ADR last year is not available in the current Report Builder schema and is explicitly `null`.
- All public identity approvals default to false. This command does not publish, message, write Notion, or change Hub/PriceLabs/GHL/Assembly.

## Artifacts

- `case-study-foundation.json`: complete machine-readable result.
- `case-study-candidates.csv`: compact candidate inventory with spreadsheet-formula neutralization.
- `case-study-executive-report.md`: strongest internally supported cases and a non-numeric fallback.
- `case-study-blocked-evidence.md`: every blocked candidate and exact reason codes.
- `source-manifest.json`: workflow, source fingerprint, report run/template, selection, artifact hashes, and explicit restricted-internal/PII classification.
- `SHA256SUMS`: hashes for replay verification.

Exact replay is deterministic. Existing identical files are accepted; changed or unexpected files cause the command to stop rather than overwrite evidence.

## Safe pilot

The pilot selection contract requires exactly three internal rows:

1. One inherited listing with medium/high start proof and at least three valid LY comparison months.
2. One RevFactor-assisted launch with at least three complete months and market evidence.
3. One expected blocked case, such as low-confidence start proof or an identity/QA flag.

The pilot passes when those three classifications, formulas, counts, and hashes reproduce exactly and no remote write occurs. Full-portfolio execution remains read-only and separately reviewed before any Notion population or public case-study use.
