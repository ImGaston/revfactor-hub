# RevFactor Hub: support capture bot contract (v1.6)

Build target for the capture bot. The capture endpoints are live at `https://hub.revfactor.io/api/v1/…` (deployed 2026-09-30). Field names and limits below match the Hub's validation exactly.

**v1.6 (2026-10-04, Hub drafts — live once deployed; Fede confirms):**
- The Hub writes its own draft for new tickets right after capture, in the same `suggested_reply` slot. Never for billing, offboarding, or check-ins. See "Hub drafts" in section 9.
- `GET /api/v1/support-tickets` adds `suggested_reply_source`: `hub`, `bot`, or `null`. `suggested_reply_generated_at` now covers Hub drafts too.
- Nothing else changes. `PUT` and `DELETE` work as before, and your `PUT` still replaces any draft, a Hub draft included.

**v1.5 (2026-10-01, check-ins and backfill):**
- New request type `check_in`: outreach we start ourselves, planned with a date. Only team messages create check-ins. See section 10.
- Asks raised outside Assembly (calls, email) are captured with `source: "call"` or `"email"`. See section 10.
- The backfill import is approved and documented. See section 11.

**v1.4 (2026-10-01, after live sample v1):**
- `team_reply` takes an optional `used_suggestion` (`yes`, `partly`, `no`) when the ticket had a draft. See section 9.
- Hedged promises ("I'll try", "voy a intentar") count as promises.
- `proposes_answered` on `uncertain` is only for a secondary gap, never when the gap is the thing asked for.

**v1.3 (2026-09-30, suggested replies):** the bot may store one draft reply per ticket through `PUT /api/v1/support-tickets/{ticket_id}/suggested-reply`. Drafts only; a person always sends. See section 9. The list endpoint now returns `suggested_reply_generated_at`. **Don't call the new endpoint until Claude confirms on the shared page that it's deployed.**

**v1.2 (2026-09-29, after dry run v2):** a promise that depends on something the team just asked the client for is not sent (see "Contingent promises" in section 5).

**v1.1 (2026-09-29, after dry run v1):**
- New `GET /api/v1/support-listings` for resolving property nicknames.
- Messages are processed one client at a time, in order.
- The Hub flags a restated ask that's already open.
- A client with one active listing auto-matches a named property.
- One-time codes are treated as credentials.
- Money-at-stake tickets need a `pass` to be marked answered.
- A follow-up after a failed reply counts as a chase.
- Priority is computed once per message, so event order doesn't matter.
- `internal_note_from_chat` is reserved (Assembly has no staff notes).
- Team proposals the client approves become tickets on the client's approval.

## 1. Your job, in one line

For every Assembly message: send **one** `POST /api/v1/support-captures` describing the new asks in it (tickets) and what it changes on existing tickets (events). The Hub decides status, priority, owner, overdue, and chases. You never resolve, merge, or dismiss anything, and never message clients.

Auth (after deploy): `Authorization: Bearer rvf_live_…`. `support:write` to capture, `support:read` to list and digest.

## 2. Before each message

0. **One client at a time, in order.** Process each client's messages sequentially in `message_at` order. Wait for the capture response before reading the next message's context, so back-to-back messages see each other. Different clients can run in parallel.
1. `GET /api/v1/support-tickets?assembly_company_id=…` (or `assembly_client_id` / `hub_client_id`) returns that client's active tickets, with their open promises (`open_commitments[].id`).
   - `GET /api/v1/support-listings?…` (same client params) returns the client's listings: `hub_listing_id`, public `name`, `aliases`, `status`, `pricelabs_listing_id`, `airbnb_id`. It also says whether capture is on (`capture_enabled`) and whether the client is `hand_managed`. Resolve nicknames ("the Cabin") to a `hub_listing_id` yourself; the Hub still checks it belongs to the client. If `capture_enabled` is false, skip the client.
2. Decide per ask:
   - **Follow-up:** same request type, overlapping property, and the same period or the same named fee/setting. Send an event on that `ticket_id`.
   - **New ask:** send a ticket.
   - **Unsure:** send a ticket with `possible_duplicate_of: <ticket_id>`. It goes to triage, never straight to open.
