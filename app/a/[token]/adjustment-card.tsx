"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Building2,
  CalendarRange,
  Check,
  ClipboardCopy,
  ExternalLink,
  MessageSquare,
  Send,
  Timer,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import type { Adjustment, AdjustmentComment, AdjustmentStatus } from "@/lib/types"
import {
  SETUP_CONTROL_CHECKLIST,
  adjustmentOriginLabel,
  adjustmentShareUrl,
  adjustmentStatusLabel,
  adjustmentTypeLabel,
  airbnbMulticalendarUrl,
  buildWhatsappUpdate,
  isEscalated,
  pricelabsUrl,
} from "@/lib/adjustments"
import { resolveProfile } from "@/lib/types"
import {
  addAdjustmentComment,
  updateAdjustmentStatus,
} from "@/app/(authenticated)/adjustments/actions"

const URGENCY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  controlled: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  issue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  rejected: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
}

function formatDate(date: string | null): string | null {
  if (!date) return null
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

type ShellAdjustment = Pick<
  Adjustment,
  | "scope"
  | "type"
  | "target_value"
  | "date_from"
  | "date_to"
  | "booking_window"
  | "urgency"
  | "status"
  | "listings"
> & { clients?: { name: string } | null }

// Read-only header + facts + shortcuts. Rendered for everyone, including the
// unauthenticated shell — keep anything sensitive out of here.
export function AdjustmentShell({
  adjustment,
  children,
}: {
  adjustment: ShellAdjustment
  children?: React.ReactNode
}) {
  const listing = adjustment.scope === "single_listing" ? adjustment.listings : null
  const plUrl = listing ? pricelabsUrl(listing) : null
  const abnbUrl = listing ? airbnbMulticalendarUrl(listing) : null
  const dateFrom = formatDate(adjustment.date_from)
  const dateTo = formatDate(adjustment.date_to)

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Image
            src="/revfactor-logo/RevFactor_Favicon_Cedar.png"
            alt="RevFactor"
            width={24}
            height={24}
          />
          <span className="text-sm text-muted-foreground">RevFactor · Adjustment</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {adjustmentTypeLabel(adjustment.type)}
            {adjustment.target_value ? ` ${adjustment.target_value}` : ""}
          </h1>
          <Badge className={URGENCY_BADGE[adjustment.urgency]}>
            {adjustment.urgency} urgency
          </Badge>
          <Badge className={STATUS_BADGE[adjustment.status]}>
            {adjustmentStatusLabel(adjustment.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <span>
              {adjustment.clients?.name}
              {listing ? ` · ${listing.name}` : " · whole portfolio (group)"}
            </span>
          </div>
          {(dateFrom || dateTo) && (
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              <span>
                {dateFrom === dateTo || !dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
              </span>
            </div>
          )}
          {adjustment.booking_window && (
            <div className="flex items-center gap-2">
              <Timer className="size-4 text-muted-foreground" />
              <span>
                {adjustment.booking_window === "last_minute" ? "Last minute" : "Far out"}{" "}
                bookings
              </span>
            </div>
          )}
        </div>

        {(plUrl || abnbUrl) && (
          <div className="flex flex-wrap gap-2">
            {plUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={plUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  PriceLabs
                </a>
              </Button>
            )}
            {abnbUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={abnbUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Airbnb calendar
                </a>
              </Button>
            )}
          </div>
        )}

        {children}
      </CardContent>
    </Card>
  )
}

export function AdjustmentCard({
  adjustment,
  comments,
  currentUserId,
  canEdit,
  canControl,
}: {
  adjustment: Adjustment
  comments: AdjustmentComment[]
  currentUserId: string
  canEdit: boolean
  canControl: boolean
}) {
  const router = useRouter()
  const [comment, setComment] = useState("")
  const [posting, setPosting] = useState(false)
  const [noteStatus, setNoteStatus] = useState<AdjustmentStatus | null>(null)

  async function changeStatus(status: AdjustmentStatus, note?: string) {
    const result = await updateAdjustmentStatus(adjustment.id, status, note)
    if (result?.error) {
      toast.error(result.error)
      return false
    }
    toast.success(`Status: ${adjustmentStatusLabel(status)}`)
    router.refresh()
    return true
  }

  async function postComment() {
    setPosting(true)
    const result = await addAdjustmentComment(adjustment.id, comment)
    setPosting(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setComment("")
    router.refresh()
  }

  async function copyLink() {
    await navigator.clipboard.writeText(adjustmentShareUrl(adjustment.public_token))
    toast.success("Link copied")
  }

  async function copyUpdate() {
    await navigator.clipboard.writeText(buildWhatsappUpdate(adjustment))
    toast.success("Update message copied — paste it in the group")
  }

  const resolver = resolveProfile(adjustment.resolver)
  const reviewer = resolveProfile(adjustment.reviewer)
  // HostPricing proposals: moving out of `open` is the internal approval step
  const isProposal =
    adjustment.origin === "hostpricing" && adjustment.status === "open"

  return (
    <div className="space-y-4">
      <AdjustmentShell adjustment={adjustment}>
        <Separator />

        <div className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Origin:</span>{" "}
            {adjustmentOriginLabel(adjustment.origin)}
            {isEscalated(adjustment) && (
              <Badge className="ml-2 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                client escalation
              </Badge>
            )}
          </p>
          {adjustment.requested_by && (
            <p>
              <span className="text-muted-foreground">Requested by:</span>{" "}
              {adjustment.requested_by}
            </p>
          )}
          {adjustment.origin_message && (
            <blockquote className="rounded-md border-l-2 bg-muted/50 p-3 text-muted-foreground">
              {adjustment.origin_message}
            </blockquote>
          )}
        </div>

        {(resolver || reviewer) && (
          <div className="space-y-1 text-sm text-muted-foreground">
            {resolver && (
              <p>
                Resolved by {resolver.full_name || resolver.email}
                {adjustment.resolved_at
                  ? ` on ${new Date(adjustment.resolved_at).toLocaleDateString("en-US")}`
                  : ""}
              </p>
            )}
            {reviewer && (
              <p>
                Controlled by {reviewer.full_name || reviewer.email}
                {adjustment.controlled_at
                  ? ` on ${new Date(adjustment.controlled_at).toLocaleDateString("en-US")}`
                  : ""}
              </p>
            )}
          </div>
        )}

        {adjustment.type === "setup" &&
          adjustment.status === "resolved" &&
          canControl && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">Before confirming control, verify:</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {SETUP_CONTROL_CHECKLIST.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="size-3.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

        <div className="flex flex-wrap gap-2">
          {canEdit && adjustment.status === "open" && (
            <Button size="sm" onClick={() => changeStatus("in_progress")}>
              {isProposal ? "Approve proposal" : "Start"}
            </Button>
          )}
          {canEdit &&
            (adjustment.status === "open" ||
              adjustment.status === "in_progress" ||
              adjustment.status === "issue") && (
              <Button size="sm" onClick={() => changeStatus("resolved")}>
                <Check />
                Mark resolved
              </Button>
            )}
          {canControl && adjustment.status === "resolved" && (
            <Button size="sm" onClick={() => changeStatus("controlled")}>
              <Check />
              Control · Done
            </Button>
          )}
          {canEdit &&
            adjustment.status !== "controlled" &&
            adjustment.status !== "rejected" && (
              <>
                {adjustment.status !== "issue" && (
                  <Button size="sm" variant="outline" onClick={() => setNoteStatus("issue")}>
                    Issue
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setNoteStatus("rejected")}>
                  {isProposal ? "Deny" : "Reject"}
                </Button>
              </>
            )}
          {canEdit &&
            (adjustment.status === "issue" || adjustment.status === "rejected") && (
              <Button size="sm" variant="outline" onClick={() => changeStatus("open")}>
                Reopen
              </Button>
            )}
          <Button size="sm" variant="ghost" onClick={copyLink}>
            <ClipboardCopy />
            Copy link
          </Button>
          <Button size="sm" variant="ghost" onClick={copyUpdate}>
            <Send />
            Copy WhatsApp update
          </Button>
        </div>
      </AdjustmentShell>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="size-4" />
            Notes
            <Badge variant="secondary">{comments.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
          {comments.map((c) => {
            const author = c.profiles
            const name = author?.full_name || author?.email || "Unknown"
            return (
              <div key={c.id} className="flex gap-3">
                <Avatar className="size-7">
                  {author?.avatar_url && <AvatarImage src={author.avatar_url} />}
                  <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {c.content}
                  </p>
                </div>
              </div>
            )
          })}
          <div className="flex gap-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note…"
              rows={2}
            />
            <Button
              size="sm"
              onClick={postComment}
              disabled={posting || !comment.trim()}
              className="self-end"
            >
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      <StatusNoteDialog
        status={noteStatus}
        isProposal={isProposal}
        onClose={() => setNoteStatus(null)}
        onSave={async (status, note) => {
          const ok = await changeStatus(status, note)
          if (ok) setNoteStatus(null)
        }}
      />
    </div>
  )
}

function StatusNoteDialog({
  status,
  isProposal,
  onClose,
  onSave,
}: {
  status: AdjustmentStatus | null
  isProposal: boolean
  onClose: () => void
  onSave: (status: AdjustmentStatus, note: string) => Promise<void>
}) {
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  return (
    <Dialog open={!!status} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {status !== "rejected"
              ? "Mark as issue"
              : isProposal
                ? "Deny proposal"
                : "Reject adjustment"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {status === "rejected"
            ? "Why is this request not being done? The reason stays on record."
            : "What is blocking this adjustment? A note is required."}
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason…"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !note.trim()}
            onClick={async () => {
              if (!status) return
              setSaving(true)
              await onSave(status, note)
              setSaving(false)
              setNote("")
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
