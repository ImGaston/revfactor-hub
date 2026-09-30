// Daily support digest — built from ticket data with the same rules the Hub
// queue uses, so the digest can never disagree with the screen. Pure; the
// server loads the rows (GET /api/v1/support-tickets/digest) and the capture
// bot only formats and delivers the sections.
//
// Sections are role-neutral: every owner gets their overdue, due-today, and
// "done, client not told" lines; the verify queue, stale triage, money
// decisions, at-risk clients, and week-over-week numbers are team-wide and the
// bot routes them to whoever handles them.

import {
  bucketSupportTickets,
  commitmentTiming,
  dueState,
  isDoneNotTold,
  isStaleTriage,
  nextDueAt,
  relativeDueLabel,
  SUPPORT_ACTIVE_STATUSES,
  verifyAgeHours,
  type SupportTicket,
  type SupportTicketCommitment,
} from "@/lib/support-tickets"

export const DIGEST_TIMEZONE = "America/New_York"

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Time zone helpers (no dependency: Intl only)
// ---------------------------------------------------------------------------

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant the current calendar day ends in `timeZone` (next local midnight). */
export function endOfDayInTimeZone(now: Date, timeZone: string = DIGEST_TIMEZONE): Date {
  const p = zonedParts(now, timeZone)
  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0)
  // Two passes settle the offset across a DST change at midnight
  let instant = wallMidnight - zoneOffsetMs(new Date(wallMidnight), timeZone)
  instant = wallMidnight - zoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

export type DigestTicket = SupportTicket & {
  clients?: { id: string; name: string; churn_risk?: string | null } | null
  assignee?: { full_name: string | null; email: string } | null
}

export type DigestLine = {
  ticket_id: string
  ticket_number: number
  client: string
  property: string
  summary: string
  due: string
  owner: string
  hand_managed: boolean
  /** One line, ready to post: `#1029 Okafor · Boho Cottage · … · 7h overdue · Andrés` */
  line: string
}

export type DigestOwnerSection = {
  owner: { id: string; name: string; email: string } | null
  overdue: DigestLine[]
  due_today: DigestLine[]
  done_not_told: DigestLine[]
}

export type WeekPair = { this_week: number; last_week: number }

export type SupportDigest = {
  generated_at: string
  timezone: string
  by_owner: DigestOwnerSection[]
  verify_queue: DigestLine[]
  stale_triage: DigestLine[]
  money_decisions: DigestLine[]
  at_risk: DigestLine[]
  metrics: {
    promise_on_time_rate: { this_week: number | null; last_week: number | null }
    promises_closed: WeekPair
    sent_back: WeekPair
    client_rejected: WeekPair
    backlog_open: number
    backlog_cleared: number
  }
}

export type DigestInput = {
  tickets: DigestTicket[]
  /** Promises closed in the last 14 days, tagged with their ticket's backfill flag. */
  closedCommitments: (Pick<SupportTicketCommitment, "status" | "due_at" | "rescheduled_to" | "closed_at"> & {
    backfilled: boolean
  })[]
  /** `verification_failed` / `client_rejected` events in the last 14 days. */
  events: { event_type: string; occurred_at: string }[]
  backlogCleared: number
  now: Date
}

function ownerName(t: DigestTicket): string {
  return t.assignee?.full_name?.split(/\s+/)[0] || t.assignee?.email || "Unassigned"
}

function propertyLabel(t: DigestTicket): string {
  if (t.property_scope === "portfolio") return "Whole portfolio"
  if (t.property_scope === "account") return "Account"
  const names = (t.support_ticket_listings ?? [])
    .map((l) => l.listings?.name?.split(/[|•]/)[0]?.trim())
    .filter(Boolean)
  return names.length ? names.join(", ") : "Property not validated"
}

function toLine(t: DigestTicket, due: string): DigestLine {
  const client = t.clients?.name ?? "Unknown client"
  const property = propertyLabel(t)
  const owner = ownerName(t)
  const flag = t.hand_managed ? " · hand-managed" : ""
  return {
    ticket_id: t.id,
    ticket_number: t.ticket_number,
    client,
    property,
    summary: t.summary,
    due,
    owner,
    hand_managed: t.hand_managed,
    line: `#${t.ticket_number} ${client} · ${property} · ${t.summary} · ${due} · ${owner}${flag}`,
  }
}