3. **Split one message into several tickets only when** the kind of "done", the property, or the period differs.
   - "Lower the min and how's December?" is 2 tickets.
   - "Lower the min at both houses" is 1 ticket with 2 listings.
4. **Safety net:** if the same ask is already open from an earlier message (same request type, category, property set, and period), the Hub flags the new ticket as a possible duplicate and sends it to triage (`triage_reasons: ["same_ask_open"]`).

## 3. Payload

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
  "events": []
}
```

### Message fields

| Field | Rule |
|---|---|
| `source` | `assembly` (default), `email`, `whatsapp`, `call` |
| `source_message_id` | required, 1–200 chars; the Assembly message ID |
| `message_at` | required, ISO 8601 with offset |
| `author_role` | required: `client`, `team` (a RevFactor person writing to the client), `internal` (staff-only note) |
| `author_name` | optional, ≤120 |
| `client` | at least one of `hub_client_id`, `assembly_client_id`, `assembly_company_id`. Send both Assembly IDs when you know them: the Hub tries the Hub ID, then the client ID, then the company. Individual channels (client ID only) work. |
| `model` / `prompt_version` | optional, ≤100 / ≤60 |
| `reprocess` | default `false`. Set `true` only to deliberately re-split an already-processed message. |
| `tickets` | ≤10. Client messages create asks; team messages create only `check_in` tickets (section 10) |
| `events` | ≤20 |

### Ticket fields

| Field | Rule |
|---|---|
| `summary` | required, 3–300; the ask restated |
| `client_message` | optional, ≤1,500, redacted (section 6) |
| `requested_by_name` | optional; defaults to `author_name` |
| `category` | required (section 4) |
| `request_type` | required (section 4) |
| `time_window` | optional, ≤40, normalized: `2027-07`, `2026-10/2026-11`, `2026-10-12/2026-10-14` |
| `client_sentiment` | `neutral` (default), `concerned`, `unhappy` |
| `money_at_stake` | billing/offboarding with money involved (charge after termination, refund) |
| `needs_attachment_review` | `true` when the ask is inside a screenshot or file you couldn't read |
| `property.scope` | `listings`, `portfolio` (all of them), `account` (not property-specific), `unknown` |
| `property.listings[]` | ≤25; each needs one of `hub_listing_id` (preferred, from `/support-listings`), `pricelabs_listing_id`, `airbnb_id`, `name_hint`. The Hub matches exactly against that client's own listings and saved `aliases`. A client with **one active listing** matches any named property to it. Anything else unmatched goes to triage. When no property is named for a one-listing client, `scope: "portfolio"` is fine. |
| `ai.confidence` | required: `category` and `request_type` (0–1); `sentiment` optional. Below 0.80 on `request_type`, the ask goes to triage. |
| `ai.rationale` | optional, ≤1,000 |
| `possible_duplicate_of` / `duplicate_note` | optional UUID of an active ticket; note ≤500 |
| `commitments[]` | ≤10; promises the team **already** made before this ticket existed (see promise fields) |
| `backfill` | only for an approved import (section 11) |

### Events (each needs `ticket_id` from the list endpoint)

| `type` | Allowed from | Extra fields | What the Hub does |
|---|---|---|---|
| `client_message` | client | `body?`, `reopen?` | Updates the client clock; counts a chase or nudge when due; waiting-on-client moves back to open; a closed ticket reopens only if `reopen: true` |
| `client_acknowledged` | client | `body?` | "Thanks / got it". Evidence only, and it doesn't start the reply clock |
| `client_rejected` | client | `body` (required quote) | "That's not what I asked / not done". Reopens the ticket and counts as a miss |
| `team_reply` | team | `body?`, `answer_check?`, `proposes_answered?`, `used_suggestion?` | Updates the team clock; stores the check; with `proposes_answered` and a non-fail check, moves the ticket to "answered, verify" |
| `team_asked_client` | team | `body?` | Moves the ticket to waiting on client and pauses the reply clock |
| `client_told_live` | team | `body?` | Records that the client was told the change is live |
| `commitment_made` | team | `commitment` | New promise |
| `commitment_kept` | team | `commitment_id` | Closes the promise; late vs on time is judged on the original date |
| `commitment_rescheduled` | team | `commitment_id`, `rescheduled_to` | New working date; the original stays for lateness |
| `commitment_cancelled` | team | `commitment_id`, `note` (3–500) | Cancels the promise |
| `handoff` | team | `to_label` (≤120), `body?` | Timeline, plus an owner change when it names a Hub user |
| `internal_note_from_chat` | internal | `body` (required) | Timeline only; never counts as a reply. **Reserved:** Assembly has no staff-only notes, so don't emit it in v1. |

`body` is ≤1,500 everywhere, redacted.

**Promise fields:**
- `description` (3–500)
- `due_source`: `explicit`, `relative`, `default_vague`, or `default_concrete`
- `due_at`: required for `explicit` and `relative`
- `made_by_name` (optional)

**`answer_check`:**
- `verdict`: `pass`, `fail`, or `uncertain`
- `asked` (1–500, a quote from the ask)
- `replied` (1–500, a quote from the reply)
- `gap` (≤500)

## 4. Taxonomy

**Request type** (defines what "done" means):
- `question`: the client wants information.
- `change`: they want something changed or set up.
- `decision`: they want us to choose or recommend ("should we…", "yes or no").
- `issue`: something is broken.
- `check_in`: outreach **we** start (e.g., an at-risk client), planned with a date. Never a client's ask; only team messages create it (section 10).

**Category** (drives routing):

| Value | Covers |
|---|---|
| `pricing` | rates, base/min price, discounts, promotions, fee markups |
| `stay_rules` | min stay, check-in/out days, gap nights, booking window |
| `availability` | blocking/unblocking dates |
| `listing_setup` | OTA/PMS sync, cleaning fees, cancellation policy, amenities |
| `performance` | occupancy, revenue, pacing, projections, comps |
| `reporting` | reports, dashboards, promised touchpoints |
| `billing` | charges, invoices, cards, subscriptions |
| `onboarding` | setup, credentials, portal/PriceLabs access, adding properties |
| `offboarding` | termination, transfers, final charges, removing properties |
| `other` | anything else |

"Should we discount?" is `pricing` + `decision`. "Can we reach $100K?" is `performance` + `question`.

## 5. Detection rules

- **Promises** (English and Spanish):
  - These count: "we'll review / look into / check / follow up / get back to you / confirm / keep you posted / send / make the adjustment", "I'll check with Gastón / the team", "lo reviso / lo revisaré / te confirmo / te aviso / lo ajustamos".
  - Hedged promises count too: "I'll try", "I'll see if I can", "voy a intentar". The client hears a commitment. Describe the team's own action (e.g., "Trigger the VRBO verification code to the client's phone"), and close it with `commitment_kept` when the next message shows it happened.
  - These don't count: "let us know", "feel free to reach out", and questions back to the client (those are `team_asked_client`).
- **Promise dates:** resolve relative dates in America/New_York at 6 PM ET.
  - "today" is 6 PM, or +4h if it's already past 4 PM.
  - "tomorrow" is tomorrow at 6 PM.
  - "by Monday" is Monday at 6 PM.
  - "end of week" is Friday at 6 PM.
  - "next week" is next Friday at 6 PM.
  - No date:
    - A vague "we'll review" is `default_vague` (the Hub gives it 24h).
    - A named deliverable is `default_concrete` (48h).
- **Team asks the client for something** (a code, access, a date, approval of a counter-offer): always send `team_asked_client`. Otherwise the client's reply counts as a chase instead of a reply.
- **Contingent promises:** if the same team message asks the client for something the promised work depends on ("I'm looking at the fee, but we need access; can you share the code?"), send **only** `team_asked_client`, with no `commitment_made`. The promise can't be kept until the client answers. When they do, the Hub's 24h reply clock takes over, and a promise in the team's next message starts fresh. A promise that doesn't depend on the ask ("report Friday; also, can you confirm the dates?") is still sent.
- **Team proposals:** when the team proposes a change ("can we lower the min from $500 to $400?") and the client approves, create the ticket **on the client's approval message**:
  - `request_type: "change"`, with the summary stating the approved change.
  - `client_message` quotes the approval, and `ai.rationale` quotes the proposal.
  - No approval means no ticket.
  - A counter-offer on an existing ticket is `team_asked_client` on that ticket, and the client's acceptance is a `client_message` on the same ticket.
- **Answer check:**
  - `pass`: right property and period, and it gives what the request type needs (a fact, an explicit yes/no, "done and live", or cause plus fix).
  - `fail`: only clear mismatches: wrong property or month, no yes/no on a decision, stats when an action was asked, or "we'll review" given as the answer.
  - `uncertain`: everything partial or ambiguous.
  - Set `proposes_answered` only on `pass`, or on `uncertain` when the gap is secondary (wording, a missing detail). **Never when the gap is the thing asked for** (data was asked and reasoning was given), and never on `fail`. On `money_at_stake` tickets the Hub accepts it **only on `pass`**.
  - After a `fail`, the client's next message on that ticket counts as a chase (they had to ask again).
- **Told live:** send `client_told_live` when a team message says a change is live and names the property and setting, or quotes a Hub "now applied" message (it includes "Ref #…").
- **Internal staff notes:** Assembly has none, so don't send `author_role: "internal"` or `internal_note_from_chat` in v1 (reserved for a future source).

## 6. Redaction (before sending anything)

- **Always replace with `[redacted: credential]`:** passwords (`password`, `pw:`, `pin`, `contraseña`… followed by a value), **one-time login codes** (VRBO/Expedia verification codes, 2FA, "código de verificación"), API keys and tokens (`sk_live_…`, `sk-…`, `rvf_live_…`, bearer tokens, JWTs, long hex strings), door, lock, gate, and keypad codes, and card numbers.
- **Mask:**
  - emails as `j***@gmail.com`
  - phone numbers to the last 4 digits (`***-***-4477`)
- **Keep** Airbnb and VRBO listing URLs (useful for matching), but strip their query strings.
- **The Hub also rejects** anything that still looks like a credential. That item comes back as `error`, and the message is not marked processed.

## 7. Response and retries

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
      "unresolved_listings": [],
      "possible_duplicate_of": null
    }
  ],
  "events": [{ "index": 0, "outcome": "applied", "ticket_id": "…" }]
}
```

