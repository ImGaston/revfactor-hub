"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleDot,
  Info,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  SCORE_PARTS,
  SECTION_HINTS,
  applyStatusLabel,
  decisionProgress,
  gradeTone,
  groupItemsBySection,
  isDecisionLocked,
  sectionPriority,
  type OptimizationDecision,
  type OptimizationItem,
  type OptimizationReport,
  OPTIMIZATION_SECTIONS,
} from "@/lib/listing-optimization"
import { passedChecks } from "@/lib/listing-optimization-checks"
import { decideOptimizationItemAction } from "./actions"

type Props = {
  reports: OptimizationReport[]
  token: string | null
  ownerName: string
  canDecide: boolean
  preview: boolean
}

export function OptimizationPortal({
  reports,
  token,
  ownerName,
  canDecide,
  preview,
}: Props) {
  // One listing opens straight into its review; several start on the overview.
  const [activeId, setActiveId] = useState<string | null>(
    reports.length === 1 ? reports[0].id : null
  )
  const [state, setState] = useState(reports)
  const active = state.find((r) => r.id === activeId) ?? null

  function replaceItem(reportId: string, item: OptimizationItem) {
    setState((prev) =>
      prev.map((r) =>
        r.id === reportId
          ? { ...r, items: r.items.map((i) => (i.id === item.id ? item : i)) }
          : r
      )
    )
  }

  if (!active && state.length > 1) {
    return (
      <main className="rf-portal-main">
        <div className="rf-portal-container">
          {preview && (
            <Alert className="rf-preview-notice">
              <Info aria-hidden="true" />
              <AlertDescription>
                Local preview of a draft review. Decisions are not saved.
              </AlertDescription>
            </Alert>
          )}
          <PortfolioOverview
            reports={state}
            ownerName={ownerName}
            onOpen={(id) => {
              setActiveId(id)
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      </main>
    )
  }

  if (!active) {
    return (
      <main className="rf-portal-main rf-empty-shell">
        <Empty className="rf-empty-card">
          <span className="rf-wordmark">revfactor</span>
          <EmptyHeader className="rf-empty-header">
            <EmptyMedia
              variant="icon"
              className="rf-empty-icon"
              aria-hidden="true"
            >
              <CircleDot />
            </EmptyMedia>
            <EmptyTitle>
              <h1 className="rf-empty-title">No listing review yet</h1>
            </EmptyTitle>
            <EmptyDescription className="rf-empty-copy">
              We’re putting your review together. You’ll get a message in the
              portal when it’s ready.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    )
  }

  return (
    <main className="rf-portal-main">
      <div className="rf-portal-container">
        {preview && (
          <Alert className="rf-preview-notice">
            <Info aria-hidden="true" />
            <AlertDescription>
              Local preview of a draft review. Decisions are not saved.
            </AlertDescription>
          </Alert>
        )}
        {state.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="rf-quiet-button rf-back-button"
            onClick={() => setActiveId(null)}
          >
            <ArrowLeft data-icon="inline-start" />
            All your listings
          </Button>
        )}
        <ReportView
          report={active}
          token={token}
          ownerName={ownerName}
          canDecide={canDecide}
          preview={preview}
          onItem={(item) => replaceItem(active.id, item)}
        />
      </div>
    </main>
  )
}

function reviewStatus(report: OptimizationReport): {
  label: string
  tone: "todo" | "queued" | "done"
} {
  const progress = decisionProgress(report.items)
  if (progress.total > 0 && progress.decided < progress.total) {
    return { label: `${progress.total - progress.decided} to review`, tone: "todo" }
  }
  const accepted = report.items.filter((i) => i.client_status === "accepted" && i.kind !== "owner_task")
  const live = accepted.filter((i) => i.apply_status === "verified")
  if (accepted.length > live.length) return { label: "We're applying your changes", tone: "queued" }
  return { label: "All done", tone: "done" }
}

function PortfolioOverview({
  reports,
  ownerName,
  onOpen,
}: {
  reports: OptimizationReport[]
  ownerName: string
  onOpen: (id: string) => void
}) {
  const firstName = ownerName.split(" ")[0]
  // Listings that need the owner first, then by most open suggestions.
  const sorted = [...reports].sort((a, b) => {
    const pa = decisionProgress(a.items)
    const pb = decisionProgress(b.items)
    return pb.total - pb.decided - (pa.total - pa.decided)
  })
  const openTotal = reports.reduce((sum, r) => {
    const p = decisionProgress(r.items)
    return sum + p.total - p.decided
  }, 0)
  // The host profile belongs to the Airbnb account, not a listing: surface it once.
  const profileTask = reports
    .flatMap((r) => r.items)
    .find((i) => i.kind === "owner_task" && i.section === "host_profile" && i.client_status === "pending")

  return (
    <div className="rf-overview">
      <header className="rf-overview-header">
        <span className="rf-wordmark">revfactor</span>
        <h1>Your listing reviews</h1>
        <p>
          Hi {firstName}. {openTotal > 0
            ? `${openTotal} suggestions across ${reports.length} listings are waiting for you. Start with the first one below.`
            : "You’ve reviewed everything. We’ll mark each change when it’s live."}
        </p>
      </header>

      {profileTask && (
        <div className="rf-overview-account">
          <div>
            <p className="rf-overview-account-title">Your host profile (all listings)</p>
            <p>
              Your profile is shared by every listing, so you only update it once. Only you can
              edit it in Airbnb.
            </p>
          </div>
          {profileTask.action_url && (
            <Button asChild size="sm" variant="outline" className="rf-decline-button">
              <a href={profileTask.action_url} target="_blank" rel="noreferrer">
                <ArrowUpRight data-icon="inline-start" />
                Open on Airbnb
              </a>
            </Button>
          )}
        </div>
      )}

      <ul className="rf-overview-list">
        {sorted.map((r) => {
          const progress = decisionProgress(r.items)
          const status = reviewStatus(r)
          return (
            <li key={r.id}>
              <button type="button" className="rf-overview-card" onClick={() => onOpen(r.id)}>
                {r.cover_photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Airbnb CDN image
                  <img src={r.cover_photo_url} alt="" className="rf-overview-photo" />
                ) : (
                  <span className="rf-overview-photo" aria-hidden="true" />
                )}
                <span className="rf-overview-body">
                  <span className="rf-overview-title">{r.listing_title}</span>
                  <span className="rf-overview-meta">
                    <span className="rf-overview-status" data-tone={status.tone}>
                      {status.label}
                    </span>
                    {progress.total > 0 && (
                      <span>
                        {progress.decided} of {progress.total} reviewed
                      </span>
                    )}
                  </span>
                  {progress.total > 0 && (
                    <span className="rf-overview-progress" aria-hidden="true">
                      <span style={{ width: `${(progress.decided / progress.total) * 100}%` }} />
                    </span>
                  )}
                </span>
                {r.overall_score != null && (
                  <span className="rf-overview-score">
                    {r.overall_score}
                    <small>/100</small>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReportView({
  report,
  token,
  ownerName,
  canDecide,
  preview,
  onItem,
}: {
  report: OptimizationReport
  token: string | null
  ownerName: string
  canDecide: boolean
  preview: boolean
  onItem: (item: OptimizationItem) => void
}) {
  // Same layout every time: every section with a suggestion or a passed
  // standard check is shown; passed checks render as "Looks good".
  const groups = useMemo(() => {
    const withItems = new Map(groupItemsBySection(report.items).map((g) => [g.section, g]))
    return OPTIMIZATION_SECTIONS.map((s) => ({
      section: s.key,
      label: s.label,
      items: withItems.get(s.key)?.items ?? [],
      passed: passedChecks(report.checks ?? [], s.key).map((c) => c.label),
    })).filter((g) => g.items.length > 0 || g.passed.length > 0)
  }, [report.items, report.checks])
  const progress = decisionProgress(report.items)
  const firstName = ownerName.split(" ")[0]

  return (
    <div className="rf-report-stack">
      <header className="rf-report-header">
        <div className="rf-report-hero">
          {report.cover_photo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- Airbnb CDN image
            <img
              src={report.cover_photo_url}
              alt=""
              className="rf-cover-photo"
            />
          )}
          <div className="rf-report-identity">
            <div className="rf-brand-line">
              <span className="rf-wordmark">revfactor</span>
              <span className="rf-brand-separator" aria-hidden="true" />
              <span>Listing optimization</span>
            </div>
            <p className="rf-eyebrow">Owner review</p>
            <h1 className="rf-report-title">{report.listing_title}</h1>
            {report.listing_url && (
              <a
                href={report.listing_url}
                target="_blank"
                rel="noreferrer"
                className="rf-listing-link"
              >
                View on Airbnb <ArrowUpRight aria-hidden="true" />
              </a>
            )}
          </div>
          {report.overall_score != null && (
            <ScoreBadge score={report.overall_score} />
          )}
        </div>

        {SCORE_PARTS.some((p) => report.score_breakdown[p.key] != null) && (
          <div className="rf-score-grid">
            {SCORE_PARTS.map((p) => {
              const value = report.score_breakdown[p.key]
              if (value == null) return null
              return (
                <div className="rf-score-part" key={p.key}>
                  <div className="rf-score-label">
                    <span>{p.label}</span>
                    <strong>{value}</strong>
                  </div>
                  <div className="rf-score-track">
                    <div
                      className="rf-score-fill"
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="rf-report-intro">
          <p className="rf-intro-lead">
            Hi {firstName}, here’s what we found and what we suggest changing.
          </p>
          {report.summary && <p>{report.summary}</p>}
          <p>
            Nothing changes on your listing until you accept it. Accepted
            changes go to our team, and we’ll mark each one when it’s live.
          </p>
        </div>

        <nav className="rf-section-nav" aria-label="Review sections">
          {groups.map((g) => {
            const grade = report.section_grades[g.section]
            return (
              <a
                key={g.section}
                href={`#section-${g.section}`}
                className="rf-section-link"
              >
                {grade && <GradeChip grade={grade} small />}
                {g.label}
              </a>
            )
          })}
          {progress.total > 0 && (
            <span className="rf-review-progress">
              {progress.decided} of {progress.total} reviewed
            </span>
          )}
        </nav>
      </header>

      {groups.map((g) => (
        <SectionCard
          key={g.section}
          id={`section-${g.section}`}
          sectionKey={g.section}
          label={g.label}
          grade={report.section_grades[g.section]}
          items={g.items}
          passed={g.passed}
          token={token}
          canDecide={canDecide}
          preview={preview}
          onItem={onItem}
        />
      ))}
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <div
      className="rf-score-badge"
      aria-label={`Overall score: ${score} out of 100`}
    >
      <span>{score}</span>
      <small>out of 100</small>
    </div>
  )
}

function GradeChip({
  grade,
  small = false,
}: {
  grade: string
  small?: boolean
}) {
  const tone = gradeTone(grade)
  const letter = grade.trim().charAt(0).toUpperCase()
  return (
    <span
      className={cn("rf-grade-chip", small && "rf-grade-chip-small")}
      data-grade={letter}
      data-tone={tone}
    >
      {grade}
    </span>
  )
}

function PriorityBadge({
  priority,
}: {
  priority: OptimizationItem["priority"]
}) {
  const label =
    priority === "high"
      ? "High priority"
      : priority === "medium"
        ? "Medium"
        : "Low"
  return (
    <Badge
      variant="outline"
      className="rf-priority-badge"
      data-priority={priority}
    >
      {label}
    </Badge>
  )
}

const BULK_SECTIONS = new Set<string>(["photos", "captions"])

function SectionCard({
  id,
  sectionKey,
  label,
  grade,
  items,
  passed,
  token,
  canDecide,
  preview,
  onItem,
}: {
  id: string
  sectionKey: string
  label: string
  grade: string | undefined
  items: OptimizationItem[]
  passed: string[]
  token: string | null
  canDecide: boolean
  preview: boolean
  onItem: (item: OptimizationItem) => void
}) {
  const priority = sectionPriority(items)
  const pendingChanges = items.filter(
    (i) => i.kind === "change" && i.client_status === "pending"
  )
  const [bulkPending, startBulk] = useTransition()
  // Photos and captions are usually reviewed as a set, so offer bulk accept
  // there as soon as there are two; other sections need three.
  const bulkThreshold = BULK_SECTIONS.has(sectionKey) ? 2 : 3
  const showBulk = canDecide && pendingChanges.length >= bulkThreshold

  function acceptAll() {
    startBulk(async () => {
      for (const item of pendingChanges) {
        const result = await decide({
          token,
          item,
          decision: "accept",
          preview,
        })
        if (result.ok) onItem(result.item)
        else {
          toast.error(result.error)
          break
        }
      }
    })
  }

  return (
    <section id={id} className="rf-section-card">
      <div className="rf-section-heading">
        <div className="rf-section-title-group">
          {grade && <GradeChip grade={grade} />}
          <h2>{label}</h2>
          {priority && <PriorityBadge priority={priority} />}
        </div>
        {showBulk && (
          <Button
            size="sm"
            variant="outline"
            className="rf-bulk-button"
            disabled={bulkPending}
            onClick={acceptAll}
          >
            <CheckCheck data-icon="inline-start" />
            Accept all {pendingChanges.length}
          </Button>
        )}
      </div>
      {SECTION_HINTS[sectionKey as keyof typeof SECTION_HINTS] && (
        <p className="rf-section-hint">
          {SECTION_HINTS[sectionKey as keyof typeof SECTION_HINTS]}
        </p>
      )}
      <div className="rf-section-items">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            token={token}
            canDecide={canDecide}
            preview={preview}
            onItem={onItem}
          />
        ))}
      </div>
      {passed.length > 0 && (
        <div className="rf-passed">
          <p className="rf-passed-title">
            {items.length === 0 ? "Looks good" : "Already in good shape"}
          </p>
          <ul>
            {passed.map((label) => (
              <li key={label}>
                <Check aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

async function decide({
  token,
  item,
  decision,
  choice,
  note,
  preview,
}: {
  token: string | null
  item: OptimizationItem
  decision: OptimizationDecision
  choice?: string | null
  note?: string | null
  preview: boolean
}): Promise<
  { ok: true; item: OptimizationItem } | { ok: false; error: string }
> {
  if (preview || !token) {
    const now = new Date().toISOString()
    return {
      ok: true,
      item:
        decision === "reset"
          ? {
              ...item,
              client_status: "pending",
              client_choice: null,
              decided_at: null,
              apply_status: "not_started",
            }
          : {
              ...item,
              client_status: decision === "accept" ? "accepted" : "declined",
              client_choice:
                decision === "accept"
                  ? (choice ?? item.proposed_value ?? item.options[0] ?? null)
                  : null,
              client_note: note ?? null,
              decided_at: now,
              apply_status:
                decision === "accept"
                  ? item.kind === "owner_task"
                    ? "applied"
                    : "queued"
                  : "not_started",
            },
    }
  }
  try {
    return await decideOptimizationItemAction({
      token,
      itemId: item.id,
      decision,
      choice,
      note,
    })
  } catch {
    return { ok: false, error: "We couldn't save that. Please try again." }
  }
}

function ItemRow({
  item,
  token,
  canDecide,
  preview,
  onItem,
}: {
  item: OptimizationItem
  token: string | null
  canDecide: boolean
  preview: boolean
  onItem: (item: OptimizationItem) => void
}) {
  const hasOptions = item.options.length > 1
  const [choice, setChoice] = useState<string>(
    item.client_choice ?? item.proposed_value ?? item.options[0] ?? ""
  )
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(item.client_note ?? "")
  const [showNote, setShowNote] = useState(Boolean(item.client_note))
  const [isPending, startTransition] = useTransition()
  const locked = isDecisionLocked(item)
  const decided = item.client_status !== "pending"
  const editable =
    item.kind === "change" &&
    (item.section === "title" ||
      item.section === "captions" ||
      item.section === "description" ||
      item.section === "location" ||
      item.section === "arrival")

  function run(decision: OptimizationDecision) {
    startTransition(async () => {
      const result = await decide({
        token,
        item,
        decision,
        choice: decision === "accept" ? choice : null,
        note: showNote ? note : null,
        preview,
      })
      if (result.ok) {
        onItem(result.item)
        setEditing(false)
        if (decision === "accept")
          toast.success(
            item.kind === "owner_task" ? "Marked as done. Thank you!" : "Accepted. It's in our queue."
          )
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <article className="rf-item">
      <div className="rf-item-layout">
        {item.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- Airbnb CDN image
          <img src={item.photo_url} alt="" className="rf-item-photo" />
        )}
        <div className="rf-item-content">
          <div className="rf-item-heading">
            {item.kind === "info" ? (
              <Info
                className="rf-item-kind-icon rf-item-kind-icon-info"
                aria-hidden="true"
              />
            ) : (
              <CircleDot className="rf-item-kind-icon" aria-hidden="true" />
            )}
            <h3>{item.headline}</h3>
            <StatusBadge item={item} />
          </div>
          {item.rationale && (
            <p className="rf-item-rationale">{item.rationale}</p>
          )}
          {item.kind === "owner_task" && (
            <p className="rf-owner-task-note">
              Only you can change this in Airbnb, so this one is yours. Open it, make the change,
              then mark it done.
            </p>
          )}

          {(item.current_value || item.proposed_value || hasOptions) && (
            <div className="rf-value-grid">
              {item.current_value && (
                <ValueBox
                  label="Now"
                  tone="current"
                  value={item.current_value}
                />
              )}
              {item.kind !== "info" &&
                !hasOptions &&
                !editing &&
                (item.client_choice ?? item.proposed_value) && (
                  <ValueBox
                    label={
                      item.kind === "owner_choice"
                        ? "Our suggestion"
                        : item.kind === "owner_task"
                          ? "What to write"
                          : "Suggested"
                    }
                    tone="proposed"
                    value={item.client_choice ?? item.proposed_value ?? ""}
                  />
                )}
            </div>
          )}

          {hasOptions && !editing && (
            <fieldset
              className="rf-option-group"
              disabled={!canDecide || locked || decided || isPending}
            >
              <legend>Pick the one you like</legend>
              {item.options.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "rf-option",
                    choice === option && "rf-option-selected"
                  )}
                >
                  <input
                    type="radio"
                    className="rf-option-radio"
                    name={`opt-${item.id}`}
                    checked={choice === option}
                    onChange={() => setChoice(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          )}

          {editing && (
            <Textarea
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              rows={item.section === "description" ? 8 : 2}
              className="rf-textarea"
              aria-label="Your version"
            />
          )}

          {canDecide && item.kind !== "info" && showNote && !locked && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything we should know? (optional)"
              className="rf-textarea"
              aria-label="Note to the team"
            />
          )}

          {canDecide && item.kind !== "info" && !locked && (
            <div className="rf-action-row">
              {!decided || editing ? (
                <>
                  {item.kind === "owner_task" && item.action_url && (
                    <Button asChild size="sm" variant="outline" className="rf-decline-button">
                      <a href={item.action_url} target="_blank" rel="noreferrer">
                        <ArrowUpRight data-icon="inline-start" />
                        Open on Airbnb
                      </a>
                    </Button>
                  )}
                  <Button
                    className="rf-accept-button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => run("accept")}
                  >
                    <Check data-icon="inline-start" />
                    {item.kind === "owner_choice"
                      ? "Yes, do it"
                      : item.kind === "owner_task"
                        ? "I did it"
                        : "Accept"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rf-decline-button"
                    disabled={isPending}
                    onClick={() => run("decline")}
                  >
                    <X data-icon="inline-start" />
                    {item.kind === "owner_choice"
                      ? "No, keep as is"
                      : item.kind === "owner_task"
                        ? "Skip"
                        : "Decline"}
                  </Button>
                  {editable && !editing && (
                    <Button
                      className="rf-quiet-button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit first
                    </Button>
                  )}
                  {!showNote && (
                    <Button
                      className="rf-quiet-button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowNote(true)}
                    >
                      Add a note
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rf-quiet-button"
                  disabled={isPending}
                  onClick={() => run("reset")}
                >
                  <RotateCcw data-icon="inline-start" />
                  Change my answer
                </Button>
              )}
            </div>
          )}
          {item.client_note && decided && (
            <p className="rf-saved-note">Your note: {item.client_note}</p>
          )}
        </div>
      </div>
    </article>
  )
}

function ValueBox({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "current" | "proposed"
}) {
  return (
    <div className="rf-value-box" data-tone={tone}>
      <p className="rf-value-label">{label}</p>
      <p className="rf-value-copy">{value}</p>
    </div>
  )
}

function StatusBadge({ item }: { item: OptimizationItem }) {
  if (item.kind === "info") {
    return (
      <Badge variant="outline" className="rf-status-badge" data-status="info">
        For your info
      </Badge>
    )
  }
  if (item.client_status === "declined") {
    return (
      <Badge
        variant="outline"
        className="rf-status-badge"
        data-status="declined"
      >
        {item.kind === "owner_task" ? "Skipped" : "Declined"}
      </Badge>
    )
  }
  if (item.kind === "owner_task") {
    return (
      <Badge
        variant="outline"
        className="rf-status-badge"
        data-status={item.client_status === "accepted" ? "live" : "owner-task"}
      >
        {item.client_status === "accepted" ? "Done ✓" : "You do this one"}
      </Badge>
    )
  }
  if (item.client_status === "accepted") {
    const applied = applyStatusLabel(item.apply_status)
    return (
      <Badge
        className="rf-status-badge"
        data-status={item.apply_status === "verified" ? "live" : "accepted"}
      >
        {item.apply_status === "verified" ? "Live ✓" : applied || "Accepted"}
      </Badge>
    )
  }
  return null
}
