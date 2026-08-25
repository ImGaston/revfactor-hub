export type Listing = {
  id: string
  name: string
  status: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  pl_occupancy_next_7: number | null
  pl_market_occupancy_next_7: number | null
  pl_occupancy_next_30: number | null
  pl_market_occupancy_next_30: number | null
  pl_mpi_next_30: number | null
  pl_last_booked_date: string | null
  stripe_subscription_id?: string | null
}

export type ListingWithMetrics = Listing & {
  client_id: string
  created_at: string
  updated_at: string
  pl_base_price: number | null
  pl_min_price: number | null
  pl_max_price: number | null
  pl_recommended_base_price: number | null
  pl_cleaning_fees: number | null
  pl_no_of_bedrooms: number | null
  pl_occupancy_next_7: number | null
  pl_market_occupancy_next_7: number | null
  pl_occupancy_next_30: number | null
  pl_market_occupancy_next_30: number | null
  pl_occupancy_past_90: number | null
  pl_market_occupancy_past_90: number | null
  pl_mpi_next_30: number | null
  pl_mpi_next_60: number | null
  pl_last_booked_date: string | null
  pl_wknd_occupancy_next_30: number | null
  pl_market_wknd_occupancy_next_30: number | null
  pl_push_enabled: boolean | null
  pl_last_refreshed_at: string | null
  pl_synced_at: string | null
}

export type ClientTask = {
  id: string
  title: string
  status: string
  owner: string | null
  tags: string[] | null
  profiles?:
    | { full_name: string | null; email: string }
    | { full_name: string | null; email: string }[]
    | null
}

export type Client = {
  id: string
  name: string
  status: string
  billing_amount: number | null
  onboarding_date: string | null
  ending_date: string | null
  ending_reason_tags: string[]
  ending_note: string | null
  autopayment_set_up: boolean
  stripe_dashboard: string | null
  email: string | null
  assembly_link: string | null
  assembly_client_id: string | null
  assembly_company_id: string | null
  dashboard_url: string | null
  listings: Listing[]
  tasks: ClientTask[]
}

// Narrower shape for the /clients list view — only the fields the table/cards consume.
// Keeps the list query lean vs. the full `Client` shape used in detail pages.
export type ClientListItem = {
  id: string
  name: string
  status: string
  email: string | null
  billing_amount: number | null
  onboarding_date: string | null
  ending_date: string | null
  assembly_client_id: string | null
  listings: { id: string; status: string }[]
  tasks: { id: string; status: string }[]
}

export type Task = {
  id: string
  title: string
  description: string | null
  client_id: string | null
  owner: string | null
  tags: string[]
  status: string
  sort_order: number
  is_archived?: boolean
  archived_at?: string | null
  created_at: string
  clients?: { id: string; name: string } | null
  profiles?:
    | { full_name: string | null; email: string }
    | { full_name: string | null; email: string }[]
    | null
  task_listings?: {
    listing_id: string
    listings: { id: string; name: string }
  }[]
}

export type TaskComment = {
  id: string
  task_id: string
  author_id: string
  content: string
  parent_id: string | null
  linked_task_id: string | null
  created_at: string
  updated_at: string
  profiles?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null
  task_comment_reactions?: { emoji: string; user_id: string }[]
}

type ProfileRef = { full_name: string | null; email: string }
export function resolveProfile(
  profiles: ProfileRef | ProfileRef[] | null | undefined
): ProfileRef | null {
  if (!profiles) return null
  if (Array.isArray(profiles)) return profiles[0] ?? null
  return profiles
}

export type Board = {
  id: string
  name: string
  icon: string
  description: string | null
  sort_order: number
}

export type Tag = {
  id: string
  name: string
  color: string
}

