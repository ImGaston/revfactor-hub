export const AGENT_STUDIO_COACH_MODEL_ID = "google/gemini-3.5-flash-lite"

export type AgentWorkflowResponseType =
  | "all"
  | "answer"
  | "clarify"
  | "escalate"

export type AgentWorkflowNodeKind =
  | "input"
  | "process"
  | "decision"
  | "output"

export type AgentWorkflowNode = {
  id: string
  label: string
  kind: AgentWorkflowNodeKind
  responseType: AgentWorkflowResponseType
  instruction: string
}

export type AgentWorkflowEdge = {
  id: string
  source: string
  target: string
  condition: string | null
}

export type AgentWorkflow = {
  version: 1
  nodes: AgentWorkflowNode[]
  edges: AgentWorkflowEdge[]
}

export type AgentCoachObservation = {
  category: "data" | "reasoning" | "tone" | "policy" | "process"
  severity: "strength" | "suggestion" | "risk"
  title: string
  detail: string
  evidenceRunIds: string[]
}

export type AgentCoachReview = {
  reviewId: string
  modelId: string
  summary: string
  score: number
  observations: AgentCoachObservation[]
  teachingPoints: string[]
  suggestedInstructionPatch: string
  playbookName: string
  playbookDescription: string
  changeNote: string
  workflow: AgentWorkflow
  analyzedRunIds: string[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostUsd: number
  }
  durationMs: number
  createdAt: string
}

export type AgentCoachResult =
  | { ok: true; review: AgentCoachReview }
  | { ok: false; error: string }

