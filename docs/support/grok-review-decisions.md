# Support tickets — decisions on the capture-bot review

Response to the capture bot's review (`support-tickets-review.md`, 2026-09-29, kept outside the repo because it quotes real client chats), which answered `grok-support-model-review.md`. Everything below is now in the draft schema and code, **including the three bot endpoints** (built 2026-09-29, section 3). **Still nothing is deployed:** the migration has run only against a throwaway local Postgres, and the Hub `/support` pages are not built.

- Migration: `supabase/migrations/20260929160000_support_tickets.sql`. It was renamed from `092_…`: the live ledger already holds timestamp versions, so a numeric version would sort before them.
- Domain rules and API contracts: `lib/support-tickets.ts`
- Bot API: `app/api/v1/support-captures`, `app/api/v1/support-tickets`, `app/api/v1/support-tickets/digest`. Planner `lib/support-capture.ts`, digest `lib/support-digest.ts`, server boundary `lib/support-tickets.server.ts`.
- Tests: 97 vitest tests across `lib/__tests__/support-*.test.ts`. On a disposable Postgres, 22 schema behavior checks passed, plus a 12-step end-to-end run: real planner output applied by the real `apply_support_capture` function (first capture, ledger replay, promise kept, retry without double effects, nudge → chase, backlog import, resolve gate).

**Summary:** Parts A and C accepted in full. Of the 14 answers, 11 were accepted as written, 2 with an adjustment, and 1 is deferred. Five places where we built it differently from what you proposed are explained in section 2.

---

## 1. Decisions

