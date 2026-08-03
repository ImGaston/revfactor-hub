-- Migration 063: refine the reservation-alteration Knowledge policy from the
-- RevFactor policy workshop and add focused synthetic evaluation cases.
--
-- This migration keeps the article disabled and in the human review queue. It
-- does not publish Knowledge, enable agent retrieval, send a message, attach a
-- file, or mutate a live reservation.

DO $migration$
DECLARE
  seed_author_id UUID;
  pricing_category_id UUID;
  alteration_article_id UUID;
BEGIN
  SELECT id
  INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the alteration policy';
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
    'Reservation Alterations: Preventing Airbnb Repricing Errors',
    'reservation-alterations',
    'RevFactor policy for initiating Airbnb reservation changes from the host side and correcting unintended length-of-stay repricing.',
    $html$
      <h2>Policy</h2>
      <p>When an Airbnb guest wants to extend, shorten, move, or otherwise change a confirmed reservation, RevFactor recommends that the alteration always be initiated from the host side.</p>
      <p>Airbnb may reprice the full stay when a guest initiates the request. Because many RevFactor listings use length-of-stay and other discounts, the alteration can apply a larger discount to the entire reservation and make the revised stay cheaper than intended.</p>

      <h2>If the guest has not submitted a request</h2>
      <ol>
        <li>Confirm the requested dates and that the listing is available.</li>
        <li>Capture the original accommodation cost and expected host payout.</li>
        <li>Calculate the approved price change for the added, removed, or moved dates.</li>
        <li>Initiate the alteration from the host side and manually verify the accommodation cost before sending it.</li>
      </ol>

      <h2>If the guest already submitted an incorrectly priced request</h2>
      <p>Do not accept it. Ask the guest to withdraw the request, or decline it if necessary, and explain that the alteration is not pricing correctly. Then create and send a corrected host-side request.</p>
      <blockquote><p>Hi [Guest Name], it looks like Airbnb is not pricing this alteration correctly. Please withdraw the current change request, and we will send you a corrected alteration from the host side for review.</p></blockquote>

      <h2>Host-side Airbnb steps</h2>
      <ol>
        <li>Open the guest's confirmed reservation from the Airbnb Inbox.</li>
        <li>Select <strong>Manage reservation</strong>.</li>
        <li>Select <strong>Change reservation</strong>.</li>
        <li>Select the revised dates and confirm any guest-count change.</li>
        <li>In <strong>Host payout details</strong>, expand <strong>Price difference</strong> and review the price adjustment, service-fee adjustment, new payout, and guest total.</li>
        <li>Enter the <strong>full revised accommodation cost</strong>. Its difference from the original accommodation cost should equal the approved price of the added nights, or the approved refund for removed nights. Reopen Price difference and review the final totals before sending.</li>
      </ol>

      <h2>Pricing check</h2>
      <p><strong>Price adjustment</strong> is the gross change in the accommodation charge. <strong>Service fee adjustment</strong> is the change in Airbnb's host service fee deducted from that gross adjustment. <strong>New payout</strong> is the revised host payout after the alteration. <strong>Guest total, including fees and taxes</strong> is the revised amount the guest pays.</p>
      <p>For an extension, the full revised accommodation cost should preserve the intended value of the nights already booked and add the approved price for the new nights. Do not enter only the incremental price in the accommodation-cost field, and do not add Airbnb service fees or taxes to it. Do not allow a newly triggered length-of-stay discount to reduce the value of the original booking unless an authorized reviewer explicitly approves that concession.</p>

      <h2>Team resource</h2>
      <p><a href="/resources/airbnb-host-side-reservation-alteration-guide.pdf" target="_blank" rel="noopener noreferrer">Download the Host-side Airbnb Reservation Alteration Guide (PDF)</a>. Agent Studio may recommend this guide, but the team must download and attach it manually while Assembly sending remains read-only.</p>

      <h2>Evidence boundary</h2>
      <p>The team must review the live Airbnb alteration preview. Do not promise an exact guest charge, refund, or host payout from calendar rates, PriceLabs, or a prior message alone. Airbnb interface labels and calculations can change.</p>
    $html$,
    pricing_category_id,
    seed_author_id,
    'draft',
    NULL,
    4,
    'policy',
    'client_safe',
    'What should we do when an Airbnb guest wants to change an existing reservation?',
    'When an Airbnb guest wants to change a confirmed reservation, the safest approach is for the host to initiate the alteration. Guest-initiated requests may reprice the entire stay and apply additional length-of-stay discounts, making the revised reservation cheaper than intended. If the guest already submitted an incorrectly priced request, do not accept it. Ask the guest to withdraw it, then send a corrected host-side request. In Airbnb, open the reservation from the Inbox, choose Manage reservation, choose Change reservation, select the new dates, expand Price difference to review the pricing breakdown, then enter the full revised accommodation cost. The difference from the original accommodation cost should equal the approved price of the added nights or refund for removed nights. Recheck the price adjustment, Airbnb service-fee adjustment, new host payout, and guest total before sending.',
    'Escalate every live alteration for human execution. Stop for additional review when the revised payout is unexpectedly lower, the change creates a refund or cancellation issue, the original booking value cannot be preserved, a monthly-stay rule applies, the stay has started, the guest disputes the corrected price, or the platform preview cannot be explained. Never claim that an alteration was sent or accepted from Agent Studio.',
    'RevFactor policy workshop 2026-08-03. The operating rule is based on repeated internal experience with guest-initiated Airbnb alterations and length-of-stay discounts. Current Airbnb Help Center documentation confirms that date changes can alter totals and taxes, and that hosts can set a revised price in a trip change request. Team resource: /resources/airbnb-host-side-reservation-alteration-guide.pdf.',
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
  RETURNING id INTO alteration_article_id;

  IF alteration_article_id IS NULL THEN
    SELECT id
    INTO alteration_article_id
    FROM public.knowledge_articles
    WHERE slug = 'reservation-alterations';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT alteration_article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('FAQ', 'Policy', 'Quick Reference', 'Assembly Insight')
  ON CONFLICT DO NOTHING;
