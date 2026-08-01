"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Bot,
  GitBranch,
  Plus,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AgentFlowStatus, AgentFlowSummary } from "@/lib/agent-flows"
import { createAgentFlowAction } from "../agent-flow-actions"

type Props = {
  flows: AgentFlowSummary[]
  canCreate: boolean
}

const STATUS_VARIANTS: Record<
  AgentFlowStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  testing: "secondary",
  approved: "default",
  production: "default",
  archived: "outline",
}

function CreateAgentFlowDialog({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isPending, startTransition] = useTransition()

  function createFlow() {
    startTransition(async () => {
      const result = await createAgentFlowAction({ name, description })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Agent Flow created")
      setOpen(false)
      router.push(
        `/knowledge/flows/${result.flowId}?version=${result.versionId}`
      )
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!canCreate}>
          <Plus data-icon="inline-start" /> New Agent Flow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an Agent Flow</DialogTitle>
          <DialogDescription>
            Start with RevFactor&apos;s safe response workflow, then change its
            nodes and branches.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="agent-flow-name">Name</Label>
            <Input
              id="agent-flow-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Negative performance response"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="agent-flow-description">Description</Label>
            <Textarea
              id="agent-flow-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="How the agent should frame weak performance and route risk."
              maxLength={500}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter showCloseButton>
          <Button
            onClick={createFlow}
            disabled={isPending || name.trim().length < 2}
          >
            {isPending ? "Creating…" : "Create flow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AgentFlowsPanel({ flows, canCreate }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Agent Flows</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build n8n-style decision maps that compile into governed
            instructions for RevFactor agents.
          </p>
        </div>
        <CreateAgentFlowDialog canCreate={canCreate} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow /> Visual and editable
            </CardTitle>
            <CardDescription>
              Drag steps, connect branches, and inspect every instruction.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck /> Governed lifecycle
            </CardTitle>
            <CardDescription>
              Test and approve immutable versions before production.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot /> Agent-readable
            </CardTitle>
            <CardDescription>
              Each valid graph compiles into observable operating instructions.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {flows.length === 0 ? (
        <Card className="border-dashed bg-muted/20 shadow-none">
          <CardHeader className="items-center py-8 text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <GitBranch className="size-6" />
            </div>
            <CardTitle>No Agent Flows yet</CardTitle>
            <CardDescription className="max-w-md">
              Create the first flow to map how evidence, decisions,
              negative-performance framing, and human review fit together.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {flows.map((flow) => (
            <Card key={flow.id}>
              <CardHeader>
                <CardTitle>{flow.name}</CardTitle>
                <CardDescription>
                  {flow.description || "No description yet."}
                </CardDescription>
                <CardAction>
                  {flow.latest_status ? (
                    <Badge
                      variant={STATUS_VARIANTS[flow.latest_status]}
                      className={
                        flow.latest_status === "production"
                          ? "bg-emerald-600 text-white"
                          : undefined
                      }
                    >
                      v{flow.latest_version} · {flow.latest_status}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No version</Badge>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4 border-t pt-5">
                <span className="text-xs text-muted-foreground">
                  Updated{" "}
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                  }).format(new Date(flow.updated_at))}
                </span>
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/knowledge/flows/${flow.id}${flow.latest_version_id ? `?version=${flow.latest_version_id}` : ""}`}
                  >
                    Open builder <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
