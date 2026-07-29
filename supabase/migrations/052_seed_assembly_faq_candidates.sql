-- ============================================================
-- 052: Sanitized Assembly FAQ candidates
-- Seeds a review queue from repeated question patterns only.
-- Raw client messages and message IDs are intentionally excluded.
-- ============================================================

INSERT INTO public.knowledge_tags (name, color)
VALUES ('Assembly Insight', 'indigo')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  seed_author_id UUID;
BEGIN
  SELECT id
  INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed Knowledge drafts';
  END IF;

  WITH candidates (
    title,
    slug,
    excerpt,
    content_html,
    category_slug,
    canonical_question,
    proposed_answer,
    escalation_guidance,
    source_notes
  ) AS (
    VALUES
      (
        'Date-specific pricing, discount, and fee requests',
        'faq-date-specific-pricing-discount-fee-requests',
        'How RevFactor reviews requests to change rates, discounts, or fees for specific dates.',
        '<h2>Proposed response</h2><p>We can review a date-specific pricing, discount, or fee request. Before confirming a change, we check the listing and channel, exact dates, current reservations, booking window, market demand, pricing floors, existing promotions, and the likely effect on the owner payout and guest total.</p><h2>Information to collect</h2><ul><li>Listing and booking channel</li><li>Exact date range</li><li>Requested rate, fee, or discount</li><li>The owner''s objective and any non-negotiable floor</li></ul><p>A team member should confirm the final setting after the review. Do not promise that a requested change will be applied or that it will produce a booking.</p>',
        'pricing-strategy',
        'Can RevFactor update a fee, discount, or nightly price for specific dates?',
        'We can review a date-specific pricing, discount, or fee request. Please share the listing, booking channel, exact dates, requested change, and your goal. We will check current reservations, booking pace, pricing floors, existing promotions, and the effect on the guest total and owner payout before confirming the appropriate setting.',
        'Escalate to a revenue manager when the request affects an existing reservation, conflicts with a pricing floor, spans a major event, or could materially change the owner payout. Never promise a booking or revenue outcome.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 127. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'Minimum-stay changes for specific dates',
        'faq-minimum-stay-changes-specific-dates',
        'How to assess a request to change minimum-stay restrictions for a listing and date range.',
        '<h2>Proposed response</h2><p>We can review a minimum-stay change for a specific listing and date range. The right rule depends on the booking window, day of week, events, existing reservations, orphan gaps, turnover constraints, and the rate needed to make a shorter stay worthwhile.</p><h2>Information to collect</h2><ul><li>Listing and exact dates</li><li>Requested minimum stay</li><li>Whether the goal is to fill a gap, protect a peak period, or allow a particular inquiry</li><li>Any cleaning or turnover limitation</li></ul><p>Confirm the final rule after checking the live calendar and channel restrictions.</p>',
        'pricing-strategy',
        'Can RevFactor change minimum-stay rules for a specific listing or date range?',
        'Yes, we can review a minimum-stay change. Please send the listing, exact date range, requested stay length, and the reason for the change. We will check booking window, demand, events, existing reservations, gap-night logic, turnover constraints, and the rate needed for a shorter stay before confirming the best rule.',
        'Escalate when the dates touch an existing reservation, a major event, a same-day turnover constraint, or conflicting PMS/OTA restrictions. Do not confirm a change until the live calendar has been checked.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 32. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'Diagnosing slow bookings',
        'faq-diagnosing-slow-bookings',
        'The evidence RevFactor reviews before deciding whether slow bookings are caused by price, market pace, restrictions, or listing factors.',
        '<h2>Proposed response</h2><p>Slow bookings are not automatically a pricing problem. We compare the property with its market and comp set using occupancy and pacing, booking window, available inventory, rate position, minimum-stay and arrival restrictions, recent listing changes, and channel visibility.</p><p>After that review, we should explain what the data supports, what remains uncertain, and the next action to test. Avoid recommending an immediate discount without checking the full picture.</p>',
        'pricing-strategy',
        'Can RevFactor review why bookings are slow and whether pricing or the market is the cause?',
        'Yes. We will compare the property''s pace and occupancy with the market and relevant comps, then review rate position, booking window, minimum stays, availability, channel visibility, and recent listing changes. That helps us distinguish a pricing issue from normal market pace or a restriction or listing issue before recommending an adjustment.',
        'Escalate when PriceLabs or market data is stale or unavailable, the comp set is disputed, the client is raising a sensitive performance complaint, or a recommendation would materially override the approved strategy. Do not guarantee future bookings.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 17. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'Blocking and unblocking calendar dates',
        'faq-blocking-unblocking-calendar-dates',
        'How to distinguish a true calendar block from restriction or sync issues before opening dates.',
        '<h2>Proposed response</h2><p>We can review dates that appear blocked or unavailable. First we determine whether the cause is an owner or maintenance block, an existing reservation, a minimum-stay or check-in restriction, a turnover rule, or a PMS/channel synchronization issue.</p><p>Dates should not be unblocked until ownership, operational availability, and the live calendars are verified. If the dates are intentionally protected, document the reason and expected end date.</p>',
        'operations',
        'Should RevFactor block or unblock dates to avoid accidental bookings?',
        'We can review the dates before changing availability. Please share the listing, channel, exact dates, and whether an owner stay, maintenance item, reservation, or turnover constraint applies. We will confirm whether the dates are truly blocked or only unavailable because of a stay rule or sync issue before making a recommendation.',
        'Escalate any uncertainty about an owner stay, maintenance, safety issue, existing reservation, same-day turnover, or PMS/channel mismatch. Never unblock dates based only on how one channel calendar appears.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 14. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'Reservation alterations and existing discounts',
        'faq-reservation-alterations-existing-discounts',
        'What to check before changing an existing reservation that may interact with discounts or channel rules.',
        '<h2>Proposed response</h2><p>Reservation alterations can recalculate nightly rates, discounts, taxes, fees, guest totals, and owner payouts according to the PMS and OTA rules. Before advising on an alteration, review the original booking, requested change, cancellation policy, promotion eligibility, payout impact, and what the guest will see.</p><p>Do not change a live reservation or promise a refund from the Knowledge response. The responsible team member must confirm the financial effect and approve the action.</p>',
        'pricing-strategy',
        'How should reservation alterations interact with discounts and existing bookings?',
        'An alteration can cause the PMS or booking channel to recalculate rates, discounts, fees, taxes, the guest total, and the owner payout. Before confirming anything, we need to review the original reservation, requested date or occupancy change, applicable promotion and cancellation terms, and the financial effect shown by the channel.',
        'Always escalate refunds, cancellations, material payout changes, disputed totals, or any live reservation change that is not fully explained by the PMS/OTA preview. A human must approve the final action.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 9. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'Explaining the current pricing plan',
        'faq-explaining-current-pricing-plan',
        'A standard structure for explaining what RevFactor is currently watching and recommending for a listing.',
        '<h2>Proposed response</h2><p>A useful plan update should be specific to the client and current data. Summarize the objective, what changed recently, the next booking window being watched, the relevant pace or market signal, the active pricing or stay-rule decision, and when the team will review it again.</p><p>If fresh client, PriceLabs, or conversation context is unavailable, ask one focused follow-up question or route the request to the account owner instead of inventing a generic strategy.</p>',
        'pricing-strategy',
        'What is RevFactor''s current plan or recommendation for this listing or account?',
        'We can summarize the current plan using the latest listing and market data. The update should cover the objective, recent changes, the booking window and pace we are watching, any active rate or stay-rule decision, and the next review point. If you share the listing or account, we can make the explanation specific.',
        'Escalate when the latest strategy, client objective, or data is missing; when the client is disputing performance; or when the answer would require a new revenue commitment. Never invent a plan from stale or absent context.',
        'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 5. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'One-night stays and gap-night rules',
        'faq-one-night-stays-gap-night-rules',
        'How day-of-week and orphan-gap rules can allow or prevent one-night stays without changing the default minimum stay.',
        '<h2>Proposed response</h2><p>A listing can use different minimum stays by date, day of week, booking window, and gap size. A one-night stay may be allowed only as a gap-night exception while the normal minimum remains higher. The live result also depends on arrival/departure restrictions, channel settings, cleaning economics, and existing reservations.</p><p>Check the exact dates in the PMS and channel before saying that a one-night stay is available.</p>',
        'pricing-strategy',
        'Can a guest book a one-night stay, or can a day be configured to allow one or three nights but not two?',
        'It may be possible using date-specific, day-of-week, or gap-night rules, but the result depends on the exact dates, existing reservations, arrival and departure settings, channel behavior, and turnover economics. Please share the listing and dates so we can verify the live rule before confirming what a guest can book.',
        'Escalate unusual rule combinations, channel mismatches, or cases where a one-night exception could create an unprofitable turnover or conflict with an existing reservation.',
        'Assembly frequent-question report generated 2026-07-29. Combined repeated patterns frequency: 10. Aggregate patterns only; raw client messages and message IDs were intentionally excluded.'
      ),
      (
        'PriceLabs and PMS onboarding status',
        'faq-pricelabs-pms-onboarding-status',
        'How to report onboarding and synchronization status without requesting passwords in chat.',
        '<h2>Proposed response</h2><p>To confirm onboarding status, check that the PMS account and listings are linked, PriceLabs has the expected listing IDs, the correct sync direction is enabled, and a recent successful sync timestamp is present. Explain which step is complete, which item is still missing, and who owns the next action.</p><p>Request role-based access or a secure invitation. Never ask a client to send a password, API key, or other credential in chat.</p>',
        'client-onboarding',
        'What is the status of PriceLabs and PMS onboarding or synchronization?',
        'We can confirm the status by checking the PMS connection, expected listing IDs, PriceLabs mapping, sync direction, and latest successful sync. We will identify what is complete, what is still missing, and the next owner. Please use a secure invitation or role-based access rather than sending passwords or credentials in chat.',
        'Escalate when listing IDs do not match, sync data is stale, duplicate listings exist, the requested access is broader than needed, or any credential has been shared in chat. Treat exposed credentials as compromised and follow the security process.',
        'Assembly frequent-question report generated 2026-07-29. Related repeated patterns frequency: 2, with additional onboarding long-tail candidates. Aggregate patterns only; raw client messages and message IDs were intentionally excluded.'
      )
  )
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
    review_due_at
  )
  SELECT
    candidate.title,
    candidate.slug,
    candidate.excerpt,
    candidate.content_html,
    category.id,
    seed_author_id,
    'draft',
    NULL,
    2,
    'faq',
    'client_safe',
    candidate.canonical_question,
    candidate.proposed_answer,
    candidate.escalation_guidance,
    candidate.source_notes,
    'needs_review',
    FALSE,
    DATE '2026-10-27'
  FROM candidates candidate
  JOIN public.knowledge_categories category
    ON category.slug = candidate.category_slug
  ON CONFLICT (slug) DO NOTHING;
