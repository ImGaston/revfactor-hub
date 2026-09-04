# Granola sales-call importer

This module is a bounded, read-only Granola ingestion core for RevFactor sales appointments. Production wiring supplies credentials, persistence, scheduling, and the internal appointment-summary destination. The core does not mutate Granola or GoHighLevel.

## API boundary

`GranolaApiClient` calls only:

- `GET https://public-api.granola.ai/v1/notes` with `updated_after`, an optional `cursor`, and `page_size` from 1 through 30.
- `GET https://public-api.granola.ai/v1/notes/{note_id}` without `include=transcript`.

The implementation follows Granola's [List Notes](https://docs.granola.ai/api-reference/list-notes), [Get Note](https://docs.granola.ai/api-reference/get-note), and [API access/scoping](https://docs.granola.ai/help-center/sharing/integrations/granola-api) documentation.

Construct a client with a server-side credential for one configured import source:

```ts
const api = new GranolaApiClient({ token: credentialFromSecretStore })
```

An import `sourceId` identifies that rep-level or workspace-level credential configuration. Tokens stay outside checkpoints, processed-note records, sink payloads, results, and logs. API errors expose only an operation, error class, and optional HTTP status; response bodies are never added to errors or logs.

Granola's detail response can contain a transcript and the owner's private notes. The client parses the response into `GranolaNote`, a deliberately narrower type that retains only meeting metadata, attendee identity, source URL, and the generated summary. Transcript and private-note fields are discarded at the API boundary.

## Production interfaces

The production runner provides three interfaces from `lib/granola/types.ts`:

- `GranolaApi` lists changed note versions and gets one note's safe detail projection.
- `GranolaImportStore` persists per-source checkpoints, deduplicates `(noteId, updatedAt)` globally across overlapping credential scopes, returns possible appointments, and records the source and outcome of each processed note version.
- `GranolaSummarySink` idempotently upserts the internal summary/source record associated with an appointment.

`GranolaSummarySink.upsertInternalSummary` receives only `sourceId`, the matched internal appointment ID, Granola note ID/version, Granola web URL, and summary text/markdown. It has no GHL mutation method. Production wiring must keep this record in the Hub's internal storage and must not copy the raw transcript, private notes, or these internal summary/source fields into GHL.

`findEligibleSalesAppointments` should query a narrow window around the supplied calendar event/time fields and return only plausible appointments. The pure matcher still enforces `kind === "revfactor_sales"`, so onboarding, support, internal, and other meetings cannot attach even if a repository returns them accidentally.

## Matching policy

Matching is deterministic:

1. Normalize and look for the Granola `calendar_event_id`. Attach only when exactly one eligible RevFactor sales appointment has that ID.
2. If there is no exact event-ID match, require all three fallback signals: normalized rep email, the same scheduled instant, and at least one normalized attendee email in common.
3. Attach only a unique fallback result. Duplicate event IDs, multiple fallback results, missing fallback signals, and mismatches remain unattached.

There is no title-only, attendee-only, fuzzy-time, or closest-record match.

## Incremental and bounded runs

`runGranolaImport` requires an explicit `initialUpdatedAfter`; this prevents an accidental unbounded historical import. Defaults are 30 notes per API page, 10 pages, 300 listed notes, a five-minute checkpoint overlap, and a 15-second HTTP timeout per request.

A completed checkpoint has this shape:

```ts
{
  updatedAfter: "2026-09-04T14:00:00.000Z",
  cursor: null,
  pendingHighWatermark: null,
}
```

At the start of a new scan, the runner subtracts the overlap from `updatedAfter`. Replayed note versions are harmless because the store checks the `(noteId, updatedAt)` key before fetching detail or writing a summary. This dedupe key is global so overlapping rep and workspace credentials cannot import the same Granola version twice. The overlap recovers notes that become visible shortly after their update time.

