// Client Profile tab — client+server-safe constants and validation for the
// `client_profiles` table (migration 20261014120000).

import { detectCredential } from "@/lib/support-tickets"

export const EXPERIENCE_LEVELS = [
  { value: "new", label: "New to STR" },
  { value: "some", label: "Some experience" },
  { value: "experienced", label: "Experienced" },
] as const
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["value"]

export function experienceLevelLabel(value: string | null | undefined): string {
  return EXPERIENCE_LEVELS.find((l) => l.value === value)?.label ?? "Not set"
}

export const CLIENT_PROFILE_TEXT_FIELDS = [
  { key: "background", label: "Background", placeholder: "Who they are, how they got into STR, other properties…" },
  { key: "goals", label: "Goals", placeholder: "Occupancy vs. rate, revenue target, owner stays…" },
  { key: "pricing_preferences", label: "Pricing preferences", placeholder: "Floors they care about, discounts they dislike, min stays…" },
  { key: "communication", label: "Communication", placeholder: "Channel, frequency, how much detail they want…" },
  { key: "decision_style", label: "Decision style", placeholder: "Decides fast, wants data first, checks with a partner…" },
  { key: "guest_mix", label: "Guest mix", placeholder: "Families, events, corporate, long stays…" },
] as const
export type ClientProfileTextField = (typeof CLIENT_PROFILE_TEXT_FIELDS)[number]["key"]

export const CLIENT_PROFILE_TEXT_MAX = 2000
export const CLIENT_PROFILE_TIMEZONE_MAX = 100

export type ClientProfileValues = {
  experience_level: ExperienceLevel | null
  timezone: string | null
} & Record<ClientProfileTextField, string | null>

export type ClientProfileRecord = ClientProfileValues & {
  updated_at: string | null
  updated_by_name: string | null
}

export const EMPTY_CLIENT_PROFILE: ClientProfileValues = {
  experience_level: null,
  timezone: null,
  background: null,
  goals: null,
  pricing_preferences: null,
  communication: null,
  decision_style: null,
  guest_mix: null,
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/** Normalizes form input; rejects oversize text and anything that looks like a credential. */
export function validateClientProfile(
  raw: Record<string, unknown>
): { values: ClientProfileValues } | { error: string } {
  const level = clean(raw.experience_level)
  if (level && !EXPERIENCE_LEVELS.some((l) => l.value === level)) {
    return { error: "Pick an experience level" }
  }
  const timezone = clean(raw.timezone)
  if (timezone && timezone.length > CLIENT_PROFILE_TIMEZONE_MAX) {
    return { error: "Keep the timezone short" }
  }
  const values: ClientProfileValues = {
    ...EMPTY_CLIENT_PROFILE,
    experience_level: (level as ExperienceLevel | null) ?? null,
    timezone,
  }
  for (const field of CLIENT_PROFILE_TEXT_FIELDS) {
    const text = clean(raw[field.key])
    if (text && text.length > CLIENT_PROFILE_TEXT_MAX) {
      return { error: `${field.label} is too long (max ${CLIENT_PROFILE_TEXT_MAX.toLocaleString()} characters)` }
    }
    const credential = detectCredential(text)
    if (credential) return { error: `Remove the ${credential} from ${field.label.toLowerCase()}` }
    values[field.key] = text
  }
  if (timezone && detectCredential(timezone)) return { error: "Remove the credential from timezone" }
  return { values }
}
