// Listing outcomes: did a setup change work? Compares bookings made after a
// tracked change window with the same span before it and the same dates last
// year, plus forward pace vs same time last year and the market (daily
// snapshots). Code computes every number and the verdict; the AI summary only
// puts them in words. Client-safe and pure. Design:
// docs/ontology/listing-revenue-setup.md (Outcome step).

import {
  CHANNEL_LABEL,
  DEFAULT_PLAN_CHANNELS,
  planChannelKey,
  type PlanChannel,
} from "@/lib/pricing-plan"

export type OutcomeReservation = {
  booked_at: string | null
  check_in: string
  check_out: string | null
  number_of_days: number | null
  booking_status: string | null
  booking_channel: string | null
  cancelled_at: string | null
  rental_revenue: number | null
  booking_window_days: number | null
}

export type OutcomeSnapshot = {
  snapshot_date: string
  occupancy_next_30: number | null
  market_occupancy_next_30: number | null
  occupancy_next_90: number | null
  market_occupancy_next_90: number | null
  mpi_next_30: number | null
}

export type ChannelShare = { key: string; label: string; nights: number; share: number }

export type WindowStats = {
  from: string
  to: string
  bookings: number
  nights: number
  revenue: number
  adr: number | null
  avgLos: number | null
  avgLeadDays: number | null
  cancelled: number
  payoutPerNight: number | null
  channels: ChannelShare[]
}

export type PaceStats = {
  horizon: 30 | 60 | 90
  nights: number
  nightsStly: number | null
  occ: number
  occStly: number | null
  /** Revenue per available night from bookings still on the books. */
  revpan: number
  revpanStly: number | null
}

export type MarketStats = {
  start: { date: string; occ30: number | null; market30: number | null } | null
  latest: { date: string; occ30: number | null; market30: number | null; mpi30: number | null } | null
}

export type OutcomeMetrics = {
  windowStart: string
  asOf: string
  days: number
  historyStart: string | null
  after: WindowStats
  before: WindowStats
  lastYear: WindowStats | null
  /** The comparison the verdict uses: last year when it's covered, else the span before. */
  baseline: "last_year" | "before"
  pace: PaceStats[]
  market: MarketStats | null
  floor: number | null
}

export type OutcomeVerdict = "on_track" | "watch" | "off_track" | "too_early"

export const CHECKPOINTS = [7, 14, 30, 60, 90] as const
export type Checkpoint = (typeof CHECKPOINTS)[number]

export const VERDICT_LABELS: Record<OutcomeVerdict, string> = {
  on_track: "On track",
  watch: "Watch",
  off_track: "Off track",
  too_early: "Too early",
}

// ─── Dates ──────────────────────────────────────────────────

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

const dateOf = (ts: string | null) => (ts ? ts.slice(0, 10) : null)

const isCancelled = (r: OutcomeReservation) => (r.booking_status ?? "").toLowerCase() === "cancelled"

function nightsOf(r: OutcomeReservation): number {
  if (r.number_of_days && r.number_of_days > 0) return r.number_of_days
  if (r.check_out) return Math.max(0, dayDiff(r.check_in, r.check_out))
  return 0
}

const round = (n: number, places = 2) => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ─── Change windows ─────────────────────────────────────────

export type ChangeSetLite = {
  id: string
  title: string
  status: string
  approved_at: string | null
  created_at: string
  /** Every change in the set only recorded what was already there (RecordObservation). */
  observationOnly?: boolean
}

export type ChangeWindow = { changeSetId: string; start: string; titles: string[]; changeSetIds: string[] }

/**
 * Groups applied change sets into tracked windows: sets within `gapDays` of
 * the previous one are one window (a takeover usually lands over a day or
 * two). Proposals, rejected sets and observation-only sets (a baseline read)
 * don't start a window.
 */
export function changeWindows(sets: ChangeSetLite[], gapDays = 3): ChangeWindow[] {
  const live = sets
    .filter((s) => s.status !== "proposed" && s.status !== "rejected" && !s.observationOnly)
    .map((s) => ({ ...s, at: (s.approved_at ?? s.created_at).slice(0, 10) }))
    .sort((a, b) => a.at.localeCompare(b.at) || (a.approved_at ?? a.created_at).localeCompare(b.approved_at ?? b.created_at))
  const windows: (ChangeWindow & { last: string })[] = []
  for (const s of live) {
    const w = windows[windows.length - 1]
    if (w && dayDiff(w.last, s.at) <= gapDays) {
      w.titles.push(s.title)
      w.changeSetIds.push(s.id)
      w.last = s.at
    } else {
      windows.push({ changeSetId: s.id, start: s.at, titles: [s.title], changeSetIds: [s.id], last: s.at })
    }
  }
  return windows.map((w) => ({ changeSetId: w.changeSetId, start: w.start, titles: w.titles, changeSetIds: w.changeSetIds }))
}

