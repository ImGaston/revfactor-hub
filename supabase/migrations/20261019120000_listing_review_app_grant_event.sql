-- Sending a listing review first tags the owner in Assembly so they can see the
-- Listing Review app; that grant is logged as its own ontology action.
ALTER TABLE listing_optimization_events DROP CONSTRAINT IF EXISTS listing_optimization_events_action_check;
ALTER TABLE listing_optimization_events ADD CONSTRAINT listing_optimization_events_action_check
  CHECK (action IN (
    'SubmitListingReviewDraft', 'PublishListingReview', 'UnpublishListingReview',
    'ArchiveListingReview', 'DecideSuggestion', 'MarkOwnerTaskDone',
    'ApplyListingContent', 'VerifyListingContentLive', 'NotifyOwnerOfReview',
    'GrantListingReviewApp'
  ));