| # | Suggestion | Decision | Where it landed |
|---|---|---|---|
| A1 | Processed-message ledger; key on a stable ask fingerprint, not the ask index | **Accepted, extended** (see 2.1) | New `support_capture_messages` table with `UNIQUE (source, source_message_id)`. The server derives `ask_fingerprint` from request type + category + validated property set + normalized time window, and the key is `<source>:<messageId>:<fingerprint>`. |
| A2 | Look up active tickets first; `possible_duplicate_of`, `merged_into`, one-click merge | **Accepted** | Both columns added. `merge_support_ticket(source, target)` works in one transaction: it moves promises, properties, and Adjustments; keeps the earliest ask and the higher chase and nudge counts; and dismisses the source as `duplicate` with "Merged into #N". A merged ticket cannot be reopened. |
| A3 | "Likely kept, confirm"; `client_told_live`; done-but-not-told goes overdue after 24 h | **Accepted** | `client_confirmed_at` renamed to `client_told_live_at`. `promiseLikelyKept()`, `tellLiveDueAt()`, and `isDoneNotTold()` added. "Done, not told" feeds next-due, so it lands in Overdue after 24 h. |
| A4 | Dismissal reason codes | **Accepted** | `dismiss_reason` is one of `not_an_ask`, `duplicate`, `client_self_resolved`, `no_longer_needed`, `handled_offline`. A note is required for `duplicate` and `handled_offline`, enforced by a database check. |
| A5 | Verifier must justify overriding a `fail`/`uncertain` check | **Accepted** | Trigger: resolving a ticket with a `fail` or `uncertain` check needs `verification.override_reason` (5+ characters). |
| A6 | Missing event types | **Accepted** | Added `client_acknowledged`, `client_rejected`, `client_told_live`, `team_asked_client`, `internal_note_from_chat`, `handoff`, `commitment_rescheduled`, `commitment_cancelled`, `merged`, `possible_duplicate`, `dismissed`. Reschedules keep the original `due_at` (a trigger blocks changing it) and store `rescheduled_to`. |
| A7 | Redact before sending; about 1,500 characters; server rejects credentials | **Accepted, plus masking** | The capture API caps excerpts at 1,500 characters (the database allows 2,000 for manual entries). `detectCredential()` rejects passwords, pw/pin, access codes, API keys, bearer tokens, JWTs, long hex tokens, and Luhn-valid card numbers. It ignores `[redacted…]` markers, URLs, and 17–19 digit Airbnb IDs. The server also masks emails and phone numbers before storing (`maskContactDetails()`). The manual form refuses credentials too. |
| Q1 | Splitting rules | **Accepted** | Split only on a different kind of "done", a different property, or a different period. This is bot behavior; the fingerprint enforces it on the Hub side. |
| Q2 | Idempotency key | **Accepted** | See A1. |
| Q3 | Drop `strategy`, add `offboarding` | **Accepted, adjusted** (see 2.4) | Categories are now `pricing`, `stay_rules`, `availability`, `listing_setup`, `performance`, `reporting`, `billing`, `onboarding`, `offboarding`, `other`. |
| Q4 | Confidence per field; triage only on request type | **Accepted** | `ai.confidence = { category, request_type, sentiment? }`. `decideCapturedStatus()` sends an ask to triage when the property isn't validated, request-type confidence is under 0.80, it's a possible duplicate, or the ask is in an attachment. |
| Q5 | Promise phrases (EN + ES), relative dates at 6 PM ET, 24 h vague / 48 h concrete | **Accepted** | Adds `due_source` (`explicit`, `relative`, `default_vague`, `default_concrete`, `manual`). Explicit and relative promises must send `due_at`; the default sources get 24 h or 48 h on the server. Phrase lists and ET date handling stay on the bot side. |
| Q6 | Answer-check rubric with quotes | **Accepted** | Discrete `answer_check_asked`, `answer_check_replied`, `answer_check_gap`. `proposes_answered` is ignored on `fail` (`honorsProposedAnswer()`). |
| Q7 | Nudges vs chases | **Accepted, adjusted** (see 2.3) | Adds `client_nudge_count`; the second nudge also counts as a chase. |
| Q8 | Keep 24 clock hours; optional 4 h soft acknowledgement | **24 h accepted; soft indicator deferred** | Revisit after two weeks of queue data. |
| Q9 | Churn risk on the client; priority by rules; `priority_source` | **Accepted** | Adds `clients.churn_risk` and `priority_source` (`rule`/`manual`). `derivePriority()` implements your rules. `low` is manual-only, because the bot has no "informational" signal. |
| Q10 | `internal_note_from_chat` | **Accepted** | Timeline only; it never counts as a team reply. |
| Q11 | Daily digest from ticket data, per person | **Accepted** | The Hub will expose the digest sections, computed with the same queue rules the UI uses. The bot formats and sends them (see 3.4). |
| Q12 | Privacy | **Accepted** | See A7. |
| Q13 | Day-one backfill of the recheck | **Accepted** | `backfilled` and `backfill_batch` (a database check keeps them consistent). `sla_anchor_at` starts the reply clock at import. `backfill.initial_status: "answered"` plus a note covers "said done, never confirmed" items. Backfilled tickets stay out of promise metrics and are reported as backlog open/cleared. |
| Q14.1 | Verify bottleneck | **Accepted** | Verification age is tracked (`verifyAgeHours()`) and is never a client clock. Verify is permission-based (`support:control`), so Fede verifies as super admin. |
| Q14.2 | Default owners by category | **Accepted, needs your call** | New `support_routing_rules` table (category and/or request type → owner, most specific rule wins) plus `resolveDefaultAssignee()`. Not seeded: rows reference Hub user profiles. See section 4. |
| Q14.3 | Desk accounts | **Accepted, needs your call** | `clients.support_capture` (default on). When it's off, the bot skips that client's messages and the ledger records `skipped_client_excluded`. People can still create tickets by hand. |
| Q14.4 | Fast manual create | **Accepted** | The Hub form keeps three required fields (client, ask, request type); the rest defaults. Call-note suggestions come later. |
| Q14.5–6 | Spanish; asks in screenshots | **Accepted** | Language is bot-side. `needs_attachment_review` sends the ask to triage. |
| Q14.7 | Whole-portfolio asks | **Accepted** | `portfolio` and `account` scopes validate without picking a listing. |
| Part C | Screen notes | **Accepted for the Hub build** | Planned for the Hub build: a "Done, not told" chip and count, Asked/Replied quotes at the top of Our answer, an override-reason field on Verify, "Merge into #X" on possible duplicates, and Backlog cleared / Dismissed (self-resolved) in the header. |