/** Checkpoints reached by `today` that have no saved review yet. */
export function dueCheckpoints(start: string, today: string, done: number[]): Checkpoint[] {
  const age = dayDiff(start, today)
  return CHECKPOINTS.filter((c) => age >= c && !done.includes(c))
}

// ─── Metrics ────────────────────────────────────────────────

function feeFor(channels: PlanChannel[], code: string | null): number {
  const key = planChannelKey(code)
  return (channels.find((c) => c.key === key) ?? DEFAULT_PLAN_CHANNELS.find((c) => c.key === key))?.fee ?? 0
}

/** Bookings made from `from` through `to` (by booked date). */
export function windowStats(
  rows: OutcomeReservation[],
  from: string,
  to: string,
  channels: PlanChannel[]
): WindowStats {
  const made = rows.filter((r) => {
    const d = dateOf(r.booked_at)
    return d !== null && d >= from && d <= to
  })
  const kept = made.filter((r) => !isCancelled(r))
  let nights = 0
  let revenue = 0
  let payout = 0
  let lead = 0
  let leadN = 0
  const byChannel = new Map<string, number>()
  for (const r of kept) {
    const n = nightsOf(r)
    const rev = Number(r.rental_revenue ?? 0)
    nights += n
    revenue += rev
    payout += rev * (1 - feeFor(channels, r.booking_channel))
    if (r.booking_window_days != null) {
      lead += r.booking_window_days
      leadN++
    }
    const key = planChannelKey(r.booking_channel)
    byChannel.set(key, (byChannel.get(key) ?? 0) + n)
  }
  return {
    from,
    to,
    bookings: kept.length,
    nights,
    revenue: round(revenue),
    adr: nights > 0 ? round(revenue / nights) : null,
    avgLos: kept.length > 0 ? round(nights / kept.length, 1) : null,
    avgLeadDays: leadN > 0 ? Math.round(lead / leadN) : null,
    cancelled: made.length - kept.length,
    payoutPerNight: nights > 0 ? round(payout / nights) : null,
    channels: [...byChannel.entries()]
      .map(([key, n]) => ({ key, label: CHANNEL_LABEL[key] ?? key, nights: n, share: nights ? round(n / nights, 3) : 0 }))
      .sort((a, b) => b.nights - a.nights),
  }
}

/**
 * Nights (and kept revenue) on the books as of `asOf` for stays in
 * [stayFrom, stayFrom + horizon). A booking later cancelled still counts as
 * on the books before its cancellation date (nights only: the feed zeroes a
 * cancelled booking's revenue).
 */
export function onTheBooks(rows: OutcomeReservation[], asOf: string, stayFrom: string, horizon: number) {
  const stayTo = addDays(stayFrom, horizon)
  let nights = 0
  let revenue = 0
  for (const r of rows) {
    const booked = dateOf(r.booked_at)
    if (!booked || booked > asOf) continue
    const cancelledOn = dateOf(r.cancelled_at)
    if (isCancelled(r) && (!cancelledOn || cancelledOn <= asOf)) continue
    const n = nightsOf(r)
    if (n === 0) continue
    const out = r.check_out ?? addDays(r.check_in, n)
    const start = r.check_in > stayFrom ? r.check_in : stayFrom
    const end = out < stayTo ? out : stayTo
    const overlap = dayDiff(start, end)
    if (overlap <= 0) continue
    nights += overlap
    if (!isCancelled(r)) revenue += (Number(r.rental_revenue ?? 0) / n) * overlap
  }
  return { nights, revenue }
}

