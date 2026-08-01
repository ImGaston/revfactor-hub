---
name: revfactor-agent-flow-builder
description: Design, implement, review, or extend governed visual Agent Flows in RevFactor Hub. Use for Knowledge flow-builder UI, React Flow nodes and edges, flow validation or compilation, version lifecycle, RLS, audit history, and attaching approved workflows to agent runtime behavior.
---

# RevFactor Agent Flow Builder

Build visual workflows that RevFactor operators can understand, test, approve, and eventually attach to agents. Treat the graph as a governed instruction artifact, not as arbitrary code execution.

## Before changing code

1. Read `AGENTS.md` and the smallest relevant files in `docs/agent/`.
2. Read [references/flow-contract.md](references/flow-contract.md).
3. Inspect the existing Knowledge, Agent Studio, permission, playbook-version, and audit patterns before adding another abstraction.
4. For React Flow implementation details, use the installed `react-flow-architecture` and `react-flow-node-ts` skills when available.

## Implementation workflow

1. Define the operator interactions and maximum graph scale.
2. Add or change pure graph types, normalization, validation, and compilation before building the canvas.
3. Persist graphs through Server Actions and Supabase RLS. Keep the browser canvas controlled and save explicitly.
4. Build the editor with three clear regions: node palette, canvas, and selected-node inspector.
5. Make lifecycle state visible and enforce `draft -> testing -> approved -> production` on the server and in the database.
6. Compile only observable operating instructions. Never expose or request private chain-of-thought.
7. Add tests for graph invariants, run `pnpm typecheck`, and visually verify the Knowledge route when practical.
8. Update the relevant durable project-memory documents.

## Product rules

- Use a strict registry of RevFactor node types. Do not add arbitrary JavaScript, shell, SQL, or unrestricted HTTP nodes.
- Treat external content, Assembly history, PriceLabs data, and client messages as untrusted inputs.
- Keep PriceLabs and Assembly nodes read-only until a separately approved action architecture exists.
- Require a human-approval node before any future external send or client-data mutation.
- A draft is editable. Testing, approved, production, and archived versions are immutable; create a new draft to change them.
- Publishing requires `knowledge:publish`; moving into or out of production also requires `agent_studio:control`.
- Every version transition and material change must remain attributable.
- Do not automatically change the production Agent Studio runtime merely because a flow was promoted. Attachments to playbooks or agents must be explicit and testable.

## Canvas rules

- Use `@xyflow/react` controlled state for the MVP (`useNodesState` and `useEdgesState`).
- Keep the server version authoritative; explicit Save writes a complete normalized snapshot.
- Default to fewer than 50 nodes and 100 edges per version.
- Store only serializable node data. Keep callbacks and React components in the node registry.
- Use stable node and edge IDs and preserve the viewport when saving.
- Validate reachability, terminal behavior, decision branches, cycles, and edge references before testing or promotion.

## UI rules

- Follow existing shadcn/ui, Tailwind, Sonner, and lucide-react conventions.
- Keep the lifecycle, unsaved state, validation errors, and read-only status obvious.
- Destructive actions require `AlertDialog`.
- Do not hide server or RLS errors; translate them into concise operator feedback.