- **`message.outcome`:**
  - `captured`, `no_ask`, `skipped_processed` (already done), `skipped_client_excluded`
  - `incomplete`: some items errored, so the message was **not** marked processed. Fix and resend the **same payload**. Items that already applied come back as `existing` or `duplicate`, never twice.
- **Ticket outcome:** `created`, `existing`, or `error`.
- **Event outcome:** `applied`, `duplicate`, `skipped` (with a `reason`), or `error`.
- **HTTP codes:**
  - 400 bad payload (see `issues`)
  - 404 unknown client
  - 409 an Assembly company maps to more than one Hub client (send `hub_client_id`)
  - 401/403 bad or under-scoped key
- **Hand-managed accounts:** send them like any other. The Hub has the list (`clients.support_hand_managed`), marks their tickets, and keeps every automatic change off.
- **Event order inside one message doesn't matter.** Priority is computed once per ticket after the whole message. The one exception is several operations on the same promise (keep, then cancel, fails).

## 8. Dry runs (before deploy)

Write the exact JSON you'd send, **without sending it anywhere**, and post it as a child page of the shared working page ("Dry run vN"). Claude validates it and replays it through the Hub's real logic.

Dry run v2 should cover the v1.1 changes:
- A team message asking the client for something (e.g. the VRBO code), followed by the client's reply. It should be a reply, not a chase.
- A team proposal the client approves, as a ticket on the approval message.
- At least one property resolved to a `hub_listing_id` through `/support-listings`. No Hub data exists yet, so use a placeholder and name the listing.
- Back-to-back messages from one client, shown in processing order.
- A money-at-stake ticket with an `uncertain` reply.

