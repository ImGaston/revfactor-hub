"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  Bot,
  FlaskConical,
  History,
  Play,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  AGENT_STUDIO_MODELS,
  DEFAULT_AGENT_STUDIO_INSTRUCTIONS,
  DEFAULT_AGENT_STUDIO_MODEL,
  getAgentStudioModel,
  isAgentStudioModelId,
  type AgentStudioClientOption,
  type AgentStudioModelId,
} from "@/lib/agent-studio"
import type {
  AgentIntegrationHealth,
  AgentPlaybookVersionSummary,
  AgentStudioGovernanceSnapshot,
  AgentStudioSettings,
} from "@/lib/agent-studio-governance"
import { AgentStudio } from "./agent-studio"
import {
  checkStudioIntegrationsAction,
  createShadowCaseAction,
  decideApprovalAction,
  movePlaybookVersionAction,
  promotePlaybookToProductionAction,
  requestProductionApprovalAction,
  runEvaluationCaseAction,
  savePlaybookVersionAction,
  updateStudioSettingsAction,
} from "./governance-actions"

function formatCost(value: number) {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (["production", "connected", "approved", "completed"].includes(status)) {
    return "default"
  }
  if (["unavailable", "failed", "rejected"].includes(status)) {
    return "destructive"
  }
  if (["testing", "running", "partial", "pending"].includes(status)) {
    return "secondary"
  }
  return "outline"
}

