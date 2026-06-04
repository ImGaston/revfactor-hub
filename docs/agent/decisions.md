# Decisions — RevFactor Hub

Keep dated decisions here when they should shape future work. Include enough rationale to avoid relitigating the same choice.

## 2026-04-18 — No Page-Level ISR on Authenticated Routes
Authenticated route data should not use `export const revalidate = N`. The app has a tiny internal user base where stale data is noticeable, and auth-cookie cache segmentation limits hit rate. If a query later proves expensive and stable, use targeted cache tags instead.

## 2026-04-18 — Trim List Queries Instead of Adding Client Portfolio SQL View
For `/clients` and `/listings`, list payload trimming is preferred over adding `client_portfolio_summary` as a new SQL dependency. Current scale is small enough, and the view would add RLS/type maintenance surface.

## 2026-04-18 — Lazy-Fetch Dialog Lookup Data
Dialog-only lookup lists, such as clients in listing dialogs, should load when the dialog opens instead of during page load. This keeps common route loads lean while preserving full dialog behavior.

## 2026-04-18 — Keep Detail Pages Unsplintered Unless a Specific Fetch Gets Slow
Do not refactor large interactive detail pages into streamed server shells by default. The complexity is not justified for current dataset sizes.

## 2026-06-04 — Shared Agent Memory Lives in `docs/agent/`
Project memory for Codex and Claude is versioned in `docs/agent/`, while root `AGENTS.md` and `CLAUDE.md` stay short routing files. `.claude/` remains local/ignored and is not the shared source of truth.

## 2026-06-04 — Do Not Store Personal Memory in Repo Docs
The repo should store system, technical, product, and workflow memory only. Personal profile facts, private preferences, secrets, tokens, credentials, and customer-sensitive details do not belong in versioned agent memory.
