-- The message that goes to the owner's Assembly chat when a review is published.
-- Drafted from the review when it's created (deterministic, no AI), editable by
-- staff, and sent only by "Publish & send" (Fede's publish click is the approval).
ALTER TABLE listing_optimization_reports
  ADD COLUMN IF NOT EXISTS owner_message TEXT,
  ADD COLUMN IF NOT EXISTS owner_message_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_message_sent_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_message_assembly_id TEXT;

ALTER TABLE listing_optimization_events DROP CONSTRAINT IF EXISTS listing_optimization_events_action_check;
ALTER TABLE listing_optimization_events ADD CONSTRAINT listing_optimization_events_action_check
  CHECK (action IN (
    'SubmitListingReviewDraft', 'PublishListingReview', 'UnpublishListingReview',
    'ArchiveListingReview', 'DecideSuggestion', 'MarkOwnerTaskDone',
    'ApplyListingContent', 'VerifyListingContentLive', 'NotifyOwnerOfReview'
  ));
