// Pricing plan math (client & server safe). Pure functions over a listing's
// synced reservations plus editable channel settings. Numbers come from code;
// the UI only displays them. Prototype: docs/pricing-plan.md.

export type PlanDiscountKind = "los" | "alt" | "promo"

/**
 * los: one length-of-stay tier applies (the longest the stay qualifies for).
 * alt: Airbnb applies the larger of this or the LOS tier (early bird, last minute, new listing).
 * promo: stacks on top (Booking.com Genius, non-refundable rate, direct coupons).
 */
export type PlanDiscount = {
  label: string
  pct: number
  kind: PlanDiscountKind
  minNights?: number
  on?: boolean
}

export type PlanChannel = {
  key: string
  label: string
  markup: number
  fee: number
  discounts: PlanDiscount[]
}

export type PlanReservation = {
  booked_date: string | null
  check_in: string
  check_out: string | null
  number_of_days: number | null
  booking_status: string | null
  booking_channel: string | null
  rental_revenue: number | null
  booking_window_days: number | null
}

export type MonthTarget = { month: string; occ: number; adr: number; days?: number }

export type DiscountMode = "auto" | "worst" | "none"

/** Starting channel settings (RevFactor markup policy). Every value is editable on the page. */
export const DEFAULT_PLAN_CHANNELS: PlanChannel[] = [
  {
    key: "airbnb",
    label: "Airbnb",
    markup: 0.44,
    fee: 0.155,
    discounts: [
      { label: "3+ nights", pct: 0.21, kind: "los", minNights: 3 },
      { label: "5+ nights", pct: 0.22, kind: "los", minNights: 5 },
      { label: "Weekly (7+)", pct: 0.24, kind: "los", minNights: 7 },
      { label: "14+ nights", pct: 0.26, kind: "los", minNights: 14 },
      { label: "Monthly (28+)", pct: 0.28, kind: "los", minNights: 28 },
      { label: "Early bird", pct: 0.2, kind: "alt" },
      { label: "Last minute", pct: 0.2, kind: "alt" },
    ],
  },
  {
    key: "bcom",
    label: "Booking.com",
    markup: 0.31,
    fee: 0.15,
    discounts: [
      { label: "Genius level 1", pct: 0.1, kind: "promo", on: true },
      { label: "Non-refundable rate", pct: 0.1, kind: "promo" },
    ],
  },
  {
    key: "vrbo",
    label: "Vrbo",
    markup: 0.15,
    fee: 0.14,
    discounts: [
      { label: "Weekly (7+)", pct: 0.1, kind: "los", minNights: 7 },
      { label: "Monthly (28+)", pct: 0.15, kind: "los", minNights: 28 },
    ],
  },
  {
    key: "direct",
    label: "Direct",
    markup: 0.05,
    fee: 0.02,
    discounts: [{ label: "Coupon", pct: 0.1, kind: "promo" }],
  },
]

/** Reservation channel codes (PriceLabs) → plan channel keys. */
const CHANNEL_KEY: Record<string, string> = {
  airbnb: "airbnb",
  bcom: "bcom",
  bookingcom: "bcom",
  "booking.com": "bcom",
  vrbo: "vrbo",
  homeaway: "vrbo",
  direct: "direct",
  manual: "direct",
  others: "direct",
}
export const planChannelKey = (code: string | null) =>
  CHANNEL_KEY[(code ?? "").toLowerCase()] ?? "direct"

export const CHANNEL_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  bcom: "Booking.com",
  vrbo: "Vrbo",
  direct: "Direct",
  manual: "Manual / owner",
  others: "Other",
}

// ─── Dates ──────────────────────────────────────────────────

export const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const addMonths = (ym: string, k: number) => {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return d.toISOString().slice(0, 7)
}
export const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000)
export const openDays = (t: MonthTarget) => t.days ?? daysInMonth(t.month)

// ─── Channel math ───────────────────────────────────────────