END
$$;

UPDATE public.knowledge_articles
SET
  excerpt = COALESCE(
    NULLIF(btrim(excerpt), ''),
    'How channel-specific fees and markups affect guest-facing prices and owner payouts.'
  ),
  content_html = COALESCE(
    NULLIF(btrim(content_html), ''),
    '<h2>Proposed response</h2><p>Channel markups are used to account for differences in OTA fee structures so the owner''s intended net revenue remains aligned across channels. Guest-facing prices do not have to be identical because Airbnb, VRBO, direct booking, and the PMS can apply different fees and taxes.</p><p>The exact setup must be verified for the listing and channel. Do not quote a universal markup percentage from memory; check the current configuration and explain both the guest total and expected owner payout.</p>'
  ),
  canonical_question = 'How do channel markups work across Airbnb, VRBO, and direct booking?',
  approved_answer = COALESCE(
    NULLIF(btrim(approved_answer), ''),
    'Channel markups account for differences in booking-channel fees so the owner''s intended net revenue stays aligned. Guest-facing prices may differ across Airbnb, VRBO, and direct booking because each channel applies different fees and taxes. We should verify the current listing-level configuration before quoting an exact percentage.'
  ),
  escalation_guidance = COALESCE(
    NULLIF(btrim(escalation_guidance), ''),
    'Escalate when the client asks for an exact markup and the live configuration is unavailable, when channel totals materially disagree, or when a fee change could alter the owner payout. Do not state a default percentage without verification.'
  ),
  source_notes = CASE
    WHEN COALESCE(source_notes, '') LIKE '%Repeated pattern frequency: 37%'
      THEN source_notes
    ELSE concat_ws(
      E'\n',
      NULLIF(btrim(source_notes), ''),
      'Assembly frequent-question report generated 2026-07-29. Repeated pattern frequency: 37. Aggregate pattern only; raw client messages and message IDs were intentionally excluded.'
    )
  END,
  article_type = 'policy',
  audience = 'client_safe',
  review_status = 'needs_review',
  agent_enabled = FALSE,
  review_due_at = COALESCE(review_due_at, DATE '2026-10-27'),
  updated_at = NOW()
