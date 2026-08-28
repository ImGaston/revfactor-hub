-- Migration 088: add the PriceLabs listing-ID handoff guide to Knowledge.
--
-- The guide is client-safe, but it remains in the human review queue until a
-- Knowledge approver publishes and enables it for agent retrieval.

DO $migration$
DECLARE
  seed_author_id UUID;
  onboarding_category_id UUID;
  guide_article_id UUID;
BEGIN
  SELECT id
  INTO seed_author_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at, id
  LIMIT 1;

  IF seed_author_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin profile is required to seed the PriceLabs listing-ID guide';
  END IF;

  SELECT id
  INTO onboarding_category_id
  FROM public.knowledge_categories
  WHERE slug = 'client-onboarding';

  IF onboarding_category_id IS NULL THEN
    RAISE EXCEPTION 'The Client Onboarding Knowledge category is required';
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
    'How to Find Your PriceLabs Listing ID',
    'find-pricelabs-listing-id',
    'Client-safe instructions for locating PriceLabs listing IDs for PMS-connected, direct Airbnb and Vrbo, unmapped, and previously mapped listings.',
    $html$
      <h2>Quick answer</h2>
      <p>In PriceLabs, open <strong>Dynamic Pricing</strong> and select <strong>Manage Listings</strong>. Search for the property under <strong>Unmapped Listings</strong>. If it is not there, search under <strong>Mapped Listings</strong>. In the <strong>Listing Name</strong> cell, the first line contains the channel and listing ID; the second line contains the listing name.</p>

      <h2>Step 1: Open Manage Listings</h2>
      <ol>
        <li>Sign in to PriceLabs.</li>
        <li>Open the first menu at the top labeled <strong>Dynamic Pricing</strong>.</li>
        <li>Select <strong>Manage Listings</strong>.</li>
      </ol>

      <h2>Step 2: Determine where the listing is located</h2>
      <ol>
        <li>Start on the <strong>Unmapped Listings</strong> tab and search for the property name.</li>
        <li>If the listing does not appear, open the <strong>Mapped Listings</strong> tab and search again.</li>
        <li>Use the <strong>Combined Listings</strong> tab only when you need one view of both sets.</li>
      </ol>
      <p>A listing that has already been mapped will normally be found under <strong>Mapped Listings</strong>, not <strong>Unmapped Listings</strong>.</p>

      <h2>Step 3: Read the Listing Name cell</h2>
      <p>Each result has a two-line <strong>Listing Name</strong> cell:</p>
      <ul>
        <li><strong>First line - channel and listing ID:</strong> This is the identifier RevFactor needs. The channel may be a PMS, Airbnb, or Vrbo.</li>
        <li><strong>Second line - listing name:</strong> This is the property name used to confirm that the correct record was selected.</li>
      </ul>
      <p>Send both the listing name and the channel/listing ID shown on the first line. Do not substitute a value from a different column when RevFactor asks for the PriceLabs listing ID.</p>

      <h2>PMS-connected listings</h2>
      <p>When PriceLabs is connected through a property management system (PMS), the result normally appears as one listing row. Send RevFactor:</p>
      <ul>
        <li>the listing name from the second line; and</li>
        <li>the PMS channel and listing ID from the first line.</li>
      </ul>

      <h2>Direct Airbnb and Vrbo listings</h2>
      <p>If the property is connected directly to both Airbnb and Vrbo instead of through a PMS, PriceLabs may show two rows for the same property. Send RevFactor both channel-specific listing IDs:</p>
      <ul>
        <li>the Airbnb listing ID from the first line of the Airbnb row; and</li>
        <li>the Vrbo listing ID from the first line of the Vrbo row.</li>
      </ul>
      <p>The two listing names should describe the same property, but the Airbnb and Vrbo IDs will be different.</p>

      <h2>Previously mapped Airbnb and Vrbo pairs</h2>
      <p>Under <strong>Mapped Listings</strong>, a connected pair may be labeled <strong>PARENT</strong> and <strong>CHILD</strong>. The parent may be the Airbnb row and the child may be the Vrbo row. Send the channel and ID from the first line of every relevant row, even when the rows are grouped together.</p>

      <h2>What to send RevFactor</h2>
      <ul>
        <li>The listing name.</li>
        <li>The channel shown on the first line.</li>
        <li>The complete listing ID shown beside that channel.</li>
        <li>For a direct Airbnb and Vrbo pair, both channel-specific IDs.</li>
      </ul>
      <p>If PriceLabs visually truncates an ID or the result is ambiguous, include a screenshot of the complete listing row so RevFactor can confirm the correct record.</p>

      <h2>Client resource</h2>
      <p><a href="/resources/revfactor-pricelabs-listing-id-guide.pdf" target="_blank" rel="noopener noreferrer">Download the RevFactor Guide: How to Find Your PriceLabs Listing ID (PDF)</a>.</p>

      <h2>Security and escalation</h2>
      <p>Never send PriceLabs usernames, passwords, one-time codes, or other login credentials. Escalate to a RevFactor team member if the property cannot be found under either tab, duplicate or unclear rows appear, the ID is truncated, or the parent-child mapping does not match the expected property.</p>
    $html$,
    onboarding_category_id,
    seed_author_id,
    'draft',
    NULL,
    4,
    'guide',
    'client_safe',
    'What PriceLabs listing information should a client send to RevFactor, and where can they find it?',
    'Open Dynamic Pricing, select Manage Listings, and search for the property under Unmapped Listings. If it is not there, search under Mapped Listings. In the Listing Name cell, the first line shows the channel and listing ID, and the second line shows the listing name. For a PMS-connected listing, send the listing name plus the PMS channel and ID. If Airbnb and Vrbo are connected directly, send both channel-specific IDs. Previously mapped pairs may appear as PARENT and CHILD under Mapped Listings. Never send login credentials. The client PDF is available at /resources/revfactor-pricelabs-listing-id-guide.pdf.',
    'Do not guess a listing ID. Escalate when the property cannot be found under Unmapped Listings or Mapped Listings, an ID is truncated or ambiguous, duplicate rows appear, multiple properties share a similar name, a parent-child mapping looks incorrect, or a client offers login credentials. Ask for a screenshot of the complete listing row when the visible record is unclear.',
    'RevFactor PriceLabs walkthrough and sanitized UI captures completed 2026-08-28. Client PDF resource: /resources/revfactor-pricelabs-listing-id-guide.pdf. Review this article after material PriceLabs navigation or listing-row changes.',
    'needs_review',
    FALSE,
    NULL,
    NULL,
    NULL,
    DATE '2026-11-28'
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
  RETURNING id INTO guide_article_id;

  IF guide_article_id IS NULL THEN
    SELECT id
    INTO guide_article_id
    FROM public.knowledge_articles
    WHERE slug = 'find-pricelabs-listing-id';
  END IF;

  INSERT INTO public.knowledge_article_tags (article_id, tag_id)
  SELECT guide_article_id, tag.id
  FROM public.knowledge_tags tag
  WHERE tag.name IN ('Checklist', 'Training', 'Quick Reference')
  ON CONFLICT DO NOTHING;
END
$migration$;
