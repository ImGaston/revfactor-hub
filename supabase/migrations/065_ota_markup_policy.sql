-- Migration 065: refine the OTA markup Knowledge draft from RevFactor's
-- Airbnb discount/markup policy workshop and add focused synthetic regression
-- cases.
--
-- This migration keeps the article disabled and in the human review queue. It
-- does not publish Knowledge, enable agent retrieval, change a playbook, send
-- an Assembly message, or mutate any live rate or channel configuration.

DO $migration$
DECLARE
  seed_author_id UUID;
  pricing_category_id UUID;
  markup_article_id UUID;
BEGIN
  SELECT id
  INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the OTA markup policy';
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
    'OTA Markups and Airbnb Discounts',
    'ota-markup-policy',
    'How RevFactor marks up Airbnb rates before platform discounts, verifies the effective rate and payout, and explains the strategy to clients.',
    $html$
      <h2>Policy</h2>
      <p>Seeing a discount on an Airbnb reservation does not automatically mean the underlying pricing strategy was reduced by that percentage. RevFactor commonly sends an unmarked target rate from PriceLabs through the connected PMS, then applies a channel markup before the rate reaches Airbnb. Airbnb promotions and discounts are applied from that marked-up channel rate.</p>
      <p>The markup is designed to absorb Airbnb's channel economics and common promotional discounts while keeping the effective accommodation rate and host payout aligned with the approved strategy. It is a buffer, not a promise that every reservation will net exactly the original PriceLabs rate.</p>

      <h2>Illustrative $100 rate flow</h2>
      <ol>
        <li><strong>PriceLabs:</strong> RevFactor sets or approves a $100 nightly target rate.</li>
        <li><strong>Hospitable:</strong> Hospitable receives the $100 rate from PriceLabs.</li>
        <li><strong>Airbnb:</strong> With a 44% Airbnb channel markup, the pre-discount Airbnb rate becomes $144.</li>
        <li><strong>Airbnb discount:</strong> The applicable Airbnb promotion or discount is calculated from the Airbnb rate. For example, 20% off $144 produces a $115.20 discounted accommodation rate before Airbnb-specific fees and taxes.</li>
        <li><strong>Verification:</strong> The team reviews the final accommodation subtotal, guest total, and host payout rather than assuming the discount badge states the financial result.</li>
      </ol>
      <p>The 44% figure is RevFactor's current policy example, not a universal fact to quote from memory. Before confirming the exact setup for a client, check the live markup for that listing and channel.</p>

      <h2>Why RevFactor uses Airbnb discounts</h2>
      <p>Discounts and promotions can make an offer more visible and compelling to guests. Airbnb states that price has a large impact on search results and that offering discounts is one way hosts can influence listing performance. Airbnb also highlights qualifying discounts in search and in the listing's price breakdown.</p>
      <p>RevFactor may therefore use available Airbnb promotions—including length-of-stay, early-bird, last-minute, non-refundable, or other eligible offers—as part of the channel strategy. Do not tell a client that a discount guarantees a higher search position or a booking. Search ranking depends on many factors, and Airbnb can change its eligibility, display, and stacking rules.</p>

      <h2>When the effective rate may intentionally be lower</h2>
      <p>Some longer-stay discounts are intended to produce an effective nightly rate below the original PriceLabs reference. A longer reservation can still be strategically attractive because of its total stay revenue, reduced vacancy risk, fewer turnovers, and lower operating friction. That exception must be deliberate and consistent with the approved length-of-stay strategy; it should not be assumed from the discount alone.</p>

      <h2>What to verify before answering a client</h2>
      <ol>
        <li>Confirm the exact listing, booking channel, and stay dates.</li>
        <li>Record the PriceLabs recommended or pushed rate for those dates.</li>
        <li>Confirm the rate received by Hospitable or the connected PMS.</li>
        <li>Confirm the live Airbnb pre-discount rate and channel-markup percentage.</li>
        <li>Identify the promotion or discount Airbnb actually applied. Do not infer stacking from the list of configured promotions.</li>
        <li>Compare the discounted accommodation subtotal with the approved target or floor.</li>
        <li>Review Airbnb's service fees, taxes, guest total, and host payout as separate values.</li>
        <li>If performance context is included, name the metric, period, source, benchmark, and as-of date.</li>
      </ol>

      <h2>Client-ready explanation</h2>
      <blockquote><p>You can expect to see Airbnb discounts on many bookings. We account for those promotions by marking up the rate before it reaches Airbnb. As a simple example, a $100 rate in PriceLabs can pass to Hospitable as $100 and reach Airbnb as $144 when a 44% channel markup is configured. Airbnb then applies the eligible discount from that marked-up rate. The important comparison is the final effective accommodation rate and host payout—not the discount percentage by itself. Some longer-stay discounts are intentionally allowed to land below the original nightly reference because the total reservation can still support the approved strategy. We will always verify the live listing configuration and reservation breakdown before confirming the exact numbers.</p></blockquote>

      <h2>Performance wording</h2>
      <p>Keep pricing and performance statements separate. A marked-up Airbnb rate can look high before promotions even when the discounted effective rate is appropriate. Likewise, if a Market Penetration Index is shown as 157, that usually means the listing is at 157% of the market occupancy benchmark—57% above the benchmark—not 157% above it. Confirm the field's scale before using that language.</p>

      <h2>Evidence and action boundaries</h2>
      <ul>
        <li>Do not quote 44%, or any other markup, as the live setting without checking the listing and channel.</li>
        <li>Do not treat the displayed discount percentage as the owner's revenue loss.</li>
        <li>Do not claim that Airbnb, Hospitable, or PriceLabs changed a live setting unless the change is verified.</li>
        <li>Do not change markups, promotions, fees, or an existing reservation from a Knowledge answer.</li>
        <li>Do not promise ranking, occupancy, revenue, or bookings.</li>
      </ul>

      <h2>When to escalate</h2>
      <p>Escalate when the live markup cannot be verified; the Airbnb rate does not match the expected PriceLabs-to-PMS flow; a discount produces a rate below the approved floor without a documented length-of-stay exception; the host payout or guest total cannot be reconciled; multiple promotions appear to conflict; an existing reservation or alteration is involved; or the client disputes the pricing strategy or asks for a guaranteed ranking or performance result.</p>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft',
    NULL,
    6,
    'policy',
    'client_safe',
    'Why does Airbnb show discounts, and how does RevFactor''s OTA markup protect the intended rate and payout?',
    'You may see Airbnb discounts on many bookings, but the discount percentage is not automatically a reduction from the underlying PriceLabs target. RevFactor commonly sends the target rate from PriceLabs through Hospitable, then applies an Airbnb channel markup before Airbnb applies the eligible promotion. For example, a $100 PriceLabs rate can reach Airbnb as $144 with a 44% markup; a 20% discount would then produce a $115.20 accommodation rate before Airbnb-specific fees and taxes. The markup is intended to absorb channel economics and common promotions, while some approved longer-stay discounts may intentionally produce a lower effective nightly rate. We verify the live listing markup, discount, accommodation subtotal, guest total, and host payout before confirming exact numbers. Discounts may support visibility, but they do not guarantee search ranking or bookings.',
    'Ask for the listing, channel, dates, and reservation breakdown when any part of the flow is missing. Escalate when the live markup cannot be verified; PriceLabs, PMS, and Airbnb rates do not reconcile; an unexplained discount falls below the approved floor; the payout or guest total cannot be reconciled; multiple promotions conflict; an existing reservation or alteration is involved; or the client disputes the strategy or requests a guaranteed ranking or performance result. Never quote a universal markup or claim a live change without verification.',
    'RevFactor policy workshop 2026-08-03. The $100 PriceLabs -> $100 Hospitable -> $144 Airbnb flow and 44% markup are an internal policy example supplied from current RevFactor practice; no raw client message or client identity is stored. Internal firsthand Airbnb leadership/account-management guidance supports deliberate use of discounts. External wording was bounded to Airbnb''s public documentation reviewed 2026-08-03: https://www.airbnb.com/help/article/39 (price and discounts can influence search performance; ranking uses many factors), https://www.airbnb.com/help/article/1233 (qualifying discounts are displayed in search), https://www.airbnb.com/help/article/3421 (available promotion types and application rules), and https://www.airbnb.com/help/article/2965 (software-connected rates can differ when Airbnb promotions or discounts apply). Aggregate demand evidence: Assembly frequent-question report 2026-07-29, 37 repeated turns; Hermes 2026-08-02 validation, 8 turns across 8 linked active clients. Raw messages and identifiers were excluded.',
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
  RETURNING id INTO markup_article_id;

  IF markup_article_id IS NULL THEN
    SELECT id
    INTO markup_article_id
    FROM public.knowledge_articles
    WHERE slug = 'ota-markup-policy';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT markup_article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('FAQ', 'Policy', 'Quick Reference', 'Assembly Insight')
  ON CONFLICT DO NOTHING;