export const DEFAULT_AGENT_WORKFLOW: AgentWorkflow = {
  version: 1,
  nodes: [
    {
      id: "classify-intent",
      label: "Classify intent",
      kind: "input",
      responseType: "all",
      instruction:
        "Identify the client's actual question and classify the required outcome as answer, clarify, or escalate.",
    },
    {
      id: "select-evidence",
      label: "Select evidence",
      kind: "process",
      responseType: "all",
      instruction:
        "Choose only relevant client, PriceLabs, Assembly, task, and approved Knowledge evidence.",
    },
    {
      id: "validate-sufficiency",
      label: "Validate sufficiency",
      kind: "decision",
      responseType: "all",
      instruction:
        "Check date grain, freshness, client scope, and whether the evidence directly supports the requested comparison.",
    },
    {
      id: "answer-branch",
      label: "Answer with evidence",
      kind: "process",
      responseType: "answer",
      instruction:
        "Lead with the direct answer, distinguish exact from approximate metrics, add the clearest interpretation, and state any material limitation.",
    },
    {
      id: "clarify-branch",
      label: "Ask one question",
      kind: "process",
      responseType: "clarify",
      instruction:
        "Explain what is known, identify the single missing fact that blocks a reliable answer, and ask one focused question.",
    },
    {
      id: "escalate-branch",
      label: "Escalate safely",
      kind: "process",
      responseType: "escalate",
      instruction:
        "Summarize the verified context and why human review is required without promising an outcome or response time.",
    },
    {
      id: "quality-check",
      label: "Client-ready check",
      kind: "output",
      responseType: "all",
      instruction:
        "Verify factual grounding, plain language, appropriate tone, no unsupported action claims, and a clear next step.",
    },
  ],
  edges: [
    {
      id: "classify-to-evidence",
      source: "classify-intent",
      target: "select-evidence",
      condition: null,
    },
    {
      id: "evidence-to-validate",
      source: "select-evidence",
      target: "validate-sufficiency",
      condition: null,
    },
    {
      id: "validate-to-answer",
      source: "validate-sufficiency",
      target: "answer-branch",
      condition: "Evidence is sufficient",
    },
    {
      id: "validate-to-clarify",
      source: "validate-sufficiency",
      target: "clarify-branch",
      condition: "One answerable fact is missing",
    },
    {
      id: "validate-to-escalate",
      source: "validate-sufficiency",
      target: "escalate-branch",
      condition: "Policy or risk requires human review",
    },
    {
      id: "answer-to-quality",
      source: "answer-branch",
      target: "quality-check",
      condition: null,
    },
    {
      id: "clarify-to-quality",
      source: "clarify-branch",
      target: "quality-check",
      condition: null,
    },
    {
      id: "escalate-to-quality",
      source: "escalate-branch",
      target: "quality-check",
      condition: null,
    },
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function responseType(value: unknown): AgentWorkflowResponseType {
  return value === "answer" || value === "clarify" || value === "escalate"
    ? value
    : "all"
}

function nodeKind(value: unknown): AgentWorkflowNodeKind {
  return value === "input" ||
    value === "decision" ||
    value === "output"
    ? value
    : "process"
}

export function normalizeAgentWorkflow(value: unknown): AgentWorkflow {
  if (!isRecord(value)) return structuredClone(DEFAULT_AGENT_WORKFLOW)

  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((rawNode) => {
        if (!isRecord(rawNode)) return []
        const id = typeof rawNode.id === "string" ? rawNode.id.trim() : ""
        const label =
          typeof rawNode.label === "string" ? rawNode.label.trim() : ""
        const instruction =
          typeof rawNode.instruction === "string"
            ? rawNode.instruction.trim()
            : ""
        if (!id || !label || !instruction) return []
        return [
          {
            id: id.slice(0, 80),
            label: label.slice(0, 120),
            kind: nodeKind(rawNode.kind),
            responseType: responseType(rawNode.responseType),
            instruction: instruction.slice(0, 1_200),
          },
        ]
      })
    : []

  if (nodes.length < 2) return structuredClone(DEFAULT_AGENT_WORKFLOW)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((rawEdge, index) => {
        if (!isRecord(rawEdge)) return []
        const source =
          typeof rawEdge.source === "string" ? rawEdge.source : ""
        const target =
          typeof rawEdge.target === "string" ? rawEdge.target : ""
        if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
          return []
        }
        return [
          {
            id:
              typeof rawEdge.id === "string" && rawEdge.id.trim()
                ? rawEdge.id.slice(0, 100)
                : `edge-${index + 1}`,
            source,
            target,
            condition:
              typeof rawEdge.condition === "string" &&
              rawEdge.condition.trim()
                ? rawEdge.condition.trim().slice(0, 240)
                : null,
          },
        ]
      })
    : []

  return { version: 1, nodes: nodes.slice(0, 16), edges: edges.slice(0, 24) }
}

const WORKFLOW_START = "[Studio workflow rules]"
const WORKFLOW_END = "[End Studio workflow rules]"

export function workflowToInstructions(workflow: AgentWorkflow): string {
  const normalized = normalizeAgentWorkflow(workflow)
  const sections: AgentWorkflowResponseType[] = [
    "all",
    "answer",
    "clarify",
    "escalate",
  ]
  const labels: Record<AgentWorkflowResponseType, string> = {
    all: "Every response",
    answer: "Answer responses",
    clarify: "Clarification responses",
    escalate: "Escalation responses",
  }

  return sections
    .map((section) => {
      const rules = normalized.nodes.filter(
        (node) => node.responseType === section
      )
      if (rules.length === 0) return ""
      return `${labels[section]}:\n${rules
        .map((node, index) => `${index + 1}. ${node.instruction}`)
        .join("\n")}`
    })
    .filter(Boolean)
    .join("\n\n")
}

export function applyCoachToInstructions({
  baseInstructions,
  instructionPatch,
  workflow,
}: {
  baseInstructions: string
  instructionPatch: string
  workflow: AgentWorkflow
}): string {
  const withoutExistingWorkflow = baseInstructions
    .replace(
      new RegExp(
        `${WORKFLOW_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${WORKFLOW_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "g"
      ),
      ""
    )
    .trim()
  const patch = instructionPatch.trim()
  const workflowRules = workflowToInstructions(workflow)
  const generatedGuidance = [
    patch ? `Coach-proposed guidance:\n${patch}` : "",
    `Workflow rules:\n${workflowRules}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  return [
    withoutExistingWorkflow,
    `${WORKFLOW_START}\n${generatedGuidance}\n${WORKFLOW_END}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000)
}
