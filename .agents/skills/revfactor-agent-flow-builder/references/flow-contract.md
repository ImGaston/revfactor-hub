# RevFactor Agent Flow Contract

## Graph envelope

Persist one complete JSON object per version:

```ts
type AgentFlowGraph = {
  version: 1
  nodes: AgentFlowNode[]
  edges: AgentFlowEdge[]
  viewport: { x: number; y: number; zoom: number }
}
```

Node positions and data must be serializable. The React component registry stays in code.

## Allowed node families

| Family         | Purpose                                                   | Runtime boundary          |
| -------------- | --------------------------------------------------------- | ------------------------- |
| Trigger        | Starts from a client message, shadow event, or evaluation | Input only                |
| Context        | Loads permitted client or conversation context            | Read-only                 |
| Knowledge      | Searches approved Knowledge                               | Read-only                 |
| PriceLabs      | Loads permitted revenue data                              | Read-only                 |
| Decision       | Routes on an observable condition                         | No hidden reasoning trace |
| Draft          | Produces or transforms an internal response draft         | Never sends               |
| Brainstorm     | Flags weak performance or ambiguity for internal review   | Internal only             |
| Escalation     | Packages verified context for a human                     | Internal only             |
| Human approval | Blocks a future side effect pending a named approver      | Required before effects   |
| Output         | Ends with an internal draft, clarification, or escalation | Terminal                  |

Do not implement arbitrary code, database-query, shell, or unrestricted HTTP nodes.

## Required invariants

- Exactly one trigger.
- At least one output.
- All IDs are unique and every edge references existing nodes.
- No self-edges or duplicate source/target pairs.
- Every node is reachable from the trigger.
- Output nodes have no outgoing edges.
- Decision nodes have at least two outgoing edges with unique, non-empty labels.
- Cycles are rejected for the initial implementation.
- Maximum 50 nodes and 100 edges.

## Lifecycle

| Current            | Next       | Required permission                            |
| ------------------ | ---------- | ---------------------------------------------- |
| draft              | testing    | `knowledge:edit`                               |
| testing            | approved   | `knowledge:publish`                            |
| approved           | production | `knowledge:publish` and `agent_studio:control` |
| any non-production | archived   | `knowledge:edit`                               |
| production         | archived   | `agent_studio:control`                         |

Testing, approved, production, and archived snapshots are immutable. Create a new draft version to revise them. Only one production version may exist for a flow.

## Compilation

Compilation produces an observable instruction document containing:

1. flow name and version,
2. allowed step sequence,
3. branch labels and destinations,
4. tool and safety boundaries,
5. terminal outcomes.

It must not include chain-of-thought, hidden scratchpads, or instructions to reveal internal reasoning.
