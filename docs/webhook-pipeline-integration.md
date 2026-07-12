# Pipeline Integration — Lead Ingest Webhook + Leads Read API

This is the external contract. It is written to be handed to the landing-page and marketing teams as-is.

Two endpoints, opposite directions:

| Endpoint | Direction | Auth | Purpose |
| --- | --- | --- | --- |
| `POST /api/webhooks/new-lead` | landing page → Hub | `x-webhook-secret` header | Create a lead with its attribution |
| `GET /api/v1/leads` | Hub → marketing's tracking stack | `Authorization: Bearer` API key | Read leads, attribution, and funnel timeline |

Base URL in production: `https://hub.revfactor.io`.

---

## 1. `POST /api/webhooks/new-lead`

Creates a lead in the pipeline at stage `inquiry`.

**Auth:** header `x-webhook-secret`, matched against the Hub's `WEBHOOK_SECRET`. Server-to-server; this secret must never reach a browser.

### Body

Only `email` is required. Everything else is optional.

```json
{
  "email": "juan@test.com",

  "full_name": "Juan Pérez",
  "project_name": "Test Property Miami",
  "phone": "+1234567890",
  "lead_source": "landing_page",
  "scheduled_date": "2026-08-10T15:00:00Z",
  "timezone": "America/New_York",
  "location": "Miami, FL",
  "description": "I have 3 properties in Miami Beach",
  "external_ref": "your-own-id",

  "attribution": {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "brand-q3",
    "utm_content": "hero-cta",
    "utm_term": "revenue management airbnb",
    "gclid": "Cj0KCQ...",
    "msclkid": null,
    "fbclid": null,
    "referrer": "https://www.google.com/",
    "landing_page": "https://revfactor.io/lp/audit?utm_source=google",

    "has_property": "yes",
    "is_pm": "yes",
    "properties": "12",
    "portfolio": "https://portfolio.example.com"
  }
}
```

Notes on the fields:

- `project_name` defaults to `full_name`, or to `email` when there is no name. **Send `full_name`** whenever the form captures it — otherwise the lead shows the email as its name on the board.
- `lead_source` defaults to `"landing_page"`. Send your own values freely (e.g. `landing_modal`, `newsletter_journal`).
- The canonical attribution keys are `utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, msclkid, fbclid, referrer, landing_page`. Use **`landing_page`** (not `landing`) for the URL — the others match verbatim.
- **Qualifier answers** (`has_property`, `is_pm`, `properties`, `portfolio`) and **any other key** you nest under `attribution` are preserved in `attribution_extra` and shown on the lead in the Hub. So send the full converted URL as `page`, iOS click ids as `gbraid`/`wbraid`, etc. — nothing is dropped. Only the ten canonical keys above become their own columns.
- `scheduled_date` must be valid ISO 8601 if present. It is the datetime **of the call**, not the moment it was booked.
- **Attribution** may be sent nested under `attribution` (preferred) or flat at the top level. If a key appears in both, the top-level value wins. Any key inside `attribution` that is not one of the nine canonical ones is preserved in a `attribution_extra` JSON blob — so you can add a tracking param without waiting on a Hub deploy.
- `external_ref` is yours: use it to correlate the Hub lead with a record in your own system.

### Responses

| Status | Body | When |
| --- | --- | --- |
| `201` | `{"success": true, "lead_id": "<uuid>"}` | Lead created |
| `200` | `{"success": true, "lead_id": "<uuid>", "deduped": true}` | An active lead with that email already existed |
| `400` | `{"error": "..."}` | Missing/invalid `email`, or malformed `scheduled_date` |
| `401` | `{"error": "Unauthorized"}` | Missing or wrong secret |
| `500` | `{"error": "Internal server error"}` | |

### Deduplication

Email-capture forms double-submit easily, so a request whose email matches an **active** lead (not archived, not completed) returns that lead's id with `deduped: true` instead of creating a second one.

Attribution follows **first touch wins, but only if there was a first touch**: if the existing lead has no `utm_source` and the incoming request carries attribution, the Hub fills it in. This covers the case where the first submit arrived without UTMs.

### Test

```bash
curl -X POST https://hub.revfactor.io/api/webhooks/new-lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{
    "email": "juan@test.com",
    "full_name": "Juan Pérez",
    "attribution": { "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "brand-q3" }
  }'
```

The lead should appear in the Inquiry column of `/pipeline`.

---

## 2. `GET /api/v1/leads`

Reads leads with their attribution and their funnel timeline, so lead source can be tied to booked calls and closed deals.

**Auth:** `Authorization: Bearer rvf_live_...`. The key is issued by RevFactor and carries the `leads:read` scope. **It must live server-side** in your stack — it returns personal data (name, email, phone) for every lead, and it can be revoked by us at any time. Rotation is: we issue a new key, you deploy it, we revoke the old one.

### Query parameters

| Param | Default | Meaning |
| --- | --- | --- |
| `updated_since` | — | ISO 8601. Only leads modified after this instant. This is how you sync incrementally. |
| `limit` | `100` | Page size, capped at `500`. |
| `cursor` | — | Opaque; pass back the `next_cursor` from the previous page. |
| `include` | — | `events` adds the raw stage-transition list to each lead. |