WHERE slug = 'ota-markup-policy'
  AND review_status <> 'approved'
  AND agent_enabled = FALSE;

-- Reuse earlier team-authored drafts when they already cover a seeded topic.
-- Only empty, unapproved governance fields are filled; authored article content
-- remains untouched.
UPDATE public.knowledge_articles target
SET
  article_type = 'faq',
  audience = 'client_safe',
  canonical_question = 'Can RevFactor update pricing, discounts, fees, or minimum-stay rules for specific dates?',
  approved_answer = 'We can review a date-specific rate, discount, fee, or minimum-stay request. Please share the listing, channel, exact dates, requested change, and your objective. We will check reservations, booking pace, market demand, pricing floors, existing promotions, gap-night logic, and turnover constraints before confirming the appropriate setting.',
  escalation_guidance = 'Escalate when the request affects an existing reservation, conflicts with a pricing floor, spans a major event, creates a turnover constraint, or could materially change the owner payout. Never promise that a requested change will be applied or produce a booking.',
  source_notes = 'Assembly frequent-question report generated 2026-07-29. Combined repeated patterns frequency: 159 (127 date-specific price/discount/fee requests and 32 minimum-stay requests). Aggregate patterns only; raw client messages and message IDs were intentionally excluded.',
  review_status = 'needs_review',
  agent_enabled = FALSE,
  review_due_at = COALESCE(target.review_due_at, DATE '2026-10-27'),
  updated_at = NOW()