export function appliedDiscounts(ch: PlanChannel, nights: number, mode: DiscountMode): PlanDiscount[] {
  if (mode === "none") return []
  const los = ch.discounts.filter((d) => d.kind === "los")
  const alts = ch.discounts.filter((d) => d.kind === "alt")
  const promos = ch.discounts.filter((d) => d.kind === "promo")
  let pick: PlanDiscount | undefined
  if (mode === "worst") {
    pick = [...los, ...alts].sort((a, b) => b.pct - a.pct)[0]
  } else {
    pick = los
      .filter((d) => (d.minNights ?? 1) <= nights)
      .sort((a, b) => (b.minNights ?? 1) - (a.minNights ?? 1))[0]
    for (const a of alts) if (a.on && (!pick || a.pct > pick.pct)) pick = a
  }
  const out = pick ? [pick] : []
  out.push(...(mode === "worst" ? promos : promos.filter((d) => d.on)))
  return out
}

/** Owner payout per $1 of PriceLabs price: (1 + markup) × Π(1 − discount) × (1 − fee). */
export const payoutShare = (ch: PlanChannel, discounts: PlanDiscount[]) =>
  (1 + ch.markup) * discounts.reduce((a, d) => a * (1 - d.pct), 1) * (1 - ch.fee)

/** PriceLabs minimum that keeps the payout at or above `floor` with the channel's deepest discounts, rounded up to $5. */
export const minPriceForFloor = (ch: PlanChannel, floor: number) =>
  Math.ceil(floor / payoutShare(ch, appliedDiscounts(ch, 30, "worst")) / 5) * 5

export function tightestChannel(channels: PlanChannel[], floor: number) {
  const ranked = channels
    .map((ch) => ({ ch, share: payoutShare(ch, appliedDiscounts(ch, 30, "worst")) }))
    .sort((a, b) => a.share - b.share)
  if (!ranked.length) return null
  return { ...ranked[0], min: minPriceForFloor(ranked[0].ch, floor), next: ranked[1] ?? null }
}

// ─── History, booking curve, pace ───────────────────────────

export type ChannelStats = {
  code: string
  bookings: number
  cancelled: number
  cancelledNights: number
  nights: number
  revenue: number
  leadSum: number
}

export type PlanHistory = {
  nights: Record<string, number>
  revenue: Record<string, number>
  onBooksNights: Record<string, number>
  onBooksRevenue: Record<string, number>
  channels: ChannelStats[]
  avgStay: number | null
  /** Lead time (days from booking to the night) for every stayed night. */
  leads: number[]
}

