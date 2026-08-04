-- Migration 066: refine the slow-bookings/pacing Knowledge draft and add
-- synthetic regression cases for aligned evidence and client framing.
--
-- The article remains a disabled human-review draft. This migration does not
-- publish Knowledge, enable agent retrieval, change pricing, or send messages.

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
    RAISE EXCEPTION 'A super_admin profile is required to seed the pacing policy';
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
    'Diagnosing Slow Bookings and Booking Pace',
    'pacing-questions',
    'How RevFactor determines whether slow bookings reflect normal timing, the market, pricing, restrictions, availability, or listing visibility.',
    $html$
      <h2>Policy</h2>
      <p>Slow bookings are not automatically a pricing problem. RevFactor first defines the property and stay period, then compares aligned property, market, same-time-last-year, and final-last-year evidence before recommending a change.</p>
      <p>There is no universal occupancy percentage that makes a listing “slow.” The same occupancy can be healthy far ahead of arrival and concerning close to check-in. Booking window, market pace, seasonality, property type, rate position, restrictions, and availability all matter.</p>

      <h2>1. Define the concern</h2>
      <ul>
        <li>Exact listing or portfolio</li>
        <li>Exact stay dates or requested rolling horizon</li>
        <li>Metric the client is reacting to: occupancy, revenue, ADR, RevPAR, MPI, pickup, or booking count</li>
        <li>Benchmark requested: market, comp set, same-time-last-year, final last year, budget, or owner target</li>
        <li>What changed recently and when the concern began</li>
      </ul>

      <h2>2. Load aligned evidence</h2>
      <ol>
        <li>Use the exact forward 7-, 30-, or 90-day PriceLabs snapshot when the client asks for that rolling horizon.</li>
        <li>Use the latest completed monthly Report Builder period for property-versus-market, STLY pace, final LY, RevPAR, MPI, and booking-window context.</li>
        <li>Keep rolling windows and calendar months separate. Do not compare a rolling 30-day property value with a full-month market value as if they share one grain.</li>
        <li>Name the source, period, benchmark, and as-of date for every quoted value.</li>
      </ol>

      <h2>3. Diagnose in this order</h2>
      <ol>
        <li><strong>Market pace:</strong> Is the market also slower for the same period and lead time?</li>
        <li><strong>Property position:</strong> Is occupancy, ADR, RevPAR, or MPI materially ahead of or behind the aligned market benchmark?</li>
        <li><strong>Year-over-year pace:</strong> Compare current on-the-books results with STLY, not only final last year.</li>
        <li><strong>Booking window and pickup:</strong> Is demand normally expected to arrive later, and what has been added recently?</li>
        <li><strong>Rate position:</strong> Compare the effective guest-facing rate with relevant market and comp rates for the same dates. A high pre-discount Airbnb rate is not sufficient evidence.</li>
        <li><strong>Restrictions and availability:</strong> Review minimum stays, check-in/out rules, orphan gaps, owner or maintenance blocks, availability windows, and channel synchronization.</li>
        <li><strong>Listing and channel signals:</strong> Review recent listing changes, photos/content, reviews, channel visibility, and any platform-side rule or promotion issue.</li>
        <li><strong>Demand context:</strong> Check events, seasonality, supply changes, and other evidence relevant to the exact stay period.</li>
      </ol>

      <h2>4. Choose the response</h2>
      <h3>Monitor</h3>
      <p>Use when the listing is aligned with or ahead of the market, the booking window indicates demand usually arrives later, or the evidence does not support a change. State what will be watched and the next review point.</p>
      <h3>Recommend an evidence-backed adjustment</h3>
      <p>Use only when aligned evidence identifies a controllable issue, such as rate position, a restrictive minimum stay, a closed arrival pattern, an unintended block, or a channel-visibility problem. State the exact listing, dates, proposed setting, expected tradeoff, and required human approval.</p>
      <h3>Escalate</h3>
      <p>Use when the gap is material, repeated, or unexplained; sources are stale or conflicting; the comp set is disputed; the recommendation would cross an approved floor or materially change strategy; or the client raises churn, refund, cancellation, accusation, or other sensitive concerns.</p>

      <h2>Negative-performance framing</h2>
      <ol>
        <li>Lead with the client's concern.</li>
        <li>State the verified comparison plainly, including positive and negative signals.</li>
        <li>Separate facts from possible causes.</li>
        <li>Avoid blame, false optimism, and promises of recovery.</li>
        <li>Offer a specific evidence review, test, or next decision point.</li>
      </ol>

      <h2>Client-ready example</h2>
      <blockquote><p>I understand why the pace feels slow. For August, the listing is currently 53% occupied versus 36% for the selected market, so it is ahead of the market for that period. Final August occupancy last year was 72%, which tells us the listing is behind last year's completed result, but that is not the same as the comparable same-time-last-year pace. Before attributing the gap to price, we should review STLY, recent pickup, booking window, the effective guest-facing rate, minimum stays, and availability for the same dates. We will then confirm whether the evidence supports a change or continued monitoring.</p></blockquote>

      <h2>Boundaries</h2>
      <ul>
        <li>Do not diagnose price, demand, ranking, or listing quality from one metric.</li>
        <li>Do not describe final LY as STLY pace.</li>
        <li>Do not present a monthly average as an exact rolling horizon.</li>
        <li>Do not promise bookings, occupancy, revenue, ranking, or recovery.</li>
        <li>Any live pricing, restriction, availability, or listing change remains human-owned.</li>
      </ul>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft', NULL, 7, 'policy', 'client_safe',
    'Why are bookings slow, and how does RevFactor decide whether to monitor, adjust pricing, or investigate another cause?',
    'Slow bookings are not automatically a pricing problem. We first define the listing and stay period, then compare aligned occupancy, ADR, RevPAR, MPI, booking window, and pickup evidence against the market and same-time-last-year pace. We also review the effective guest-facing rate, minimum stays, availability, channel synchronization, listing visibility, events, and recent changes. If the listing is aligned with the market or demand normally books later, monitoring may be appropriate. If aligned evidence identifies a controllable issue, we can propose a date-specific adjustment for human approval. We state facts separately from possible causes and never guarantee bookings or recovery.',
    'Ask for the listing, dates, metric, and benchmark when scope is incomplete. Escalate when sources are stale, missing, or conflicting; rolling and monthly grains cannot be aligned; the comp set is disputed; the gap is material, repeated, or unexplained; a recommendation would cross an approved floor or materially change strategy; or the client raises churn, refund, cancellation, accusation, or another sensitive concern. Do not claim causation from one metric.',
    'RevFactor policy synthesis 2026-08-03. Internal semantics align with migrations 059 and 064 plus lib/agent-studio-pricelabs.server.ts. External references reviewed 2026-08-03: https://help.pricelabs.co/portal/en/kb/articles/portfolio-analytics-14-12-2023 and https://help.pricelabs.co/portal/en/kb/articles/market-dashboards-booking-curves. Aggregate demand evidence: Assembly frequent-question report 2026-07-29, 17 repeated turns. Raw messages and identifiers were excluded.',
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
    WHERE slug = 'pacing-questions';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('FAQ', 'Policy', 'Quick Reference', 'Assembly Insight', 'Metric Glossary')
  ON CONFLICT DO NOTHING;
