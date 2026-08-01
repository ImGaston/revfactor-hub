"use client"

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ComponentType,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react"
import {
  ArrowLeft,
  Bot,
  Brain,
  Check,
  CircleStop,
  Database,
  FileSearch,
  GitBranch,
  History,
  LockKeyhole,
  MessageSquare,
  Network,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserCheck,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  AGENT_FLOW_NODE_DEFINITIONS,
  makeNode,
  normalizeAgentFlowGraph,
  validateAgentFlowGraph,
  type AgentFlowGraph,
  type AgentFlowNodeData,
  type AgentFlowNodeKind,
  type AgentFlowStatus,
} from "@/lib/agent-flows"
import { cn } from "@/lib/utils"
import {
  createAgentFlowDraftVersionAction,
  saveAgentFlowDraftAction,
  transitionAgentFlowVersionAction,
} from "../../agent-flow-actions"

type FlowNode = Node<AgentFlowNodeData, "agentStep">
type FlowEdge = Edge<{ label?: string | null }>

type FlowRecord = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

type VersionRecord = {
  id: string
  flow_id: string
  version: number
  status: AgentFlowStatus
  graph: AgentFlowGraph
  compiled_instructions: string
  change_note: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
  promoted_at: string | null
}

type VersionOption = Pick<
  VersionRecord,
  "id" | "version" | "status" | "updated_at"
>

type EventRecord = {
  id: string
  version_id: string | null
  event_type: string
  details: Record<string, unknown>
  created_at: string
}

type Props = {
  flow: FlowRecord
  version: VersionRecord
  versions: VersionOption[]
  events: EventRecord[]
  permissions: {
    canEdit: boolean
    canPublish: boolean
    canControl: boolean
  }
}

const NODE_ICONS: Record<
  AgentFlowNodeKind,
  ComponentType<{ className?: string }>
> = {
  trigger: MessageSquare,
  context: Database,
  knowledge: FileSearch,
  pricelabs: Network,
  decision: GitBranch,
  draft: Sparkles,
  brainstorm: Brain,
  escalation: TriangleAlert,
  approval: UserCheck,
  output: CircleStop,
}

const NODE_STYLES: Record<AgentFlowNodeKind, string> = {
  trigger: "border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950",
  context:
    "border-violet-300 bg-violet-50 dark:border-violet-900 dark:bg-violet-950",
  knowledge:
    "border-indigo-300 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950",
  pricelabs: "border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950",
  decision:
    "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  draft:
    "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
  brainstorm:
    "border-fuchsia-300 bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-fuchsia-950",
  escalation:
    "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950",
  approval: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950",
  output:
    "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900",
}

const STATUS_BADGE: Record<
  AgentFlowStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  testing: "secondary",
  approved: "default",
  production: "default",
  archived: "outline",
}

function AgentStepNode({ data, selected }: NodeProps<FlowNode>) {
  const Icon = NODE_ICONS[data.kind]
  const isTrigger = data.kind === "trigger"
  const isOutput = data.kind === "output"

  return (
    <div
      className={cn(
        "w-56 rounded-2xl border bg-card px-4 py-3 shadow-md transition-shadow",
        NODE_STYLES[data.kind],
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="size-3! border-2! border-background! bg-foreground!"
        />
      )}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-background/80 shadow-sm">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.label}</div>
          <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
            {data.description}
          </div>
        </div>
      </div>
      <Badge variant="outline" className="mt-3 bg-background/60 capitalize">
        {data.kind}
      </Badge>
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="size-3! border-2! border-background! bg-primary!"
        />
      )}
    </div>
  )
}

const nodeTypes = { agentStep: AgentStepNode }

function eventLabel(eventType: string): string {
  return eventType.replaceAll("_", " ")
}