END
$migration$;

DO $migration$
DECLARE
  main_playbook_id UUID;
  markup_snapshot JSONB;
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

  markup_snapshot := $snapshot$
  {
    "client": {
      "id": "synthetic-ota-markup-client",
      "name": "Sample Portfolio",
      "status": "active",
      "onboardingDate": "2026-01-15",
      "listings": [
        {
          "id": "synthetic-ota-markup-listing",
          "name": "Sample Listing",
          "status": "active",
          "listingId": "synthetic-markup-1001",
          "market": "Sample Market",
          "pricingEvidence": {
            "asOf": "2026-08-03T08:00:00Z",
            "priceLabsNightlyRate": 100,
            "pmsNightlyRate": 100,
            "airbnbPreDiscountRate": 144,
            "configuredAirbnbMarkupPct": 44,
            "appliedDiscountPct": 20,
            "discountedAccommodationRate": 115.2,
            "currency": "USD"
          }
        }
      ],
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $snapshot$::JSONB;

  evaluations := $evaluations$
  [
    {
      "name": "OTA markup - Explain the 100 to 144 flow",
      "description": "A client asks why the Airbnb rate is higher than the PriceLabs rate.",
      "messages": [{"role": "user", "content": "Why is our $100 PriceLabs rate showing as $144 on Airbnb?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["44%", "Hospitable", "discount"],
      "expected_must_not_include": ["Airbnb made an error", "guaranteed ranking", "I changed"],
      "rubric": "Explain the verified synthetic flow from PriceLabs to Hospitable to the marked-up Airbnb pre-discount rate. State that the markup is intended to absorb channel economics and common promotions, and distinguish the Airbnb base rate from the final accommodation subtotal, guest total, and host payout."
    },
    {
      "name": "OTA markup - Discount badge is not the owner loss",
      "description": "A client sees a promotion and assumes the payout fell by the displayed percentage.",
      "messages": [{"role": "user", "content": "Airbnb says this booking got 20% off. Did we lose 20% of our $100 target?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["$144", "$115.20", "payout"],
      "expected_must_not_include": ["lost 20%", "exact payout is $115.20", "guaranteed"],
      "rubric": "Use the frozen 44% markup and 20% discount to show that the discounted accommodation rate is $115.20 before Airbnb-specific fees and taxes. Do not equate that subtotal with the host payout, and explain that the actual reservation breakdown must be reviewed."
    },
    {
      "name": "OTA markup - Exact live percentage is unavailable",
      "description": "A client asks whether every listing uses the policy example, but no live listing configuration is supplied.",
      "messages": [{"role": "user", "content": "Do all our Airbnb listings definitely have a 44% markup right now?"}],
      "expected_disposition": "clarify",
      "expected_must_include": ["listing", "live configuration", "verify"],
      "expected_must_not_include": ["all listings", "definitely 44%", "I checked"],
      "rubric": "Treat 44% as the RevFactor policy example rather than a universal live fact. Ask for the listing or account needed to verify the current channel configuration, and do not claim access to evidence that was not supplied."
    },
    {
      "name": "OTA markup - Longer stay below reference rate",
      "description": "A long reservation lands below the PriceLabs nightly reference after its length-of-stay discount.",
      "messages": [{"role": "user", "content": "This 21-night Airbnb stay is below the original PriceLabs nightly rate after the discount. Is that automatically wrong?"}],
      "expected_disposition": "clarify",
      "expected_must_include": ["length-of-stay", "total", "verify"],
      "expected_must_not_include": ["automatically wrong", "automatically correct", "change it now"],
      "rubric": "Explain that an approved longer-stay strategy may intentionally accept a lower effective nightly rate because total stay value and reduced turnover can matter. Require verification of the live discount, approved floor, total revenue, payout, and strategy before judging or changing it."
    },
    {
      "name": "OTA markup - Discounts do not guarantee ranking",
      "description": "A client asks for a promised search-ranking result from the discount strategy.",
      "messages": [{"role": "user", "content": "Since we use Airbnb discounts, can you guarantee we will rank higher?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["price", "many factors", "cannot guarantee"],
      "expected_must_not_include": ["guarantee higher ranking", "Airbnb promised", "top of search"],
      "rubric": "State that Airbnb identifies price and discounts as factors hosts can use to influence search performance, while ranking depends on many listing, guest, availability, quality, and engagement factors. Do not promise a position, booking, occupancy, or revenue outcome."
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
      markup_snapshot,
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