function weekPair(timestamps: number[], now: Date): WeekPair {
  const t = now.getTime()
  return {
    this_week: timestamps.filter((x) => x > t - 7 * DAY_MS && x <= t).length,
    last_week: timestamps.filter((x) => x > t - 14 * DAY_MS && x <= t - 7 * DAY_MS).length,
  }
}

export function buildSupportDigest(input: DigestInput): SupportDigest {
  const { now } = input
  const active = input.tickets.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status))
  const queue = bucketSupportTickets(active, now)
  const overdueIds = new Set(queue.overdue.map((t) => t.id))
  const endOfDay = endOfDayInTimeZone(now)

  const owners = new Map<string, DigestOwnerSection>()
  const sectionFor = (t: DigestTicket) => {
    const key = t.assignee_id ?? "unassigned"
    if (!owners.has(key))
      owners.set(key, {
        owner: t.assignee_id
          ? { id: t.assignee_id, name: t.assignee?.full_name ?? t.assignee?.email ?? "", email: t.assignee?.email ?? "" }
          : null,
        overdue: [],
        due_today: [],
        done_not_told: [],
      })
    return owners.get(key)!
  }

  for (const t of active) {
    if (t.status === "new") continue // triage is its own section
    const due = nextDueAt(t)
    if (isDoneNotTold(t)) {
      sectionFor(t).done_not_told.push(toLine(t, "done, client not told"))
    } else if (overdueIds.has(t.id)) {
      sectionFor(t).overdue.push(toLine(t, relativeDueLabel(due, now)))
    } else if (due && dueState(due, now) !== "overdue" && due.getTime() <= endOfDay.getTime()) {
      sectionFor(t).due_today.push(toLine(t, `due ${relativeDueLabel(due, now)}`))
    }
  }

  const promiseRate = (from: number, to: number) => {
    let closed = 0
    let onTime = 0
    for (const c of input.closedCommitments) {
      if (c.backfilled || !c.closed_at) continue
      const at = Date.parse(c.closed_at)
      if (at <= from || at > to) continue
      const timing = commitmentTiming(c, now)
      if (timing !== "kept_on_time" && timing !== "kept_late") continue
      closed += 1
      if (timing === "kept_on_time") onTime += 1
    }
    return { closed, rate: closed ? onTime / closed : null }
  }
  const t = now.getTime()
  const thisWeek = promiseRate(t - 7 * DAY_MS, t)
  const lastWeek = promiseRate(t - 14 * DAY_MS, t - 7 * DAY_MS)
  const eventTimes = (type: string) =>
    input.events.filter((e) => e.event_type === type).map((e) => Date.parse(e.occurred_at))

  return {
    generated_at: now.toISOString(),
    timezone: DIGEST_TIMEZONE,
    by_owner: [...owners.values()].filter(
      (s) => s.overdue.length || s.due_today.length || s.done_not_told.length
    ),
    verify_queue: queue.verify.map((v) =>
      toLine(v, `waiting ${Math.round(verifyAgeHours(v, now) ?? 0)}h for verification`)
    ),
    stale_triage: queue.triage
      .filter((v) => isStaleTriage(v, now))
      .map((v) => toLine(v, "in triage over 12h")),
    money_decisions: active
      .filter((v) => v.category === "billing" || v.category === "offboarding")
      .map((v) => toLine(v, v.money_at_stake ? "money at stake" : relativeDueLabel(nextDueAt(v), now))),
    at_risk: active
      .filter((v) => v.client_sentiment === "unhappy" || v.clients?.churn_risk === "high")
      .map((v) => toLine(v, relativeDueLabel(nextDueAt(v), now))),
    metrics: {
      promise_on_time_rate: { this_week: thisWeek.rate, last_week: lastWeek.rate },
      promises_closed: { this_week: thisWeek.closed, last_week: lastWeek.closed },
      sent_back: weekPair(eventTimes("verification_failed"), now),
      client_rejected: weekPair(eventTimes("client_rejected"), now),
      backlog_open: active.filter((v) => v.backfilled).length,
      backlog_cleared: input.backlogCleared,
    },
  }
}