When a page or note cap is reached while Granola still has another page, the runner returns `status: "deferred"` and stores Granola's cursor with the fixed query boundary and pending high-water mark. The next invocation resumes that cursor. It does not recalculate the overlap in the middle of a paged scan.

The completed high-water mark is committed only after the final page succeeds. A list, detail, repository, sink, processed-record, or checkpoint failure returns `status: "failed"`. A failed page does not advance the cursor, and an idempotent sink makes replay safe if its write succeeded immediately before another persistence failure.

Unmatched and summary-less note versions are recorded as processed outcomes so the overlap does not repeatedly reconsider the same unchanged version. A later Granola update produces a new `updatedAt` dedupe key and is evaluated again.

## Operational logging

The optional `GranolaSafeLogger` accepts a fixed event name, source ID, optional opaque note ID, and a small error code. Do not pass thrown messages, bearer tokens, attendee data, note titles, summaries, transcripts, private notes, request URLs, or response payloads into the logger.

The returned counters are suitable for internal monitoring: fetched, imported, deduplicated, unmatched, missing summary, and failures. They contain no note content.

## Durable persistence and appointment gate

Migration `20260904123000_granola_import.sql` creates four service-role-only tables:

- `granola_sales_appointment_map` is the explicit eligibility and matching source.
- `granola_import_checkpoints` stores per-source completed boundaries or bounded-scan cursors.
- `granola_processed_notes` stores the global note-version dedupe key and outcome.
- `granola_appointment_summaries` stores the internal summary/source projection linked to an eligible appointment.

All four tables have RLS enabled, revoke access from `anon` and `authenticated`, and intentionally define no user-facing policies. The service-role store in `lib/granola/store.server.ts` is the only application persistence path. It accepts only `https://notes.granola.ai` source URLs and drops other URLs.

The current Hub schema has no reliable appointment record carrying all matching signals. The old calendar/notes feature is inert; listing-review intake has an optional GHL appointment ID and owner but no calendar event ID, scheduled instant, and attendee set; onboarding journey records likewise do not establish those match fields as a trusted sales-call mirror. The importer must therefore stay gated on `granola_sales_appointment_map`.

Rows in that map default to `eligible_for_granola_import = false`. A trusted GHL/calendar ingestion path must upsert the appointment ID, calendar event ID when available, normalized rep email, scheduled start, normalized attendee emails, source update time, and a traceable `eligibility_source`, then explicitly set eligibility true only for appointments in the RevFactor sales calendar/workflow. The Granola importer never creates or promotes eligibility rows itself. Until that integration exists and populates eligible rows, notes will be recorded as unmatched and no internal summary will attach.

## Cron wiring

`GET /api/cron/granola-import` fails closed on the standard `CRON_SECRET` bearer credential. It is disabled unless `GRANOLA_IMPORT_ENABLED` is exactly `true`; missing or any other value returns a successful disabled response without parsing credentials or touching persistence.

Enabled runs read server-only `GRANOLA_IMPORT_SOURCES_JSON`. The value is a JSON array with at most five unique source entries:

```json
[
  {
    "id": "rep-one",
    "scope": "rep",
    "token": "server-secret-value",
    "initialUpdatedAfter": "2026-09-01T00:00:00Z"
  }
]
```

`scope` is `rep` or `workspace`. Tokens are used only to construct the corresponding server-side client and never appear in the response or logs. Invalid, duplicate, empty, or oversized configurations fail before any import begins.

Each source invocation is capped at one page of ten note versions and uses a ten-second request timeout. A stored cursor resumes the next invocation, so this cap limits work without losing later pages. Up to five configured sources run in parallel. The route returns only source ID/scope, status, and content-free counters. It performs no external send or provider mutation.

The route is present but no Vercel schedule is added by this module. Keep `GRANOLA_IMPORT_ENABLED` disabled until the migration is applied, a trusted integration populates the eligibility map, server source credentials are configured, and the operator intentionally wires the cron schedule.
