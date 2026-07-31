import { describe, expect, it } from "vitest"

import {
  DEFAULT_AGENT_WORKFLOW,
  applyCoachToInstructions,
  normalizeCoachScore,
  normalizeAgentWorkflow,
  workflowToInstructions,
} from "@/lib/agent-studio-coach"

describe("normalizeAgentWorkflow", () => {
  it("falls back to the governed default for malformed workflows", () => {
    const workflow = normalizeAgentWorkflow({ nodes: [] })
    expect(workflow).toEqual(DEFAULT_AGENT_WORKFLOW)
    expect(workflow).not.toBe(DEFAULT_AGENT_WORKFLOW)
  })

  it("drops dangling edges and normalizes node enums", () => {
    const workflow = normalizeAgentWorkflow({
      nodes: [
        {
          id: "start",
          label: "Start",
          kind: "unexpected",
          responseType: "unexpected",
          instruction: "Begin safely.",
        },
        {
          id: "finish",
          label: "Finish",
          kind: "output",
          responseType: "answer",
          instruction: "Return the answer.",
        },
      ],
      edges: [
        { id: "valid", source: "start", target: "finish", condition: "Ready" },
        { id: "dangling", source: "missing", target: "finish" },
      ],
    })

    expect(workflow.nodes[0]).toMatchObject({
      kind: "process",
      responseType: "all",
    })
    expect(workflow.edges).toEqual([
      { id: "valid", source: "start", target: "finish", condition: "Ready" },
    ])
  })
})

describe("workflow instructions", () => {
  it("groups operating rules by response branch", () => {
    const rendered = workflowToInstructions(DEFAULT_AGENT_WORKFLOW)
    expect(rendered).toContain("Every response:")
    expect(rendered).toContain("Answer responses:")
    expect(rendered).toContain("Clarification responses:")
    expect(rendered).toContain("Escalation responses:")
  })

  it("replaces a prior generated workflow instead of stacking duplicates", () => {
    const first = applyCoachToInstructions({
      baseInstructions: "Base instructions.",
      instructionPatch: "Prefer explicit date-grain labels.",
      workflow: DEFAULT_AGENT_WORKFLOW,
    })
    const second = applyCoachToInstructions({
      baseInstructions: first,
      instructionPatch: "Keep the direct answer first.",
      workflow: DEFAULT_AGENT_WORKFLOW,
    })

    expect(second.match(/\[Studio workflow rules\]/g)).toHaveLength(1)
    expect(second).toContain("Keep the direct answer first.")
    expect(second).not.toContain("Prefer explicit date-grain labels.")
  })
})

describe("normalizeCoachScore", () => {
  it("accepts both five-point and percentage-style model scores", () => {
    expect(normalizeCoachScore(4)).toBe(4)
    expect(normalizeCoachScore(60)).toBe(3)
    expect(normalizeCoachScore(100)).toBe(5)
    expect(normalizeCoachScore(0)).toBe(1)
  })
})
