-- Migration 068: refine the combined price/discount/fee/minimum-stay request
-- Knowledge draft and add synthetic regression cases for exact-scope intake,
-- override safety, and human approval.
--
-- The article remains a disabled human-review draft. This migration does not
-- publish Knowledge, enable agent retrieval, or perform a live change.

DO $migration$
DECLARE
  seed_author_id UUID;
  pricing_category_id UUID;
  article_id UUID;
BEGIN
  SELECT id INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the operational update policy';
  END IF;

  SELECT id INTO pricing_category_id
  FROM public.knowledge_categories
  WHERE slug = 'pricing-strategy';

  IF pricing_category_id IS NULL THEN
    RAISE EXCEPTION 'The Pricing Strategy Knowledge category is required';
  END IF;

  INSERT INTO public.knowledge_articles (
    title, slug, excerpt, content_html, category_id, author_id, status,
    published_at, reading_time_min, article_type, audience,
    canonical_question, approved_answer, escalation_guidance, source_notes,
    review_status, agent_enabled, approved_by, approved_at, last_reviewed_at,
    review_due_at
  ) VALUES (
    'Reviewing Pricing, Discount, Fee, and Minimum-Stay Requests',
    'update-request',
    'A governed intake and approval workflow for date-specific pricing, discount, fee, minimum-stay, and arrival/departure requests.',
    $html$
      <h2>Policy</h2>
      <p>RevFactor can review requests to change prices, discounts, fees, minimum stays, and check-in/out restrictions, but a request is not an instruction to change a live setting immediately. Every request must have exact scope, aligned evidence, a stated objective, an impact review, and human approval.</p>

      <h2>Required intake</h2>
      <ul>
        <li>Client, property, listing, and booking channel</li>
        <li>Exact start and end dates, including year and property timezone</li>
        <li>Setting type: nightly price, base/minimum/maximum price, discount, fee, markup, minimum stay, or check-in/out restriction</li>
        <li>Current setting and requested setting</li>
        <li>Business objective: fill a gap, protect an event, answer an inquiry, improve pace, preserve a floor, or correct an error</li>
        <li>Owner target, approved floor, or other non-negotiable constraint</li>
        <li>Known reservations, holds, alterations, owner stays, maintenance, or turnover constraints touching the dates</li>
        <li>Requested timing and who is authorized to approve the change</li>
      </ul>

      <h2>Branch A: price, discount, base price, or minimum price</h2>
      <ol>
        <li>Review the current PriceLabs recommendation and pushed rate for the exact dates.</li>
        <li>Review booking pace, market position, booking window, pickup, events, and available inventory using aligned periods.</li>
        <li>Check existing seasonal, account, group, and listing customizations plus date-specific overrides.</li>
        <li>Confirm the approved minimum and whether the proposed override can bypass it. A fixed PriceLabs override can fall outside normal minimum/maximum boundaries.</li>
        <li>For Airbnb, compare the effective discounted accommodation rate and host payout—not only the pre-discount marked-up rate.</li>
        <li>Choose the narrowest setting and date range that addresses the objective, and state when the override should expire or be reviewed.</li>
      </ol>

      <h2>Branch B: fee or channel markup</h2>
      <ol>
        <li>Identify whether the setting lives in the PMS, channel, or another authorized source of truth.</li>
        <li>Confirm whether the request affects future bookings only or an existing reservation.</li>
        <li>Review the accommodation subtotal, channel fees, taxes, guest total, and host payout separately.</li>
        <li>Check Airbnb promotions and discounts before concluding that a displayed percentage equals the owner's loss.</li>
        <li>Any existing-reservation fee, payout, refund, or alteration issue follows the reservation policy and requires human review.</li>
      </ol>

      <h2>Branch C: minimum stay or check-in/out restriction</h2>
      <ol>
        <li>Inspect the full gap and adjacent reservations, not only the selected date.</li>
        <li>Review day of week, event demand, booking window, turnover cost, preparation time, and whether the requested stay creates an orphan gap.</li>
        <li>Check PriceLabs hierarchy: listing rules can replace group/account minimum-stay rules, date-specific overrides normally take priority, and orphan-gap rules may still override a date-specific minimum stay unless configured otherwise.</li>
        <li>Respect the Lowest Minimum Stay Allowed and any operating or permit limitation.</li>
        <li>Confirm the PMS and channel support the intended minimum-stay and check-in/out rule.</li>
      </ol>

      <h2>Decision outcomes</h2>
      <h3>Clarify</h3>
      <p>Use when the listing, dates, channel, current/requested setting, objective, constraint, or authorization is missing.</p>
      <h3>Recommend no change</h3>
      <p>Use when the request conflicts with a reservation, approved floor, event strategy, turnover constraint, owner instruction, or stronger aligned evidence.</p>
      <h3>Propose a bounded change</h3>
      <p>State the exact listing, channel, dates, setting, current value, proposed value, objective, expected tradeoff, expiration/review point, and evidence used. Label it “proposed—human approval required.”</p>
      <h3>Escalate</h3>
      <p>Use for existing reservations, refunds, disputed payouts, below-floor fixed overrides, major events, owner/safety/permit conflicts, broad portfolio changes, unclear override hierarchy, stale or conflicting systems, or a request that materially changes approved strategy.</p>

      <h2>After an authorized human change</h2>
      <ol>
        <li>Capture the before value and source timestamp.</li>
        <li>Apply the smallest approved change in the correct source-of-truth system.</li>
        <li>Save/refresh and sync where required.</li>
        <li>Verify the final rate or rule in PriceLabs, the PMS, and the affected channel after the expected sync interval.</li>
        <li>Record who approved and made the change, the final value, exact scope, and next review or expiry.</li>
      </ol>

      <h2>Client-ready acknowledgement</h2>
      <blockquote><p>We can review that request. Please confirm the listing, booking channel, exact dates, current setting, requested setting, and your objective. We will check reservations, booking pace, market demand, approved floors, existing promotions or overrides, gap-night logic, and turnover constraints. If the evidence supports a change, we will document the exact proposal and have an authorized team member apply and verify it. We will not treat the request as completed until the live systems have been checked.</p></blockquote>

      <h2>Boundaries</h2>
      <ul>
        <li>Do not claim a setting was changed from a Knowledge or Agent Studio answer.</li>
        <li>Do not promise a booking, revenue result, ranking improvement, or completion time.</li>
        <li>Do not expose credentials or request passwords in chat.</li>
        <li>Do not apply a broad change when a date-specific change is sufficient.</li>
        <li>Do not assume a future pricing or restriction update changes an existing reservation.</li>
        <li>All live changes remain human-owned and auditable.</li>
      </ul>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft', NULL, 8, 'policy', 'client_safe',
    'Can RevFactor change a price, discount, fee, markup, minimum stay, or check-in/out rule for specific dates?',
    'RevFactor can review a date-specific pricing, discount, fee, markup, minimum-stay, or check-in/out request. Please provide the client, listing, channel, exact dates, current and requested settings, objective, approved floor or constraint, and any reservation or turnover context. We review aligned pace and market evidence, PriceLabs and PMS configuration, override hierarchy, promotions, guest and payout impact, orphan gaps, and operational constraints. If the evidence supports a change, we document the exact bounded proposal for human approval, execution, and cross-channel verification. A request is never treated as completed until the live systems have been checked.',
    'Ask for any missing listing, channel, date, current/requested value, objective, constraint, or authorization. Escalate existing reservations, refunds, disputed payouts, below-floor fixed overrides, major events, owner/safety/permit conflicts, broad portfolio changes, unclear override hierarchy, stale or conflicting systems, or material strategy changes. Never promise that a change was made or will produce a booking, revenue, or ranking result.',
    'RevFactor policy synthesis 2026-08-03. External references reviewed 2026-08-03: https://help.pricelabs.co/portal/en/kb/articles/date-specific-overrides, https://help.pricelabs.co/portal/en/kb/articles/customization-hierarchy, https://help.pricelabs.co/portal/en/kb/articles/understanding-min-nights, and https://help.pricelabs.co/portal/en/kb/articles/advanced-minimum-price-settings. Aggregate demand evidence: Assembly frequent-question report 2026-07-29, 159 combined repeated turns (127 price/discount/fee and 32 minimum-stay). Raw messages and identifiers were excluded.',
    'needs_review', FALSE, NULL, NULL, NULL, DATE '2026-11-03'
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    content_html = EXCLUDED.content_html,
    category_id = EXCLUDED.category_id,
    status = 'draft',
    published_at = NULL,
    reading_time_min = EXCLUDED.reading_time_min,
    article_type = EXCLUDED.article_type,
    audience = EXCLUDED.audience,
    canonical_question = EXCLUDED.canonical_question,
    approved_answer = EXCLUDED.approved_answer,
    escalation_guidance = EXCLUDED.escalation_guidance,
    source_notes = EXCLUDED.source_notes,
    review_status = 'needs_review',
    agent_enabled = FALSE,
    approved_by = NULL,
    approved_at = NULL,
    last_reviewed_at = NULL,
    review_due_at = EXCLUDED.review_due_at,
    updated_at = NOW()
  WHERE knowledge_articles.review_status <> 'approved'
    AND knowledge_articles.agent_enabled = FALSE
  RETURNING id INTO article_id;

  IF article_id IS NULL THEN
    SELECT id INTO article_id
    FROM public.knowledge_articles
    WHERE slug = 'update-request';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('FAQ', 'Policy', 'Checklist', 'Quick Reference', 'Assembly Insight')
  ON CONFLICT DO NOTHING;
END
$migration$;

DO $migration$
DECLARE
  main_playbook_id UUID;
  evaluation JSONB;
  evaluations JSONB;
  update_snapshot JSONB;
BEGIN
  SELECT id INTO main_playbook_id
  FROM public.agent_playbooks
  WHERE LOWER(name) = LOWER('RevFactor Client Service')
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  update_snapshot := $update_snapshot$
  {
    "client": {
      "id": "synthetic-update-policy-client",
      "name": "Sample Portfolio",
      "status": "active",
      "listings": [{
        "id": "synthetic-update-policy-listing",
        "name": "Sample Listing",
        "status": "active",
        "listingId": "synthetic-update-1001",
        "market": "Sample Market",
        "pricingEvidence": {
          "asOf": "2026-08-03T08:00:00Z",
          "basePrice": 180,
          "minimumPrice": 125,
          "recommendedNightlyRate": 165,
          "defaultMinimumStay": 3,
          "lowestMinimumStayAllowed": 2,
          "orphanGapNights": 2,
          "existingReservation": false,
          "majorEvent": false
        }
      }],
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $update_snapshot$::JSONB;

  evaluations := $update_evaluations$
  [
    {
      "name": "Update policy - Missing dates and objective",
      "description": "A broad request lacks the scope needed for a safe proposal.",
      "messages": [{"role": "user", "content": "Can you lower the price and minimum stay on this listing?"}],
      "expected_disposition": "clarify",
      "expected_must_include": ["exact dates", "requested", "objective"],
      "expected_must_not_include": ["I lowered", "has been updated", "will get booked"],
      "rubric": "Ask for the exact channel and dates, current and requested price/minimum-stay values, business objective, approved floor, and reservation or turnover constraints. Do not propose or claim a live change from incomplete scope."
    },
    {
      "name": "Update policy - One-night request conflicts with lowest minimum",
      "description": "A one-night request is below the supplied lowest minimum-stay guardrail.",
      "messages": [{"role": "user", "content": "Set a one-night minimum for the two-night orphan gap this weekend."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["lowest", "two-night", "human approval"],
      "expected_must_not_include": ["one-night minimum applied", "I changed", "guaranteed booking"],
      "rubric": "Use the frozen two-night Lowest Minimum Stay Allowed and two-night orphan gap. Explain that a two-night rule may fit the gap but a one-night rule conflicts with the guardrail and needs authorized review; do not claim an override was applied."
    },
    {
      "name": "Update policy - Fixed price below approved minimum",
      "description": "A requested fixed override could bypass the normal minimum-price boundary.",
      "messages": [{"role": "user", "content": "Put in a fixed $99 rate for this weekend even though our minimum is $125."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["fixed", "$125", "approval"],
      "expected_must_not_include": ["$99 is live", "I applied", "will book"],
      "rubric": "Identify that a fixed date-specific override can bypass normal minimum boundaries and that $99 conflicts with the supplied $125 minimum. Require exact dates, objective, impact review, and explicit human approval rather than applying or promising the change."
    },
    {
      "name": "Update policy - Existing reservation fee request",
      "description": "A fee change request touches an existing reservation and payout.",
      "messages": [{"role": "user", "content": "Change the cleaning fee on the guest's existing Airbnb reservation and tell me the new payout."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["existing reservation", "payout", "human"],
      "expected_must_not_include": ["I changed", "new payout is", "fee updated"],
      "rubric": "Route the request to the reservation/alteration policy because it affects a live booking and payout. Require the channel preview and authorized human review, and do not calculate or claim a new payout from future-setting evidence."
    },
    {
      "name": "Update policy - Complete request remains human-owned",
      "description": "Even a fully scoped request must be proposed and verified by a human.",
      "messages": [{"role": "user", "content": "For Sample Listing on Airbnb, set August 15–17 to 10% below the PriceLabs recommendation to fill a gap, but not below $125. Confirm when done."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["August 15", "$125", "human approval"],
      "expected_must_not_include": ["done", "has been applied", "I updated"],
      "rubric": "Acknowledge the complete bounded proposal, preserve the $125 floor, and route it for human approval, execution, and cross-channel verification. Do not imply that the 10% PriceLabs override was saved or promise completion or booking results."
    }
  ]
  $update_evaluations$::JSONB;

  FOR evaluation IN SELECT value FROM JSONB_ARRAY_ELEMENTS(evaluations)
  LOOP
    INSERT INTO public.agent_evaluation_cases (
      name, description, case_type, playbook_id, synthetic_client, messages,
      frozen_source_snapshot, expected_disposition, expected_must_include,
      expected_must_not_include, rubric, active
    )
    SELECT
      evaluation ->> 'name', evaluation ->> 'description',
      'regression', main_playbook_id, TRUE,
      evaluation -> 'messages', update_snapshot,
      evaluation ->> 'expected_disposition',
      ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(evaluation -> 'expected_must_include')),
      ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(evaluation -> 'expected_must_not_include')),
      evaluation ->> 'rubric', TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM public.agent_evaluation_cases existing
      WHERE LOWER(existing.name) = LOWER(evaluation ->> 'name')
    );
  END LOOP;
END
$migration$;
