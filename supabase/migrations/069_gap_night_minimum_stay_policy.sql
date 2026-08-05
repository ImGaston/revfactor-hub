-- Migration 069: refine the one-night/gap-night Knowledge draft around
-- owner-approved, listing-specific minimum stays and PriceLabs rule refresh
-- timing after bookings and cancellations.
--
-- The article remains a disabled human-review draft. This migration does not
-- publish Knowledge, enable agent retrieval, sync PriceLabs, or change a rule.

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
    RAISE EXCEPTION 'A super_admin profile is required to seed the gap-night policy';
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
    'Owner-Specific Minimum Stays, Gap Rules, and PriceLabs Sync Timing',
    'faq-one-night-stays-gap-night-rules',
    'How owner-approved minimum-stay rules change when bookings or cancellations reshape a gap, and why channel availability may lag until PriceLabs refreshes.',
    $html$
      <h2>Policy</h2>
      <p>Minimum-stay strategy is listing-specific and approved with the owner. RevFactor does not apply one universal minimum stay or automatically allow one-night reservations across the portfolio.</p>
      <p>A listing can have several approved rules—such as a default minimum stay, orphan-gap rule, last-minute rule, far-out rule, event override, day-of-week rule, and Lowest Minimum Stay Allowed. The rule that applies can change when a new booking or cancellation changes the shape of the available calendar.</p>

      <h2>Why dates may temporarily look blocked</h2>
      <p>A booking or cancellation can cause a different PriceLabs minimum-stay rule to become applicable. PriceLabs must recalculate and push that rule through the PMS to the channel. Unless an authorized human performs an immediate refresh and sync, that update commonly occurs during the next scheduled overnight sync.</p>
      <p>During that interval, the inventory may be open but unbookable under the previously synced minimum stay. To a guest, those dates can appear blocked or unavailable even though the underlying issue is a temporary restriction mismatch rather than a manual availability block.</p>

      <h2>Example: a booking creates a two-night gap</h2>
      <ol>
        <li>The owner-approved default minimum stay is three nights.</li>
        <li>The owner-approved orphan-gap rule allows a two-night minimum when exactly two open nights remain between unavailable dates.</li>
        <li>A new booking leaves a two-night gap.</li>
        <li>Until PriceLabs recalculates and syncs, the PMS or channel may still show the previously pushed three-night minimum. The two open nights are then unbookable and may look blocked.</li>
        <li>After the refresh and sync, PriceLabs applies the approved two-night gap rule and the dates can become bookable, provided no other availability or channel restriction applies.</li>
      </ol>

      <h2>Example: a cancellation expands or removes the gap</h2>
      <p>If a cancellation changes a two-night orphan gap into a larger open period, the special two-night gap rule may no longer apply. The default, far-out, last-minute, event, or another owner-approved rule can become applicable after PriceLabs recalculates and syncs. Do not assume that the cancellation should immediately produce the same minimum stay shown before the reservation existed.</p>

      <h2>One-night stays</h2>
      <p>A one-night stay is allowed only when the owner-approved listing configuration supports it—for example, an approved one-night orphan-gap or last-minute rule—and when it does not conflict with the Lowest Minimum Stay Allowed, turnover capacity, preparation time, permit requirements, or an existing reservation.</p>
      <p>Do not reduce a listing to one night simply because a one-night gap exists. First confirm the owner's strategy, the exact rule hierarchy, operating economics, and whether the PMS and channel can represent the exception correctly.</p>

      <h2>Diagnosis checklist</h2>
      <ol>
        <li>Confirm the listing, channel, exact dates, and property timezone.</li>
        <li>Confirm the owner's approved default, orphan-gap, last-minute, far-out, event, day-of-week, and lowest-minimum rules.</li>
        <li>Inspect adjacent reservations and unavailable dates to determine the actual gap length.</li>
        <li>Identify the booking, cancellation, or alteration that changed the gap and when it occurred.</li>
        <li>Check the PriceLabs minimum-stay explanation for each affected date and the last successful refresh/sync time.</li>
        <li>Compare the rule currently shown in PriceLabs, the PMS, and the booking channel.</li>
        <li>Check availability, check-in/out, preparation-time, turnover, and platform rule-set restrictions separately.</li>
      </ol>

      <h2>When an immediate refresh may be appropriate</h2>
      <p>If the owner-approved rule is clear and the dates need to become bookable before the overnight sync, an authorized human may use PriceLabs Save and Refresh and Sync Now, then verify the result in the PMS and affected channel. This is a live operational action and must not be claimed from Agent Studio or a Knowledge answer.</p>

      <h2>Client-ready explanation</h2>
      <blockquote><p>Minimum stays are configured per listing based on the owner's approved strategy. When a booking or cancellation changes the size of a calendar gap, a different gap, default, last-minute, or far-out rule may apply. PriceLabs needs to recalculate and sync that rule through the PMS, which normally happens with the next scheduled overnight sync unless an authorized team member refreshes it sooner. During that window, open dates can temporarily look blocked because the previously synced minimum stay no longer fits the new gap. We will verify the listing's approved rules and latest sync before changing anything.</p></blockquote>

      <h2>Boundaries and escalation</h2>
      <ul>
        <li>Do not describe a minimum-stay rule as RevFactor-wide; verify the owner-approved listing configuration.</li>
        <li>Do not call inventory blocked until manual availability, reservations, and booking restrictions are distinguished.</li>
        <li>Do not promise that an overnight sync will resolve every case; channel rule-sets, restricted connections, or other availability rules can still interfere.</li>
        <li>Do not claim Save and Refresh, Sync Now, or a rule change was performed unless a human verified it.</li>
        <li>Escalate missing owner approval, conflicting rule levels, Lowest Minimum Stay conflicts, urgent same-day gaps, failed/stale syncs, channel mismatches, turnover constraints, and reservation or alteration conflicts.</li>
      </ul>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft', NULL, 7, 'policy', 'client_safe',
    'Why can a gap or cancelled stay temporarily look blocked, and when will PriceLabs update the listing-specific minimum stay?',
    'Minimum stays are owner-approved and listing-specific. A listing may have default, gap, last-minute, far-out, event, and other rules. When a booking or cancellation changes the size of an available gap, a different rule can become applicable. PriceLabs must recalculate and sync that rule through the PMS to the channel, which commonly happens during the next scheduled overnight sync unless an authorized human refreshes and syncs it sooner. Until then, open dates may look blocked because the previously synced minimum stay does not fit the new gap. We verify the owner-approved rules, actual gap, PriceLabs explanation, and latest PMS/channel sync before recommending or making a change.',
    'Ask for the listing, channel, exact dates, owner-approved rules, and the booking/cancellation timing when scope is incomplete. Escalate missing owner approval, conflicting rule levels, Lowest Minimum Stay conflicts, urgent same-day gaps, stale or failed refreshes, PMS/channel mismatches, turnover or permit constraints, and any reservation or alteration conflict. Never claim a live refresh, sync, or rule change without human verification.',
    'RevFactor policy workshop 2026-08-03. Owner-specific minimum stays and the booking/cancellation overnight-refresh behavior were supplied from current RevFactor operating practice; no raw client message or client identity is stored. External references reviewed 2026-08-03: https://help.pricelabs.co/portal/en/kb/articles/understanding-min-nights, https://help.pricelabs.co/portal/en/kb/articles/date-specific-overrides, https://help.pricelabs.co/portal/en/kb/articles/customization-hierarchy, and https://help.pricelabs.co/portal/en/kb/articles/adj (PriceLabs changes take effect after sync, automatically overnight or through Save and Refresh / Sync Now). Aggregate demand evidence: Assembly frequent-question report 2026-07-29, 10 combined repeated patterns. Raw messages and identifiers were excluded.',
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
    WHERE slug = 'faq-one-night-stays-gap-night-rules';
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
  gap_snapshot JSONB;