WHERE target.slug = 'update-request'
  AND target.review_status = 'draft'
  AND target.agent_enabled = FALSE
  AND NULLIF(btrim(target.approved_answer), '') IS NULL;

UPDATE public.knowledge_articles target
SET
  article_type = 'faq',
  audience = 'client_safe',
  canonical_question = source.canonical_question,
  approved_answer = source.approved_answer,
  escalation_guidance = source.escalation_guidance,
  source_notes = source.source_notes,
  review_status = 'needs_review',
  agent_enabled = FALSE,
  review_due_at = COALESCE(target.review_due_at, source.review_due_at),
  updated_at = NOW()
FROM public.knowledge_articles source
WHERE target.slug = 'pacing-questions'
  AND source.slug = 'faq-diagnosing-slow-bookings'
  AND target.review_status = 'draft'
  AND target.agent_enabled = FALSE
  AND NULLIF(btrim(target.approved_answer), '') IS NULL;

UPDATE public.knowledge_articles target
SET
  article_type = 'faq',
  audience = 'client_safe',
  canonical_question = source.canonical_question,
  approved_answer = source.approved_answer,
  escalation_guidance = source.escalation_guidance,
  source_notes = source.source_notes,
  review_status = 'needs_review',
  agent_enabled = FALSE,
  review_due_at = COALESCE(target.review_due_at, source.review_due_at),
  updated_at = NOW()
FROM public.knowledge_articles source
WHERE target.slug = 'reservation-alterations'
  AND source.slug = 'faq-reservation-alterations-existing-discounts'
  AND target.review_status = 'draft'
  AND target.agent_enabled = FALSE
  AND NULLIF(btrim(target.approved_answer), '') IS NULL;

