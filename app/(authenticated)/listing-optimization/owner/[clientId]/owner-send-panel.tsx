"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, MessageSquare, RotateCcw, Send } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { ACTION_FAILED_MESSAGE, type OwnerReviewRow } from "@/lib/listing-optimization"
import { buildOwnerBundleMessage, MAX_OWNER_MESSAGE_LENGTH } from "@/lib/listing-optimization-message"
import { publishAndSendOwnerReviewsAction } from "../../actions"

function draftMessage(clientName: string | null, reviews: OwnerReviewRow[]): string {
  return buildOwnerBundleMessage({
    ownerName: clientName,
    reviews: reviews.map((r) => ({ listingName: r.listingName, items: r.items, channelManager: r.channelManager })),
  })
}

/**
 * Owner-level send: pick this owner's reviews, edit one message, then publish
 * them all and post the message once to their Assembly chat.
 */
export function OwnerSendPanel({
  clientId,
  clientName,
  reviews,
  sentCount,
  canEdit,
}: {
  clientId: string
  clientName: string | null
  reviews: OwnerReviewRow[]
  sentCount: number
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<string[]>(() => reviews.map((r) => r.id))
  const picked = useMemo(() => reviews.filter((r) => selected.includes(r.id)), [reviews, selected])
  const [text, setText] = useState(() => draftMessage(clientName, picked))
  const [edited, setEdited] = useState(false)

  const partial = picked.filter((r) => r.status === "draft" && !r.coverage.complete)
  const drafts = picked.filter((r) => r.status === "draft").length
  const canSend = canEdit && picked.length > 0 && partial.length === 0 && text.trim().length > 0

  function toggle(id: string, on: boolean) {
    const next = on ? [...selected, id] : selected.filter((s) => s !== id)
    setSelected(next)
    // Follow the selection until staff edit the text by hand.
    if (!edited) setText(draftMessage(clientName, reviews.filter((r) => next.includes(r.id))))
  }

  function rebuild() {
    setText(draftMessage(clientName, picked))
    setEdited(false)
  }

  function publishAndSend() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof publishAndSendOwnerReviewsAction>>
      try {
        result = await publishAndSendOwnerReviewsAction(clientId, selected, text)
      } catch {
        toast.error(ACTION_FAILED_MESSAGE)
        return
      }
      if (!result.ok) {
        toast.error(
          result.published
            ? `Published, but the message didn't send: ${result.error} Try again from this page.`
            : result.error
        )
        if (result.published) router.refresh()
        return
      }
      toast.success(
        `Published ${picked.length === 1 ? "the review" : `${picked.length} reviews`} and sent one message to the owner's Assembly chat.`
      )
      router.push("/listing-optimization")
    })
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <Button asChild size="sm" variant="ghost">
          <Link href="/listing-optimization">
            <ArrowLeft className="size-4" />
            Listing reviews
          </Link>
        </Button>
        <span className="text-sm font-medium">{clientName ?? "Unknown client"}</span>
        <span className="text-xs text-muted-foreground">One message for all of this owner&apos;s reviews</span>
        {canEdit && (
          <div className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isPending || !canSend}>
                  <Send className="size-4" />
                  {drafts > 0 ? "Publish & send to owner" : "Send to owner"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {drafts > 0
                      ? `Publish ${picked.length === 1 ? "this review" : `these ${picked.length} reviews`} and send one message?`
                      : "Send one message for these reviews?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {drafts > 0
                      ? "The owner will see them in their portal. Publishing approves every suggestion in them: anything they accept goes straight to the apply queue in Adjustments. "
                      : ""}
                    The message posts to their Assembly chat now and can only be sent once.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={publishAndSend}>
                    {drafts > 0 ? "Publish & send" : "Send"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="space-y-4 p-4 md:p-6">
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Reviews in this message</h2>
            <p className="text-xs text-muted-foreground">
              Drafts and published reviews that haven&apos;t had an owner message yet.
              {sentCount > 0 ? ` ${sentCount} other ${sentCount === 1 ? "review was" : "reviews were"} already sent.` : ""}
            </p>
          </div>
          {reviews.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing waiting: every review for this owner has been sent.
            </p>
          ) : (
            <ul className="divide-y">
              {reviews.map((r) => {
                const isPartial = r.status === "draft" && !r.coverage.complete
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Checkbox
                      id={`pick-${r.id}`}
                      checked={selected.includes(r.id)}
                      onCheckedChange={(v) => toggle(r.id, v === true)}
                      disabled={!canEdit || isPending}
                      aria-label={`Include ${r.listingName}`}
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/listing-optimization/${r.id}`} className="font-medium hover:underline">
                        {r.listingName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{r.listingTitle}</p>
                    </div>
                    <Badge variant={r.status === "published" ? "default" : "secondary"} className="capitalize">
                      {r.status}
                    </Badge>
                    <Badge variant={isPartial ? "destructive" : "outline"}>
                      {r.coverage.checked}/{r.coverage.total} checks{isPartial ? " · partial" : ""}
                    </Badge>
                    <Badge variant="outline">{r.channelManager ?? "Airbnb"}</Badge>
                    <span className="w-10 text-right text-sm tabular-nums">{r.overallScore ?? "—"}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        {partial.length > 0 && (
          <p className="text-sm text-destructive">
            {partial.map((r) => r.listingName).join(", ")} {partial.length === 1 ? "is" : "are"} partial. Finish
            the audit or leave {partial.length === 1 ? "it" : "them"} out to send.
          </p>
        )}

        <section className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Message to the owner (Assembly chat)</h2>
            {edited && <Badge variant="secondary">Edited</Badge>}
            {canEdit && (
              <Button size="sm" variant="ghost" className="ml-auto" disabled={isPending} onClick={rebuild}>
                <RotateCcw className="size-4" />
                Rebuild from reviews
              </Button>
            )}
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Drafted from the picked reviews. Edit it here; it goes out once and is saved on every review in it.
          </p>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setEdited(true)
            }}
            rows={18}
            maxLength={MAX_OWNER_MESSAGE_LENGTH}
            disabled={!canEdit || isPending}
            aria-label="Message to the owner"
          />
        </section>
      </div>
    </div>
  )
}
