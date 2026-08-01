import { describe, expect, it } from "vitest"

import {
  compileAgentFlow,
  DEFAULT_AGENT_FLOW_GRAPH,
  normalizeAgentFlowGraph,
  validateAgentFlowGraph,
} from "@/lib/agent-flows"

describe("Agent Flow graph", () => {
  it("accepts and compiles the governed starter flow", () => {
    const result = validateAgentFlowGraph(DEFAULT_AGENT_FLOW_GRAPH)
    expect(result).toEqual({ valid: true, issues: [] })

    const compiled = compileAgentFlow(
      "Client performance response",
      1,
      DEFAULT_AGENT_FLOW_GRAPH
    )
    expect(compiled).toContain("[Agent Flow: Client performance response v1]")
    expect(compiled).toContain("Negative performance needs framing")
    expect(compiled).toContain("Do not reveal private reasoning")
  })

  it("rejects missing decision labels and unreachable nodes", () => {
    const graph = structuredClone(DEFAULT_AGENT_FLOW_GRAPH)
    graph.edges = graph.edges
      .filter((edge) => edge.target !== "human-escalation")
      .map((edge) =>
        edge.source === "route-response" && edge.target === "draft-answer"
          ? { ...edge, label: null }
          : edge
      )

    const result = validateAgentFlowGraph(graph)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain("decision_label")
    expect(result.issues.map((issue) => issue.code)).toContain("unreachable")
  })

  it("normalizes unsafe or malformed values into the serializable contract", () => {
    const graph = normalizeAgentFlowGraph({
      nodes: [
        {
          id: "draft node",
          position: { x: Number.NaN, y: 20 },
          data: {
            kind: "shell",
            label: "",
            instruction: "Write a safe draft.",
          },
        },
      ],
      edges: [{ source: "missing", target: "draft-node" }],
    })

    expect(graph.nodes[0]).toMatchObject({
      id: "draft-node",
      type: "agentStep",
      position: { x: 80, y: 20 },
      data: { kind: "draft", label: "Draft response" },
    })
    expect(graph.edges).toEqual([])
  })
})
