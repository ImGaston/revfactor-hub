export type Listing = {
  id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

export type ClientTask = {
  id: string
  title: string
  status: string
  owner: string | null
  tag: string | null
  profiles?: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

export type Client = {
  id: string
  name: string
  status: string
  billing_amount: number | null
  onboarding_date: string | null
  ending_date: string | null
  autopayment_set_up: boolean
  stripe_dashboard: string | null
  email: string | null
  assembly_link: string | null
  assembly_client_id: string | null
  assembly_company_id: string | null
  listings: Listing[]
  tasks: ClientTask[]
}

export type Task = {
  id: string
  title: string
  description: string | null
  client_id: string | null
  owner: string | null
  tag: string | null
  status: string
  sort_order: number
  created_at: string
  clients?: { id: string; name: string } | null
  profiles?: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
  task_listings?: { listing_id: string; listings: { id: string; name: string } }[]
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

export type Post = {
  id: string
  title: string
  description: string | null
  status: string
  board_id: string | null
  eta: string | null
  author_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
  // Joined / computed fields
  upvote_count?: number
  comment_count?: number
  boards?: { name: string; icon: string } | null
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
  profiles?: { full_name: string | null; avatar_url: string | null; email: string } | null
  like_count?: number
  dislike_count?: number
  user_reaction?: "like" | "dislike" | null
  replies?: Comment[]
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
  assembly_client_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  lead_tag_assignments?: { lead_tags: LeadTag }[]
  lead_team_assignments?: {
    profile_id: string
    role: string
    profiles: { full_name: string | null; email: string; avatar_url: string | null }
  }[]
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