function RunsPanel({
  governance,
}: {
  governance: AgentStudioGovernanceSnapshot
}) {
  const totals = useMemo(() => {
    const completed = governance.recentRuns.filter(
      (run) => run.status === "completed"
    )
    return {
      runs: completed.length,
      cost: completed.reduce(
        (total, run) => total + run.estimatedCostUsd,
        0
      ),
      latency:
        completed.length > 0
          ? completed.reduce((total, run) => total + run.durationMs, 0) /
            completed.length
          : 0,
      rating: (() => {
        const rated = completed.filter((run) => run.feedbackRating != null)
        return rated.length > 0
          ? rated.reduce(
              (total, run) => total + (run.feedbackRating ?? 0),
              0
            ) / rated.length
          : null
      })(),
    }
  }, [governance.recentRuns])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Runs and cost</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Durable conversation history, token usage, cost, latency, and review
          outcomes.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Tracked runs</CardDescription>
            <CardTitle>{totals.runs}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Total cost</CardDescription>
            <CardTitle>{formatCost(totals.cost)}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Average latency</CardDescription>
            <CardTitle>{(totals.latency / 1_000).toFixed(1)}s</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Average rating</CardDescription>
            <CardTitle>
              {totals.rating == null ? "—" : `${totals.rating.toFixed(1)}/5`}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>
            Playground, evaluation, and shadow activity share one cost ledger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conversation</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {governance.recentRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="font-medium">
                      {run.conversationTitle ?? "Untitled"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.clientName ?? "Synthetic"} · {formatDate(run.createdAt)}
                    </div>
                    {run.errorMessage && (
                      <div className="mt-1 max-w-96 text-xs text-destructive">
                        {run.errorMessage}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAgentStudioModelId(run.modelId)
                      ? getAgentStudioModel(run.modelId).label
                      : run.modelId}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(run.status)}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(run.conversationSource)}>
                      {run.conversationSource}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {run.totalTokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono">
                    {(run.durationMs / 1_000).toFixed(1)}s
                  </TableCell>
                  <TableCell>
                    {run.feedbackRating == null
                      ? "—"
                      : `${run.feedbackRating}/5`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCost(run.estimatedCostUsd)}
                  </TableCell>
                </TableRow>
              ))}
              {governance.recentRuns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    Run the playground to create the first durable record.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function PlaybookEditor({
  versions,
  canCreate,
}: {
  versions: AgentPlaybookVersionSummary[]
  canCreate: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initial = versions[0]
  const [playbookId, setPlaybookId] = useState(initial?.playbookId ?? "new")
  const [name, setName] = useState(initial?.playbookName ?? "RevFactor Client Service")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [instructions, setInstructions] = useState(
    initial?.instructions ?? DEFAULT_AGENT_STUDIO_INSTRUCTIONS
  )
  const [modelId, setModelId] = useState<AgentStudioModelId>(
    initial?.modelId ?? DEFAULT_AGENT_STUDIO_MODEL
  )
  const [changeNote, setChangeNote] = useState("")

  function changePlaybook(value: string) {
    setPlaybookId(value)
    if (value === "new") {
      setName("New playbook")
      setDescription("")
      setInstructions(DEFAULT_AGENT_STUDIO_INSTRUCTIONS)
      setModelId(DEFAULT_AGENT_STUDIO_MODEL)
      return
    }
    const version = versions.find((item) => item.playbookId === value)
    if (!version) return
    setName(version.playbookName)
    setDescription(version.description ?? "")
    setInstructions(version.instructions)
    setModelId(version.modelId)
  }

  function save() {
    startTransition(async () => {
      const result = await savePlaybookVersionAction({
        playbookId: playbookId === "new" ? null : playbookId,
        name,
        description,
        instructions,
        modelId,
        maxInputTokens: 30_000,
        maxOutputTokens: 1_200,
        maxRunCostUsd: 0.02,
        changeNote,
      })
      if (result.ok) {
        toast.success("Draft playbook version saved")
        setChangeNote("")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a draft version</CardTitle>
        <CardDescription>
          Editing creates a new immutable version; existing test results remain
          attached to the version they used.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="playbook-base">Base playbook</FieldLabel>
            <Select value={playbookId} onValueChange={changePlaybook}>
              <SelectTrigger id="playbook-base" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="new">New playbook</SelectItem>
                  {Array.from(
                    new Map(
                      versions.map((version) => [
                        version.playbookId,
                        version,
                      ])
                    ).values()
                  ).map((version) => (
                    <SelectItem
                      key={version.playbookId}
                      value={version.playbookId}
                    >
                      {version.playbookName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="playbook-name">Name</FieldLabel>
            <Input
              id="playbook-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="playbook-description">Description</FieldLabel>
            <Input
              id="playbook-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="playbook-model">Default model</FieldLabel>
            <Select
              value={modelId}
              onValueChange={(value) => {
                if (isAgentStudioModelId(value)) setModelId(value)
              }}
            >
              <SelectTrigger id="playbook-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {AGENT_STUDIO_MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label} · ${model.inputUsdPerMillion}/$
                      {model.outputUsdPerMillion} per M
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="playbook-instructions">
              Instructions
            </FieldLabel>
            <Textarea
              id="playbook-instructions"
              className="min-h-72"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="playbook-note">Change note</FieldLabel>
            <Input
              id="playbook-note"
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
              placeholder="What changed and why?"
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button onClick={save} disabled={!canCreate || isPending}>
          {isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          Save draft version
        </Button>
      </CardFooter>
    </Card>
  )
}

function PlaybooksPanel({
  governance,
}: {
  governance: AgentStudioGovernanceSnapshot
}) {
  const router = useRouter()
  const [pendingAction, startTransition] = useTransition()

  function mutate(
    operation: () => Promise<{ ok: boolean; error?: string }>,
    success: string
  ) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(success)
        router.refresh()
      } else {
        toast.error(result.error ?? "The action failed.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Playbooks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Version, test, approve, and deliberately promote agent behavior.
        </p>
      </div>

      <Alert>
        <ShieldCheck />
        <AlertTitle>Two-person production gate</AlertTitle>
        <AlertDescription>
          The person requesting production promotion cannot approve the same
          request. Assembly sending remains unavailable even after promotion.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-4">
          {governance.playbookVersions.map((version) => {
            const approvedRequest = governance.approvals.find(
              (approval) =>
                approval.playbookVersionId === version.id &&
                approval.status === "approved"
            )
            return (
              <Card key={version.id}>
                <CardHeader>
                  <CardTitle>
                    {version.playbookName} v{version.version}
                  </CardTitle>
                  <CardDescription>
                    {version.changeNote || version.description || "No change note"}
                  </CardDescription>
                  <CardAction>
                    <Badge variant={statusVariant(version.status)}>
                      {version.status}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {getAgentStudioModel(version.modelId).label}
                    </Badge>
                    <Badge variant="outline">
                      {version.maxInputTokens.toLocaleString()} max input
                    </Badge>
                    <Badge variant="outline">
                      {formatCost(version.maxRunCostUsd)} max run
                    </Badge>
                    <Badge variant="outline">
                      {version.allowedTools.length} tools
                    </Badge>
                  </div>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  {version.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!governance.canEdit || pendingAction}
                      onClick={() =>
                        mutate(
                          () =>
                            movePlaybookVersionAction(version.id, "testing"),
                          "Playbook moved to testing"
                        )
                      }
                    >
                      <FlaskConical data-icon="inline-start" />
                      Start testing
                    </Button>
                  )}
                  {version.status === "testing" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!governance.canPublish || pendingAction}
                      onClick={() =>
                        mutate(
                          () =>
                            movePlaybookVersionAction(version.id, "approved"),
                          "Playbook approved"
                        )
                      }
                    >
                      <BadgeCheck data-icon="inline-start" />
                      Approve
                    </Button>
                  )}
                  {version.status === "approved" && !approvedRequest && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!governance.canEdit || pendingAction}
                      onClick={() =>
                        mutate(
                          () =>
                            requestProductionApprovalAction(
                              version.id,
                              version.changeNote || "Ready for production review"
                            ),
                          "Production approval requested"
                        )
                      }
                    >
                      Request production approval
                    </Button>
                  )}
                  {version.status === "approved" && approvedRequest && (
                    <Button
                      size="sm"
                      disabled={!governance.canControl || pendingAction}
                      onClick={() =>
                        mutate(
                          () =>
                            promotePlaybookToProductionAction(version.id),
                          "Playbook promoted to production"
                        )
                      }
                    >
                      <ShieldCheck data-icon="inline-start" />
                      Promote to production
                    </Button>
                  )}
                </CardFooter>
              </Card>
            )
          })}

          {governance.approvals
            .filter((approval) => approval.status === "pending")
            .map((approval) => (
              <Card key={approval.id}>
                <CardHeader>
                  <CardTitle>Pending production approval</CardTitle>
                  <CardDescription>
                    {approval.playbookLabel ?? approval.requestType} requested by{" "}
                    {approval.requestedByName ?? "a team member"}.
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!governance.canControl || pendingAction}
                    onClick={() =>
                      mutate(
                        () =>
                          decideApprovalAction(
                            approval.id,
                            "approved",
                            "Reviewed and approved in Agent Studio."
                          ),
                        "Approval recorded"
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!governance.canControl || pendingAction}
                    onClick={() =>
                      mutate(
                        () =>
                          decideApprovalAction(
                            approval.id,
                            "rejected",
                            "Rejected during Agent Studio review."
                          ),
                        "Rejection recorded"
                      )
                    }
                  >
                    Reject
                  </Button>
                </CardFooter>
              </Card>
            ))}
        </div>

        <PlaybookEditor
          versions={governance.playbookVersions}
          canCreate={governance.canCreate}
        />
      </div>
    </div>
  )
}

function EvaluationsPanel({
  governance,
  clients,
}: {
  governance: AgentStudioGovernanceSnapshot
  clients: AgentStudioClientOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const defaultVersion =
    governance.playbookVersions.find((version) => version.status === "testing")
      ?.id ??
    governance.playbookVersions.find((version) => version.status === "approved")
      ?.id ??
    governance.playbookVersions[0]?.id ??
    ""
  const [playbookVersionId, setPlaybookVersionId] = useState(defaultVersion)
  const [shadowClientId, setShadowClientId] = useState(
    clients.find((client) => !client.synthetic)?.id ?? ""
  )

  function runCase(caseId: string) {
    startTransition(async () => {
      const result = await runEvaluationCaseAction({
        caseId,
        playbookVersionId,
        modelIds: [
          "openai/gpt-5-nano",
          "google/gemini-2.5-flash-lite",
          "alibaba/qwen3.5-flash",
          "openai/gpt-5-mini",
        ],
      })
      if (result.ok) {
        toast.success(
          `Evaluation complete: ${result.passedCases}/${result.totalCases} passed`
        )
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  function createShadowCase() {
    startTransition(async () => {
      const result = await createShadowCaseAction(shadowClientId)
      if (result.ok) {
        toast.success("Shadow replay case captured from Assembly")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Evaluations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Replay frozen scenarios across the low-cost model ladder before
          promoting a playbook.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evaluation configuration</CardTitle>
          <CardDescription>
            Each case runs against Nano, Gemini Flash Lite, Qwen Flash, and
            GPT-5 Mini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="evaluation-playbook">
              Playbook version
            </FieldLabel>
            <Select
              value={playbookVersionId}
              onValueChange={setPlaybookVersionId}
            >
              <SelectTrigger id="evaluation-playbook" className="w-full">
                <SelectValue placeholder="Choose a version" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {governance.playbookVersions
                    .filter((version) => version.status !== "archived")
                    .map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        {version.playbookName} v{version.version} ·{" "}
                        {version.status}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {governance.evaluationCases.map((evaluationCase) => (
          <Card key={evaluationCase.id}>
            <CardHeader>
              <CardTitle>{evaluationCase.name}</CardTitle>
              <CardDescription>
                {evaluationCase.description || evaluationCase.rubric}
              </CardDescription>
              <CardAction>
                <Badge variant={statusVariant(evaluationCase.caseType)}>
                  {evaluationCase.caseType}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Expected: {evaluationCase.expectedDisposition ?? "rubric review"}
                {evaluationCase.hasFrozenSnapshot ? " · Frozen data" : " · Live data"}
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !governance.canCreate ||
                  !playbookVersionId ||
                  isPending
                }
                onClick={() => runCase(evaluationCase.id)}
              >
                {isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                Run four-model comparison
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capture production shadow case</CardTitle>
          <CardDescription>
            Uses a recent real Assembly client-message/team-reply pair. The
            model draft is never sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="shadow-client">Active client</FieldLabel>
            <Select value={shadowClientId} onValueChange={setShadowClientId}>
              <SelectTrigger id="shadow-client" className="w-full">
                <SelectValue placeholder="Choose a linked client" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {clients
                    .filter((client) => !client.synthetic)
                    .map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={createShadowCase}
            disabled={!shadowClientId || isPending || !governance.canCreate}
          >
            <Plus data-icon="inline-start" />
            Capture shadow case
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent evaluation batches</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pass rate</TableHead>
                <TableHead>Models</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {governance.evaluationBatches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>{batch.name}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(batch.status)}>
                      {batch.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {batch.passedCases}/{batch.totalCases}
                  </TableCell>
                  <TableCell>{batch.modelIds.length}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCost(batch.totalCostUsd)}
                  </TableCell>
                </TableRow>
              ))}
              {governance.evaluationBatches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No evaluation batches yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationCard({ health }: { health: AgentIntegrationHealth }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="capitalize">{health.integration.replace("_", " ")}</CardTitle>
        <CardDescription>
          Checked {formatDate(health.checkedAt)}
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant(health.status)}>{health.status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className="max-h-48 overflow-auto rounded-2xl bg-muted p-3 text-xs wrap-anywhere">
          {JSON.stringify(health.details, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}

function PolicyEditor({
  initialSettings,
  canControl,
}: {
  initialSettings: AgentStudioSettings
  canControl: boolean
}) {
  const router = useRouter()
  const [settings, setSettings] = useState(initialSettings)
  const [isPending, startTransition] = useTransition()

  function numeric<K extends keyof AgentStudioSettings>(
    key: K,
    value: string
  ) {
    setSettings((current) => ({
      ...current,
      [key]: Number(value),
    }))
  }

  function save() {
    startTransition(async () => {
      const result = await updateStudioSettingsAction(settings)
      if (result.ok) {
        toast.success("Studio policy updated")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets and retention</CardTitle>
        <CardDescription>
          Server-enforced limits apply to playground and evaluation runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="policy-max-input">Max input tokens</FieldLabel>
            <Input
              id="policy-max-input"
              type="number"
              value={settings.maxInputTokens}
              onChange={(event) =>
                numeric("maxInputTokens", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-max-output">
              Max output tokens
            </FieldLabel>
            <Input
              id="policy-max-output"
              type="number"
              value={settings.maxOutputTokens}
              onChange={(event) =>
                numeric("maxOutputTokens", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-run-cost">
              Max cost per run ($)
            </FieldLabel>
            <Input
              id="policy-run-cost"
              type="number"
              step="0.001"
              value={settings.maxRunCostUsd}
              onChange={(event) =>
                numeric("maxRunCostUsd", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-daily">Daily budget ($)</FieldLabel>
            <Input
              id="policy-daily"
              type="number"
              step="0.01"
              value={settings.dailyBudgetUsd}
              onChange={(event) =>
                numeric("dailyBudgetUsd", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-monthly">
              Monthly budget ($)
            </FieldLabel>
            <Input
              id="policy-monthly"
              type="number"
              step="0.01"
              value={settings.monthlyBudgetUsd}
              onChange={(event) =>
                numeric("monthlyBudgetUsd", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-retention">
              Conversation retention (days)
            </FieldLabel>
            <Input
              id="policy-retention"
              type="number"
              value={settings.retentionDays}
              onChange={(event) =>
                numeric("retentionDays", event.target.value)
              }
              disabled={!canControl}
            />
          </Field>
          <Field orientation="horizontal">
            <div>
              <FieldLabel htmlFor="policy-approval">
                Require Assembly send approval
              </FieldLabel>
              <FieldDescription>
                Future send actions cannot bypass the approval ledger.
              </FieldDescription>
            </div>
            <Switch
              id="policy-approval"
              checked={settings.requireSendApproval}
              onCheckedChange={(checked) =>
                setSettings((current) => ({
                  ...current,
                  requireSendApproval: checked,
                }))
              }
              disabled={!canControl}
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button onClick={save} disabled={!canControl || isPending}>
          {isPending && <Spinner data-icon="inline-start" />}
          Save policy
        </Button>
      </CardFooter>
    </Card>
  )
}

function HealthPanel({
  governance,
}: {
  governance: AgentStudioGovernanceSnapshot
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function checkHealth() {
    startTransition(async () => {
      const result = await checkStudioIntegrationsAction()
      if (result.ok) {
        toast.success("Integration health refreshed")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Health, policy, and audit
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Integration freshness, enforced budgets, retention, permissions,
            approvals, and change history.
          </p>
        </div>
        <Button variant="outline" onClick={checkHealth} disabled={isPending}>
          {isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCcw data-icon="inline-start" />
          )}
          Check integrations
        </Button>
      </div>

      <Alert>
        <TriangleAlert />
        <AlertTitle>Privacy boundary</AlertTitle>
        <AlertDescription>
          Traces inherit Agent Studio permissions. Contact details and private
          links are redacted before Assembly history is supplied to a model or
          stored in a trace.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        {governance.integrationHealth.map((health) => (
          <IntegrationCard key={health.integration} health={health} />
        ))}
        {governance.integrationHealth.length === 0 && (
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle>No integration checks yet</CardTitle>
              <CardDescription>
                Run the health check to validate AI Gateway, PriceLabs, and
                Assembly without exposing credentials.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <PolicyEditor
          initialSettings={governance.settings}
          canControl={governance.canControl}
        />

        <Card>
          <CardHeader>
            <CardTitle>Audit history</CardTitle>
            <CardDescription>
              Playbook, evaluation, feedback, approval, policy, and run events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {governance.auditEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>{event.actorName ?? "System"}</TableCell>
                    <TableCell>
                      {event.entityType}
                      {event.entityId
                        ? ` · ${event.entityId.slice(0, 8)}`
                        : ""}
                    </TableCell>
                    <TableCell>{formatDate(event.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {governance.auditEvents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No audit events yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function AgentStudioShell({
  clients,
  gatewayConfigured,
  governance,
}: {
  clients: AgentStudioClientOption[]
  gatewayConfigured: boolean
  governance: AgentStudioGovernanceSnapshot
}) {
  return (
    <Tabs defaultValue="playground" className="flex flex-col gap-6">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="playground">
          <Bot data-icon="inline-start" />
          Playground
        </TabsTrigger>
        <TabsTrigger value="runs">
          <History data-icon="inline-start" />
          Runs
        </TabsTrigger>
        <TabsTrigger value="playbooks">
          <BookOpenCheck data-icon="inline-start" />
          Playbooks
        </TabsTrigger>
        <TabsTrigger value="evaluations">
          <FlaskConical data-icon="inline-start" />
          Evaluations
        </TabsTrigger>
        <TabsTrigger value="health">
          <Activity data-icon="inline-start" />
          Health & policy
        </TabsTrigger>
      </TabsList>

      <TabsContent value="playground">
        <AgentStudio
          clients={clients}
          gatewayConfigured={gatewayConfigured}
          playbookVersions={governance.playbookVersions}
        />
      </TabsContent>
      <TabsContent value="runs">
        <RunsPanel governance={governance} />
      </TabsContent>
      <TabsContent value="playbooks">
        <PlaybooksPanel governance={governance} />
      </TabsContent>
      <TabsContent value="evaluations">
        <EvaluationsPanel governance={governance} clients={clients} />
      </TabsContent>
      <TabsContent value="health">
        <HealthPanel governance={governance} />
      </TabsContent>
    </Tabs>
  )
}
