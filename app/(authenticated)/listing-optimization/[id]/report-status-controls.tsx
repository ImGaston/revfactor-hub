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
import { setOptimizationReportStatusAction } from "../actions"

export function ReportStatusControls({
  reportId,
  status,
  clientName,
  canEdit,
  coverage,
}: {
  reportId: string
  status: string
  clientName: string | null
  canEdit: boolean
  coverage: { checked: number; total: number; complete: boolean }
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function setStatus(next: "draft" | "published" | "archived") {
    startTransition(async () => {
      const result = await setOptimizationReportStatusAction(reportId, next)
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
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setStatus("published")}>Publish</AlertDialogAction>
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
