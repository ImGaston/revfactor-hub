"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, Clock3, UserRound } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type {
  GhlOnboardingTeamReviewRow,
  GhlOnboardingTeamReviewRun,
} from "@/lib/ghl-onboarding-v1/team-review"
import { verifyGhlOnboardingTaskAction } from "./actions"

function displayDate(value: string | null) {
  if (!value) return "Unknown"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

const GOAL_LABELS: Record<string, string> = {
  revenue: "Increase revenue",
  occupancy: "Improve occupancy",
  balanced: "Balance revenue and occupancy",
  guidance: "Needs guidance",
}
const SOFTWARE_STATUS_LABELS: Record<string, string> = {
  done: "Client reports complete",
  need_help: "Client requested guidance",
  not_applicable: "Client reports not applicable",
}

function safeHttpUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

function constraintLabel(
  mode: string | null,
  value: number | null,
  unit: "money" | "nights"
) {
  if (mode === "guidance") return "Needs guidance"
  if (mode === "none") return "No firm minimum"
  if (mode !== "specified" || value === null) return "Not provided"
  return unit === "money"
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value)
    : `${value} night${value === 1 ? "" : "s"}`
}

function AcceptedTaskContext({ task }: { task: GhlOnboardingTeamReviewRow }) {
  if (task.task_kind === "software") {
    return (
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p>
          {SOFTWARE_STATUS_LABELS[task.software_status ?? ""] ??
            "Status unavailable"}
        </p>
        {task.pms_name && <p>PMS: {task.pms_name}</p>}
      </div>
    )
  }

  const address = [
    task.property_street,
    task.property_unit,
    task.property_city,
    task.property_region,
    task.property_postal_code,
    task.property_country,
  ]
    .filter(Boolean)
    .join(", ")
  const listingUrl = safeHttpUrl(task.listing_url)

  return (
    <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
      {address && <p>{address}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>{task.property_status === "live" ? "Live" : "Pre-launch"}</span>
        {task.target_launch_date && (
          <span>Target: {task.target_launch_date}</span>
        )}
        {listingUrl && (
          <a
            className="font-medium text-primary underline underline-offset-2"
            href={listingUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open listing
          </a>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>Goal</dt>
        <dd>{GOAL_LABELS[task.property_goal ?? ""] ?? "Not provided"}</dd>
        <dt>Nightly minimum</dt>
        <dd>
          {constraintLabel(
            task.minimum_nightly_mode,
            task.minimum_nightly_value,
            "money"
          )}
        </dd>
        <dt>Minimum stay</dt>
        <dd>
          {constraintLabel(
            task.minimum_stay_mode,
            task.minimum_stay_nights,
            "nights"
          )}
        </dd>
        <dt>Cleaning fee</dt>
        <dd>
          {constraintLabel(
            task.cleaning_fee_mode,
            task.cleaning_fee_value,
            "money"
          )}
        </dd>
      </dl>
      {task.operating_constraints && (
        <p className="wrap-anywhere">
          Restrictions: {task.operating_constraints}
        </p>
      )}
    </div>
  )
}

export function GhlOnboardingTeamReview({
  runs,
  canVerify,
}: {
  runs: GhlOnboardingTeamReviewRun[]
  canVerify: boolean
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function verify(taskId: string, taskUpdatedAt: string) {
    const evidence = notes[taskId]?.trim() ?? ""
    if (!evidence) {
      toast.error(
        "Add a human verification note before marking this task verified."
      )
      return
    }
    setActiveTaskId(taskId)
    startTransition(async () => {
      const result = await verifyGhlOnboardingTaskAction({
        taskId,
        expectedUpdatedAt: taskUpdatedAt,
        evidence,
      })
      if ("error" in result) toast.error(result.error)
      else {
        setNotes((current) => ({ ...current, [taskId]: "" }))
        toast.success("Task verified with evidence")
      }
      setActiveTaskId(null)
    })
  }

  function evidenceControl(task: GhlOnboardingTeamReviewRow) {
    if (task.team_status === "verified") {
      return (
        <div className="space-y-1">
          <p className="text-sm wrap-anywhere">{task.verification_evidence}</p>
          <p className="text-xs text-muted-foreground">
            {task.verified_by ?? "Team member"} ·{" "}
            {displayDate(task.verified_at)}
          </p>
        </div>
      )
    }
    if (!canVerify) {
      return (
        <span className="text-sm text-muted-foreground">
          Edit permission required
        </span>
      )
    }
    return (
      <div className="space-y-2">
        <Textarea
          aria-label={`Verification evidence for ${task.task_label}`}
          value={notes[task.task_id] ?? ""}
          maxLength={2000}
          rows={2}
          placeholder="What did you verify?"
          onChange={(event) =>
            setNotes((current) => ({
              ...current,
              [task.task_id]: event.target.value,
            }))
          }
        />
        <Button
          size="sm"
          disabled={pending && activeTaskId === task.task_id}
          onClick={() => verify(task.task_id, task.task_updated_at)}
        >
          Mark verified
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            V1 onboarding review
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accepted GHL onboarding runs awaiting internal verification.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/onboarding">
            <ArrowLeft />
            Legacy onboarding
          </Link>
        </Button>
      </div>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No accepted V1 onboarding tasks are ready for review.
          </CardContent>
        </Card>
      ) : (
        runs.map((run) => {
          const verified = run.tasks.filter(
            (task) => task.team_status === "verified"
          ).length
          return (
            <Card key={run.runId}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>{run.clientName}</CardTitle>
                    <CardDescription className="mt-1">
                      Submitted {displayDate(run.submittedAt)} · {verified} of{" "}
                      {run.tasks.length} tasks verified
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      run.portalStatus === "portal_active"
                        ? "default"
                        : "outline"
                    }
                  >
                    {run.portalStatus === "portal_active"
                      ? "Portal active"
                      : "Portal invited"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 sm:hidden">
                  {run.tasks.map((task) => (
                    <div
                      key={task.task_id}
                      className="min-w-0 space-y-3 border-b pb-4 last:border-0 last:pb-0"
                    >
                      <div>
                        <div className="font-medium">{task.task_label}</div>
                        <AcceptedTaskContext task={task} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {task.client_status === "submitted"
                            ? "Submitted"
                            : task.client_status === "in_progress"
                              ? "In progress"
                              : "Not started"}
                        </Badge>
                        {task.team_status === "verified" ? (
                          <Badge className="bg-emerald-600 text-white">
                            <CheckCircle2 /> Verified
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Clock3 /> Pending
                          </Badge>
                        )}
                      </div>
                      <p className="flex items-center gap-1.5 text-sm">
                        <UserRound className="size-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          Owner:
                        </span>{" "}
                        {task.owner_name ?? "Unassigned"}
                      </p>
                      <div className="min-w-0">{evidenceControl(task)}</div>
                    </div>
                  ))}
                </div>
                <div className="hidden sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[340px]">Task</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="min-w-[280px]">
                          Evidence
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.tasks.map((task) => (
                        <TableRow key={task.task_id}>
                          <TableCell className="whitespace-normal">
                            <div className="font-medium">{task.task_label}</div>
                            <AcceptedTaskContext task={task} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {task.client_status === "submitted"
                                ? "Submitted"
                                : task.client_status === "in_progress"
                                  ? "In progress"
                                  : "Not started"}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound className="size-3.5 text-muted-foreground" />
                              {task.owner_name ?? "Unassigned"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {task.team_status === "verified" ? (
                              <Badge className="bg-emerald-600 text-white">
                                <CheckCircle2 /> Verified
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <Clock3 /> Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {evidenceControl(task)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