export function computeOutcome(input: {
  reservations: OutcomeReservation[]
  windowStart: string
  asOf: string
  channels?: PlanChannel[]
  floor?: number | null
  snapshots?: OutcomeSnapshot[]
}): OutcomeMetrics {
  const { reservations: rows, windowStart, asOf } = input
  const channels = input.channels?.length ? input.channels : DEFAULT_PLAN_CHANNELS
  const days = Math.max(1, dayDiff(windowStart, asOf) + 1)
  const historyStart =
    rows
      .map((r) => dateOf(r.booked_at))
      .filter((d): d is string => !!d)
      .sort()[0] ?? null

  const after = windowStats(rows, windowStart, asOf, channels)
  const before = windowStats(rows, addDays(windowStart, -days), addDays(windowStart, -1), channels)
  const lyFrom = addDays(windowStart, -365)
  const lyCovered = historyStart !== null && historyStart <= lyFrom
  const lastYear = lyCovered ? windowStats(rows, lyFrom, addDays(asOf, -365), channels) : null

  const pace: PaceStats[] = ([30, 60, 90] as const).map((h) => {
    const now = onTheBooks(rows, asOf, asOf, h)
    const lyAsOf = addDays(asOf, -365)
    const ly = historyStart !== null && historyStart <= lyAsOf ? onTheBooks(rows, lyAsOf, lyAsOf, h) : null
    return {
      horizon: h,
      nights: now.nights,
      nightsStly: ly ? ly.nights : null,
      occ: round(now.nights / h, 3),
      occStly: ly ? round(ly.nights / h, 3) : null,
      revpan: round(now.revenue / h),
      revpanStly: ly ? round(ly.revenue / h) : null,
    }
  })

  let market: MarketStats | null = null
  const snaps = [...(input.snapshots ?? [])].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (snaps.length > 0) {
    const atStart = snaps.find((s) => s.snapshot_date >= addDays(windowStart, -3) && s.snapshot_date <= addDays(windowStart, 3))
    const latest = [...snaps].reverse().find((s) => s.snapshot_date <= asOf)
    market = {
      start: atStart
        ? { date: atStart.snapshot_date, occ30: atStart.occupancy_next_30, market30: atStart.market_occupancy_next_30 }
        : null,
      latest: latest
        ? {
            date: latest.snapshot_date,
            occ30: latest.occupancy_next_30,
            market30: latest.market_occupancy_next_30,
            mpi30: latest.mpi_next_30,
          }
        : null,
    }
  }

  return {
    windowStart,
    asOf,
    days,
    historyStart,
    after,
    before,
    lastYear,
    baseline: lastYear && lastYear.bookings >= 3 ? "last_year" : "before",
    pace,
    market,
    floor: input.floor ?? null,
  }
}

// ─── Verdict ────────────────────────────────────────────────

const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`

/**
 * The verdict is code, not AI. The goal for a pricing change is more money
 * per night without losing pace ("leaving money on the table"):
 * - off track: forward pace (90 days) under 80% of last year, payout per
 *   night under the owner's floor, or bookings down 40%+ without a 10%+ ADR gain;
 * - on track: ADR at or above the baseline and pace at 95%+ of last year
 *   (or, without last year, booked nights at 90%+ of the baseline);
 * - watch: anything in between; too early: under 3 bookings before day 30.
 */
export function judgeOutcome(m: OutcomeMetrics): { verdict: OutcomeVerdict; reasons: string[] } {
  const reasons: string[] = []
  const base = m.baseline === "last_year" && m.lastYear ? m.lastYear : m.before
  const baseLabel = m.baseline === "last_year" ? "same dates last year" : `the ${m.days} day${m.days === 1 ? "" : "s"} before`

  if (m.after.bookings < 3 && m.days < 30) {
    return {
      verdict: "too_early",
      reasons: [
        `${m.after.bookings} booking${m.after.bookings === 1 ? "" : "s"} in ${m.days} day${m.days === 1 ? "" : "s"}; judging from day 30 or 3 bookings`,
      ],
    }
  }

  const adrChange = m.after.adr != null && base.adr ? m.after.adr / base.adr - 1 : null
  if (adrChange != null) reasons.push(`ADR ${usd(m.after.adr!)} vs ${usd(base.adr!)} (${pct(adrChange)} vs ${baseLabel})`)
  const volume = base.nights > 0 ? m.after.nights / base.nights : null
  if (volume != null) reasons.push(`${m.after.nights} nights booked vs ${base.nights} (${pct(volume - 1)} vs ${baseLabel})`)

  const p90 = m.pace.find((p) => p.horizon === 90)
  const paceRatio = p90 && p90.nightsStly ? p90.nights / p90.nightsStly : null
  if (p90 && paceRatio != null) {
    reasons.push(`Next 90 days: ${p90.nights} nights on the books vs ${p90.nightsStly} last year (${pct(paceRatio - 1)})`)
  }
  const latest = m.market?.latest
  if (latest?.occ30 != null && latest.market30 != null) {
    reasons.push(`Next 30 days occupancy ${Math.round(latest.occ30)}% vs market ${Math.round(latest.market30)}%`)
  }
  const belowFloor = m.floor != null && m.after.payoutPerNight != null && m.after.payoutPerNight < m.floor
  if (m.floor != null && m.after.payoutPerNight != null) {
    reasons.push(`Payout per night ${usd(m.after.payoutPerNight)} vs ${usd(m.floor)} floor`)
  }

  const off =
    (paceRatio != null && paceRatio < 0.8) ||
    belowFloor ||
    (volume != null && volume < 0.6 && (adrChange == null || adrChange < 0.1))
  if (off) return { verdict: "off_track", reasons }

  const adrOk = adrChange == null || adrChange >= 0
  const paceOk = paceRatio != null ? paceRatio >= 0.95 : volume == null || volume >= 0.9
  if (adrOk && paceOk) return { verdict: "on_track", reasons }
  return { verdict: "watch", reasons }
}