function BuilderCanvas({
  flow,
  version,
  versions,
  events,
  permissions,
}: Props) {
  const router = useRouter()
  const initialGraph = useMemo(
    () => normalizeAgentFlowGraph(version.graph),
    [version.graph]
  )
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>(
    initialGraph.nodes as FlowNode[]
  )
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<FlowEdge>(
    initialGraph.edges.map((edge) => ({
      ...edge,
      data: { label: edge.label },
      label: edge.label ?? undefined,
    }))
  )
  const [name, setName] = useState(flow.name)
  const [description, setDescription] = useState(flow.description ?? "")
  const [changeNote, setChangeNote] = useState(version.change_note ?? "")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { getViewport, fitView } = useReactFlow<FlowNode, FlowEdge>()

  const editable = version.status === "draft" && permissions.canEdit
  const validation = useMemo(
    () =>
      validateAgentFlowGraph({
        version: 1,
        nodes,
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label:
            typeof edge.label === "string"
              ? edge.label
              : (edge.data?.label ?? null),
        })),
        viewport: getViewport(),
      }),
    [edges, getViewport, nodes]
  )
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (!editable) return
      onNodesChangeBase(changes)
      if (changes.some((change) => change.type !== "select")) setDirty(true)
    },
    [editable, onNodesChangeBase]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (!editable) return
      onEdgesChangeBase(changes)
      if (changes.some((change) => change.type !== "select")) setDirty(true)
    },
    [editable, onEdgesChangeBase]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable || !connection.source || !connection.target) return
      const sourceNode = nodes.find((node) => node.id === connection.source)
      const label = sourceNode?.data.kind === "decision" ? "New branch" : null
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `edge-${crypto.randomUUID()}`,
            label: label ?? undefined,
            data: { label },
          },
          current
        )
      )
      setDirty(true)
    },
    [editable, nodes, setEdges]
  )

  function addNode(kind: AgentFlowNodeKind) {
    if (!editable) return
    const base = makeNode(
      `${kind}-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      160 + (nodes.length % 3) * 300,
      120 + Math.floor(nodes.length / 3) * 180
    )
    setNodes((current) => [...current, base as FlowNode])
    setSelectedNodeId(base.id)
    setSelectedEdgeId(null)
    setDirty(true)
  }

  function updateSelectedNode(data: Partial<AgentFlowNodeData>) {
    if (!editable || !selectedNodeId) return
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      )
    )
    setDirty(true)
  }

  function updateSelectedEdgeLabel(label: string) {
    if (!editable || !selectedEdgeId) return
    setEdges((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              label: label || undefined,
              data: { label: label || null },
            }
          : edge
      )
    )
    setDirty(true)
  }

  function removeSelection() {
    if (!editable) return
    if (selectedNodeId) {
      setNodes((current) =>
        current.filter((node) => node.id !== selectedNodeId)
      )
      setEdges((current) =>
        current.filter(
          (edge) =>
            edge.source !== selectedNodeId && edge.target !== selectedNodeId
        )
      )
    } else if (selectedEdgeId) {
      setEdges((current) =>
        current.filter((edge) => edge.id !== selectedEdgeId)
      )
    }
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setDirty(true)
  }

  function currentGraph(): AgentFlowGraph {
    return normalizeAgentFlowGraph({
      version: 1,
      nodes,
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label:
          typeof edge.label === "string"
            ? edge.label
            : (edge.data?.label ?? null),
      })),
      viewport: getViewport(),
    })
  }

  function saveDraft() {
    startTransition(async () => {
      const result = await saveAgentFlowDraftAction({
        flowId: flow.id,
        versionId: version.id,
        name,
        description,
        changeNote,
        graph: currentGraph(),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDirty(false)
      toast.success(
        validation.valid
          ? "Agent Flow saved and validated"
          : `Draft saved with ${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}`
      )
      router.refresh()
    })
  }

  function createDraftVersion() {
    startTransition(async () => {
      const result = await createAgentFlowDraftVersionAction(version.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("New draft version created")
      router.push(`/knowledge/flows/${flow.id}?version=${result.versionId}`)
      router.refresh()
    })
  }

  function moveTo(
    targetStatus: "testing" | "approved" | "production" | "archived"
  ) {
    startTransition(async () => {
      if (dirty && targetStatus !== "archived") {
        toast.error(
          "Save the current draft before changing its lifecycle status."
        )
        return
      }
      const result = await transitionAgentFlowVersionAction({
        versionId: version.id,
        targetStatus,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        targetStatus === "production"
          ? "Agent Flow promoted to production"
          : `Agent Flow moved to ${targetStatus}`
      )
      router.refresh()
    })
  }

  const nextAction =
    version.status === "draft"
      ? {
          label: "Move to testing",
          target: "testing" as const,
          allowed: permissions.canEdit,
        }
      : version.status === "testing"
        ? {
            label: "Approve version",
            target: "approved" as const,
            allowed: permissions.canPublish,
          }
        : version.status === "approved"
          ? {
              label: "Promote to production",
              target: "production" as const,
              allowed: permissions.canPublish && permissions.canControl,
            }
          : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/knowledge" aria-label="Back to Knowledge">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{flow.name}</h1>
              <Badge
                variant={STATUS_BADGE[version.status]}
                className={
                  version.status === "production"
                    ? "bg-emerald-600 text-white"
                    : undefined
                }
              >
                v{version.version} · {version.status}
              </Badge>
              {dirty && <Badge variant="destructive">Unsaved</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Visual operating logic for agents. Production remains read-only
              and never sends messages by itself.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={version.id}
            onValueChange={(versionId) =>
              router.push(`/knowledge/flows/${flow.id}?version=${versionId}`)
            }
          >
            <SelectTrigger className="min-w-44 bg-background">
              <History />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  Version {item.version} · {item.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {editable && (
            <Button onClick={saveDraft} disabled={isPending}>
              <Save data-icon="inline-start" />{" "}
              {isPending ? "Saving…" : "Save draft"}
            </Button>
          )}
          {!editable &&
            permissions.canEdit &&
            version.status !== "archived" && (
              <Button
                variant="outline"
                onClick={createDraftVersion}
                disabled={isPending}
              >
                <Plus data-icon="inline-start" /> New draft
              </Button>
            )}
          {nextAction && (
            <Button
              variant={
                nextAction.target === "production" ? "default" : "secondary"
              }
              onClick={() => moveTo(nextAction.target)}
              disabled={isPending || !nextAction.allowed || !validation.valid}
            >
              {nextAction.target === "production" ? <Rocket /> : <Check />}
              {nextAction.label}
            </Button>
          )}
        </div>
      </div>

      {!validation.valid && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>
            {validation.issues.length} validation issue
            {validation.issues.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            {validation.issues
              .slice(0, 3)
              .map((issue) => issue.message)
              .join(" · ")}
            {validation.issues.length > 3
              ? ` · plus ${validation.issues.length - 3} more`
              : ""}
          </AlertDescription>
        </Alert>
      )}

      <Card className="h-[720px] gap-0 py-0">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="18%" minSize="14%" maxSize="26%">
            <ScrollArea className="h-full">
              <div className="space-y-5 p-4">
                <div>
                  <h2 className="font-semibold">Step library</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add controlled RevFactor steps. Drag them on the canvas to
                    arrange the flow.
                  </p>
                </div>
                <div className="grid gap-2">
                  {AGENT_FLOW_NODE_DEFINITIONS.map((definition) => {
                    const Icon = NODE_ICONS[definition.kind]
                    return (
                      <Button
                        key={definition.kind}
                        variant="outline"
                        className="h-auto justify-start rounded-2xl px-3 py-3 text-left whitespace-normal"
                        onClick={() => addNode(definition.kind)}
                        disabled={!editable}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span>
                          <span className="block font-medium">
                            {definition.label}
                          </span>
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            {definition.description}
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                </div>
                <Alert>
                  <LockKeyhole />
                  <AlertTitle>Safe by design</AlertTitle>
                  <AlertDescription>
                    No arbitrary code, SQL, shell, or unrestricted HTTP nodes.
                  </AlertDescription>
                </Alert>
              </div>
            </ScrollArea>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="58%" minSize="38%">
            <div className="relative h-full bg-muted/20">
              <ReactFlow<FlowNode, FlowEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id)
                  setSelectedEdgeId(null)
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id)
                  setSelectedNodeId(null)
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null)
                  setSelectedEdgeId(null)
                }}
                nodesDraggable={editable}
                nodesConnectable={editable}
                elementsSelectable
                deleteKeyCode={null}
                defaultViewport={initialGraph.viewport}
                minZoom={0.2}
                maxZoom={1.8}
                fitView={false}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  style: { strokeWidth: 2 },
                  labelStyle: { fontSize: 11, fontWeight: 600 },
                  labelBgPadding: [6, 4],
                  labelBgBorderRadius: 8,
                }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={18}
                  size={1}
                />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  className="!rounded-2xl !border !bg-background"
                  nodeColor="var(--primary)"
                />
              </ReactFlow>
              <div className="absolute top-3 right-3 z-10 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fitView({ padding: 0.2 })}
                >
                  <Network /> Fit flow
                </Button>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="24%" minSize="19%" maxSize="34%">
            <ScrollArea className="h-full">
              <div className="space-y-5 p-4">
                <div>
                  <h2 className="font-semibold">Inspector</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedNode
                      ? "Edit the selected step's observable instruction."
                      : selectedEdge
                        ? "Describe the condition for this branch."
                        : "Select a step or branch to edit it."}
                  </p>
                </div>

                {!selectedNode && !selectedEdge && (
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="flow-name">Flow name</Label>
                      <Input
                        id="flow-name"
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value)
                          setDirty(true)
                        }}
                        disabled={!editable}
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="flow-description">Description</Label>
                      <Textarea
                        id="flow-description"
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value)
                          setDirty(true)
                        }}
                        disabled={!editable}
                        rows={4}
                        maxLength={500}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="change-note">Version note</Label>
                      <Textarea
                        id="change-note"
                        value={changeNote}
                        onChange={(event) => {
                          setChangeNote(event.target.value)
                          setDirty(true)
                        }}
                        disabled={!editable}
                        rows={3}
                        maxLength={500}
                      />
                    </div>
                  </div>
                )}

                {selectedNode && (
                  <div className="space-y-4">
                    <Badge variant="outline" className="capitalize">
                      {selectedNode.data.kind}
                    </Badge>
                    <div className="grid gap-2">
                      <Label htmlFor="node-label">Step label</Label>
                      <Input
                        id="node-label"
                        value={selectedNode.data.label}
                        onChange={(event) =>
                          updateSelectedNode({ label: event.target.value })
                        }
                        disabled={!editable}
                        maxLength={100}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="node-description">
                        Canvas description
                      </Label>
                      <Textarea
                        id="node-description"
                        value={selectedNode.data.description}
                        onChange={(event) =>
                          updateSelectedNode({
                            description: event.target.value,
                          })
                        }
                        disabled={!editable}
                        rows={3}
                        maxLength={240}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="node-instruction">
                        Agent instruction
                      </Label>
                      <Textarea
                        id="node-instruction"
                        value={selectedNode.data.instruction}
                        onChange={(event) =>
                          updateSelectedNode({
                            instruction: event.target.value,
                          })
                        }
                        disabled={!editable}
                        rows={8}
                        maxLength={2000}
                      />
                      <p className="text-xs text-muted-foreground">
                        Describe observable behavior and evidence rules, not
                        private reasoning.
                      </p>
                    </div>
                  </div>
                )}

                {selectedEdge && (
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="edge-label">Branch condition</Label>
                      <Textarea
                        id="edge-label"
                        value={
                          typeof selectedEdge.label === "string"
                            ? selectedEdge.label
                            : (selectedEdge.data?.label ?? "")
                        }
                        onChange={(event) =>
                          updateSelectedEdgeLabel(event.target.value)
                        }
                        disabled={!editable}
                        rows={4}
                        maxLength={160}
                        placeholder="Evidence is sufficient"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Decision-node branches require unique labels before
                      testing.
                    </p>
                  </div>
                )}

                {(selectedNode || selectedEdge) && editable && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full">
                        <Trash2 /> Delete {selectedNode ? "step" : "branch"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete this {selectedNode ? "step" : "branch"}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This changes only the unsaved draft. Save the flow to
                          persist it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={removeSelection}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Validation</h3>
                    <Badge
                      variant={validation.valid ? "default" : "destructive"}
                    >
                      {validation.valid
                        ? "Ready"
                        : `${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                  {validation.valid ? (
                    <p className="text-xs text-muted-foreground">
                      The graph can compile and move to the next lifecycle
                      stage.
                    </p>
                  ) : (
                    <ul className="space-y-2 text-xs text-muted-foreground">
                      {validation.issues.map((issue, index) => (
                        <li
                          key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
                          className="flex gap-2"
                        >
                          <TriangleAlert className="mt-0.5 size-3 shrink-0 text-destructive" />
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <History className="size-4" /> Recent activity
                  </h3>
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No activity recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {events.slice(0, 6).map((event) => (
                        <div key={event.id} className="border-l-2 pl-3 text-xs">
                          <div className="font-medium capitalize">
                            {eventLabel(event.event_type)}
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            {new Intl.DateTimeFormat("en", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(event.created_at))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {version.status !== "archived" &&
                  permissions.canEdit &&
                  (version.status !== "production" ||
                    permissions.canControl) && (
                    <>
                      <Separator />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            className="w-full"
                            disabled={isPending}
                          >
                            <Trash2 /> Archive version
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Archive version {version.version}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Archived versions stay in audit history and cannot
                              be edited or promoted.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => moveTo("archived")}
                            >
                              Archive
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck /> Runtime boundary
          </CardTitle>
          <CardDescription>
            Production makes this version eligible for explicit agent
            attachment. It does not automatically replace a playbook, execute
            tools, or send a response.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Compiles to agent
            instructions
          </div>
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-primary" /> Read-only tools only
          </div>
          <div className="flex items-center gap-2">
            <UserCheck className="size-4 text-primary" /> Human approval before
            effects
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function AgentFlowBuilder(props: Props) {
  return (
    <ReactFlowProvider>
      <BuilderCanvas {...props} />
    </ReactFlowProvider>
  )
}