UPDATE public.knowledge_articles target
SET
  article_type = 'faq',
  audience = 'client_safe',
  canonical_question = source.canonical_question,
  approved_answer = source.approved_answer,
  escalation_guidance = source.escalation_guidance,
  source_notes = source.source_notes,
  review_status = 'needs_review',
  agent_enabled = FALSE,
  review_due_at = COALESCE(target.review_due_at, source.review_due_at),
  updated_at = NOW()
FROM public.knowledge_articles source
WHERE target.slug = 'pricing-strategy'
  AND source.slug = 'faq-explaining-current-pricing-plan'
  AND target.review_status = 'draft'
  AND target.agent_enabled = FALSE
  AND NULLIF(btrim(target.approved_answer), '') IS NULL;

INSERT INTO public.knowledge_article_tags (article_id, tag_id)
SELECT article.id, tag.id
FROM public.knowledge_articles article
CROSS JOIN public.knowledge_tags tag
WHERE article.slug IN (
    'ota-markup-policy',
    'faq-date-specific-pricing-discount-fee-requests',
    'faq-minimum-stay-changes-specific-dates',
    'faq-diagnosing-slow-bookings',
    'faq-blocking-unblocking-calendar-dates',
    'faq-reservation-alterations-existing-discounts',
    'faq-explaining-current-pricing-plan',
    'faq-one-night-stays-gap-night-rules',
    'faq-pricelabs-pms-onboarding-status',
    'update-request',
    'pacing-questions',
    'reservation-alterations',
    'pricing-strategy'
  )
  AND tag.name IN ('FAQ', 'Assembly Insight')
ON CONFLICT DO NOTHING;

-- Remove only the seed-owned duplicates after a matching team-authored draft
-- has been enriched. In databases without those earlier drafts, the standalone
-- seed remains in place.
DELETE FROM public.knowledge_articles seeded
WHERE (
    seeded.slug = 'faq-date-specific-pricing-discount-fee-requests'
    OR seeded.slug = 'faq-minimum-stay-changes-specific-dates'
  )
  AND seeded.status = 'draft'
  AND seeded.review_status = 'needs_review'
  AND seeded.source_notes LIKE 'Assembly frequent-question report generated 2026-07-29.%'
  AND EXISTS (
    SELECT 1
    FROM public.knowledge_articles target
    WHERE target.slug = 'update-request'
      AND target.review_status = 'needs_review'
      AND target.source_notes LIKE '%Combined repeated patterns frequency: 159%'
  );

DELETE FROM public.knowledge_articles seeded
WHERE seeded.slug = 'faq-diagnosing-slow-bookings'
  AND seeded.status = 'draft'
  AND seeded.review_status = 'needs_review'
  AND seeded.source_notes LIKE 'Assembly frequent-question report generated 2026-07-29.%'
  AND EXISTS (
    SELECT 1
    FROM public.knowledge_articles target
    WHERE target.slug = 'pacing-questions'
      AND target.review_status = 'needs_review'
      AND target.source_notes LIKE '%Repeated pattern frequency: 17%'
  );

DELETE FROM public.knowledge_articles seeded
WHERE seeded.slug = 'faq-reservation-alterations-existing-discounts'
  AND seeded.status = 'draft'
  AND seeded.review_status = 'needs_review'
  AND seeded.source_notes LIKE 'Assembly frequent-question report generated 2026-07-29.%'
  AND EXISTS (
    SELECT 1
    FROM public.knowledge_articles target
    WHERE target.slug = 'reservation-alterations'
      AND target.review_status = 'needs_review'
      AND target.source_notes LIKE '%Repeated pattern frequency: 9%'
  );

DELETE FROM public.knowledge_articles seeded
WHERE seeded.slug = 'faq-explaining-current-pricing-plan'
  AND seeded.status = 'draft'
  AND seeded.review_status = 'needs_review'
  AND seeded.source_notes LIKE 'Assembly frequent-question report generated 2026-07-29.%'
  AND EXISTS (
    SELECT 1
    FROM public.knowledge_articles target
    WHERE target.slug = 'pricing-strategy'
      AND target.review_status = 'needs_review'
      AND target.source_notes LIKE '%Repeated pattern frequency: 5%'
  );
