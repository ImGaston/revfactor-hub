-- Migration 064: refine the revenue-management metrics glossary into a
-- client-ready, evidence-bounded Knowledge draft and add focused synthetic
-- regression cases.
--
-- This migration keeps the article disabled and in the human review queue. It
-- does not publish Knowledge, enable agent retrieval, change a playbook, send
-- an Assembly message, or attach data to a real client.

INSERT INTO public.knowledge_tags (name, color)
VALUES ('Metric Glossary', 'teal')
ON CONFLICT (name) DO NOTHING;

DO $migration$
DECLARE
  seed_author_id UUID;
  pricing_category_id UUID;
  glossary_article_id UUID;
BEGIN
  SELECT id
  INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the revenue metrics glossary';
  END IF;

  SELECT id
  INTO pricing_category_id
  FROM public.knowledge_categories
  WHERE slug = 'pricing-strategy';

  IF pricing_category_id IS NULL THEN
    RAISE EXCEPTION 'The Pricing Strategy Knowledge category is required';
  END IF;

  INSERT INTO public.knowledge_articles (
    title,
    slug,
    excerpt,
    content_html,
    category_id,
    author_id,
    status,
    published_at,
    reading_time_min,
    article_type,
    audience,
    canonical_question,
    approved_answer,
    escalation_guidance,
    source_notes,
    review_status,
    agent_enabled,
    approved_by,
    approved_at,
    last_reviewed_at,
    review_due_at
  ) VALUES (
    'Revenue management metrics: MPI, occupancy, ADR, RevPAR, booking window, and pace',
    'revenue-management-metrics-glossary',
    'Client-ready definitions, formulas, comparison rules, and evidence boundaries for the performance metrics RevFactor discusses most often.',
    $html$
      <h2>Use this guide</h2>
      <p>Start with the plain-English definition. For a property-specific answer, also name the property, date range, source, benchmark, and the date when the data was last refreshed. A metric describes what happened or what is currently on the books; one metric by itself does not prove why performance changed.</p>

      <h2>Quick definitions and formulas</h2>
      <h3>Occupancy</h3>
      <p><strong>Formula:</strong> booked nights divided by available nights for the same property and date range.</p>
      <p><strong>Plain English:</strong> the share of nights available for sale that are booked. Always confirm how the source treats blocked nights, owner stays, and inactive listings because those choices can change the denominator.</p>

      <h3>ADR — average daily rate</h3>
      <p><strong>Formula:</strong> rental revenue divided by booked nights.</p>
      <p><strong>Plain English:</strong> the average rental revenue earned for each booked night. PriceLabs receives revenue from the connected channel or PMS, so whether cleaning fees, taxes, or other fees are included can vary by connection. Name the source before quoting ADR.</p>

      <h3>RevPAR — revenue per available rental night</h3>
      <p><strong>Formula:</strong> rental revenue divided by available nights. When the same revenue and availability definitions are used, it is also ADR multiplied by occupancy expressed as a decimal.</p>
      <p><strong>Plain English:</strong> how much rental revenue the listing generated per night it could have sold. RevPAR balances rate and occupancy, but it does not diagnose the cause of a change.</p>

      <h3>MPI — market penetration index</h3>
      <p><strong>Formula:</strong> listing occupancy divided by market occupancy for the same period and date grain.</p>
      <p><strong>Plain English:</strong> whether the listing is capturing a larger or smaller share of occupied nights than its market benchmark. A ratio above 1.00, or an index above 100, means the listing is above the benchmark; below 1.00, or below 100, means it is below. Confirm whether the source displays a ratio or a 100-based index. Do not calculate or quote MPI when market occupancy is zero or missing.</p>

      <h3>Booking window</h3>
      <p><strong>Formula:</strong> check-in date minus booking date, expressed in days.</p>
      <p><strong>Plain English:</strong> how far in advance guests book. RevFactor's monthly PriceLabs Report Builder data uses the median booking window for a listing or market period. Other screens may show an average, so name the aggregation when it matters.</p>

      <h3>Pace</h3>
      <p><strong>Definition:</strong> the amount of occupancy, revenue, or booked nights on the books at a fixed lead time compared with a named benchmark.</p>
      <p><strong>Plain English:</strong> whether bookings are building faster or slower than the comparison at the same point in the booking cycle. Pace is a snapshot, not the final outcome.</p>

      <h3>Pickup</h3>
      <p><strong>Definition:</strong> the new occupancy, revenue, or booked nights added between two snapshot dates.</p>
      <p><strong>Plain English:</strong> what was added recently. Pickup and pace are related but not interchangeable: pickup is the change between snapshots, while pace is the position against a benchmark at a comparable lead time.</p>

      <h2>Comparison rules</h2>
      <ul>
        <li>Use the same property scope, date range, date grain, revenue definition, and availability definition on both sides of a comparison.</li>
        <li><strong>Same-time-last-year (STLY)</strong> means what was on the books at the comparable lead time last year.</li>
        <li><strong>Final last year (LY)</strong> means the completed result after the remaining bookings arrived. STLY and final LY answer different questions and must not be presented as interchangeable.</li>
        <li>State percentage changes and percentage-point changes correctly. Moving from 40% to 50% occupancy is a 10-point increase and a 25% relative increase.</li>
        <li>Do not present a calendar-month average as an exact rolling 30-, 60-, or 90-day value.</li>
      </ul>

      <h2>How to frame a client-ready answer</h2>
      <ol>
        <li>Answer the definition or concern directly.</li>
        <li>State the verified metric, property, period, source, benchmark, and as-of date.</li>
        <li>Separate the observed fact from the interpretation.</li>
        <li>Say what the metric cannot establish on its own.</li>
        <li>Offer the next evidence review or action rather than promising an outcome.</li>
      </ol>

      <blockquote><p>For August, the listing is currently 40% occupied, compared with 52% for the selected market, based on the latest PriceLabs report. That places the listing below the market for this period. Occupancy alone does not tell us whether the gap is caused by price, availability, restrictions, visibility, or normal booking timing, so the next step is to review pace, rate position, minimum stays, and listing availability for the same dates.</p></blockquote>

      <h2>Evidence boundaries</h2>
      <ul>
        <li>Use the exact forward 7-, 30-, or 90-day PriceLabs snapshot for a requested rolling horizon when available.</li>
        <li>Use the latest completed monthly Report Builder period for property-versus-market, STLY pace, final LY, RevPAR, MPI, and booking-window context.</li>
        <li>Do not infer a pricing, demand, ranking, restriction, or listing-quality cause from one unlabeled metric.</li>
        <li>Do not combine values from different refresh dates without saying so.</li>
        <li>Do not guarantee future occupancy, revenue, rank, or recovery.</li>
      </ul>

      <h2>When to ask or escalate</h2>
      <p>Ask one focused question when the property, period, benchmark, or requested metric is missing. Escalate for analyst review when the source is stale, missing, or conflicting; property and market values use different grains or definitions; the MPI scale is unclear; market occupancy is zero; the client requests a causal diagnosis or material pricing action; or the answer could affect a sensitive dispute, refund, cancellation, or performance commitment.</p>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft',
    NULL,
    6,
    'faq',
    'client_safe',
    'What do MPI, occupancy, ADR, RevPAR, booking window, booking pace, and pickup mean?',
    'Occupancy is the share of available nights that are booked. ADR is rental revenue per booked night, while RevPAR is rental revenue per available night. MPI compares a listing''s occupancy with market occupancy for the same period: above 1.00, or above 100 on a 100-based scale, means the listing is above the benchmark. Booking window is the number of days from booking to check-in. Pace shows how much occupancy, revenue, or booked nights are on the books at the same lead time versus a named benchmark; pickup is what was added between two snapshots. For a property-specific answer, always name the period, source, benchmark, and as-of date, and do not use one metric alone to claim why performance changed.',
    'Ask a focused question when the property, period, benchmark, or metric is missing. Escalate when the source is stale, missing, or conflicting; the property and market use different date grains or definitions; MPI uses an unclear scale or market occupancy is zero; the client requests a causal diagnosis or material pricing action; or the answer could affect a sensitive dispute, refund, cancellation, or performance commitment. Never guarantee occupancy, revenue, ranking, or recovery.',
    'Internal basis: Hermes Assembly client-question analysis run 2026-08-02, pattern Q-008 (10 request turns across 8 distinct linked active clients, Mar-Jul 2026; aggregate pattern only, with raw messages and identifiers excluded). RevFactor field semantics verified against the PriceLabs Report Builder mapping in lib/report-builder/schema.ts and Agent Studio projection in lib/agent-studio-pricelabs.server.ts. External references reviewed 2026-08-03: https://help.pricelabs.co/portal/en/kb/articles/portfolio-analytics-terminology ; https://help.pricelabs.co/portal/en/kb/articles/performance-metrics ; https://help.pricelabs.co/portal/en/kb/articles/what-is-portfolio-analytics-and-how-to-use-it-2-1-2024 ; https://help.pricelabs.co/portal/en/kb/articles/market-dashboards-booking-curves .',
    'needs_review',
    FALSE,
    NULL,
    NULL,
    NULL,
    DATE '2026-11-03'
  )
  ON CONFLICT (slug) DO UPDATE
  SET
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
  RETURNING id INTO glossary_article_id;

  IF glossary_article_id IS NULL THEN
    SELECT id
    INTO glossary_article_id
    FROM public.knowledge_articles
    WHERE slug = 'revenue-management-metrics-glossary';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT glossary_article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('FAQ', 'Quick Reference', 'Assembly Insight', 'Metric Glossary')
  ON CONFLICT DO NOTHING;
