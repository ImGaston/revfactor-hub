"use client"

import { FormEvent, KeyboardEvent, useMemo, useState, useTransition } from "react"
import {
  Bot,
  BookOpen,
  Copy,
  Database,
  FlaskConical,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wrench,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
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
  EmptyContent,
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
import { ScrollArea } from "@/components/ui/scroll-area"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  AGENT_STUDIO_MODELS,
  DEFAULT_AGENT_STUDIO_INSTRUCTIONS,
  DEFAULT_AGENT_STUDIO_MODEL,
  SYNTHETIC_CLIENT_ID,
  getAgentStudioModel,
  isAgentStudioModelId,
  type AgentStudioClientOption,
  type AgentStudioHistoryMessage,
  type AgentStudioModelId,
  type AgentStudioRun,
} from "@/lib/agent-studio"
import type { AgentPlaybookVersionSummary } from "@/lib/agent-studio-governance"
import { cn } from "@/lib/utils"
import { runAgentStudio } from "./actions"
import { submitRunFeedbackAction } from "./governance-actions"

type StudioMessage = AgentStudioHistoryMessage & {
  id: string
  run?: AgentStudioRun
  failed?: boolean
}

const EXAMPLE_PROMPTS = [
  "Why is my occupancy below the market for the next 30 days?",
  "Can you lower my minimum price for this weekend?",
  "What does market penetration index mean?",
]

