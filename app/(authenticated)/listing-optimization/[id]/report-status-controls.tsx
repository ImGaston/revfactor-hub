"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"

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
import { ACTION_FAILED_MESSAGE } from "@/lib/listing-optimization"
import { publishAndSendAction, setOptimizationReportStatusAction } from "../actions"

export function ReportStatusControls({
  reportId,
  status,
  clientName,
  canEdit,
  coverage,
  channelManager,
  ownerMessage,
  messageSent,
}: {
  reportId: string
  status: string
  clientName: string | null
  canEdit: boolean
  coverage: { checked: number; total: number; complete: boolean }
  channelManager: string | null
  /** Current (possibly unsaved) owner message text from the message panel. */
  ownerMessage: string
  messageSent: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function publishAndSend() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof publishAndSendAction>>
      try {
        result = await publishAndSendAction(reportId, ownerMessage)
      } catch {
        toast.error(ACTION_FAILED_MESSAGE)
        return
      }
      if (!result.ok) {
        toast.error(
          result.published
            ? `Published, but the message didn't send: ${result.error} Use "Send message" to retry.`
            : result.error
        )
        if (result.published) router.refresh()
        return
      }
      toast.success("Published and sent to the owner's Assembly chat.")
      router.refresh()
    })
  }

  function setStatus(next: "draft" | "published" | "archived") {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setOptimizationReportStatusAction>>
      try {
        result = await setOptimizationReportStatusAction(reportId, next)
      } catch {
        toast.error(ACTION_FAILED_MESSAGE)
        return
      }
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        next === "published"
          ? "Published. The owner sees it in the portal now."
          : next === "archived"
            ? "Archived."
            : "Moved back to draft. The owner no longer sees it."
      )
      router.refresh()
    })
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-6">
      <Button asChild size="sm" variant="ghost">
        <Link href="/listing-optimization">
          <ArrowLeft className="size-4" />
          Listing reviews
        </Link>
      </Button>
      <span className="text-sm text-muted-foreground">{clientName ?? "Unknown client"}</span>
      <Badge variant={status === "published" ? "default" : "secondary"} className="capitalize">
        {status}
      </Badge>
      <Badge variant={coverage.complete ? "outline" : "destructive"}>
        {coverage.checked}/{coverage.total} checks{coverage.complete ? "" : " · partial"}
      </Badge>
      <Badge variant="outline">
        {channelManager ? `Content synced from ${channelManager}` : "Edited in Airbnb"}
      </Badge>
      <span className="text-xs text-muted-foreground">Staff preview: this is what the owner sees.</span>
      {canEdit && (
        <div className="ml-auto flex gap-2">
          {status !== "published" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isPending || !coverage.complete}>
                  Publish to owner
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish this listing review?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The owner will see it in their portal. Publishing approves every suggestion in
                    it: anything they accept goes straight to the apply queue in Adjustments.
                    {!messageSent && ownerMessage.trim()
                      ? " Publish & send also posts the message below to their Assembly chat."
                      : ""}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {!messageSent && ownerMessage.trim() && (
                  <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {ownerMessage.trim()}
                  </pre>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-transparent text-foreground hover:bg-muted"
                    onClick={() => setStatus("published")}
                  >
                    Publish only
                  </AlertDialogAction>
                  {!messageSent && ownerMessage.trim() && (
                    <AlertDialogAction onClick={publishAndSend}>Publish &amp; send</AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {status === "published" && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setStatus("draft")}>
              Unpublish
            </Button>
          )}
          {status !== "archived" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={isPending}>
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this listing review?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The owner will no longer see it. Decisions already made and their adjustments
                    stay as they are.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setStatus("archived")}>Archive</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  )
}
