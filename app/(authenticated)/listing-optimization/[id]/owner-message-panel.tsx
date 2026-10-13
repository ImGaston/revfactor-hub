"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MessageSquare, Send } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"
import { MAX_OWNER_MESSAGE_LENGTH } from "@/lib/listing-optimization-message"
import { saveOwnerMessageAction, sendOwnerMessageAction } from "../actions"

/**
 * The message that goes to the owner's Assembly chat with the review.
 * Editable until sent; "Publish & send" (header) or "Send message" (after a
 * plain publish) delivers it.
 */
export function OwnerMessagePanel({
  reportId,
  status,
  message,
  sentAt,
  canEdit,
  value,
  onChange,
}: {
  reportId: string
  status: string
  message: string | null
  sentAt: string | null
  canEdit: boolean
  value: string
  onChange: (text: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const dirty = value.trim() !== (message ?? "").trim()
  const sent = Boolean(sentAt)

  function save() {
    startTransition(async () => {
      const result = await saveOwnerMessageAction(reportId, value)
      if (!result.ok) toast.error(result.error)
      else {
        toast.success("Message saved.")
        router.refresh()
      }
    })
  }

  function send() {
    startTransition(async () => {
      if (dirty) {
        const saved = await saveOwnerMessageAction(reportId, value)
        if (!saved.ok) {
          toast.error(saved.error)
          return
        }
      }
      const result = await sendOwnerMessageAction(reportId)
      if (!result.ok) toast.error(result.error)
      else {
        toast.success("Sent to the owner's Assembly chat.")
        router.refresh()
      }
    })
  }

  return (
    <section className="mx-4 my-4 rounded-lg border bg-card p-4 md:mx-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <MessageSquare className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Message to the owner (Assembly chat)</h2>
        {sent ? (
          <Badge variant="outline">Sent {new Date(sentAt as string).toLocaleString()}</Badge>
        ) : (
          <Badge variant="secondary">Not sent</Badge>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Drafted from this review. Edit it here; it goes out with Publish &amp; send, and only once.
      </p>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        maxLength={MAX_OWNER_MESSAGE_LENGTH}
        disabled={!canEdit || sent || isPending}
        aria-label="Message to the owner"
      />
      {canEdit && !sent && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!dirty || isPending} onClick={save}>
            Save message
          </Button>
          {status === "published" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isPending || !value.trim()}>
                  <Send className="size-4" />
                  Send message
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Send this message to the owner?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It posts to their Assembly chat now. It can only be sent once.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={send}>Send</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </section>
  )
}