Pagination is keyset-based and ordered by `updated_at`, so it stays stable even while leads are being edited mid-walk. Keep calling with `next_cursor` until `has_more` is `false`; store the last `updated_at` you saw and pass it as `updated_since` on the next sync.

### Response

```json
{
  "data": [
    {
      "id": "3f2a...",
      "created_at": "2026-07-01T10:00:00Z",
      "updated_at": "2026-07-09T14:00:00Z",
      "stage": "retainer_paid",
      "outcome": "won",
      "is_won": true,
      "lost_reason": null,
      "is_archived": false,
      "is_completed": false,
      "full_name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+15550100",
      "lead_source": "landing_page",
      "service_type": null,
      "location": "Miami, FL",
      "scheduled_date": "2026-07-05T15:00:00Z",
      "external_ref": null,
      "attribution": {
        "utm_source": "google",
        "utm_medium": "cpc",
        "utm_campaign": "brand-q3",
        "utm_content": null,
        "utm_term": null,
        "gclid": "Cj0KCQ...",
        "msclkid": null,
        "fbclid": null,
        "referrer": "https://www.google.com/",
        "landing_page": "https://revfactor.io/lp/audit",
        "extra": { "has_property": "yes", "is_pm": "yes", "properties": "12" }
      },
      "timeline": {
        "created_at": "2026-07-01T10:00:00Z",
        "booked_call_at": "2026-07-02T09:12:00Z",
        "proposal_sent_at": "2026-07-04T11:30:00Z",
        "proposal_signed_at": "2026-07-06T16:05:00Z",
        "retainer_paid_at": "2026-07-08T08:00:00Z",
        "converted_at": "2026-07-08T12:00:00Z",
        "lost_at": null
      }
    }
  ],
  "next_cursor": "2026-07-09T14:00:00Z|3f2a...",
  "has_more": false
}
```

### Outcome — for close-rate math and offline conversions

- **`outcome` is the clean tri-state: `"won" | "lost" | "open"`.** Use this, not the raw board flags, for close-rate per campaign. `won` = became a client (precedence over lost). `lost` = explicitly marked lost/disqualified; `lost_reason` tells you why (`price`, `timing`, `no_response`, `not_qualified`, `competitor`, `other`). `open` = still in play.
- **`timeline.converted_at` / `timeline.lost_at`** are the timestamps for won / lost. Combined with `attribution.gclid` and `attribution.msclkid`, that's everything you need to push offline conversions back to Google Ads / Microsoft Ads when a lead hits `booked_call_at`, `proposal_sent_at`, or `won`.
- `is_won` stays as a boolean alias of `outcome === "won"` (back-compat). Prefer `outcome`.

### Reading the timeline

Four things matter here and they are easy to conflate.

- **`booked_call_at` is not `scheduled_date`.** The first is when the lead entered the `meeting` stage — when the call got booked. The second is when the call is scheduled to happen. For attribution you almost always want `booked_call_at`.
- **`outcome`/`is_won` is the closed-deal signal, not `stage`.** Won means the lead became a real client in Assembly. Do not infer "won" from `stage`: the stage keeps advancing past `retainer_paid` into `planning`, so a won deal usually isn't sitting on the stage you'd expect.
- **Each milestone is the *first* time the lead entered that stage.** A lead can move backwards and re-enter, and that will not overwrite the milestone. Don't double-count.
- **The timeline starts on 2026-07-10.** Stage history is recorded from that deploy onward. Leads created before it carry a single synthetic event at whatever stage they were in, so their `booked_call_at` and `retainer_paid_at` are `null` or approximate. Cohort your funnel reports from the deploy date.

`stage` is one of: `inquiry`, `follow_up`, `audit`, `meeting`, `proposal_sent`, `proposal_signed`, `retainer_paid`, `planning`.

Deliberately not returned: the lead's internal notes and `description` (it can contain third-party contact details), the internal project label, tags, and team assignments.

### Errors

| Status | When |
| --- | --- |
| `400` | Bad `updated_since`, `limit`, or `cursor` |
| `401` | Missing, malformed, invalid, or revoked key |
| `403` | Valid key without the `leads:read` scope |
| `429` | Rate limited; honor the `Retry-After` header |
| `500` | |

### Test

```bash
curl -s "https://hub.revfactor.io/api/v1/leads?updated_since=2026-01-01T00:00:00Z&limit=10" \
  -H "Authorization: Bearer $LEADS_API_KEY"
```

---

## 3. Operating the API key (internal)

Keys live in the `api_keys` table, stored as a SHA-256 digest — the plaintext is shown once at creation and is not recoverable.

```bash
# Issue
npx tsx --env-file=.env.local scripts/create-api-key.ts \
  "Marketing tracking stack" marketing@example.com leads:read

# Revoke — effective immediately, no redeploy
npx tsx --env-file=.env.local scripts/revoke-api-key.ts rvf_live_a1b2c3d4
```

Env vars, set in Vercel and `.env.local`: `WEBHOOK_SECRET` (generate with `openssl rand -hex 32`) for the ingest webhook. The read API needs no env var — its keys are rows.