END
$migration$;

DO $migration$
DECLARE
  main_playbook_id UUID;
  policy_snapshot JSONB;
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

  policy_snapshot := $snapshot$
  {
    "client": {
      "id": "synthetic-alteration-policy-client",
      "name": "Sample Host Portfolio",
      "status": "active",
      "onboardingDate": "2026-01-15",
      "listings": [
        {
          "id": "synthetic-alteration-listing",
          "name": "Sample Listing",
          "status": "active",
          "listingId": "synthetic-alteration-1001",
          "market": "Sample Market"
        }
      ],
      "priceLabsReport": null,
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $snapshot$::JSONB;

  evaluations := $evaluations$
  [
    {
      "name": "Alterations - Host initiates an extension",
      "description": "A guest asks to add nights before submitting a trip change request.",
      "messages": [{"role": "user", "content": "Our Airbnb guest wants to extend the reservation by three nights. Should they send the alteration?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["host side", "accommodation cost"],
      "expected_must_not_include": ["accept their request", "I changed the reservation", "guaranteed"],
      "rubric": "Recommend that the host initiate the request, verify availability, preserve the original booking value, set the approved accommodation cost for the change, and review the revised payout before sending."
    },
    {
      "name": "Alterations - Incorrect guest request is withdrawn",
      "description": "A guest-initiated alteration reprices the full stay and lowers the host payout.",
      "messages": [{"role": "user", "content": "The guest sent an Airbnb alteration to add nights, but the total stay became cheaper and our payout dropped. Can we accept it?"}],
      "expected_disposition": "escalate",
      "expected_must_include": ["withdraw", "host side"],
      "expected_must_not_include": ["accept it", "I canceled", "refund approved"],
      "rubric": "Do not accept the incorrect request. Explain that the guest should withdraw it, provide the approved guest wording, and route the corrected host-side alteration for human execution."
    },
    {
      "name": "Alterations - Host-side Airbnb steps",
      "description": "A team member asks for the exact safe path for creating the corrected change.",
      "messages": [{"role": "user", "content": "What are the Airbnb steps for sending the corrected alteration from the host account?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["manage reservation", "change reservation", "price difference", "accommodation cost"],
      "expected_must_not_include": ["Resolution Center", "I sent it", "I accepted it"],
      "rubric": "Give the ordered Inbox, Manage reservation, Change reservation, dates, Price difference review, full revised accommodation-cost, and final review steps. Correctly distinguish the price adjustment, Airbnb service-fee adjustment, new payout, and guest total. Mention that the PDF guide is available for manual attachment and do not imply a live action occurred."
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
      policy_snapshot,
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
