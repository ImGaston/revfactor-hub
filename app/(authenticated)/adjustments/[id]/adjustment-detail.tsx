"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  Check,
  ClipboardCopy,
  ExternalLink,
  History,
  MessageSquare,
  Send,
  SquareCheckBig,
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
import type {
  Adjustment,
  AdjustmentComment,
  AdjustmentStatus,
  AdjustmentStatusHistoryEntry,
} from "@/lib/types"
import { resolveProfile } from "@/lib/types"
import {
  ORIGIN_BADGE,
  SETUP_CONTROL_CHECKLIST,
  STATUS_BADGE,
  URGENCY_BADGE,
  adjustmentOriginLabel,
  adjustmentShareUrl,
  adjustmentStatusLabel,
  adjustmentStatusLabelFor,
  adjustmentTypeLabel,
  airbnbMulticalendarUrl,
  buildWhatsappUpdate,
  isEscalated,
  pricelabsUrl,
} from "@/lib/adjustments"
import {
  addAdjustmentComment,
  createTaskFromAdjustmentComment,
  deleteAdjustmentComment,
  toggleAdjustmentCommentReaction,
  updateAdjustmentStatus,
} from "../actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CommentActionBar } from "@/components/comments/comment-action-bar"
import { ReactionChips } from "@/components/comments/reaction-chips"

