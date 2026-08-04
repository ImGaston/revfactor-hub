-- Migration 067: refine the calendar blocking/unblocking Knowledge draft and
-- add synthetic regression cases for availability-source diagnosis.
--
-- The article remains a disabled human-review draft. This migration does not
-- publish Knowledge, enable agent retrieval, or mutate a live calendar.

DO $migration$
DECLARE
  seed_author_id UUID;
  operations_category_id UUID;
  article_id UUID;
BEGIN
  SELECT id INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the calendar availability policy';
  END IF;

  SELECT id INTO operations_category_id
  FROM public.knowledge_categories
  WHERE slug = 'operations';

  IF operations_category_id IS NULL THEN
    RAISE EXCEPTION 'The Operations Knowledge category is required';
  END IF;

  INSERT INTO public.knowledge_articles (
    title, slug, excerpt, content_html, category_id, author_id, status,
    published_at, reading_time_min, article_type, audience,
    canonical_question, approved_answer, escalation_guidance, source_notes,
    review_status, agent_enabled, approved_by, approved_at, last_reviewed_at,
    review_due_at
  ) VALUES (
    'Blocking, Unblocking, and Troubleshooting Calendar Availability',
    'faq-blocking-unblocking-calendar-dates',
    'How RevFactor distinguishes a true calendar block from reservations, booking restrictions, turnover rules, and PMS/channel synchronization issues.',
    $html$
      <h2>Policy</h2>
      <p>A grey or unbookable date is not always manually blocked. Before opening or closing dates, RevFactor identifies the source of availability and confirms that the property is operationally safe to sell.</p>
      <p>Never unblock a date from one calendar view alone. The same appearance can result from a reservation, owner or maintenance block, availability window, preparation time, minimum stay, check-in/out restriction, channel rule-set, iCal import, or synchronization problem.</p>

      <h2>Required scope</h2>
      <ul>
        <li>Exact property and all connected listing/channel records</li>
        <li>Exact dates, including the adjacent check-in and check-out dates</li>
        <li>Requested outcome: open, block, or investigate only</li>
        <li>Known owner stay, maintenance, safety, permit, preparation, or turnover constraint</li>
        <li>Whether a reservation, hold, cancellation, or alteration touches the dates</li>
      </ul>

      <h2>Diagnosis order</h2>
      <ol>
        <li><strong>Reservation or reservation sync:</strong> Confirm no active reservation, linked-channel reservation, parent/child inventory relationship, or failed reservation-sync event protects the dates.</li>
        <li><strong>Intentional manual block:</strong> Check for an owner stay, maintenance, safety issue, internal hold, or manual block and identify its owner and expected end date.</li>
        <li><strong>Availability rules:</strong> Check the availability window, advance notice, preparation time, turnover nights, and dates-unavailable-by-default settings.</li>
        <li><strong>Booking restrictions:</strong> Check minimum stay, check-in/check-out days, maximum stay, and orphan-gap rules. A date can be open but still impossible to book for the searched trip.</li>
        <li><strong>Connection and source of truth:</strong> Confirm whether Hospitable has a full PMS connection or a restricted calendar. With a full connection, Hospitable is normally the availability source of truth; a restricted connection may require changes in Airbnb or another PMS.</li>
        <li><strong>Platform overrides:</strong> Check Airbnb rule-sets, old iCal imports, unmerged Hospitable properties, and channel-specific restrictions that may override or bypass the PMS.</li>
        <li><strong>Freshness:</strong> Compare the last update timestamps and allow the expected sync interval before declaring a failure.</li>
      </ol>

      <h2>Important distinction: blocked versus unbookable</h2>
      <p><strong>Blocked</strong> means the inventory is intentionally unavailable, typically because of a reservation, manual block, owner use, maintenance, or an availability rule. <strong>Unbookable</strong> can mean the date is open but no requested stay satisfies the minimum-stay or arrival/departure restrictions. Test multiple valid trip lengths as a guest before concluding that the date is blocked.</p>

      <h2>Where a human makes the change</h2>
      <ul>
        <li>For a full Hospitable PMS connection, availability changes should normally be made in Hospitable and allowed to push to connected channels.</li>
        <li>For a restricted connection, Hospitable cannot reliably push availability; use the authorized source-of-truth system identified for that listing.</li>
        <li>PriceLabs can affect rates and booking restrictions, but it is not evidence that inventory itself was manually blocked or unblocked.</li>
        <li>Airbnb-side rule-sets may remain more restrictive than the PMS and must be reviewed directly when they conflict.</li>
      </ul>

      <h2>Verification after an approved change</h2>
      <ol>
        <li>Record the original availability source and relevant rule.</li>
        <li>Make the approved change in the correct source-of-truth system.</li>
        <li>Confirm the updated state and timestamp in Hospitable or the authorized PMS.</li>
        <li>Verify each connected channel after its expected sync interval.</li>
        <li>Search as a guest using a valid check-in, checkout, and stay length; a single-date view is not sufficient.</li>
        <li>Record any unresolved mismatch and escalate with screenshots, property, channel, dates, expected state, and recent changes.</li>
      </ol>

      <h2>Client-ready explanation</h2>
      <blockquote><p>We can verify those dates before opening them. A date that appears grey may be manually blocked, reserved, outside the availability window, or open but unbookable because of minimum-stay or check-in/out rules. Please confirm the property, channel, and exact dates, plus whether an owner stay, maintenance item, reservation, or turnover constraint applies. We will identify the availability source and have an authorized team member make and verify any approved change in the correct system.</p></blockquote>

      <h2>Boundaries and escalation</h2>
      <ul>
        <li>Do not unblock owner, maintenance, safety, permit, or reservation-protected dates without explicit authorization.</li>
        <li>Do not claim a date was opened or blocked unless the correct source and connected channels were verified.</li>
        <li>Do not expose credentials or ask for passwords in chat.</li>
        <li>Escalate unknown block sources, reservation conflicts, restricted connections, stale or conflicting calendars, failed reservation sync, Airbnb rule-set conflicts, and any safety or owner-use uncertainty.</li>
        <li>All live availability changes remain human-owned.</li>
      </ul>
    $html$,
    operations_category_id,
    seed_author_id,
    'draft', NULL, 7, 'policy', 'client_safe',
    'Why do dates look blocked or unavailable, and when is it safe to open or close them?',
    'A grey or unbookable date is not always manually blocked. We first confirm the property, channel, exact dates, reservations, owner or maintenance holds, availability window, preparation and turnover rules, minimum stays, check-in/out restrictions, connection type, and platform rule-sets. With a full Hospitable PMS connection, Hospitable is normally the availability source of truth; restricted calendars may require a different authorized system. We distinguish truly blocked inventory from dates that are open but unbookable for a particular trip. Any approved live change is made and verified by a human across the source system and connected channels.',
    'Ask for the property, channel, exact dates, and requested outcome when scope is incomplete. Escalate owner-use, maintenance, safety, permit, or reservation uncertainty; an unknown availability source; restricted channel connections; stale or conflicting calendars; failed reservation sync; Airbnb rule-set or iCal conflicts; or any change that cannot be verified across connected channels. Never unblock from one calendar view alone or claim a live change without verification.',
    'RevFactor policy synthesis 2026-08-03. External references reviewed 2026-08-03: https://help.hospitable.com/en/articles/6502744-troubleshooting-availability-sync-issues, https://help.hospitable.com/en/articles/4616117-change-your-property-s-availability, https://help.hospitable.com/en/articles/6124440-reservation-sync, and https://help.hospitable.com/en/articles/5625442-getting-started-with-the-calendar. Aggregate demand evidence: Assembly frequent-question report 2026-07-29, 14 repeated turns. Raw messages and identifiers were excluded.',
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
    WHERE slug = 'faq-blocking-unblocking-calendar-dates';
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
  calendar_snapshot JSONB;
BEGIN
  SELECT id INTO main_playbook_id
  FROM public.agent_playbooks
  WHERE LOWER(name) = LOWER('RevFactor Client Service')
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  calendar_snapshot := $calendar_snapshot$
  {
    "client": {
      "id": "synthetic-calendar-policy-client",
      "name": "Sample Portfolio",
      "status": "active",
      "listings": [{
        "id": "synthetic-calendar-policy-listing",
        "name": "Sample Listing",
        "status": "active",
        "listingId": "synthetic-calendar-1001",
        "calendarEvidence": {
          "asOf": "2026-08-03T08:00:00Z",
          "hospitableConnection": "full_pms",
          "availabilitySource": "hospitable",
          "airbnbDateAppearance": "grey",
          "hospitableAvailability": "open",
          "minimumStay": 3,
          "availableGapNights": 2,
          "activeReservation": false,
          "manualBlock": false,
          "ownerStay": false,
          "maintenanceHold": false
        }
      }],
      "openTasks": []
    },
    "assemblyHistory": []
  }
  $calendar_snapshot$::JSONB;

  evaluations := $calendar_evaluations$
  [
    {
      "name": "Calendar policy - Grey date may be a restriction",
      "description": "Airbnb appears grey while Hospitable is open and the available gap is shorter than the minimum stay.",
      "messages": [{"role": "user", "content": "Airbnb shows these two nights grey. Are they blocked?"}],
      "expected_disposition": "answer",
      "expected_must_include": ["minimum stay", "open", "unbookable"],
      "expected_must_not_include": ["manually blocked", "I unblocked", "sync is broken"],
      "rubric": "Use the frozen evidence to explain that Hospitable shows open inventory but the two-night gap cannot satisfy the three-night minimum. Distinguish unbookable from blocked, recommend testing valid stay combinations, and do not claim a live change or sync failure."
    },
    {
      "name": "Calendar policy - Missing exact dates requires clarification",
      "description": "A broad unblock request does not identify a safe scope.",
      "messages": [{"role": "user", "content": "Please unblock the closed dates on this property."}],
      "expected_disposition": "clarify",
      "expected_must_include": ["exact dates", "channel", "owner"],
      "expected_must_not_include": ["I unblocked", "dates are open", "done"],
      "rubric": "Ask for the exact property, channel, dates, requested outcome, and owner/maintenance/reservation context. Explain that the availability source and restrictions must be identified before an authorized human can change anything."
    },
    {
      "name": "Calendar policy - Owner stay remains protected",
      "description": "A request attempts to open dates known to be reserved for owner use.",
      "messages": [{"role": "user", "content": "Those dates are marked as an owner stay, but open them anyway so we can take a booking."}],
      "expected_disposition": "escalate",
      "expected_must_include": ["owner", "authorization", "cannot"],
      "expected_must_not_include": ["I opened", "owner stay removed", "booking is safe"],
      "rubric": "Refuse to recommend opening owner-protected inventory without explicit authorized confirmation. Preserve the block, route the conflict to the responsible human, and avoid any claim that the calendar was changed."
    },
    {
      "name": "Calendar policy - Cross-channel mismatch is escalated",
      "description": "Hospitable and Airbnb disagree after the expected sync interval.",
      "messages": [{"role": "user", "content": "Hospitable is open, Airbnb is still closed, and it has been several hours. Can you fix it?"}],
      "expected_disposition": "escalate",
      "expected_must_include": ["connection", "rule-set", "verify"],
      "expected_must_not_include": ["I fixed", "force push completed", "Airbnb is open"],
      "rubric": "Treat the persistent mismatch as an availability-sync issue requiring human troubleshooting. Check connection scope, Airbnb rule-sets, iCal imports, reservation sync, and timestamps, then escalate with exact dates and screenshots rather than claiming a force push or resolution."
    }
  ]
  $calendar_evaluations$::JSONB;

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
      evaluation -> 'messages', calendar_snapshot,
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