There are no Hub tickets yet, so for events on "existing" tickets use placeholder IDs `00000000-0000-4000-8000-00000000000N` and say which ask each refers to.

## 9. Suggested replies (v1.3)

A draft the ticket owner can edit and send in Assembly. **The bot never sends it.** One draft per ticket: each `PUT` replaces the previous one.

**When to draft**
- Only `pricing`, `performance`, and `stay_rules` tickets for now (the pricing voice skill, `revfactor-pricing-voice`).
- **Never `billing` or `offboarding`.** The Hub rejects them (422).
- Only open tickets. Resolved, dismissed, or merged tickets return 409, and so does a client with capture off.
- For `change` tickets, never draft "it's live" unless the Hub shows the linked Adjustment as controlled. Otherwise put the confirmation in brackets.

**Writing the draft**
- Gaps stay in `[brackets]`: dates, promises, and any number you can't pull from this client's real data (pacing, RevPAR, markup and channel %). The **ticket owner** fills them. On `money_at_stake` tickets, Fede approves before sending.
- Never reuse the skill's example numbers.
- Redact as in section 6. The Hub rejects credentials (422, without echoing them) and masks emails and phone numbers.

**Request**

```http
PUT /api/v1/support-tickets/{ticket_id}/suggested-reply
Authorization: Bearer rvf_live_…   (support:write)
Content-Type: application/json
```

