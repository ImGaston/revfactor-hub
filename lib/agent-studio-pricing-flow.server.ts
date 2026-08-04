import { Annotation, END, START, StateGraph } from "@langchain/langgraph"

export const PRICING_PERFORMANCE_PILOT_ID =
  "pricing-performance-langgraph-pilot-v1"

export type PricingPerformanceEvidence = {
  listingCount: number
  hasForwardPerformanceMetrics: boolean
  hasPriceLabsReport: boolean
}

export type PricingPerformanceFlowOutput = {
  disposition: "answer" | "clarify" | "escalate"
  reply: string
  confidence: "low" | "medium" | "high"
  escalationReason: string | null
  reviewNotes: string[]
}

export type PricingPerformanceFlowStep = {
  id: string
  label: string
  outcome: string
  summary: string
  durationMs: number
}

export type PricingPerformanceFlowResult<TGeneration> = {
  flowId: typeof PRICING_PERFORMANCE_PILOT_ID
  output: PricingPerformanceFlowOutput
  generation: TGeneration | null
  steps: PricingPerformanceFlowStep[]
}

const PERFORMANCE_TERMS = [
  "adr",
  "average daily rate",
  "base price",
  "booking pace",
  "bookings",
  "forecast",
  "market penetration",
  "minimum price",
  "mpi",
  "occupancy",
  "performance",
  "price",
  "pricing",
  "rate",
  "revenue",
  "revpar",
]

export function isPricingPerformanceRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return PERFORMANCE_TERMS.some((term) => normalized.includes(term))
}

export function hasPricingPerformanceEvidence(
  evidence: PricingPerformanceEvidence
): boolean {
  return (
    evidence.listingCount > 0 &&
    (evidence.hasForwardPerformanceMetrics || evidence.hasPriceLabsReport)
  )
}

function step(
  id: string,
  label: string,
  outcome: string,
  summary: string,
  startedAt: number
): PricingPerformanceFlowStep {
  return {
    id,
    label,
    outcome,
    summary,
    durationMs: Date.now() - startedAt,
  }
}

