"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { STATUS_BADGE, adjustmentStatusLabelFor, adjustmentTypeLabel } from "@/lib/adjustments"
import {
  clientGaps,
  clientOpenPromises,
  isPropertyValidated,
  type SupportClientContext,
  type SupportContextAdjustment,
} from "@/lib/support-client-view"
import { formatSupportDateTime, ownerLabel, ticketPropertyLabel, timeAgo } from "@/lib/support-display"
import {
  SUPPORT_ACTIVE_STATUSES,
  SUPPORT_VERDICT_BADGE,
  publicListingName,
  relativeDueLabel,
  supportTicketPath,
  ticketRef,
  type SupportTicket,
} from "@/lib/support-tickets"
import { cn } from "@/lib/utils"

const ALERT_BADGE = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
const OK_BADGE = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"

/** "Oct 5" for a DATE column, without a timezone shift. */
function formatDay(day: string | null): string | null {
  if (!day) return null
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function TicketLink({ id, ticketNumber }: { id: string; ticketNumber: number }) {
  return (
    <Link href={supportTicketPath(id)} className="font-mono text-xs text-muted-foreground hover:underline">
      {ticketRef(ticketNumber)}
    </Link>
  )
}

function Panel({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-lg border bg-card p-4", className)}>
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Everything about one client on one screen, above its tickets: the gaps to
 * close, open promises, properties, Adjustments, and the latest messages.
 * `tickets` is the client's loaded tickets (open, plus closed when shown).
 */
export function SupportClientContextPanel({
  clientName,
  tickets,
  context,
  now,
}: {
  clientName: string
  tickets: SupportTicket[]
  context: SupportClientContext
  now: Date
}) {
  const open = tickets.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status))
  const gaps = clientGaps(tickets, now)
  const promises = clientOpenPromises(tickets, now)

  return (
    <div className="grid gap-3 lg:grid-cols-2" aria-label={`${clientName} context`}>
      <Panel title="Gaps to close" description="Same rules as the numbers above. Each ticket links to its page.">
        <ul className="space-y-2">
          {gaps.map((gap) => (
            <li key={gap.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span
                className={cn(
                  "min-w-7 rounded-md px-1.5 py-0.5 text-center font-mono text-xs tabular-nums",
                  gap.count > 0 ? ALERT_BADGE : "bg-muted text-muted-foreground"
                )}
              >
                {gap.count}
              </span>
              <span className={cn(gap.count === 0 && "text-muted-foreground")}>{gap.label}</span>
              {gap.tickets.map((t) => (
                <TicketLink key={t.id} id={t.id} ticketNumber={t.ticket_number} />
              ))}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Conversation" description="Latest messages across all of this client's tickets.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Last client message</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {context.lastClientMessage ? (
              <>
                <span title={formatSupportDateTime(context.lastClientMessage.at)}>
                  {timeAgo(context.lastClientMessage.at, now)}
                </span>
                <TicketLink id={context.lastClientMessage.ticketId} ticketNumber={context.lastClientMessage.ticketNumber} />
              </>
            ) : (
              <span className="text-muted-foreground">None recorded</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Last team reply</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {context.lastTeamMessage ? (
              <>
                <span title={formatSupportDateTime(context.lastTeamMessage.at)}>
                  {timeAgo(context.lastTeamMessage.at, now)}
                </span>
                <TicketLink id={context.lastTeamMessage.ticketId} ticketNumber={context.lastTeamMessage.ticketNumber} />
              </>
            ) : (
              <span className="text-muted-foreground">None recorded</span>
            )}
          </dd>
        </dl>
      </Panel>

      <Panel
        title={`Open promises (${promises.length})`}
        description="Every open promise on this client's open tickets, soonest due first."
        className="lg:col-span-2"
      >
        {promises.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open promises.</p>
        ) : (
          <ul className="divide-y text-sm">
            {promises.map((p) => (
              <li key={p.commitment.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <TicketLink id={p.ticket.id} ticketNumber={p.ticket.ticket_number} />
                <span className="min-w-0 flex-1 wrap-anywhere">{p.commitment.description}</span>
                <span className="text-xs text-muted-foreground">{ownerLabel(p.ticket.assignee)}</span>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    p.overdue ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"
                  )}
                  title={formatSupportDateTime(p.dueAt)}
                >
                  {relativeDueLabel(new Date(p.dueAt), now)}
                </span>
                {p.overdue && <Badge className={ALERT_BADGE}>Overdue</Badge>}
                {p.likelyKept && <Badge className={SUPPORT_VERDICT_BADGE.uncertain}>Likely kept, confirm</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Properties" description="The client's listings, and whether each open ticket's property is confirmed.">
        {context.listings && <ListingSummary listings={context.listings} />}
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tickets.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {open.map((t) => {
              const validated = isPropertyValidated(t)
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <TicketLink id={t.id} ticketNumber={t.ticket_number} />
                  <span className="min-w-0 flex-1 wrap-anywhere">{ticketPropertyLabel(t)}</span>
                  <Badge className={validated ? OK_BADGE : SUPPORT_VERDICT_BADGE.uncertain}>
                    {validated ? "Validated" : "Not validated"}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {context.adjustments && (
        <Panel
          title="Adjustments"
          description="In flight (open, needs info, issue, or resolved but not yet controlled) and controlled in the last 30 days."
        >
          <AdjustmentList label="In flight" rows={context.adjustments.inFlight} empty="None in flight." />
          <AdjustmentList
            label="Controlled, last 30 days"
            rows={context.adjustments.recentlyControlled}
            empty="None controlled in the last 30 days."
          />
        </Panel>
      )}
    </div>
  )
}

function ListingSummary({ listings }: { listings: NonNullable<SupportClientContext["listings"]> }) {
  const active = listings.filter((l) => l.status === "active")
  const other = listings.length - active.length
  return (
    <div className="space-y-1.5 text-sm">
      <p>
        <span className="font-medium">{active.length}</span> active {active.length === 1 ? "listing" : "listings"}
        {other > 0 && <span className="text-muted-foreground"> · {other} inactive or test</span>}
      </p>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {active.map((l) => (
            <Badge key={l.id} variant="outline" className="font-normal">
              {publicListingName(l.name)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function AdjustmentList({ label, rows, empty }: { label: string; rows: SupportContextAdjustment[]; empty: string }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground uppercase">{label}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((a) => {
            const from = formatDay(a.date_from)
            const to = formatDay(a.date_to)
            const range = from && to && from !== to ? `${from} – ${to}` : (from ?? to)
            const stamp = a.controlled_at
              ? `controlled ${formatSupportDateTime(a.controlled_at)}`
              : `created ${formatSupportDateTime(a.created_at)}`
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 first:pt-0 last:pb-0">
                <Link href={`/adjustments/${a.id}`} className="font-medium hover:underline">
                  {adjustmentTypeLabel(a.type)}
                </Link>
                <span className="min-w-0 text-muted-foreground wrap-anywhere">
                  {a.listings?.name ? publicListingName(a.listings.name) : "All listings"}
                  {range ? ` · ${range}` : ""}
                </span>
                <Badge className={STATUS_BADGE[a.status]}>{adjustmentStatusLabelFor(a)}</Badge>
                <span className="text-xs text-muted-foreground">{stamp}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