```json
{
  "text": "Hi Kate! Great question. December is pacing [X]% vs the same point last year…",
  "basis": ["PriceLabs: December on-the-books vs same lead time last year"],
  "skill": "revfactor-pricing-voice",
  "prompt_version": "support-reply-v1",
  "generated_at": "2026-09-30T21:00:00-04:00"
}
```

| Field | Rules |
|---|---|
| `text` | Required, 1–4,000 characters, redacted |
| `basis` | Optional, up to 8 items of 1–300 characters: the data the draft used, in plain words |
| `skill` | Optional lowercase slug (`revfactor-pricing-voice`) |
| `prompt_version` | Optional, ≤60 characters |
| `generated_at` | Optional ISO 8601 with offset; defaults to now; can't be in the future |

**Responses**
- 200 `{ ticket_id, ticket_number, suggested_reply }` (the stored, masked draft)
- 400 bad payload (see `issues`) or a non-UUID ticket id
- 404 unknown ticket
- 409 the ticket is closed or merged, or capture is off for the client
- 422 billing or offboarding ticket, or a credential in the draft

`DELETE` on the same URL withdraws the draft (200 `{ ticket_id, ticket_number, cleared: true }`).

**Sync:** saving a draft doesn't change the ticket's `updated_at`, so drafts never show up as ticket activity in `updated_since` syncs. `GET /api/v1/support-tickets` returns `suggested_reply_generated_at` (null when there's no draft). Regenerate only when the conversation has moved on.

**Draft usage (v1.4)**
- On a `team_reply` to a ticket that had a draft (its `suggested_reply_generated_at` is before the reply), add `used_suggestion`:
  - `yes`: sent as drafted, or with light edits.
  - `partly`: reused some of it (structure, a paragraph, the numbers).
  - `no`: written independently.
- Leave it out when the ticket had no draft. The Hub ignores the tag if no draft existed before the reply.
- It's measurement only. It never changes the answer check or the ticket's status.

**Hub drafts (v1.6)**
- The Hub drafts a ticket once, right after capture, and only when it has no draft yet. It never replaces your draft on its own. A person can regenerate on the ticket page, which replaces whatever is there.
- A Hub draft shows as `suggested_reply_source: "hub"`. If you would draft that ticket (`pricing`, `performance`, `stay_rules`), `PUT` yours as usual. It replaces the Hub draft.
- `used_suggestion` is for your own drafts only. When the draft before the reply was a Hub draft, leave the tag out: you can't see its text.
- Don't `DELETE` a Hub draft. Withdraw only your own.

**The answer check stays independent of drafts**
- `answer_check` compares the reply the team **actually sent** with the client's ask, never with the draft.
- A sent reply that still has an unfilled bracket (`[date]`, `[X]%`, `[owner to fill]`) is a `fail` with `gap: "unfilled placeholder sent"` and no `proposes_answered`.

## Ticket writes (support sweep)

This endpoint is for Martín's support sweep agent, not the capture flow above. The sweep agent's closes are approval-gated on its side; the Hub records the approved bot action and does not add another approval step. The capture bot's rule still stands: it never resolves, merges, or dismisses anything.

```http
PATCH /api/v1/support-tickets/{id}
Authorization: Bearer rvf_live_…   (support:write)
Content-Type: application/json
```

```json
{
  "note": "Confirmed on the Oct 8 sweep that the request was completed.",
  "status": "closed",
  "actor_label": "Martín (support sweep)",
  "idempotency_key": "sweep:ticket-1029:close"
}
```

- Send `note` (3–1,000, credential-free) for a timeline note. Every status change also requires a note.
- `status` is `open`, `in_progress`, `awaiting_client`, `answered`, `resolved`, `closed`, or `dismissed`; `closed` is an alias for `resolved`, and `new` cannot be set.
- `dismiss_reason` is required only with `dismissed`. `answer_summary` (3–1,000, credential-free) is allowed only with `answered`.
- `actor_label` defaults to `Support API bot`; the Hub stores every label with a `Bot:` prefix. `idempotency_key` makes a retry return the original event without writing twice.
- Merged tickets and no-op status changes return 409. Hand-managed tickets accept notes but reject bot status changes.

Responses: 200 returns `ticket_id`, `ticket_number`, `status`, `previous_status`, `event_id`, and `replayed`; 400 means invalid JSON, id, fields, or field combination; 401 means a missing or invalid key; 403 means the key lacks `support:write`; 404 means the ticket does not exist; 409 means the ticket state blocks the change; 500 is a generic internal error.

## 10. Check-ins and asks raised outside Assembly (v1.5)

**Asks raised on a call or by email** are ordinary client asks. Send them like a chat message:
- `source: "call"` (or `"email"`), with `source_message_id` like `granola:<meeting id>:<n>`, one per ask.
- `message_at` is the call or email time, and `author_role` is `"client"`.

**A check-in is outreach we start ourselves.** For example: "check in with Marissa about December pacing by Friday".
- **Create it from the team message or call note where it was planned.** Send `author_role: "team"`, with a ticket of `request_type: "check_in"`.
- **The planned outreach goes in `commitments`.** At least one is required: the description says what we'll reach out about, plus its due date (`explicit` or `relative`).
- **Fields:**
  - `category`: the topic (usually `performance` or `reporting`).
  - `property.scope`: usually `account`.
  - `summary`: the purpose.
  - `client_message`: leave it out.
- **The Hub opens it with no client clock.** Only the outreach promise is due, and it shows as overdue if we're late.
- **When the team reaches out**, on that message:
  - `commitment_kept` on the outreach promise.
  - `team_asked_client` (or `team_reply`), which moves the ticket to waiting on client.
- **When the client replies:** send `client_message` (or `client_acknowledged`). Our normal 24h reply clock starts.
- **Logging the outcome:** a `team_reply` with `proposes_answered: true` records it. The summary should say what the client said and any next step.
- **Done:** a person verifies it. The Hub won't resolve a check-in until the client's reply after our outreach is logged.
- **Not a check-in:** an unplanned "just checking in" message that already went out. Don't create a ticket for it. If the client's reply contains an ask, that's a normal ticket.

## 11. Backfill import (approved 2026-09-30)

A one-time import of asks that were still open when capture went live.

1. **Dry run first.**
   - Post a safe list on the shared page: client, Hub client id, request type, category, open or answered, promise due, and a one-line summary. **No message text in Notion.**
   - Give Fede the full payload files. Claude replays them locally against the real Hub logic.
2. **Payloads:** one per original client ask message, using its original `source_message_id` and `message_at`.
   - Each ticket carries `backfill: { "batch": "<batch>", "initial_status": "open" }`.
   - Use `"answered"` only when the team said it was done and the client never confirmed. Put what the team said in `backfill.note`.
   - Promises already made go in `commitments`.
   - Send no events for the old back-and-forth.
3. **What the Hub does:**
   - The ticket keeps the original ask date and is tagged as backlog.
   - Its reply clock starts at import.
   - An overdue promise becomes due 24h after import.
   - Backlog stays out of the reply-time and promise metrics.
4. **Right before importing,** recheck each item against the chat:
   - The client confirmed it's done: skip it.
   - The team answered: import it as `answered`.
   - The client only followed up: keep it as one open ticket.
5. **Import order:** the backfill comes before switching every client to live capture. That way a chase on an old ask lands on its backfilled ticket.