function formatCost(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`
}

function dispositionVariant(disposition: AgentStudioRun["disposition"]) {
  if (disposition === "escalate") return "destructive" as const
  if (disposition === "clarify") return "secondary" as const
  return "outline" as const
}

function ConversationMessage({ message }: { message: StudioMessage }) {
  const isUser = message.role === "user"
  const failed = message.failed === true

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <Card
        size="sm"
        className={cn("max-w-[88%]", failed && "border-destructive/40")}
      >
        <CardHeader>
          <CardTitle
            className={cn(
              "flex items-center gap-2",
              failed && "text-destructive"
            )}
          >
            {isUser ? <UserRound /> : failed ? <TriangleAlert /> : <Bot />}
            {isUser ? "Client" : failed ? "Run failed" : "RevFactor draft"}
          </CardTitle>
          {message.run && (
            <CardAction className="flex items-center gap-1.5">
              <Badge variant={dispositionVariant(message.run.disposition)}>
                {message.run.disposition}
              </Badge>
              <Badge variant="outline">{message.run.confidence}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "prose prose-sm max-w-none wrap-anywhere dark:prose-invert",
              failed && "text-destructive"
            )}
          >
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function RunInspector({ run }: { run: AgentStudioRun | null }) {
  if (!run) {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Wrench />
          </EmptyMedia>
          <EmptyTitle>No run selected</EmptyTitle>
          <EmptyDescription>
            Send a test message to inspect tools, sources, token usage, and
            estimated cost.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const model = getAgentStudioModel(run.modelId)

  return (
    <Tabs defaultValue="run">
      <TabsList className="w-full">
        <TabsTrigger value="run">Run</TabsTrigger>
        <TabsTrigger value="cost">Cost</TabsTrigger>
        <TabsTrigger value="sources">
          Sources
          <Badge variant="outline">{run.sources.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
      </TabsList>

      <TabsContent value="run" className="flex flex-col gap-4 pt-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>{model.label}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Disposition</dt>
                <dd className="mt-1 capitalize">{run.disposition}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className="mt-1 capitalize">{run.confidence}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Duration</dt>
                <dd className="mt-1 font-mono">
                  {formatDuration(run.durationMs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Est. cost</dt>
                <dd className="mt-1 font-mono">
                  {formatCost(run.usage.estimatedCostUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Input</dt>
                <dd className="mt-1 font-mono">
                  {run.usage.inputTokens.toLocaleString()} tokens
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Output</dt>
                <dd className="mt-1 font-mono">
                  {run.usage.outputTokens.toLocaleString()} tokens
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cached input</dt>
                <dd className="mt-1 font-mono">
                  {run.usage.cachedInputTokens.toLocaleString()} tokens
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reasoning</dt>
                <dd className="mt-1 font-mono">
                  {run.usage.reasoningTokens.toLocaleString()} tokens
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {run.escalationReason && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Escalation</AlertTitle>
            <AlertDescription>{run.escalationReason}</AlertDescription>
          </Alert>
        )}

        {run.reviewNotes.length > 0 && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Reviewer notes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground">
                {run.reviewNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

      </TabsContent>

      <TabsContent value="cost" className="pt-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Same-token model estimates</CardTitle>
            <CardDescription>
              What this run would cost at current Gateway rates if every model
              used the same token counts. Actual reruns may use different
              tokenization and output lengths.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Input / output</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.modelEstimates
                  .slice()
                  .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)
                  .map((estimate) => (
                    <TableRow key={estimate.modelId}>
                      <TableCell>
                        {getAgentStudioModel(estimate.modelId).label}
                        {estimate.modelId === run.modelId && (
                          <Badge variant="secondary">Used</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        ${estimate.inputUsdPerMillion}/$
                        {estimate.outputUsdPerMillion} per M
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCost(estimate.estimatedCostUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="sources" className="flex flex-col gap-3 pt-2">
        {run.sources.length > 0 ? (
          run.sources.map((source) => (
            <Card key={source.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {source.title}
                  <Badge variant="outline">{source.type ?? "knowledge"}</Badge>
                </CardTitle>
                <CardDescription>{source.excerpt}</CardDescription>
              </CardHeader>
              <CardContent>
                {source.warning && (
                  <Alert>
                    <TriangleAlert />
                    <AlertTitle>Source warning</AlertTitle>
                    <AlertDescription>{source.warning}</AlertDescription>
                  </Alert>
                )}
                {source.payload && (
                  <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-muted p-3 text-xs wrap-anywhere">
                    {JSON.stringify(source.payload, null, 2)}
                  </pre>
                )}
              </CardContent>
              {source.slug && (
                <CardFooter>
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/knowledge/${source.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <BookOpen data-icon="inline-start" />
                      Open source
                    </a>
                  </Button>
                </CardFooter>
              )}
            </Card>
          ))
        ) : (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen />
              </EmptyMedia>
              <EmptyTitle>No knowledge sources</EmptyTitle>
              <EmptyDescription>
                This run did not retrieve a published Knowledge article.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>

      <TabsContent value="trace" className="pt-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Tool trace</CardTitle>
            <CardDescription>
              Sanitized inputs and outputs for every model-selected tool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {run.toolCalls.length > 0 ? (
              <div className="flex flex-col gap-4">
                {run.toolCalls.map((toolCall) => (
                  <div key={toolCall.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary">
                        <Wrench data-icon="inline-start" />
                        {toolCall.name}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {toolCall.resultSummary}
                      </span>
                    </div>
                    <pre className="max-h-64 overflow-auto rounded-2xl bg-muted p-3 text-xs wrap-anywhere">
                      {JSON.stringify(
                        {
                          input: toolCall.input,
                          output: toolCall.output ?? {},
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                The model used only the server-supplied context shown under
                Sources.
              </p>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

function RunFeedback({ run }: { run: AgentStudioRun }) {
  const [rating, setRating] = useState("5")
  const [lessonAction, setLessonAction] = useState("none")
  const [notes, setNotes] = useState("")
  const [correctedResponse, setCorrectedResponse] = useState("")
  const [isSaving, startSaving] = useTransition()

  if (!run.conversationId) return null

  function saveFeedback() {
    startSaving(async () => {
      const result = await submitRunFeedbackAction({
        runId: run.id,
        conversationId: run.conversationId,
        overallRating: Number(rating),
        correctedResponse: correctedResponse || null,
        notes: notes || null,
        lessonAction,
      })
      if (result.ok) {
        toast.success(
          lessonAction === "knowledge"
            ? "Feedback saved and Knowledge draft created"
            : "Feedback saved"
        )
      }
      else toast.error(result.error)
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Rate this conversation</CardTitle>
        <CardDescription>
          Ratings create reviewable lessons; they never change production
          behavior automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Overall rating</FieldLabel>
            <ToggleGroup
              type="single"
              value={rating}
              onValueChange={(value) => {
                if (value) setRating(value)
              }}
              variant="outline"
              className="w-full"
              aria-label="Overall rating"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={String(value)}
                  className="flex-1"
                  aria-label={`${value} out of 5`}
                >
                  {value}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="feedback-lesson">Turn into</FieldLabel>
            <Select value={lessonAction} onValueChange={setLessonAction}>
              <SelectTrigger id="feedback-lesson" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Rating only</SelectItem>
                  <SelectItem value="example">Good example</SelectItem>
                  <SelectItem value="regression">Regression test</SelectItem>
                  <SelectItem value="knowledge">Knowledge change</SelectItem>
                  <SelectItem value="instruction">Playbook change</SelectItem>
                  <SelectItem value="data_issue">Data issue</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="feedback-correction">
              Corrected response
            </FieldLabel>
            <Textarea
              id="feedback-correction"
              value={correctedResponse}
              onChange={(event) => setCorrectedResponse(event.target.value)}
              placeholder={
                lessonAction === "knowledge"
                  ? "Required: the client-safe answer to review"
                  : "Optional reviewed answer"
              }
            />
            {lessonAction === "knowledge" && (
              <FieldDescription>
                This creates a disabled FAQ draft in Knowledge. A publisher
                must review and enable it before Agent Studio can retrieve it.
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="feedback-notes">Reviewer notes</FieldLabel>
            <Textarea
              id="feedback-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What was right, wrong, or missing?"
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button onClick={saveFeedback} disabled={isSaving}>
          {isSaving && <Spinner data-icon="inline-start" />}
          Save feedback
        </Button>
      </CardFooter>
    </Card>
  )
}

export function AgentStudio({
  clients,
  gatewayConfigured,
  playbookVersions,
}: {
  clients: AgentStudioClientOption[]
  gatewayConfigured: boolean
  playbookVersions: AgentPlaybookVersionSummary[]
}) {
  const initialPlaybook =
    playbookVersions.find((version) => version.status === "production") ??
    playbookVersions.find((version) => version.status === "approved") ??
    playbookVersions.find((version) => version.status === "testing") ??
    playbookVersions[0] ??
    null
  const [clientId, setClientId] = useState(SYNTHETIC_CLIENT_ID)
  const [modelId, setModelId] = useState<AgentStudioModelId>(
    initialPlaybook?.modelId ?? DEFAULT_AGENT_STUDIO_MODEL
  )
  const [instructions, setInstructions] = useState(
    initialPlaybook?.instructions ?? DEFAULT_AGENT_STUDIO_INSTRUCTIONS
  )
  const [playbookVersionId, setPlaybookVersionId] = useState(
    initialPlaybook?.id ?? "session"
  )
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState<StudioMessage[]>([])
  const [activeRun, setActiveRun] = useState<AgentStudioRun | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedModel = useMemo(
    () => getAgentStudioModel(modelId),
    [modelId]
  )

  function resetConversation() {
    setMessages([])
    setActiveRun(null)
    setMessage("")
    setConversationId(null)
  }

  function copyDraft() {
    if (!activeRun) return
    void navigator.clipboard.writeText(activeRun.reply)
    toast.success("Draft copied")
  }

  async function submitMessage(nextMessage: string) {
    const cleanMessage = nextMessage.trim()
    if (!cleanMessage || isPending) return

    const history = messages
      .filter((item) => !item.failed)
      .map(({ role, content }) => ({ role, content }))
    const userMessage: StudioMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanMessage,
    }

    setMessages((current) => [...current, userMessage])
    setMessage("")

    let result: Awaited<ReturnType<typeof runAgentStudio>>
    try {
      result = await runAgentStudio({
        clientId,
        modelId,
        playbookVersionId:
          playbookVersionId === "session" ? null : playbookVersionId,
        conversationId,
        instructions,
        message: cleanMessage,
        history,
      })
    } catch {
      const errorMessage =
        "The Studio run failed before it could return a result. Check the server configuration and try again."
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorMessage,
          failed: true,
        },
      ])
      setActiveRun(null)
      toast.error(errorMessage)
      return
    }

    if (!result.ok) {
      setMessages((current) => [
        ...current,
        {
          id: result.runId ?? crypto.randomUUID(),
          role: "assistant",
          content: result.error,
          failed: true,
        },
      ])
      setActiveRun(null)
      setConversationId(result.conversationId ?? conversationId)
      toast.error(result.error)
      return
    }

    const assistantMessage: StudioMessage = {
      id: result.run.id,
      role: "assistant",
      content: result.run.reply,
      run: result.run,
    }

    setMessages((current) => [...current, assistantMessage])
    setActiveRun(result.run)
    setConversationId(result.run.conversationId ?? null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextMessage = message
    startTransition(() => {
      void submitMessage(nextMessage)
    })
  }

  function handleComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  function changeClient(value: string) {
    setClientId(value)
    resetConversation()
  }

  function changeModel(value: string) {
    if (!isAgentStudioModelId(value)) return
    setModelId(value)
    resetConversation()
  }

  function changePlaybook(value: string) {
    setPlaybookVersionId(value)
    if (value === "session") {
      setInstructions(DEFAULT_AGENT_STUDIO_INSTRUCTIONS)
      setModelId(DEFAULT_AGENT_STUDIO_MODEL)
    } else {
      const version = playbookVersions.find((item) => item.id === value)
      if (version) {
        setInstructions(version.instructions)
        setModelId(version.modelId)
      }
    }
    resetConversation()
  }

  function changeInstructions(value: string) {
    setInstructions(value)
    if (playbookVersionId !== "session") {
      setPlaybookVersionId("session")
    }
    resetConversation()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Agent Studio</h1>
            <Badge variant="secondary">
              <FlaskConical data-icon="inline-start" />
              Sandbox
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Test RevFactor client-service drafts with controlled data and
            read-only tools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeRun && (
            <Button variant="outline" size="sm" onClick={copyDraft}>
              <Copy data-icon="inline-start" />
              Copy draft
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={resetConversation}>
            <RotateCcw data-icon="inline-start" />
            New conversation
          </Button>
        </div>
      </div>

      {!gatewayConfigured && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>AI Gateway setup required</AlertTitle>
          <AlertDescription>
            Add <code>AI_GATEWAY_API_KEY</code> to <code>.env.local</code> to
            run models locally. Vercel deployments can authenticate through
            OIDC.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <ShieldCheck />
        <AlertTitle>Safe sandbox</AlertTitle>
        <AlertDescription>
          Agent Studio cannot send Assembly messages or modify client data.
          Published Knowledge articles are available for internal testing but
          are not yet classified as customer-safe.
        </AlertDescription>
      </Alert>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Choose a model and active client for this browser session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="studio-playbook">Playbook</FieldLabel>
                <Select
                  value={playbookVersionId}
                  onValueChange={changePlaybook}
                >
                  <SelectTrigger id="studio-playbook" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="session">
                        Session draft · custom
                      </SelectItem>
                      {playbookVersions
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
                <FieldDescription>
                  {playbookVersions.filter(
                    (version) => version.status !== "archived"
                  ).length} saved version(s). Create and version more from the
                  Playbooks tab.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>Model</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={modelId}
                  onValueChange={(value) => {
                    if (value) changeModel(value)
                  }}
                  orientation="vertical"
                  variant="outline"
                  className="w-full"
                  aria-label="Choose an AI model"
                >
                  {AGENT_STUDIO_MODELS.map((model) => (
                    <ToggleGroupItem
                      key={model.id}
                      value={model.id}
                      className="w-full justify-start"
                      aria-label={model.label}
                    >
                      {model.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>
                  {selectedModel.description}. ${selectedModel.inputUsdPerMillion}
                  /M input, ${selectedModel.outputUsdPerMillion}/M output.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="studio-client">Client context</FieldLabel>
                <Select value={clientId} onValueChange={changeClient}>
                  <SelectTrigger id="studio-client" className="w-full">
                    <SelectValue placeholder="Choose a client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                          {client.synthetic ? " · Synthetic" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Real client data is loaded read-only through your existing
                  permissions.
                </FieldDescription>
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="studio-instructions">
                    Draft instructions
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      changeInstructions(DEFAULT_AGENT_STUDIO_INSTRUCTIONS)
                    }
                  >
                    Reset
                  </Button>
                </div>
                <Textarea
                  id="studio-instructions"
                  value={instructions}
                  onChange={(event) => changeInstructions(event.target.value)}
                  className="min-h-72"
                />
                <FieldDescription>
                  Security rules remain fixed even when these draft
                  instructions change.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles />
              Test conversation
            </CardTitle>
            <CardDescription>
              The client never sees messages generated here.
            </CardDescription>
            <CardAction className="flex flex-wrap justify-end gap-2">
              <Badge variant="secondary">
                <Bot data-icon="inline-start" />
                {selectedModel.label}
              </Badge>
              <Badge variant="outline">
                <Database data-icon="inline-start" />
                {clients.find((client) => client.id === clientId)?.name}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="min-w-0">
            <ScrollArea className="h-[520px] pr-3">
              {messages.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {messages.map((conversationMessage) => (
                    <ConversationMessage
                      key={conversationMessage.id}
                      message={conversationMessage}
                    />
                  ))}
                  {isPending && (
                    <div className="flex justify-start">
                      <Card size="sm">
                        <CardContent className="flex items-center gap-2">
                          <Spinner />
                          <span className="text-muted-foreground">
                            Running tools and preparing a draft…
                          </span>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              ) : (
                <Empty className="h-[500px]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Bot />
                    </EmptyMedia>
                    <EmptyTitle>Start a test conversation</EmptyTitle>
                    <EmptyDescription>
                      Ask as the selected client, or try one of these common
                      RevFactor scenarios.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {EXAMPLE_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt}
                        type="button"
                        variant="outline"
                        className="h-auto w-full whitespace-normal py-2"
                        onClick={() =>
                          startTransition(() => {
                            void submitMessage(prompt)
                          })
                        }
                      >
                        {prompt}
                      </Button>
                    ))}
                  </EmptyContent>
                </Empty>
              )}
            </ScrollArea>
          </CardContent>
          <CardFooter className="border-t">
            <form className="flex w-full items-end gap-2" onSubmit={handleSubmit}>
              <Field>
                <FieldLabel htmlFor="studio-message" className="sr-only">
                  Client message
                </FieldLabel>
                <Textarea
                  id="studio-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Write a client message…"
                  className="min-h-20"
                  disabled={isPending}
                />
                <FieldDescription>
                  Press ⌘ Enter or Ctrl Enter to run.
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                size="icon"
                disabled={isPending || message.trim().length === 0}
                aria-label="Run agent"
              >
                {isPending ? (
                  <Spinner />
                ) : (
                  <Send data-icon="inline-start" />
                )}
              </Button>
            </form>
          </CardFooter>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Inspector</CardTitle>
            <CardDescription>
              Review what happened before trusting a draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <RunInspector run={activeRun} />
              {activeRun && <RunFeedback run={activeRun} />}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