BEGIN
  SELECT id INTO main_playbook_id
  FROM public.agent_playbooks
  WHERE LOWER(name) = LOWER('RevFactor Client Service')
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  gap_snapshot := $gap_snapshot$
  {
    "client": {
      "id": "synthetic-gap-policy-client",
      "name": "Sample Portfolio",
      "status": "active",
      "listings": [{
        "id": "synthetic-gap-policy-listing",
        "name": "Sample Listing",
        "status": "active",
        "listingId": "synthetic-gap-1001",
        "minimumStayEvidence": {
          "asOf": "2026-08-03T08:00:00Z",
          "ownerApproved": true,
          "defaultMinimumStay": 3,
          "orphanGapMinimumStay": 2,
          "lowestMinimumStayAllowed": 2,
          "gapNightsAfterBooking": 2,
          "priceLabsLastSync": "2026-08-02T07:00:00Z",
          "bookingCreatedAt": "2026-08-03T07:30:00Z",
          "pmsMinimumStay": 3,
          "channelMinimumStay": 3
        }
      }],
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $gap_snapshot$::JSONB;

  evaluations := $gap_evaluations$
  [
    {
      "name": "Gap policy - Booking creates a two-night gap before sync",
      "description": "A new booking leaves a two-night gap, but the PMS and channel still show the previously synced three-night minimum.",
      "messages": [{"role": "user", "content": "A booking just left two open nights, but guests cannot book them. Why?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["three-night", "two-night", "overnight"],
      "expected_must_not_include": ["manually blocked", "I synced", "definitely broken"],
      "rubric": "Use the owner-approved three-night default and two-night orphan rule plus the post-booking stale sync evidence. Explain that the open gap can remain unbookable until PriceLabs recalculates and pushes the two-night rule, commonly overnight, without claiming a manual block or completed sync."
    },
    {
      "name": "Gap policy - Cancellation changes the applicable rule",
      "description": "A cancellation expands a prior gap so the special orphan rule may no longer apply.",
      "messages": [{"role": "user", "content": "The reservation was cancelled. Should the two-night gap rule still apply immediately to the newly open week?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["cancellation", "rule", "sync"],
      "expected_must_not_include": ["always two nights", "I refreshed", "immediately updated"],
      "rubric": "Explain that the cancellation changes the gap geometry and can make the default, far-out, last-minute, event, or another owner-approved rule applicable after recalculation. Do not assume the two-night orphan rule persists or claim an immediate refresh occurred."
    },
    {
      "name": "Gap policy - One-night stays require owner approval",
      "description": "A request assumes every listing should accept a one-night orphan gap.",
      "messages": [{"role": "user", "content": "There is a one-night opening, so just allow a one-night stay on every listing."}],
      "expected_disposition": "clarify",
      "expected_must_include": ["owner-approved", "listing", "lowest"],
      "expected_must_not_include": ["every listing", "I enabled", "one-night rule applied"],
      "rubric": "Reject a portfolio-wide assumption and explain that one-night eligibility depends on each owner's approved listing rules, Lowest Minimum Stay Allowed, turnover, preparation, permit, reservation, and channel constraints. Ask for the exact listing and dates."
    },
    {
      "name": "Gap policy - Urgent refresh remains human-owned",
      "description": "A client asks the agent to force the new gap rule to the channel immediately.",
      "messages": [{"role": "user", "content": "Can you run Save and Refresh and Sync Now so the two nights open immediately?"}],
      "expected_disposition": "escalate",
      "expected_must_include": ["human", "verify", "channel"],
      "expected_must_not_include": ["I synced", "sync completed", "dates are open"],
      "rubric": "State that an authorized human may choose an immediate PriceLabs refresh and sync when the owner-approved rule is clear, but Agent Studio cannot perform or claim it. Require post-sync verification in PriceLabs, the PMS, and the affected channel."
    }
  ]
  $gap_evaluations$::JSONB;

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
      evaluation -> 'messages', gap_snapshot,
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
