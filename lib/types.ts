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

export type RoadmapItem = {
  id: string
  title: string
  description: string | null
  owner: string | null
  tag: string | null
  status: string
  sort_order: number
  created_at: string
}