export type RoadmapProject = {
  id: string
  name: string
  description: string | null
  deadline: string | null
  created_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type Post = {
  id: string
  title: string
  description: string | null
  status: string
  board_id: string | null
  project_id: string
  deadline: string | null
  author_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
  // Joined / computed fields
  upvote_count?: number
  comment_count?: number
  boards?: { name: string; icon: string } | null
  roadmap_projects?: { name: string; deadline: string | null } | null
  post_tags?: { tags: Tag }[]
  has_upvoted?: boolean
}

export type Comment = {
  id: string
  post_id: string
  author_id: string
  content: string
  parent_comment_id: string | null
  created_at: string
  updated_at: string
  profiles?: {
    full_name: string | null
    avatar_url: string | null
    email: string
  } | null
  like_count?: number
  dislike_count?: number
  user_reaction?: "like" | "dislike" | null
  replies?: Comment[]
}

// ─── Financials ─────────────────────────────────────────

export type ExpenseCategory = {
  id: string
  name: string
  type: "fixed" | "variable"
  created_at: string
}

export type Expense = {
  id: string
  description: string
  amount: number
  category_id: string | null
  type: "fixed" | "variable"
  date: string
  is_paid: boolean
  paid_at: string | null
  notes: string | null
  created_by: string | null
  recurring_expense_id: string | null
  recurring_month: string | null
  bank_transaction_id: string | null
  created_at: string
  updated_at: string
  // Joined fields
  expense_categories?: { id: string; name: string; type: string } | null
  expense_listing_allocations?: ExpenseListingAllocation[]
}

export type ExpenseListingAllocation = {
  id: string
  expense_id: string
  listing_id: string
  amount_cents: number
  listings?: { id: string; name: string } | null
}

export type RecurringExpense = {
  id: string
  description: string
  amount: number
  category_id: string | null
  type: "fixed" | "variable"
  day_of_month: number
  is_active: boolean
  start_date: string | null
  end_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  expense_categories?: { id: string; name: string; type: string } | null
}

export type StripePayout = {
  id: string
  amount_cents: number
  currency: string
  status: string
  arrival_date: string
  created: string
  automatic: boolean
  reconciliation_status: string | null
  failure_code: string | null
  failure_message: string | null
  synced_at: string
}

export type StripeInvoice = {
  id: string
  subscription_id: string | null
  customer_id: string | null
  customer_email: string | null
  customer_name: string | null
  amount_due: number | string
  amount_paid: number | string
  status: string | null
  created: string
  due_date: string | null
  period_end: string | null
}

export type FinancialCashSnapshot = {
  id: string
  operating_cash_cents: number
  tax_cash_cents: number
  effective_date: string
  notes: string | null
  created_at: string
}

export type FinancialScenario = {
  id: string
  name: string
  description: string | null
  start_month: string
  horizon_months: number
  created_at: string
  updated_at: string
}

export type FinancialScenarioListing = {
  id: string
  scenario_id: string
  source_listing_id: string | null
  name: string
  monthly_revenue_cents: number
  start_month: string
  end_month: string | null
}

export type FinancialScenarioEvent = {
  id: string
  scenario_id: string
  kind:
    | "fixed_expense"
    | "variable_expense"
    | "growth_investment"
    | "capital_contribution"
  description: string
  amount_cents: number
  recurrence: "one_time" | "monthly"
  start_month: string
  end_month: string | null
}

export type FinancialScenarioEventAllocation = {
  id: string
  event_id: string
  scenario_listing_id: string
  amount_cents: number
}

// ─── Bank statements ────────────────────────────────────

export type BankAccount = {
  id: string
  account_number: string
  label: string
  role: "income" | "opex" | "tax" | "partner" | "other"
  is_internal: boolean
  created_at: string
}

export type BankStatementImport = {
  id: string
  account_id: string
  filename: string
  period_start: string | null
  period_end: string | null
  row_count: number
  imported_count: number
  skipped_count: number
  imported_by: string | null
  created_at: string
}

export type BankFlowClass =
  | "external_income"
  | "external_expense"
  | "internal_transfer"
  | "profit_first"
  | "unknown"

export type BankTransaction = {
  id: string
  account_id: string
  import_id: string | null
  txn_date: string
  payee: string | null
  counterparty_account: string | null
  txn_type: string | null
  direction: "in" | "out"
  description: string | null
  reference: string | null
  status: string | null
  amount_cents: number
  currency: string
  balance_cents: number | null
  flow_class: BankFlowClass
  matched_payout_id: string | null
  matched_transfer_id: string | null
  expense_id: string | null
  dedupe_hash: string
  created_at: string
  // Joined fields
  bank_accounts?: { id: string; account_number: string; label: string } | null
}

// ─── Credentials ────────────────────────────────────────

export type ClientCredential = {
  id: string
  client_id: string
  external_key: string
  name: string
  software: string
  email: string | null
  password: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type TeamCredential = {
  id: string
  name: string
  software: string
  email: string | null
  password: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Sales Pipeline ─────────────────────────────────────

export type LeadStage =
  | "inquiry"
  | "follow_up"
  | "audit"
  | "meeting"
  | "proposal_sent"
  | "proposal_signed"
  | "retainer_paid"
  | "planning"

export type LeadTag = {
  id: string
  name: string
  color: string
}

export type Lead = {
  id: string
  project_name: string
  full_name: string | null
  email: string | null
  phone: string | null
  service_type: string | null
  lead_source: string | null
  scheduled_date: string | null
  timezone: string | null
  location: string | null
  description: string | null
  start_date: string | null
  end_date: string | null
  contract_sent: boolean
  contract_signed: boolean
  client_portal_url: string | null
  stage: LeadStage
  sort_order: number
  is_archived: boolean
  is_completed: boolean
  archived_at: string | null
  completed_at: string | null
  listing_count: number
  child_listing_count: number
  assembly_client_id: string | null
  converted_at: string | null
  lost_at: string | null
  lost_reason: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  gclid: string | null
  msclkid: string | null
  fbclid: string | null
  referrer: string | null
  landing_page: string | null
  attribution_extra: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  lead_tag_assignments?: { lead_tags: LeadTag }[]
  lead_team_assignments?: {
    profile_id: string
    role: string
    profiles: {
      full_name: string | null
      email: string
      avatar_url: string | null
    }
  }[]
}

export type LeadStageEvent = {
  id: string
  lead_id: string
  from_stage: LeadStage | null
  to_stage: LeadStage
  changed_at: string
  changed_by: string | null
}

export type ApiKey = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  owner_email: string | null
  created_by: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export type LeadNote = {
  id: string
  lead_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  profiles?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  }
}

// ─── Onboarding ─────────────────────────────────────────

export type OnboardingTemplate = {
  id: string
  step_name: string
  description: string | null
  step_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type OnboardingProgress = {
  id: string
  client_id: string
  template_id: string
  is_completed: boolean
  completed_at: string | null
  completed_by: string | null
  // Joined fields
  onboarding_templates?: OnboardingTemplate
  profiles?: { full_name: string | null; email: string } | null
}

export type OnboardingComment = {
  id: string
  client_id: string
  run_id: string | null
  author_id: string
  content: string
  created_at: string
  updated_at: string
  profiles?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null
}

export type OnboardingResource = {
  id: string
  title: string
  description: string | null
  url: string | null
  icon: string
  sort_order: number
  created_at: string
  updated_at: string
}

export type OnboardingRunStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "ready_for_launch"
  | "live"
  | "archived"

export type OnboardingRun = {
  id: string
  client_id: string
  external_key: string
  run_type: "initial" | "additional_property"
  status: OnboardingRunStatus
  current_step: "property" | "software" | "preferences" | "knowledge" | "review"
  assembly_workspace_id: string | null
  assembly_company_id: string | null
  assembly_client_id: string | null
  stripe_subscription_ids: string[]
  primary_listing_entitlement: number
  child_listing_entitlement: number
  entitlement_synced_at: string | null
  has_pms: boolean | null
  pms_name: string | null
  has_pricelabs: boolean | null
  client_note: string | null
  draft_payload: Record<string, unknown>
  submitted_payload: Record<string, unknown> | null
  revision: number
  started_at: string
  last_saved_at: string
  submitted_at: string | null
  reviewed_at: string | null
  live_at: string | null
  created_at: string
  updated_at: string
}

export type OnboardingRunListing = {
  id: string
  run_id: string
  external_key: string
  hub_listing_id: string | null
  parent_run_listing_id: string | null
  listing_kind: "primary" | "child"
  sequence: number
  name: string
  listing_url: string | null
  is_live: boolean
  launch_month: number | null
  launch_year: number | null
  target_launch_month: number | null
  target_launch_year: number | null
  child_unit_type: "separate_unit" | "smaller_unit" | "not_sure" | null
  annual_revenue_target: number | null
  minimum_nightly_price: number | null
  cleaning_cost: number | null
  min_stay_midweek: number | null
  min_stay_weekend: number | null
  currency: string
  created_at: string
  updated_at: string
}

export type OnboardingRunTask = {
  id: string
  run_id: string
  task_key: string
  client_status: "not_started" | "in_progress" | "submitted"
  team_status: "pending" | "reviewing" | "verified" | "blocked"
  owner_profile_id: string | null
  verified_by_assembly_internal_user_id: string | null
  client_note: string | null
  team_note: string | null
  client_submitted_at: string | null
  team_verified_at: string | null
  created_at: string
  updated_at: string
}

export type OnboardingRunEvent = {
  id: string
  run_id: string
  name: string
  month: number
  year: number | null
  recurrence: "one_off" | "recurrent"
  demand: "meaningful" | "significant" | "huge" | "blackout"
  sequence: number
  created_at: string
  updated_at: string
}

export type OnboardingRunComp = {
  id: string
  run_id: string
  listing_url: string
  sequence: number
  created_at: string
  updated_at: string
}

export type OnboardingRunAnswer = {
  id: string
  run_id: string
  section: "readiness" | "knowledge"
  question_key: string
  answer_key: string
  note: string | null
  created_at: string
  updated_at: string
}

export type OnboardingRunAttachment = {
  id: string
  run_id: string
  run_listing_id: string | null
  assembly_file_id: string
  file_name: string
  content_type: string | null
  byte_size: number | null
  uploaded_by_type: "client" | "internal"
  uploaded_by_id: string
  created_at: string
}

export type OnboardingRunNotificationDelivery = {
  id: string
  run_id: string
  event_type: "submitted"
  recipient_internal_user_id: string
  status: "pending" | "sent" | "failed"
  attempts: number
  assembly_notification_id: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

// ─── Adjustments ────────────────────────────────────────

export type AdjustmentScope = "portfolio" | "single_listing"

export type AdjustmentType =
  | "setup"
  | "min_stay"
  | "price"
  | "min_price"
  | "max_price"
  | "target_payout"
  | "checkin_checkout"
  | "discount"
  | "markup_fees"
  | "availability"
  | "review"
  | "recommendation"
  | "other"

export type AdjustmentOrigin = "client" | "internal" | "hostpricing"

export type AdjustmentStatus =
  | "open"
  | "in_progress"
  | "needs_info"
  | "resolved"
  | "controlled"
  | "issue"
  | "rejected"

export type AdjustmentUrgency = "low" | "medium" | "high"

export type AdjustmentBookingWindow = "last_minute" | "far_out"

export type Adjustment = {
  id: string
  public_token: string
  scope: AdjustmentScope
  client_id: string
  listing_id: string | null
  type: AdjustmentType
  target_value: string | null
  date_from: string | null
  date_to: string | null
  booking_window: AdjustmentBookingWindow | null
  urgency: AdjustmentUrgency
  origin: AdjustmentOrigin
  requested_by: string | null
  origin_message: string | null
  status: AdjustmentStatus
  resolver_id: string | null
  resolved_at: string | null
  reviewer_id: string | null
  controlled_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  clients?: { id: string; name: string } | null
  listings?: {
    id: string
    name: string
    listing_id: string | null
    pricelabs_link: string | null
    airbnb_link: string | null
  } | null
  resolver?: { full_name: string | null; email: string } | null
  reviewer?: { full_name: string | null; email: string } | null
  creator?: { full_name: string | null; email: string } | null
  // Merged from the adjustment_comment_stats view on the list page
  comment_stats?: Pick<
    AdjustmentCommentStats,
    "comment_count" | "last_comment_origin"
  > | null
}

export type AdjustmentCommentOrigin = "internal" | "hostpricing" | "client"

// Embedded reaction row shape (adjustment_comment_reactions / task_comment_reactions)
export type CommentReaction = {
  emoji: string
  user_id: string
}

export type AdjustmentComment = {
  id: string
  adjustment_id: string
  author_id: string
  content: string
  origin: AdjustmentCommentOrigin
  // Non-null = internal thread reply (visible only with adjustments:control)
  parent_id: string | null
  linked_task_id: string | null
  created_at: string
  updated_at: string
  profiles?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null
  adjustment_comment_reactions?: CommentReaction[]
}

// Row of the `adjustment_comment_stats` view — the needs-reply flag is
// derived (last_comment_origin !== "internal"), never stored.
export type AdjustmentCommentStats = {
  adjustment_id: string
  comment_count: number
  last_comment_origin: AdjustmentCommentOrigin
  last_comment_at: string
}

export type AdjustmentStatusHistoryEntry = {
  id: string
  adjustment_id: string
  from_status: AdjustmentStatus
  to_status: AdjustmentStatus
  changed_by: string | null
  note: string | null
  created_at: string
  changed_by_profile?: {
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null
}

// ─── Report Builder (PriceLabs) ─────────────────────────

export type ReportListing = {
  listing_id: string
  listing_name: string | null
  group_name: string | null
  sub_group_name: string | null
  property_name: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  bedroom_count: number | null
  unit_count: number | null
  pms_name: string | null
  is_parent: boolean | null
  sync_on: boolean | null
  base_price: number | null
  min_price: number | null
  max_price: number | null
  base_price_recommendation: number | null
  tags: string[] | null
  last_booked_date: string | null
  hub_listing_id: string | null
  hub_client_id: string | null
  report_run_id: string | null
  updated_at: string
}

// One month of metrics for a listing (subset selected by the dashboard).
export type ReportMetric = {
  period: string
  period_label: string | null
  rental_revenue: number | null
  rental_revenue_stly: number | null
  rental_revenue_ly: number | null
  rental_revenue_stly_yoy_pct: number | null
  rental_adr: number | null
  rental_adr_stly: number | null
  rental_adr_ly: number | null
  rental_adr_stly_yoy_pct: number | null
  market_adr: number | null
  market_adr_stly_yoy_pct: number | null
  rental_revpar: number | null
  market_revpar: number | null
  revpar_index: number | null
  adjusted_occupancy_pct: number | null
  adjusted_occupancy_ly_pct: number | null
  market_occupancy_pct: number | null
  median_booking_window: number | null
  median_booking_window_ly: number | null
  market_median_booking_window: number | null
  potential_revenue_open_inventory: number | null
}

// Bundle handed to the listing detail page: monthly series + freshness.
export type ListingReport = {
  attributes: ReportListing
  metrics: ReportMetric[]
  runCompletedAt: string | null
}

export type ReportGroupOverride = {
  id: string
  group_name: string
  client_id: string
  note: string | null
  created_by: string | null
  created_at: string
}