export function buildHistory(rows: PlanReservation[], today: string): PlanHistory {
  const h: PlanHistory = { nights: {}, revenue: {}, onBooksNights: {}, onBooksRevenue: {}, channels: [], avgStay: null, leads: [] }
  const byChannel = new Map<string, ChannelStats>()
  const stays: number[] = []
  for (const r of rows) {
    const code = (r.booking_channel ?? "others").toLowerCase()
    const c = byChannel.get(code) ?? { code, bookings: 0, cancelled: 0, cancelledNights: 0, nights: 0, revenue: 0, leadSum: 0 }
    byChannel.set(code, c)
    const n = Math.max(0, Number(r.number_of_days ?? 0))
    if ((r.booking_status ?? "").toLowerCase() !== "booked") {
      c.cancelled++
      c.cancelledNights += n
      continue
    }
    const rev = Number(r.rental_revenue ?? 0)
    c.bookings++
    c.nights += n
    c.revenue += rev
    const w = Number(r.booking_window_days ?? 0)
    c.leadSum += w >= 0 && w <= 730 ? w : 0
    stays.push(n)
    const perNight = n ? rev / n : 0
    const d = new Date(r.check_in + "T00:00:00Z")
    for (let i = 0; i < n; i++) {
      const iso = d.toISOString().slice(0, 10)
      const ym = iso.slice(0, 7)
      if (iso < today) {
        h.nights[ym] = (h.nights[ym] ?? 0) + 1
        h.revenue[ym] = (h.revenue[ym] ?? 0) + perNight
        if (r.booked_date) {
          // Some PMS rows carry a 1970 placeholder booking date; ignore impossible lead times.
          const lead = dayDiff(r.booked_date, iso)
          if (lead >= 0 && lead <= 730) h.leads.push(lead)
        }
      } else {
        h.onBooksNights[ym] = (h.onBooksNights[ym] ?? 0) + 1
        h.onBooksRevenue[ym] = (h.onBooksRevenue[ym] ?? 0) + perNight
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
  }
  h.channels = [...byChannel.values()].sort((a, b) => b.revenue - a.revenue)
  h.avgStay = stays.length ? stays.reduce((a, b) => a + b, 0) / stays.length : null
  h.leads.sort((a, b) => a - b)
  return h
}

/** Share of stayed nights already booked `d` days before the night (null without history). */
export function curveAt(h: PlanHistory, d: number): number | null {
  const n = h.leads.length
  if (!n) return null
  let lo = 0
  let hi = n
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (h.leads[m] < d) lo = m + 1
    else hi = m
  }
  return (n - lo) / n
}

export type MonthPace = {
  lead: number
  curve: number | null
  onBooksNights: number
  onBooksRevenue: number
  expectedNow: number | null
  /** On-the-books nights ÷ nights the curve expects by now (null when too early to tell). */
  pace: number | null
  pickupNights: number | null
  projectedRevenue: number | null
}

export function monthPace(t: MonthTarget, h: PlanHistory | null, today: string): MonthPace {
  const lead = Math.max(0, dayDiff(today, t.month + "-15"))
  const c = h ? curveAt(h, lead) : null
  const obN = h?.onBooksNights[t.month] ?? 0
  const obRev = h?.onBooksRevenue[t.month] ?? 0
  if (c == null) return { lead, curve: null, onBooksNights: obN, onBooksRevenue: obRev, expectedNow: null, pace: null, pickupNights: null, projectedRevenue: null }
  const targetNights = t.occ * openDays(t)
  const expectedNow = targetNights * c
  const pace = expectedNow >= 2 ? obN / expectedNow : null
  const open = Math.max(0, openDays(t) - obN)
  const pickupNights = Math.min(open, Math.max(0, targetNights * (1 - c)))
  return { lead, curve: c, onBooksNights: obN, onBooksRevenue: obRev, expectedNow, pace, pickupNights, projectedRevenue: obRev + pickupNights * t.adr }
}

export const targetRevenue = (t: MonthTarget) => t.occ * openDays(t) * t.adr

/** Starting targets when no plan is saved: the same month last year (occupancy and nightly rate). */
export function draftTargetsFromHistory(h: PlanHistory | null, today: string, months = 12): MonthTarget[] {
  const start = addMonths(today.slice(0, 7), 1)
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(start, i)
    const ly = addMonths(month, -12)
    // The current month is only partly stayed: count its remaining on-the-books nights too.
    const n = (h?.nights[ly] ?? 0) + (h?.onBooksNights[ly] ?? 0)
    const rev = (h?.revenue[ly] ?? 0) + (h?.onBooksRevenue[ly] ?? 0)
    const occ = Math.min(1, n / daysInMonth(ly))
    const adr = n ? rev / n : 0
    return { month, occ: Math.round(occ * 100) / 100, adr: Math.round(adr / 5) * 5 }
  })
}

// ─── Owner economics ────────────────────────────────────────

export type EconomicsInput = {
  fixedMonthly: number
  cleaningPerTurn: number
  guestCleaningFee: number
  avgStay: number
  revfactorMonthly: number
}

/** Revenue-weighted channel mix from history; all Airbnb when there is none. */
export function channelMix(channels: PlanChannel[], h: PlanHistory | null): number[] {
  if (h && h.channels.length) {
    const total = h.channels.reduce((a, c) => a + c.revenue, 0) || 1
    const w = channels.map((ch) => h.channels.filter((c) => planChannelKey(c.code) === ch.key).reduce((a, c) => a + c.revenue, 0) / total)
    const s = w.reduce((a, b) => a + b, 0)
    if (s > 0) return w.map((v) => v / s)
  }
  return channels.map((ch) => (ch.key === "airbnb" ? 1 : 0))
}

/** Target revenue is booked nightly revenue, so the owner keeps revenue minus each channel's fee. */
export const keptShare = (channels: PlanChannel[], mix: number[]) =>
  channels.reduce((a, ch, i) => a + (mix[i] ?? 0) * (1 - ch.fee), 0)