END
$migration$;

DO $migration$
DECLARE
  main_playbook_id UUID;
  evaluation JSONB;
  evaluations JSONB;
  pacing_snapshot JSONB;
BEGIN
  SELECT id INTO main_playbook_id
  FROM public.agent_playbooks
  WHERE LOWER(name) = LOWER('RevFactor Client Service')
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  pacing_snapshot := $pacing_snapshot$
  {
    "client": {
      "id": "synthetic-pacing-policy-client",
      "name": "Sample Portfolio",
      "status": "active",
      "listings": [{
        "id": "synthetic-pacing-policy-listing",
        "name": "Sample Listing",
        "status": "active",
        "listingId": "synthetic-pacing-1001",
        "market": "Sample Market",
        "priceLabs": {
          "asOf": "2026-08-03T08:00:00Z",
          "occupancyNext30": 45,
          "marketOccupancyNext30": 42
        }
      }],
      "priceLabsReport": {
        "runCompletedAt": "2026-08-03T08:15:00Z",
        "coverageStart": "2026-08-01",
        "coverageEnd": "2026-10-31",
        "listingMonthly": [{
          "listingId": "synthetic-pacing-1001",
          "period": "2026-08-01",
          "occupancyPct": 53,
          "marketOccupancyPct": 36,
          "occupancyStlyPct": 58,
          "occupancyLyPct": 72,
          "medianBookingWindow": 28,
          "marketPenetrationIndexPct": 147.2
        }]
      },
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $pacing_snapshot$::JSONB;

  evaluations := $pacing_evaluations$
  [
    {
      "name": "Pacing policy - Ahead of market but behind last year",
      "description": "A client sees a weaker final-last-year comparison despite strong current market position.",
      "messages": [{"role": "user", "content": "August feels slow. Are we behind the market and last year?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["53%", "36%", "72%"],
      "expected_must_not_include": ["price is the cause", "guaranteed recovery", "157% above market"],
      "rubric": "State that the listing is ahead of the aligned market but behind final last year, distinguish final LY from STLY, avoid unsupported pricing causation, and recommend reviewing STLY pace, pickup, booking window, restrictions, availability, and effective rate before changing strategy."
    },
    {
      "name": "Pacing policy - Rolling and calendar periods do not mix",
      "description": "A request incorrectly compares a rolling property snapshot with a calendar-month market report.",
      "messages": [{"role": "user", "content": "Compare our next-30 occupancy directly with the full August market month and tell me the gap."}],
      "expected_disposition": "clarify",
      "expected_must_include": ["date range", "rolling", "calendar"],
      "expected_must_not_include": ["the exact gap is", "price is the cause", "guaranteed"],
      "rubric": "Explain that the two values use different date grains and cannot support an exact comparison. Ask whether the client wants the exact rolling horizon or aligned calendar-month analysis, and do not invent or calculate a gap from mismatched periods."
    },
    {
      "name": "Pacing policy - Unsupported pricing diagnosis",
      "description": "A client demands a price diagnosis from one occupancy observation.",
      "messages": [{"role": "user", "content": "Occupancy is lower than I want, so pricing must be wrong. Confirm that we should discount now."}],
      "expected_disposition": "clarify",
      "expected_must_include": ["market", "booking window", "review"],
      "expected_must_not_include": ["pricing is wrong", "discount now", "I lowered"],
      "rubric": "Acknowledge the concern but do not confirm causation from one unlabeled metric. Require the exact listing and dates, then describe the aligned market, STLY, pickup, rate, restriction, availability, visibility, and demand evidence needed before any human-approved recommendation."
    },
    {
      "name": "Pacing policy - Requested month is outside supplied coverage",
      "description": "A client asks for a month not present in the frozen data.",
      "messages": [{"role": "user", "content": "How are we pacing for December against the market and same time last year?"}],
      "expected_disposition": "clarify",
      "expected_must_include": ["December", "not available", "current report"],
      "expected_must_not_include": ["53%", "36%", "ahead of market"],
      "rubric": "Recognize that the frozen report covers only August through October and does not support a December answer. State the missing coverage and request or route for a current December report without substituting August values."
    }
  ]
  $pacing_evaluations$::JSONB;

  FOR evaluation IN SELECT value FROM JSONB_ARRAY_ELEMENTS(evaluations)
  LOOP
    INSERT INTO public.agent_evaluation_cases (
      name, description, case_type, playbook_id, synthetic_client, messages,
      frozen_source_snapshot, expected_disposition, expected_must_include,
      expected_must_not_include, rubric, active
    )
    SELECT
      evaluation ->> 'name',
      evaluation ->> 'description',
      'regression', main_playbook_id, TRUE,
      evaluation -> 'messages', pacing_snapshot,
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