function formatDate(date: string | null): string | null {
  if (!date) return null
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Left accent for comments coming from outside the internal team
const COMMENT_ORIGIN_ACCENT: Record<string, string> = {
  hostpricing: "border-l-2 border-violet-400 pl-3 dark:border-violet-600",
  client: "border-l-2 border-amber-400 pl-3 dark:border-amber-600",
}

// Internal detail view (authed core). The public card at /a/[token] stays a
// separate component — do not merge them.
export function AdjustmentDetail({
  adjustment,
  comments,
  history,
  canEdit,
  canControl,
  canCreateTask,
  canDeleteAnyComment,
  currentUserId,
  variant = "page",
}: {
  adjustment: Adjustment
  comments: AdjustmentComment[]
  history: AdjustmentStatusHistoryEntry[]
  canEdit: boolean
  canControl: boolean
  canCreateTask: boolean
  canDeleteAnyComment: boolean
  currentUserId: string
  variant?: "page" | "modal"
}) {
  const router = useRouter()
  const [comment, setComment] = useState("")
  const [posting, setPosting] = useState(false)
  const [noteStatus, setNoteStatus] = useState<AdjustmentStatus | null>(null)
  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [postingReply, setPostingReply] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdjustmentComment | null>(null)

  // Internal thread replies (parent_id set) are RLS-filtered for roles
  // without adjustments:control — this grouping only sees what the user may
  const topLevelComments = comments.filter((c) => !c.parent_id)
  const repliesByParent = new Map<string, AdjustmentComment[]>()
  for (const c of comments) {
    if (!c.parent_id) continue
    const list = repliesByParent.get(c.parent_id) ?? []
    list.push(c)
    repliesByParent.set(c.parent_id, list)
  }

  const listing = adjustment.scope === "single_listing" ? adjustment.listings : null
  const plUrl = listing ? pricelabsUrl(listing) : null
  const abnbUrl = listing ? airbnbMulticalendarUrl(listing) : null
  const resolver = resolveProfile(adjustment.resolver)
  const reviewer = resolveProfile(adjustment.reviewer)
  const creator = resolveProfile(adjustment.creator)
  // HostPricing proposals: moving out of `open` is the internal approval step
  const isProposal =
    adjustment.origin === "hostpricing" && adjustment.status === "open"

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

  async function postReply(parentId: string) {
    setPostingReply(true)
    const result = await addAdjustmentComment(adjustment.id, replyText, parentId)
    setPostingReply(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setReplyText("")
    setReplyTarget(null)
    router.refresh()
  }

  async function reactToComment(commentId: string, emoji: string) {
    const result = await toggleAdjustmentCommentReaction(commentId, emoji)
    if (result?.error) toast.error(result.error)
    else router.refresh()
  }

  async function createTaskFromComment(commentId: string) {
    const result = await createTaskFromAdjustmentComment(commentId)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success("Task created — linked to this note")
    router.refresh()
  }

  async function copyCommentText(content: string) {
    await navigator.clipboard.writeText(content)
    toast.success("Copied")
  }

  async function confirmDeleteComment() {
    if (!deleteTarget) return
    const result = await deleteAdjustmentComment(deleteTarget.id)
    if (result?.error) toast.error(result.error)
    else toast.success("Note deleted")
    setDeleteTarget(null)
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

  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: "Client",
      value: `${adjustment.clients?.name ?? "—"}${
        listing ? ` · ${listing.name}` : " · whole portfolio (group)"
      }`,
    },
  ]
  const dateFrom = formatDate(adjustment.date_from)
  const dateTo = formatDate(adjustment.date_to)
  if (dateFrom || dateTo)
    facts.push({
      label: "Dates",
      value: dateFrom === dateTo || !dateTo ? dateFrom : `${dateFrom} → ${dateTo}`,
    })
  if (adjustment.booking_window)
    facts.push({
      label: "Booking window",
      value:
        adjustment.booking_window === "last_minute" ? "Last minute" : "Far out",
    })
  if (adjustment.requested_by)
    facts.push({ label: "Requested by", value: adjustment.requested_by })
  facts.push({
    label: "Created",
    value: `${formatTimestamp(adjustment.created_at)}${
      creator ? ` by ${creator.full_name || creator.email}` : ""
    }`,
  })
  if (resolver)
    facts.push({
      label: "Resolved",
      value: `${resolver.full_name || resolver.email}${
        adjustment.resolved_at ? ` · ${formatTimestamp(adjustment.resolved_at)}` : ""
      }`,
    })
  if (reviewer)
    facts.push({
      label: "Controlled",
      value: `${reviewer.full_name || reviewer.email}${
        adjustment.controlled_at
          ? ` · ${formatTimestamp(adjustment.controlled_at)}`
          : ""
      }`,
    })

  return (
    <div className={variant === "page" ? "mx-auto w-full max-w-3xl space-y-4" : "space-y-4"}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {adjustmentTypeLabel(adjustment.type)}
            {adjustment.target_value ? ` ${adjustment.target_value}` : ""}
          </h1>
          <Badge className={STATUS_BADGE[adjustment.status]}>
            {adjustmentStatusLabelFor(adjustment)}
          </Badge>
          <Badge className={URGENCY_BADGE[adjustment.urgency]}>
            {adjustment.urgency} urgency
          </Badge>
          {adjustment.origin !== "internal" && (
            <Badge variant="outline" className={ORIGIN_BADGE[adjustment.origin]}>
              {adjustmentOriginLabel(adjustment.origin)}
            </Badge>
          )}
          {isEscalated(adjustment) && (
            <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
              client escalation
            </Badge>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">{fact.label}:</dt>
              <dd className="min-w-0">{fact.value}</dd>
            </div>
          ))}
        </dl>

        {adjustment.origin_message && (
          <blockquote className="rounded-md border-l-2 bg-muted/50 p-3 text-sm text-muted-foreground">
            {adjustment.origin_message}
          </blockquote>
        )}

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
          <Button size="sm" variant="ghost" onClick={copyLink}>
            <ClipboardCopy />
            Copy link
          </Button>
          <Button size="sm" variant="ghost" onClick={copyUpdate}>
            <Send />
            Copy WhatsApp update
          </Button>
        </div>

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

        <Separator />

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
            (adjustment.status === "open" ||
              adjustment.status === "in_progress" ||
              adjustment.status === "issue") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNoteStatus("needs_info")}
              >
                Needs info
              </Button>
            )}
          {canEdit &&
            adjustment.status !== "controlled" &&
            adjustment.status !== "rejected" && (
              <>
                {adjustment.status !== "issue" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNoteStatus("issue")}
                  >
                    Issue
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNoteStatus("rejected")}
                >
                  {isProposal ? "Deny" : "Reject"}
                </Button>
              </>
            )}
          {canEdit &&
            (adjustment.status === "issue" ||
              adjustment.status === "rejected" ||
              adjustment.status === "needs_info") && (
              <Button size="sm" variant="outline" onClick={() => changeStatus("open")}>
                Reopen
              </Button>
            )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="size-4" />
            Notes
            <Badge variant="secondary">{topLevelComments.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {topLevelComments.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
          {topLevelComments.map((c) => {
            const replies = repliesByParent.get(c.id) ?? []
            return (
              <div key={c.id} className="space-y-2">
                <CommentRow
                  comment={c}
                  currentUserId={currentUserId}
                  onReact={(emoji) => reactToComment(c.id, emoji)}
                  onReply={
                    canControl
                      ? () => setReplyTarget(replyTarget === c.id ? null : c.id)
                      : undefined
                  }
                  onCreateTask={
                    canCreateTask && !c.linked_task_id
                      ? () => createTaskFromComment(c.id)
                      : undefined
                  }
                  onCopy={() => copyCommentText(c.content)}
                  onDelete={
                    canDeleteAnyComment || c.author_id === currentUserId
                      ? () => setDeleteTarget(c)
                      : undefined
                  }
                />
                {(replies.length > 0 || replyTarget === c.id) && (
                  <div className="ml-10 space-y-2 border-l-2 border-violet-200 pl-3 dark:border-violet-900">
                    <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
                      Internal thread — not visible to external roles
                    </p>
                    {replies.map((r) => (
                      <CommentRow
                        key={r.id}
                        comment={r}
                        compact
                        currentUserId={currentUserId}
                        onReact={(emoji) => reactToComment(r.id, emoji)}
                        onCopy={() => copyCommentText(r.content)}
                        onDelete={
                          canDeleteAnyComment || r.author_id === currentUserId
                            ? () => setDeleteTarget(r)
                            : undefined
                        }
                      />
                    ))}
                    {replyTarget === c.id && (
                      <div className="flex gap-2">
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Reply internally…"
                          rows={2}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => postReply(c.id)}
                          disabled={postingReply || !replyText.trim()}
                          className="self-end"
                        >
                          Post
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div className="flex gap-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                adjustment.status === "needs_info"
                  ? "Reply with the missing info — posting reopens the ticket…"
                  : "Add a note…"
              }
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

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="size-4" />
            Status history
            <Badge variant="secondary">{history.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No transitions recorded yet — older tickets keep their trail in the
              Resolved / Controlled lines above.
            </p>
          )}
          {history.map((entry) => {
            const author = entry.changed_by_profile
            const name = author?.full_name || author?.email || "System"
            return (
              <div key={entry.id} className="flex items-start gap-3 text-sm">
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <Badge className={STATUS_BADGE[entry.from_status] ?? ""}>
                    {adjustmentStatusLabel(entry.from_status)}
                  </Badge>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <Badge className={STATUS_BADGE[entry.to_status] ?? ""}>
                    {adjustmentStatusLabel(entry.to_status)}
                  </Badge>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {name} · {formatTimestamp(entry.created_at)}
                  </p>
                  {entry.note && (
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {entry.note}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && !deleteTarget.parent_id
                ? "The note, its reactions, and any internal thread replies under it are deleted."
                : "The reply and its reactions are deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteComment}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// One comment row with the on-hover action bar, reaction chips, origin
// styling, and the linked-task chip. `compact` = internal thread reply.
function CommentRow({
  comment,
  currentUserId,
  compact = false,
  onReact,
  onReply,
  onCreateTask,
  onCopy,
  onDelete,
}: {
  comment: AdjustmentComment
  currentUserId: string
  compact?: boolean
  onReact: (emoji: string) => void
  onReply?: () => void
  onCreateTask?: () => void
  onCopy: () => void
  onDelete?: () => void
}) {
  const author = comment.profiles
  const name = author?.full_name || author?.email || "Unknown"
  return (
    <div
      className={`group/comment relative -mx-2 flex gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 ${
        !compact ? (COMMENT_ORIGIN_ACCENT[comment.origin] ?? "") : ""
      }`}
    >
      <CommentActionBar
        onReact={onReact}
        onReply={onReply}
        onCreateTask={onCreateTask}
        onCopy={onCopy}
        onDelete={onDelete}
      />
      <Avatar className={compact ? "size-6" : "size-7"}>
        {author?.avatar_url && <AvatarImage src={author.avatar_url} />}
        <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{name}</span>{" "}
          {!compact && comment.origin !== "internal" && (
            <Badge
              variant="outline"
              className={`mr-1 ${ORIGIN_BADGE[comment.origin] ?? ""}`}
            >
              {adjustmentOriginLabel(comment.origin)}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(comment.created_at)}
          </span>
        </p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {comment.content}
        </p>
        {comment.linked_task_id && (
          <Link
            href="/tasks"
            className="mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <SquareCheckBig className="size-3" />
            Task created
          </Link>
        )}
        <ReactionChips
          reactions={comment.adjustment_comment_reactions ?? []}
          currentUserId={currentUserId}
          onToggle={onReact}
        />
      </div>
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

  const title =
    status === "needs_info"
      ? "Needs info from the internal team"
      : status === "rejected"
        ? isProposal
          ? "Deny proposal"
          : "Reject adjustment"
        : "Mark as issue"
  const description =
    status === "needs_info"
      ? "What information do you need? The question is posted as a note and the ticket reopens when an internal user replies."
      : status === "rejected"
        ? "Why is this request not being done? The reason stays on record."
        : "What is blocking this adjustment? A note is required."

  return (
    <Dialog open={!!status} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={status === "needs_info" ? "What's missing…" : "Reason…"}
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
