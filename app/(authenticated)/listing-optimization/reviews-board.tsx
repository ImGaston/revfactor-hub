"use client"

// Listing reviews by workflow stage (Draft · Published · Accepted · Completed),
// grouped by client by default, or as a flat list sorted by listing, client or score.

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { REVIEW_STAGES, reviewStage, type ReviewStage } from "@/lib/listing-optimization"

export type BoardRow = {
  id: string
  client_id: string
  client_name: string | null
  listing_title: string
  status: string
  overall_score: number | null
  owner_message_sent_at: string | null
  counts: { total: number; pending: number; accepted: number; declined: number; live: number; applied: number; toApply: number }
}

type View = "client" | "listing" | "score"
const STAGE_KEYS = REVIEW_STAGES.map((s) => s.key) as string[]

const STAGE_BADGE: Record<ReviewStage, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  published: { label: "Published", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  accepted: { label: "Accepted", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
}

export function ReviewsBoard({ rows, ownerSendClientIds }: { rows: BoardRow[]; ownerSendClientIds: string[] }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const staged = useMemo(() => rows.map((r) => ({ ...r, stage: reviewStage(r) })), [rows])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of staged) c[r.stage] = (c[r.stage] ?? 0) + 1
    return c
  }, [staged])
  const firstWithRows = REVIEW_STAGES.find((s) => counts[s.key])?.key ?? "draft"
  const initialStage = searchParams.get("stage")
  const [stage, setStage] = useState<string>(initialStage && STAGE_KEYS.includes(initialStage) ? initialStage : firstWithRows)
  const [view, setView] = useState<View>((searchParams.get("view") as View) || "client")

  const update = (next: { stage?: string; view?: View }) => {
    if (next.stage) setStage(next.stage)
    if (next.view) setView(next.view)
    const params = new URLSearchParams(searchParams.toString())
    params.set("stage", next.stage ?? stage)
    params.set("view", next.view ?? view)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const visible = staged.filter((r) => r.stage === stage)
  const sorted = [...visible].sort((a, b) =>
    view === "score"
      ? (a.overall_score ?? 999) - (b.overall_score ?? 999)
      : view === "listing"
        ? a.listing_title.localeCompare(b.listing_title)
        : (a.client_name ?? "").localeCompare(b.client_name ?? "") || a.listing_title.localeCompare(b.listing_title)
  )
  const groups = useMemo(() => {
    const m = new Map<string, { clientId: string; clientName: string | null; rows: typeof sorted }>()
    for (const r of sorted) {
      const g = m.get(r.client_id) ?? { clientId: r.client_id, clientName: r.client_name, rows: [] }
      g.rows.push(r)
      m.set(r.client_id, g)
    }
    return [...m.values()]
  }, [sorted])

  const stageHint = REVIEW_STAGES.find((s) => s.key === stage)?.hint

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={stage} onValueChange={(v) => update({ stage: v })}>
          <TabsList>
            {REVIEW_STAGES.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{counts[s.key] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          View
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={view}
            onChange={(e) => update({ view: e.target.value as View })}
            aria-label="View"
          >
            <option value="client">Grouped by client</option>
            <option value="listing">By listing name</option>
            <option value="score">Lowest score first</option>
          </select>
        </label>
      </div>
      {stageHint && <p className="text-xs text-muted-foreground">{stageHint}</p>}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Listing</TableHead>
              {view !== "client" && <TableHead>Client</TableHead>}
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Owner decisions</TableHead>
              <TableHead className="text-right">Changes made</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No reviews in this stage.
                </TableCell>
              </TableRow>
            )}
            {view === "client"
              ? groups.map((g) => (
                  <ClientGroup key={g.clientId} group={g} canSendByOwner={ownerSendClientIds.includes(g.clientId)} />
                ))
              : sorted.map((r) => <ReviewRow key={r.id} r={r} showClient />)}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ClientGroup({
  group,
  canSendByOwner,
}: {
  group: { clientId: string; clientName: string | null; rows: (BoardRow & { stage: ReviewStage })[] }
  canSendByOwner: boolean
}) {
  const toApply = group.rows.reduce((a, r) => a + r.counts.toApply, 0)
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={5} className="py-2">
          <Link href={`/clients/${group.clientId}`} className="font-semibold hover:underline">
            {group.clientName ?? "Unknown client"}
          </Link>
          <span className="ml-2 text-sm text-muted-foreground">
            {group.rows.length} {group.rows.length === 1 ? "listing" : "listings"}
            {toApply ? ` · ${toApply} changes to make` : ""}
          </span>
        </TableCell>
        <TableCell className="py-2 text-right">
          {canSendByOwner && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/listing-optimization/owner/${group.clientId}`}>
                <Send className="size-4" />
                Send to owner
              </Link>
            </Button>
          )}
        </TableCell>
      </TableRow>
      {group.rows.map((r) => (
        <ReviewRow key={r.id} r={r} />
      ))}
    </>
  )
}

function ReviewRow({ r, showClient = false }: { r: BoardRow & { stage: ReviewStage }; showClient?: boolean }) {
  const badge = STAGE_BADGE[r.stage]
  return (
    <TableRow>
      <TableCell className={cn("max-w-xs truncate", !showClient && "pl-6")}>
        <Link href={`/listing-optimization/${r.id}`} className="font-medium hover:underline">
          {r.listing_title}
        </Link>
      </TableCell>
      {showClient && <TableCell>{r.client_name ?? "—"}</TableCell>}
      <TableCell>
        <Badge variant="outline" className={cn("border-transparent", badge.className)}>{badge.label}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">{r.overall_score ?? "—"}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {r.counts.accepted} accepted · {r.counts.declined} declined · {r.counts.pending} open
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.counts.accepted ? `${r.counts.applied}/${r.counts.accepted}` : "—"}
      </TableCell>
    </TableRow>
  )
}
