"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  Bot,
  BrainCircuit,
  CirclePlus,
  GitBranch,
  GraduationCap,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import type { AgentStudioModelId, AgentStudioRun } from "@/lib/agent-studio"
import {
  AGENT_STUDIO_COACH_MODEL_ID,
  DEFAULT_AGENT_WORKFLOW,
  applyCoachToInstructions,
  normalizeAgentWorkflow,
  type AgentCoachObservation,
  type AgentCoachReview,
  type AgentWorkflow,
  type AgentWorkflowNode,
  type AgentWorkflowResponseType,
} from "@/lib/agent-studio-coach"
import type { AgentPlaybookVersionSummary } from "@/lib/agent-studio-governance"
import { coachAgentStudioRun } from "./coach-actions"
import { savePlaybookVersionAction } from "./governance-actions"

function formatCost(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

function severityVariant(severity: AgentCoachObservation["severity"]) {
  if (severity === "risk") return "destructive" as const
  if (severity === "strength") return "secondary" as const
  return "outline" as const
}

function kindLabel(kind: AgentWorkflowNode["kind"]) {
  if (kind === "input") return "Input"
  if (kind === "decision") return "Decision"
  if (kind === "output") return "Output"
  return "Process"
}

function CoachReview({ review }: { review: AgentCoachReview }) {
  return (
    <div className="flex flex-col gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Coaching review</CardTitle>
          <CardDescription>
            {review.analyzedRunIds.length} run
            {review.analyzedRunIds.length === 1 ? "" : "s"} analyzed
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{review.score}/5</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p>{review.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{formatCost(review.usage.estimatedCostUsd)}</span>
            <span>·</span>
            <span>{review.usage.totalTokens.toLocaleString()} tokens</span>
            <span>·</span>
            <span>{review.modelId.replace("google/", "")}</span>
          </div>
        </CardContent>
      </Card>

      {review.observations.map((observation, index) => (
        <Card key={`${observation.title}-${index}`} size="sm">
          <CardHeader>
            <CardTitle>{observation.title}</CardTitle>
            <CardAction>
              <Badge variant={severityVariant(observation.severity)}>
                {observation.severity}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{observation.detail}</p>
          </CardContent>
        </Card>
      ))}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap />
            Teaching points
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground">
            {review.teachingPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function WorkflowGraph({
  workflow,
  responseType,
  selectedNodeId,
  onSelectNode,
}: {
  workflow: AgentWorkflow
  responseType: Exclude<AgentWorkflowResponseType, "all">
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) {
  const visibleNodes = workflow.nodes.filter(
    (node) =>
      node.responseType === "all" ||
      node.responseType === responseType
  )
  const visibleIds = new Set(visibleNodes.map((node) => node.id))

  return (
    <div className="flex flex-col items-stretch">
      {visibleNodes.map((node, index) => {
        const incomingEdges = workflow.edges.filter(
          (edge) =>
            edge.target === node.id &&
            visibleIds.has(edge.source) &&
            visibleIds.has(edge.target)
        )
        const incomingConditions = incomingEdges
          .filter((edge) => edge.condition)
          .flatMap((edge) => (edge.condition ? [edge.condition] : []))
        return (
          <div key={node.id} className="flex flex-col items-center">
            {index > 0 && incomingEdges.length > 0 && (
              <div className="flex flex-col items-center gap-1 py-2">
                <ArrowDown className="text-muted-foreground" />
                {incomingConditions.map((condition) => (
                  <Badge key={condition} variant="outline">
                    {condition}
                  </Badge>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant={selectedNodeId === node.id ? "secondary" : "outline"}
              className="h-auto w-full justify-start whitespace-normal py-3 text-left"
              onClick={() => onSelectNode(node.id)}
            >
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{node.label}</span>
                  <Badge variant="outline">{kindLabel(node.kind)}</Badge>
                  {node.responseType !== "all" && (
                    <Badge variant="secondary">{node.responseType}</Badge>
                  )}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {node.instruction}
                </span>
              </span>
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function WorkflowNodeEditor({
  node,
  onChange,
  onDelete,
}: {
  node: AgentWorkflowNode
  onChange: (next: AgentWorkflowNode) => void
  onDelete: () => void
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Edit step</CardTitle>
        <CardDescription>
          These are explicit operating rules, not hidden model reasoning.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workflow-node-label">Step name</FieldLabel>
            <Textarea
              id="workflow-node-label"
              value={node.label}
              onChange={(event) =>
                onChange({ ...node, label: event.target.value.slice(0, 120) })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workflow-node-response">
              Response type
            </FieldLabel>
            <Select
              value={node.responseType}
              onValueChange={(value) =>
                onChange({
                  ...node,
                  responseType: value as AgentWorkflowResponseType,
                })
              }
            >
              <SelectTrigger id="workflow-node-response" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Every response</SelectItem>
                  <SelectItem value="answer">Answer only</SelectItem>
                  <SelectItem value="negative">Negative scenario</SelectItem>
                  <SelectItem value="clarify">Clarify only</SelectItem>
                  <SelectItem value="escalate">Escalate only</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="workflow-node-instruction">
              Operating instruction
            </FieldLabel>
            <Textarea
              id="workflow-node-instruction"
              value={node.instruction}
              onChange={(event) =>
                onChange({
                  ...node,
                  instruction: event.target.value.slice(0, 1_200),
                })
              }
              className="min-h-28"
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button type="button" variant="outline" onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          Delete step
        </Button>
      </CardFooter>
    </Card>
  )
}

export function StudioCoachWorkspace({
  run,
  playbookVersion,
  currentInstructions,
  currentModelId,
  onApplyInstructions,
}: {
  run: AgentStudioRun | null
  playbookVersion: AgentPlaybookVersionSummary | null
  currentInstructions: string
  currentModelId: AgentStudioModelId
  onApplyInstructions: (instructions: string) => void
}) {
  const router = useRouter()
  const [review, setReview] = useState<AgentCoachReview | null>(null)
  const [workflow, setWorkflow] = useState<AgentWorkflow>(() =>
    normalizeAgentWorkflow(
      playbookVersion?.workflow ?? DEFAULT_AGENT_WORKFLOW
    )
  )
  const [instructionPatch, setInstructionPatch] = useState("")
  const [responseType, setResponseType] =
    useState<Exclude<AgentWorkflowResponseType, "all">>("answer")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCoaching, startCoaching] = useTransition()
  const [isSaving, startSaving] = useTransition()

  const selectedNode = useMemo(
    () => workflow.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, workflow.nodes]
  )

  function runCoach() {
    if (!run) return
    startCoaching(async () => {
      const result = await coachAgentStudioRun({ runId: run.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setReview(result.review)
      setWorkflow(result.review.workflow)
      setInstructionPatch(result.review.suggestedInstructionPatch)
      setSelectedNodeId(result.review.workflow.nodes[0]?.id ?? null)
      toast.success(
        `Coach reviewed ${result.review.analyzedRunIds.length} run${
          result.review.analyzedRunIds.length === 1 ? "" : "s"
        }`
      )
    })
  }

  function updateNode(next: AgentWorkflowNode) {
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === next.id ? next : node
      ),
    }))
  }

  function deleteNode(nodeId: string) {
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
    }))
    setSelectedNodeId(null)
  }

  function addNode() {
    const id = `custom-step-${Date.now()}`
    const nextNode: AgentWorkflowNode = {
      id,
      label: "New review step",
      kind: "process",
      responseType,
      instruction: "Describe the explicit operating rule for this step.",
    }
    setWorkflow((current) => {
      const outputNode = current.nodes.find(
        (node) => node.kind === "output" && node.responseType === "all"
      )
      const outputIndex = outputNode
        ? current.nodes.findIndex((node) => node.id === outputNode.id)
        : -1
      const branchBeforeOutput = current.nodes.filter(
        (node, index) =>
          index < (outputIndex === -1 ? current.nodes.length : outputIndex) &&
          (node.responseType === "all" || node.responseType === responseType)
      )
      const previousNode = branchBeforeOutput.at(-1)
      const nodes = [...current.nodes]
      nodes.splice(outputIndex === -1 ? nodes.length : outputIndex, 0, nextNode)
      const edges = current.edges.filter(
        (edge) =>
          !(
            previousNode &&
            outputNode &&
            edge.source === previousNode.id &&
            edge.target === outputNode.id
          )
      )
      if (previousNode) {
        edges.push({
          id: `${previousNode.id}-to-${id}`,
          source: previousNode.id,
          target: id,
          condition: null,
        })
      }
      if (outputNode) {
        edges.push({
          id: `${id}-to-${outputNode.id}`,
          source: id,
          target: outputNode.id,
          condition: null,
        })
      }
      return { ...current, nodes, edges }
    })
    setSelectedNodeId(id)
  }

  function finalInstructions() {
    return applyCoachToInstructions({
      baseInstructions: currentInstructions,
      instructionPatch,
      workflow,
    })
  }

  function applyToSession() {
    onApplyInstructions(finalInstructions())
    toast.success("Coach workflow applied to the session draft")
  }

  function saveDraftPlaybook() {
    if (!review) {
      toast.error("Run the Coach before creating a playbook draft.")
      return
    }
    startSaving(async () => {
      const result = await savePlaybookVersionAction({
        playbookId: playbookVersion?.playbookId ?? null,
        name: playbookVersion?.playbookName ?? review.playbookName,
        description:
          playbookVersion?.description ?? review.playbookDescription,
        instructions: finalInstructions(),
        workflow,
        modelId: currentModelId,
        maxInputTokens: playbookVersion?.maxInputTokens ?? 30_000,
        maxOutputTokens: playbookVersion?.maxOutputTokens ?? 1_200,
        maxRunCostUsd: playbookVersion?.maxRunCostUsd ?? 0.02,
        changeNote: review.changeNote,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.refresh()
      toast.success("New draft playbook version saved")
    })
  }

  if (!run) {
    return (
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BrainCircuit />
          </EmptyMedia>
          <EmptyTitle>Studio Coach is ready</EmptyTitle>
          <EmptyDescription>
            Select or run a conversation to get teaching, compare recent runs,
            and edit its response workflow.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Tabs defaultValue="coach" className="flex flex-col gap-3">
      <TabsList className="w-full">
        <TabsTrigger value="coach">
          <GraduationCap data-icon="inline-start" />
          Coach
        </TabsTrigger>
        <TabsTrigger value="workflow">
          <GitBranch data-icon="inline-start" />
          Workflow
        </TabsTrigger>
      </TabsList>

      <TabsContent value="coach" className="flex flex-col gap-3">
        <Alert>
          <Bot />
          <AlertTitle>Separate review agent</AlertTitle>
          <AlertDescription>
            Uses {AGENT_STUDIO_COACH_MODEL_ID.replace("google/", "")} and up
            to four recent runs from the same playbook. It can only propose
            drafts.
          </AlertDescription>
        </Alert>
        <Button type="button" onClick={runCoach} disabled={isCoaching}>
          {isCoaching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <WandSparkles data-icon="inline-start" />
          )}
          {review ? "Review again" : "Review this run"}
        </Button>

        {review ? (
          <>
            <CoachReview review={review} />
            <Card size="sm">
              <CardHeader>
                <CardTitle>Proposed playbook guidance</CardTitle>
                <CardDescription>
                  Edit this before applying or saving a version.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field>
                  <FieldLabel htmlFor="coach-instruction-patch">
                    Instruction patch
                  </FieldLabel>
                  <Textarea
                    id="coach-instruction-patch"
                    value={instructionPatch}
                    onChange={(event) =>
                      setInstructionPatch(event.target.value.slice(0, 4_000))
                    }
                    className="min-h-40"
                  />
                  <FieldDescription>
                    Workflow rules are appended separately from this patch.
                  </FieldDescription>
                </Field>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button type="button" onClick={applyToSession}>
                  <Sparkles data-icon="inline-start" />
                  Apply to session
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveDraftPlaybook}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  Save draft playbook
                </Button>
              </CardFooter>
            </Card>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The Coach will inspect the selected response, its sources and
            feedback, plus comparable recent runs. No production configuration
            changes automatically.
          </p>
        )}
      </TabsContent>

      <TabsContent value="workflow" className="flex flex-col gap-3">
        {responseType === "negative" && (
          <Alert>
            <BrainCircuit />
            <AlertTitle>Frame negative performance honestly</AlertTitle>
            <AlertDescription>
              State the verified gap, separate facts from hypotheses, then
              choose a client-ready next step, an internal brainstorm, or a
              human escalation. Never soften the result with unsupported
              optimism or invent a cause.
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel>Response scenario</FieldLabel>
          <ToggleGroup
            type="single"
            value={responseType}
            onValueChange={(value) => {
              if (value) {
                setResponseType(
                  value as Exclude<AgentWorkflowResponseType, "all">
                )
              }
            }}
            variant="outline"
            className="grid w-full grid-cols-2"
            aria-label="Workflow response scenario"
          >
            {(
              [
                ["answer", "Answer"],
                ["negative", "Negative result"],
                ["clarify", "Clarify"],
                ["escalate", "Escalate"],
              ] as const
            ).map(([value, label]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="w-full"
                aria-label={
                  value === "negative"
                    ? "Negative performance workflow"
                    : `${value} workflow`
                }
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch />
              Observable decision workflow
            </CardTitle>
            <CardDescription>
              Click a step to change its instruction or response branch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkflowGraph
              workflow={workflow}
              responseType={responseType}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </CardContent>
          <CardFooter>
            <Button type="button" variant="outline" onClick={addNode}>
              <CirclePlus data-icon="inline-start" />
              Add step
            </Button>
          </CardFooter>
        </Card>

        {selectedNode && (
          <WorkflowNodeEditor
            node={selectedNode}
            onChange={updateNode}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={applyToSession}>
            <Sparkles data-icon="inline-start" />
            Apply to session
          </Button>
          {review && (
            <Button
              type="button"
              variant="outline"
              onClick={saveDraftPlaybook}
              disabled={isSaving}
            >
              {isSaving ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              Save draft playbook
            </Button>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}