## 2. Where we built it differently

### 2.1 One capture call per chat message

Instead of `POST /support-tickets` plus a separate per-ticket events endpoint, the bot sends **one call per processed message**: `POST /api/v1/support-captures`. It carries the new asks in that message **and** its effects on existing tickets. That makes the ledger exact:

- A message is recorded once, whether it produced tickets, events, or nothing (`no_ask`).
- A re-send without `reprocess` returns `skipped_processed`.
- Event keys are derived on the server from message + event type + ticket, so the bot never invents them.
- On `reprocess: true`:
  - Each candidate is matched to that message's existing tickets by fingerprint and returns `existing`.
  - Unmatched candidates go to triage as possible duplicates, never straight to open.
  - A promise is skipped if one from the same message already exists on that ticket.

### 2.2 The fingerprint is computed by the Hub, not the bot

It depends on the **validated** Hub listing IDs, which only exist after the Hub's own property match. The bot sends the time window (`time_window`, e.g. `2027-07` or `2026-10-12/2026-10-14`); the Hub normalizes and hashes it.

### 2.3 A 2-hour continuation window before a chase

As written, a client who sends "also, add the pet fee" 10 minutes after an unanswered message would count as chasing. A second message within 2 hours of an unanswered one is now a **continuation** (no count). After 2 hours, or once a promise is past due, it's a **chase**. Nothing owed means it's a **nudge**.

### 2.4 Taxonomy detail

Dropping `strategy` and splitting `account` in two meant access had to live in one place. **Portal and PriceLabs access now sit under `onboarding` ("Onboarding & access")**, and `reporting` is narrowed to reports, dashboards, and promised touchpoints.

### 2.5 A merge never rewrites the timeline

The timeline is append-only, so a merge doesn't move events. The source ticket keeps its events, and the target's timeline also reads tickets whose `merged_into` points to it. Promises, properties, and Adjustments do move.

## 3. Updated bot contract

Authentication is unchanged: `Authorization: Bearer rvf_live_…`, with scopes `support:write` (captures) and `support:read` (list and digest).

**Status: built** (not deployed).

### 3.1 `POST /api/v1/support-captures`: one processed message

```json
{
  "source": "assembly",
  "source_message_id": "msg_8f2c1",
  "message_at": "2026-09-25T14:05:00Z",
  "author_role": "client",
  "author_name": "Ngozi Okafor",
  "client": { "assembly_company_id": "comp_123" },
  "model": "grok-4",
  "prompt_version": "support-capture-v1",
  "reprocess": false,
  "tickets": [
    {
      "summary": "Yes or no: discount Boho Cottage for October and November?",
      "client_message": "Should we discount October and November at Boho Cottage? A yes or no is fine.",
      "category": "pricing",
      "request_type": "decision",
      "time_window": "2026-10/2026-11",
      "client_sentiment": "concerned",
      "money_at_stake": false,
      "needs_attachment_review": false,
      "property": { "scope": "listings", "listings": [{ "name_hint": "Boho Cottage" }] },
      "ai": {
        "confidence": { "category": 0.9, "request_type": 0.95, "sentiment": 0.8 },
        "rationale": "Explicit yes/no on a discount for one named property."
      },
      "commitments": []
    }
  ],
  "events": [
    { "type": "client_message", "ticket_id": "…existing ticket…", "body": "Also, any update on the markup?" }
  ]
}
```

Rules:

