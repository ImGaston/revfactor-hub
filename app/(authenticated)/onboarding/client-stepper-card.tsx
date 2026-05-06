"use client"

import { useOptimistic, useState, useTransition } from "react"
import { Home, MessageSquare, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AddListingDialog } from "@/components/clients/add-listing-dialog"
import { toggleOnboardingStep, updateClientStatus } from "./actions"
import { OnboardingComments } from "./onboarding-comments"
import { cn } from "@/lib/utils"
import type { OnboardingTemplate, OnboardingProgress } from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
  status: string
  commentCount?: number
  listingCount: number
}

type Props = {
  client: ClientRow
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
  currentUserId: string | null
  isSuperAdmin: boolean
}

type OptimisticProgress = {
  templateId: string
  isCompleted: boolean
  completedByName: string | null
  completedAt: string | null
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "inactive", label: "Inactive" },
] as const

export function ClientStepperCard({ client, templates, progress, currentUserId, isSuperAdmin }: Props) {
  const [isPending, startTransition] = useTransition()
  const [commentCount, setCommentCount] = useState(client.commentCount ?? 0)
  const [optimisticStatus, setOptimisticStatus] = useState(client.status)
  const [addListingOpen, setAddListingOpen] = useState(false)
  const [noListingsWarning, setNoListingsWarning] = useState(false)

  // Build initial progress map
  const initialSteps: OptimisticProgress[] = templates.map((t) => {
    const p = progress.find((pr) => pr.template_id === t.id)
    const profileData = p?.profiles
    const resolvedProfile = Array.isArray(profileData)
      ? profileData[0]
      : profileData
    return {
      templateId: t.id,
      isCompleted: p?.is_completed ?? false,
      completedByName: resolvedProfile?.full_name ?? null,
      completedAt: p?.completed_at ?? null,
    }
  })

  const [optimisticSteps, addOptimistic] = useOptimistic(
    initialSteps,
    (
      state: OptimisticProgress[],
      update: { templateId: string; isCompleted: boolean }
    ) =>
      state.map((s) =>
        s.templateId === update.templateId
          ? {
              ...s,
              isCompleted: update.isCompleted,
              completedAt: update.isCompleted
                ? new Date().toISOString()
                : null,
              completedByName: update.isCompleted ? "You" : null,
            }
          : s
      )
  )

  const completedCount = optimisticSteps.filter((s) => s.isCompleted).length
  const totalCount = optimisticSteps.length
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  function performStatusChange(newStatus: string) {
    const prev = optimisticStatus
    setOptimisticStatus(newStatus)
    startTransition(async () => {
      const result = await updateClientStatus(client.id, newStatus)
      if (result.error) {
        setOptimisticStatus(prev)
        toast.error(result.error)
      } else {
        const label = STATUS_OPTIONS.find((o) => o.value === newStatus)?.label ?? newStatus
        toast.success(`${client.name} moved to ${label}`)
      }
    })
  }

  function handleStatusChange(newStatus: string) {
    if (newStatus === "active" && client.listingCount === 0) {
      setNoListingsWarning(true)
      return
    }
    performStatusChange(newStatus)
  }

  function handleToggle(templateId: string, currentCompleted: boolean) {
    const newValue = !currentCompleted
    const wasCompleted = completedCount
    const willBeCompleted = newValue ? wasCompleted + 1 : wasCompleted - 1
    const willBe100 = willBeCompleted === totalCount && totalCount > 0
    const wasNot100 = wasCompleted < totalCount

    startTransition(async () => {
      addOptimistic({ templateId, isCompleted: newValue })
      await toggleOnboardingStep(client.id, templateId, newValue)
    })

    if (newValue && willBe100 && wasNot100) {
      toast(`${client.name} — all steps completed!`, {
        description: "Ready to mark as active?",
        duration: Infinity,
        closeButton: true,
        action: {
          label: "Activate",
          onClick: () => handleStatusChange("active"),
        },
      })
    }
  }

  return (
    <Card className={cn(
      "transition-opacity duration-300",
      optimisticStatus !== "onboarding" && "opacity-50"
    )}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold truncate">{client.name}</CardTitle>
            {client.email && (
              <p className="text-xs text-muted-foreground truncate">
                {client.email}
              </p>
            )}
          </div>
          <Badge
            variant={pct === 100 ? "default" : "secondary"}
            className="text-[10px] shrink-0"
          >
            {completedCount}/{totalCount} &mdash; {pct}%
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {isSuperAdmin && (
            <Select value={optimisticStatus} onValueChange={handleStatusChange} disabled={isPending}>
              <SelectTrigger className="h-7 w-[110px] text-xs px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Comments"
              >
                <MessageSquare className="size-3" />
                {commentCount}
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Comments — {client.name}</DialogTitle>
              </DialogHeader>
              <OnboardingComments
                clientId={client.id}
                currentUserId={currentUserId}
                onCountChange={setCommentCount}
              />
            </DialogContent>
          </Dialog>
          <button
            type="button"
            onClick={() => setAddListingOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Listings — click to add"
          >
            <Home className="size-3" />
            {client.listingCount}
            <Plus className="size-3" />
          </button>
        </div>
        <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <div className="divide-y">
          {templates.map((t, idx) => {
            const step = optimisticSteps.find(
              (s) => s.templateId === t.id
            )
            const isCompleted = step?.isCompleted ?? false

            return (
              <label
                key={t.id}
                className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:bg-muted/50 -mx-1 px-1 rounded-sm transition-colors"
              >
                <Checkbox
                  checked={isCompleted}
                  onCheckedChange={() =>
                    handleToggle(t.id, isCompleted)
                  }
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <span
                    className={`text-sm leading-tight ${
                      isCompleted
                        ? "line-through text-muted-foreground"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground mr-1">{idx + 1}.</span>
                    {t.step_name}
                  </span>
                  {t.description && !isCompleted && (
                    <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                      {t.description}
                    </p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      </CardContent>
      <AddListingDialog
        open={addListingOpen}
        onOpenChange={setAddListingOpen}
        clientId={client.id}
      />
      <AlertDialog open={noListingsWarning} onOpenChange={setNoListingsWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No listings yet</AlertDialogTitle>
            <AlertDialogDescription>
              {client.name} has no listings associated. Add at least one listing
              before activating this client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setNoListingsWarning(false)
                setAddListingOpen(true)
              }}
            >
              Add listing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