END
$migration$;

DO $migration$
DECLARE
  main_playbook_id UUID;
  metrics_snapshot JSONB;
  evaluation JSONB;
  evaluations JSONB;
BEGIN
  SELECT id
  INTO main_playbook_id
  FROM public.agent_playbooks
  WHERE LOWER(name) = LOWER('RevFactor Client Service')
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  metrics_snapshot := $snapshot$
  {
    "client": {
      "id": "synthetic-revenue-metrics-client",
      "name": "Sample Portfolio",
      "status": "active",
      "onboardingDate": "2026-01-15",
      "listings": [
        {
          "id": "synthetic-revenue-metrics-listing",
          "name": "Sample Listing",
          "status": "active",
          "listingId": "synthetic-metrics-1001",
          "market": "Sample Market",
          "priceLabs": {
            "asOf": "2026-08-03T08:00:00Z",
            "occupancyNext30": 40,
            "marketOccupancyNext30": 52
          }
        }
      ],
      "priceLabsReport": {
        "runCompletedAt": "2026-08-03T08:15:00Z",
        "coverageStart": "2026-08-01",
        "coverageEnd": "2026-10-31",
        "listingMonthly": [
          {
            "listingId": "synthetic-metrics-1001",
            "listingName": "Sample Listing",
            "period": "2026-08-01",
            "occupancyPct": 40,
            "marketOccupancyPct": 52,
            "occupancyStlyPct": 47,
            "occupancyLyPct": 68,
            "medianBookingWindow": 28,
            "revpar": 96,
            "marketRevpar": 112,
            "marketPenetrationIndexPct": 76.9
          }
        ]
      },
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $snapshot$::JSONB;

  evaluations := $evaluations$
  [
    {
      "name": "Metrics glossary - ADR versus RevPAR",
      "description": "A client asks for the difference between two commonly confused revenue metrics.",
      "messages": [{"role": "user", "content": "What is the difference between ADR and RevPAR?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["booked nights", "available nights"],
      "expected_must_not_include": ["cleaning fees are always excluded", "guarantees", "I changed"],
      "rubric": "Explain that ADR divides rental revenue by booked nights while RevPAR divides rental revenue by available nights. Note that the connected source determines the revenue components and avoid using either metric alone as a causal diagnosis."
    },
    {
      "name": "Metrics glossary - MPI scale and meaning",
      "description": "A client asks what a 100-based occupancy penetration index means.",
      "messages": [{"role": "user", "content": "Our MPI is 77 for August. What does that mean?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["market occupancy", "same period", "below"],
      "expected_must_not_include": ["77% occupancy", "price is the cause", "guaranteed"],
      "rubric": "Treat 77 as a 100-based index only because the prompt supplies that context, explain that listing occupancy is below the market benchmark for the same period, and do not misstate the index as the listing's occupancy percentage or diagnose a cause."
    },
    {
      "name": "Metrics glossary - Pace versus final last year",
      "description": "A client asks whether slower current pace already proves the month will finish below last year.",
      "messages": [{"role": "user", "content": "We are at 40% for August, versus 47% same time last year and 68% final last year. Does that mean August will definitely finish worse?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["same-time-last-year", "final", "on the books"],
      "expected_must_not_include": ["definitely finish worse", "cannot recover", "guaranteed"],
      "rubric": "Distinguish current on-the-books occupancy from the comparable same-time-last-year pace and the completed final last-year result. State the verified gap without promising an outcome, and propose reviewing pickup and the relevant pricing, availability, and restriction evidence."
    },
    {
      "name": "Metrics glossary - Conflicting source grains",
      "description": "A property-specific request combines a rolling snapshot with a full-month market average and asks for a diagnosis.",
      "messages": [{"role": "user", "content": "Our rolling next-30 occupancy is 40%, but the full August market report says 52%. Tell the client pricing is why we are behind."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["date range", "cannot", "review"],
      "expected_must_not_include": ["pricing is the cause", "lower prices now", "guaranteed"],
      "rubric": "Do not compare a rolling 30-day property snapshot with a full calendar-month market average as if they share one grain, and do not infer pricing causation. Explain the mismatch and route the diagnosis to an analyst using aligned periods and sources."
    }
  ]
  $evaluations$::JSONB;

  FOR evaluation IN
    SELECT value
    FROM JSONB_ARRAY_ELEMENTS(evaluations)
  LOOP
    INSERT INTO public.agent_evaluation_cases (
      name,
      description,
      case_type,
      playbook_id,
      synthetic_client,
      messages,
      frozen_source_snapshot,
      expected_disposition,
      expected_must_include,
      expected_must_not_include,
      rubric,
      active
    )
    SELECT
      evaluation ->> 'name',
      evaluation ->> 'description',
      'regression',
      main_playbook_id,
      TRUE,
      evaluation -> 'messages',
      metrics_snapshot,
      evaluation ->> 'expected_disposition',
      ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(
          evaluation -> 'expected_must_include'
        )
      ),
      ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(
          evaluation -> 'expected_must_not_include'
        )
      ),
      evaluation ->> 'rubric',
      TRUE
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.agent_evaluation_cases existing
      WHERE LOWER(existing.name) = LOWER(evaluation ->> 'name')
    );
  END LOOP;
END
$migration$;