export async function runPricingPerformancePilot<TGeneration>({
  message,
  evidence,
  generateDraft,
  readOutput,
}: {
  message: string
  evidence: PricingPerformanceEvidence
  generateDraft: () => Promise<TGeneration>
  readOutput: (generation: TGeneration) => PricingPerformanceFlowOutput
}): Promise<PricingPerformanceFlowResult<TGeneration>> {
  const FlowState = Annotation.Root({
    message: Annotation<string>,
    evidence: Annotation<PricingPerformanceEvidence>,
    intent: Annotation<"pricing_performance" | "outside_pilot" | null>,
    evidenceStatus: Annotation<"sufficient" | "insufficient" | null>,
    output: Annotation<PricingPerformanceFlowOutput | null>,
    generation: Annotation<TGeneration | null>,
    steps: Annotation<PricingPerformanceFlowStep[]>({
      reducer: (current, next) => current.concat(next),
      default: () => [],
    }),
  })

  const graph = new StateGraph(FlowState)
    .addNode("classify_intent", (state) => {
      const startedAt = Date.now()
      const intent = isPricingPerformanceRequest(state.message)
        ? "pricing_performance"
        : "outside_pilot"
      return {
        intent,
        steps: [
          step(
            "classify_intent",
            "Classify request",
            intent,
            intent === "pricing_performance"
              ? "The request is inside the Pricing & Performance pilot."
              : "The request is outside this pilot's approved scope.",
            startedAt
          ),
        ],
      }
    })
    .addNode("validate_evidence", (state) => {
      const startedAt = Date.now()
      const evidenceStatus = hasPricingPerformanceEvidence(state.evidence)
        ? "sufficient"
        : "insufficient"
      return {
        evidenceStatus,
        steps: [
          step(
            "validate_evidence",
            "Validate permitted evidence",
            evidenceStatus,
            evidenceStatus === "sufficient"
              ? "At least one listing has a permitted performance snapshot."
              : "The supplied context does not contain enough performance evidence.",
            startedAt
          ),
        ],
      }
    })
    .addNode("generate_draft", async () => {
      const startedAt = Date.now()
      const generation = await generateDraft()
      return {
        generation,
        output: readOutput(generation),
        steps: [
          step(
            "generate_draft",
            "Generate grounded draft",
            "completed",
            "The selected model generated an internal draft using read-only tools.",
            startedAt
          ),
        ],
      }
    })
    .addNode("outside_pilot", () => {
      const startedAt = Date.now()
      return {
        output: {
          disposition: "clarify" as const,
          reply:
            "This executable pilot currently covers pricing and performance questions only. Turn off the pilot to test this question with the standard Agent Studio runtime.",
          confidence: "high" as const,
          escalationReason: null,
          reviewNotes: ["No model call was made."],
        },
        steps: [
          step(
            "outside_pilot",
            "Stop outside approved scope",
            "clarify",
            "Execution stopped before any model call.",
            startedAt
          ),
        ],
      }
    })
    .addNode("insufficient_evidence", () => {
      const startedAt = Date.now()
      return {
        output: {
          disposition: "clarify" as const,
          reply:
            "I don’t have enough current pricing or performance data in the supplied context to answer this accurately. Please select a listing with a current PriceLabs snapshot or ask the team to refresh the report.",
          confidence: "high" as const,
          escalationReason: null,
          reviewNotes: [
            "The executable flow stopped before generation because evidence was insufficient.",
          ],
        },
        steps: [
          step(
            "insufficient_evidence",
            "Stop on insufficient evidence",
            "clarify",
            "Execution stopped before any model call.",
            startedAt
          ),
        ],
      }
    })
    .addNode("client_ready_check", (state) => {
      const startedAt = Date.now()
      const hasOutput = Boolean(state.output?.reply.trim())
      return {
        output: hasOutput
          ? state.output
          : {
              disposition: "escalate" as const,
              reply:
                "I couldn’t produce a reviewable pricing or performance draft. Please have a team member review this request.",
              confidence: "low" as const,
              escalationReason: "The pilot returned an empty draft.",
              reviewNotes: ["The client-ready check blocked an empty output."],
            },
        steps: [
          step(
            "client_ready_check",
            "Client-ready check",
            hasOutput ? "passed" : "blocked",
            hasOutput
              ? "A structured, reviewable internal draft is available."
              : "The flow replaced an empty result with a human escalation.",
            startedAt
          ),
        ],
      }
    })
    .addEdge(START, "classify_intent")
    .addConditionalEdges(
      "classify_intent",
      (state) =>
        state.intent === "pricing_performance"
          ? "validate_evidence"
          : "outside_pilot",
      ["validate_evidence", "outside_pilot"]
    )
    .addConditionalEdges(
      "validate_evidence",
      (state) =>
        state.evidenceStatus === "sufficient"
          ? "generate_draft"
          : "insufficient_evidence",
      ["generate_draft", "insufficient_evidence"]
    )
    .addEdge("generate_draft", "client_ready_check")
    .addEdge("client_ready_check", END)
    .addEdge("outside_pilot", END)
    .addEdge("insufficient_evidence", END)
    .compile({
      name: PRICING_PERFORMANCE_PILOT_ID,
      description:
        "Internal-only executable workflow for pricing and performance questions.",
    })

  const result = await graph.invoke({
    message,
    evidence,
    intent: null,
    evidenceStatus: null,
    output: null,
    generation: null,
    steps: [],
  })

  if (!result.output) {
    throw new Error("The Pricing & Performance pilot returned no output.")
  }

  return {
    flowId: PRICING_PERFORMANCE_PILOT_ID,
    output: result.output,
    generation: result.generation,
    steps: result.steps,
  }
}