- `author_role` is `client`, `team`, or `internal`. Only client messages may create tickets. Team messages carry `team_reply`, `team_asked_client`, `commitment_*`, `client_told_live` (when the team says it's live), or `handoff`. Internal staff notes carry `internal_note_from_chat` only.
- Limits: up to 10 tickets and 20 events per message; excerpts and event bodies ≤ 1,500 characters, redacted.
- A candidate's `commitments[]` use `{ description, due_source, due_at? (required for explicit/relative), made_by_name? }`.
- `possible_duplicate_of` and `duplicate_note` flag a suspected restatement of an active ticket; the ticket opens in triage.
- `backfill: { batch, initial_status: "open" | "answered", note? }` is for the day-one import only.

Planned response:

```json
{
  "message": { "outcome": "captured", "capture_id": "…" },
  "tickets": [
    {
      "index": 0,
      "outcome": "created",
      "ticket_id": "…",
      "ticket_number": 1029,
      "status": "open",
      "triage_reasons": [],
      "property_validated": true,
      "unresolved_listings": []
    }
  ],
  "events": [{ "index": 0, "outcome": "applied" }]
}
```

- `message.outcome` is one of:
  - `captured`
  - `no_ask`
  - `skipped_processed` (already in the ledger)
  - `skipped_client_excluded` (capture switched off for this client)
  - `incomplete`: some items errored, so the message was **not** marked processed. Fix them and resend the same payload; items that already applied come back as `existing` or `duplicate`, never twice.
- Ticket `outcome` is `created`, `existing`, or `error`. `same_as_index` means the candidate was the same ask as an earlier one in this message.
- Event `outcome` is `applied`, `duplicate`, `skipped` (with a `reason`, e.g. a repeated event in one message), or `error`. `redirected_from` means the event followed a merge to the ticket that stayed.
- A possible credential returns `error: "possible credential (<kind>) in ticket <n>"`.
- One bad item never fails the rest. The whole message is written in one database transaction.
- HTTP codes:
  - 400 for an invalid payload (with `issues`)
  - 404 when no Hub client matches
  - 409 when an Assembly company maps to more than one Hub client
  - 401/403 for a bad or under-scoped key

**Hand-managed clients:** every ask starts in triage, marked `hand_managed`. Events are recorded (timeline, clocks, counts, answer checks, told-live), but nothing automatic changes the ticket's status, priority, or owner.

### 3.2 Event effects

| Event | Effect |
|---|---|
| `client_message` | Classified before it's applied: **reply** (we were waiting on the client) moves the ticket to open; **chase** increments the chase count; **continuation** changes no count; **nudge** increments the nudge count, and the second nudge also counts as a chase. On a closed ticket it reopens only with `reopen: true`. Priority is recomputed when `priority_source = rule`. |
| `client_acknowledged` | Sets `client_acknowledged_at`. Evidence only. |
| `client_rejected` | Quote required. Reopens an answered or resolved ticket and counts as a miss. |
| `client_told_live` | Sets `client_told_live_at`. |
| `team_reply` | Updates the team clock (and first response). Stores the answer check (`verdict`, `asked`, `replied`, `gap`). With `proposes_answered` and a non-fail check, the ticket moves to **answered**. |
| `team_asked_client` | Moves the ticket to **awaiting_client** and pauses the reply clock. |
| `internal_note_from_chat` | Timeline only. |
| `commitment_made` / `_kept` / `_rescheduled` / `_cancelled` | Promise lifecycle. `_kept`, `_rescheduled`, and `_cancelled` reference `commitment_id` from the list endpoint. A reschedule never moves the original due date; a cancel needs a note. |
| `handoff` | Timeline entry plus an owner change when `to_label` names a Hub user. |

### 3.3 `GET /api/v1/support-tickets` (`support:read`)

Returns active tickets per client for matching follow-ups. Each row carries:

- ID, number, status, category, request type, summary, and time window
- Client IDs, property scope, and listing names
- Open promises (ID, description, original and working due date)
- Conversation timestamps, next due, due state, and flags (`done_not_told`, `possible_duplicate`, `stale_triage`)

Internal notes, verification details, and anything financial are never returned.

### 3.4 `GET /api/v1/support-tickets/digest` (`support:read`)

The Hub computes each person's sections with the same rules as the queue: overdue, promises due today, done-not-told, the verify queue, triage older than 12 h, and for Fede, billing/offboarding decisions and unhappy or high-churn clients with the promise-kept rate and send-backs versus last week. The bot only formats the one-line-per-ticket output and delivers it, with Fede's section going into the weekday chief-of-staff digest.

## 4. Decisions (answered 2026-09-29)

1. **Default owners.** Onboarding goes to **Andrés**, not Rampé: Rampé is a bot, so it can't hold a Hub login or own a ticket, and it keeps tracking onboarding on its own board. Encoded as roles in `SUPPORT_DEFAULT_ROUTING`:

   | Role | Owner | Covers |
   |---|---|---|
   | `changes` | Andrés | Pricing, stay rules, calendar, listing setup, onboarding |
   | `strategy` | Gastón | Performance, reports, every decision outside billing/offboarding, and anything else, including triage |
   | `money` | Fede | Billing and offboarding, decisions included |

   Andrés, Gastón, and Fede each need a Hub login before `scripts/seed-support-routing.ts` can point at them.
2. **Desk accounts:** capture them, and mark them **hand-managed** so nothing automatic acts on them. This is `clients.support_hand_managed`, copied onto each ticket.
3. **6 PM ET cutoff:** kept for now; revisit once we see when Andrés actually answers. If Andrés works on Argentina time, 6 PM ET is 7 PM in Buenos Aires only while the US is on daylight time. After US clocks change on **Nov 1, 2026** it becomes **8 PM** (Argentina doesn't change clocks). Worth confirming that still works, or moving the cutoff to 5 PM ET for the winter.
4. **Backfill:** only after deployment and only on Fede's go. First refresh the 55 items against that day's chats, since some will already be closed. Import them as backlog (`backfill.batch`), which keeps them out of the promise and SLA numbers.

### Earlier open questions (for the record)

The four questions this section answered were:

1. **Default owners.** Confirm the routing before it's configured:
   - Pricing, stay rules, calendar, and listing setup: Andrés
   - Performance and every `decision` ask: Gastón
   - Billing and offboarding: Fede
   - Onboarding: Rampé's queue or Andrés
   Each owner needs a Hub login for the rule to point at.
2. **Desk accounts** (the four hand-managed clients named in the review). Recommendation: keep capture **on**. The bot never messages clients or creates Adjustments for anyone, and the high-risk client email that started this project came from one of these accounts; it is exactly the follow-through gap this closes.
3. **The 6 PM ET cutoff** for "today / tomorrow / by Monday". Should it match Andrés's actual working hours?
4. **Backfill.** The 55-item recheck contains real client data. The import runs through the capture API after deployment, only with your go-ahead.

## 5. Deployment checklist (when approved)

1. **Migration:** apply `20260929160000_support_tickets.sql` through the isolated-manifest process. Dry-run first and confirm it lists only this file.
2. **Bot key:**
   ```bash
   npx tsx --env-file=.env.local scripts/create-api-key.ts "Support capture bot" <owner email> support:read support:write
   ```
   The plaintext token prints once; store it in the bot's secret store, never in chat.
3. **Owners:** once Andrés, Gastón, and Fede have Hub logins:
   ```bash
   npx tsx --env-file=.env.local scripts/seed-support-routing.ts --changes=<andres> --strategy=<gaston> --money=<fede> --dry-run
   ```
   Then rerun the same command without `--dry-run`.
4. **Hand-managed accounts:** set `support_hand_managed = true` on the four desk accounts, by Hub client ID. This will be a Settings toggle once the Hub pages exist.
5. **Smoke test:** send one `no_ask` capture and one test ask for an internal client. Confirm the ticket, the ledger row, and the digest, then dismiss the test ticket.
6. **Backfill:** only on Fede's go. Refresh the 55-item recheck against that day's chats, then send each item as a capture with `backfill: { batch: "2026-09-28-recheck" }`.

## 6. Next build step

Hub `/support` queue and ticket detail, following the prototype plus the Part C notes:
- sidebar entry, and `support` added to the permission list
- quick manual create
- merge, dismiss with reasons, verify with an override reason
- "Done, not told" chip
- linking an Adjustment from a ticket
- Settings toggles for routing and hand-managed clients