export function economics(targets: MonthTarget[], channels: PlanChannel[], mix: number[], e: EconomicsInput) {
  const kept = keptShare(channels, mix)
  const stay = Math.max(1, e.avgStay)
  const rows = targets.map((t) => {
    const revenue = targetRevenue(t)
    const nights = t.occ * openDays(t)
    const turns = nights / stay
    const payout = revenue * kept
    const active = nights > 0
    const net = payout + turns * e.guestCleaningFee - turns * e.cleaningPerTurn - e.fixedMonthly - (active ? e.revfactorMonthly : 0)
    return { month: t.month, revenue, nights, turns, payout, net }
  })
  const sum = (k: "revenue" | "nights" | "payout" | "net") => rows.reduce((a, r) => a + r[k], 0)
  const nights = sum("nights")
  const avgRate = nights ? sum("revenue") / nights : 0
  const perNightNet = avgRate * kept + (e.guestCleaningFee - e.cleaningPerTurn) / stay
  const yearCost = e.fixedMonthly * targets.length + e.revfactorMonthly * rows.filter((r) => r.nights > 0).length
  const dayCount = targets.reduce((a, t) => a + openDays(t), 0)
  return {
    kept,
    rows,
    revenue: sum("revenue"),
    payout: sum("payout"),
    net: sum("net"),
    avgRate,
    breakEvenOcc: perNightNet > 0 && dayCount ? yearCost / (perNightNet * dayCount) : null,
  }
}

// ─── Suggestions ────────────────────────────────────────────

export type PlanSuggestion = {
  id: string
  severity: "critical" | "high" | "medium"
  title: string
  why: string
  math?: string
  impact?: number
  impactLabel?: string
  apply?: MonthTarget[]
}

/** Below this share of the curve's expectation a month is "behind" (draft threshold, goals Q4). */
export const PACE_BEHIND = 0.8

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US")
const pctTxt = (n: number) => Math.round(n * 100) + "%"
const monthName = (ym: string) =>
  new Date(ym + "-01T00:00:00Z").toLocaleString("en-US", { month: "long", timeZone: "UTC" })
const monthShort = (ym: string) =>
  new Date(ym + "-01T00:00:00Z").toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })

export function buildSuggestions(input: {
  targets: MonthTarget[]
  history: PlanHistory | null
  channels: PlanChannel[]
  floor: number
  today: string
}): PlanSuggestion[] {
  const { targets, history: h, channels, floor, today } = input
  const out: PlanSuggestion[] = []

  if (!h || !h.leads.length) {
    out.push({
      id: "connect",
      severity: "high",
      title: "No booking history synced for this listing yet",
      why: "Pace, the booking curve and last-year comparisons appear once PriceLabs syncs this listing's reservations. Until then the targets are estimates.",
    })
  }

  for (const t of targets) {
    const p = monthPace(t, h, today)
    if (p.pace == null || p.lead > 120) continue
    if (p.pace < PACE_BEHIND) {
      const gap = targetRevenue(t) - (p.projectedRevenue ?? 0)
      out.push({
        id: `behind-${t.month}`,
        severity: p.onBooksNights === 0 && p.lead < 90 ? "critical" : "high",
        title: `${monthName(t.month)} is behind pace: ${p.onBooksNights} of ${Math.round(p.expectedNow ?? 0)} expected nights booked`,
        why:
          p.onBooksNights === 0
            ? `Nothing is booked ${p.lead} days out. Check whether the owner blocked it; if not, open and price it now.`
            : `At ${p.lead} days out the booking curve expects ${pctTxt(p.curve ?? 0)} of target nights on the books. Hold the floor; use minimum stays and length-of-stay rules, not across-the-board discounts.`,
        math: `Target ${Math.round(t.occ * openDays(t))} nights × curve ${pctTxt(p.curve ?? 0)} = ${Math.round(p.expectedNow ?? 0)} expected now.`,
        impact: -Math.max(0, gap),
        impactLabel: "at risk vs target",
      })
    } else if (p.pace > 1.3 && p.lead > 20 && (p.expectedNow ?? 0) >= 5) {
      const open = Math.max(0, openDays(t) - p.onBooksNights)
      out.push({
        id: `ahead-${t.month}`,
        severity: "medium",
        title: `${monthName(t.month)} is ahead of pace: raise rates on the nights left`,
        why: `${p.onBooksNights} nights are booked ${p.lead} days out. Raise the open nights 5–10% and let pickup tell you if it went too far.`,
        math: `Expected now ${Math.round(p.expectedNow ?? 0)} nights; booked ${p.onBooksNights}.`,
        impact: open * Math.min(1, t.occ) * t.adr * 0.07,
        impactLabel: "if +7% on open nights",
      })
    }
  }

  if (h) {
    const lyOcc = (m: string) => {
      const ly = addMonths(m, -12)
      return h.nights[ly] == null ? null : (h.nights[ly] ?? 0) / daysInMonth(ly)
    }
    const hot = targets.filter((t) => {
      const o = lyOcc(t.month)
      const ly = addMonths(t.month, -12)
      const adr = (h.revenue[ly] ?? 0) / Math.max(1, h.nights[ly] ?? 0)
      return o != null && o >= 0.85 && t.adr < adr * 1.12
    })
    if (hot.length) {
      const apply = hot.map((t) => {
        const ly = addMonths(t.month, -12)
        const adr = (h.revenue[ly] ?? 0) / Math.max(1, h.nights[ly] ?? 0)
        return { ...t, adr: Math.round((adr * 1.12) / 5) * 5, occ: Math.min(t.occ, 0.88) }
      })
      const delta = apply.reduce((a, t, i) => a + targetRevenue(t) - targetRevenue(hot[i]), 0)
      out.push({
        id: "underpriced",
        severity: "high",
        title: `Raise the nightly target in ${hot.map((t) => monthShort(t.month)).join(", ")}: last year these ran 85%+ full`,
        why: "Near-full months mean guests would have paid more. Aim for last year's nightly rate +12% and accept slightly lower occupancy (capped at 88%).",
        math: apply.map((t) => `${monthShort(t.month)} → ${usd(t.adr)}`).join(" · "),
        impact: delta,
        impactLabel: "vs current targets",
        apply,
      })
    }
    const soft = targets.filter((t) => {
      const o = lyOcc(t.month)
      return o != null && o < 0.55
    })
    if (soft.length) {
      const each = soft.reduce((a, t) => a + 0.1 * openDays(t) * t.adr, 0)
      out.push({
        id: "soft",
        severity: "medium",
        title: `${soft.map((t) => monthShort(t.month)).join(", ")} were under 55% booked last year`,
        why: "First confirm owner use. If they were open: keep the floor, allow shorter stays inside 45 days, price gap nights, and check the guest-count rules (children, pets).",
        math: `Each +10 points of occupancy in these months ≈ ${usd(each)}.`,
        impact: each,
        impactLabel: "per +10 pts occupancy",
      })
    }
    for (const c of h.channels) {
      const rate = c.cancelled / Math.max(1, c.bookings + c.cancelled)
      if (c.cancelled >= 4 && rate > 0.25) {
        const adr = c.nights ? c.revenue / c.nights : 0
        out.push({
          id: `cancel-${c.code}`,
          severity: "high",
          title: `${CHANNEL_LABEL[c.code] ?? c.code} cancels ${pctTxt(rate)} of bookings (${c.cancelled} of ${c.bookings + c.cancelled})`,
          why: "Cancelled stays hold peak dates and hand them back late. Add a non-refundable rate (about 10% off) and limit free cancellation to 30 days out (60 in peak).",
          math: `${c.cancelledNights} nights cancelled, about ${usd(c.cancelledNights * adr)} at this channel's ${usd(adr)} average. Some were re-sold.`,
        })
      }
    }
  }

  if (floor > 0 && channels.length > 1) {
    const t = tightestChannel(channels, floor)
    if (t && t.next) {
      const nextMin = minPriceForFloor(t.next.ch, floor)
      if (t.min - nextMin >= 5) {
        out.push({
          id: "tightest",
          severity: "medium",
          title: `${t.ch.label} sets the PriceLabs minimum at ${usd(t.min)}`,
          why: `Its deepest discount leaves the owner the smallest share. Trim that discount or raise ${t.ch.label}'s markup and the minimum can drop to ${usd(nextMin)} (set by ${t.next.ch.label}).`,
          math: `${usd(floor)} ÷ ${t.share.toFixed(3)} = ${usd(t.min)}.`,
        })
      }
    }
  }

  const rank = { critical: 0, high: 1, medium: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0))
}
