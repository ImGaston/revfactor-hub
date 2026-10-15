"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { Ban, ExternalLink, Info, Loader2, MoreHorizontal, OctagonAlert, Pencil, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  ONBOARDING_CHANNELS,
  ONBOARDING_NOTE_MAX,
  describeOnboardingEvent,
  formatOnboardingTimestamp,
  onboardingItemDef,
  type OnboardingCell,
  type OnboardingItemDef,
  type OnboardingStatus,
  type OnboardingValue,
} from "@/lib/client-onboarding"
import { formatJourneyDate } from "@/lib/client-journey"
import { cn } from "@/lib/utils"
import {
  loadClientOnboardingAction,
  saveOnboardingItemAction,
  type ClientOnboardingData,
} from "@/app/(authenticated)/clients/[id]/tab-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

type SaveFn = (
  cell: OnboardingCell,
  patch: { status: OnboardingStatus; value: OnboardingValue | null; note: string | null }
) => Promise<boolean>

const cellId = (c: Pick<OnboardingCell, "listingId" | "key">) => `${c.listingId ?? "client"}:${c.key}`

export function OnboardingTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientOnboardingAction(clientId), [clientId])
  const { state, reload, refresh } = useLazyTabData(load)
  // Optimistic statuses for checkbox clicks, keyed by cellId; dropped once the
  // refreshed data arrives (a new data object) or the save fails.
  const [pending, setPending] = useState<{ data: ClientOnboardingData | null; byCell: Record<string, OnboardingStatus> }>(
    { data: null, byCell: {} }
  )
  const [editing, setEditing] = useState<OnboardingCell | null>(null)

  const save: SaveFn = useCallback(
    async (cell, patch) => {
      const current = state.status === "ready" ? state.data : null
      setPending((p) => ({ data: current, byCell: { ...(p.data === current ? p.byCell : {}), [cellId(cell)]: patch.status } }))
      const result = await saveOnboardingItemAction(clientId, {
        itemKey: cell.key,
        listingId: cell.listingId,
        ...patch,
      })
      if (result.error) {
        setPending((p) => {
          const byCell = { ...p.byCell }
          delete byCell[cellId(cell)]
          return { ...p, byCell }
        })
        toast.error(result.error)
        return false
      }
      refresh()
      return true
    },
    [clientId, refresh, state]
  )

  if (state.status === "loading") return <TabSkeleton variant="cards" />
  if (state.status === "error") return <TabError error={state.error} onRetry={reload} />

  const data = state.data
  const overrides = pending.data === data ? pending.byCell : {}
  const withOverride = (c: OnboardingCell): OnboardingCell =>
    overrides[cellId(c)] ? { ...c, status: overrides[cellId(c)] } : c
  const canEdit = data.canEdit && data.itemsAvailable
  const listingNames = new Map(data.view.listings.map((l) => [l.id, l.name]))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {!data.itemsAvailable && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              Showing what the client submitted. Saving checks and verified values needs the onboarding migration,
              which isn&apos;t applied yet.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preparation</CardTitle>
            <CardDescription>
              Prefilled from the client&apos;s GHL intake and Hub data. Verify each value once staff have confirmed it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Owner</h3>
              <div className="divide-y">
                {data.view.owner.map((c) => (
                  <PrepRow key={cellId(c)} cell={withOverride(c)} canEdit={canEdit} onSave={save} onEdit={setEditing} />
                ))}
              </div>
            </section>
            {data.view.listings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active listings in the Hub yet. Add them on the Legacy tab; the Airbnb link, channels, PMS and
                PriceLabs status then appear here per listing.
              </p>
            ) : (
              data.view.listings.map((l) => (
                <section key={l.id} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{l.name}</h3>
                    <Link
                      href={`/listings/${l.id}?tab=setup`}
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Listing setup
                    </Link>
                  </div>
                  <div className="divide-y">
                    {l.cells.map((c) => (
                      <PrepRow key={cellId(c)} cell={withOverride(c)} canEdit={canEdit} onSave={save} onEdit={setEditing} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Call checklist</CardTitle>
            <CardDescription>
              {data.view.progress.done} of {data.view.progress.total} done
              {data.view.progress.blocked > 0 && ` · ${data.view.progress.blocked} blocked`}. Work through it on the
              onboarding call; decided settings go on each listing&apos;s Setup tab.
            </CardDescription>
            <ProgressBar done={data.view.progress.done} total={data.view.progress.total} />
          </CardHeader>
          <CardContent className="space-y-6">
            {data.view.call.map((g) => (
              <section key={g.group} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                <div className="space-y-3">
                  {g.items.map((item) => {
                    const def = onboardingItemDef(item.key)
                    if (!def) return null
                    return (
                      <div key={item.key} className="rounded-lg border p-3">
                        <p className="text-sm font-medium">{def.label}</p>
                        {def.help && <p className="mt-0.5 text-xs text-muted-foreground">{def.help}</p>}
                        <div className="mt-2 space-y-1.5">
                          {item.cells.map((c) => (
                            <CheckRow
                              key={cellId(c)}
                              def={def}
                              cell={withOverride(c)}
                              listingName={c.listingId ? (listingNames.get(c.listingId) ?? "Listing") : null}
                              canEdit={canEdit}
                              onSave={save}
                              onEdit={setEditing}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <IntakeCard data={data} />
        <ActivityCard data={data} listingNames={listingNames} />
      </div>

      {editing && (
        <EditItemDialog
          cell={editing}
          listingName={editing.listingId ? (listingNames.get(editing.listingId) ?? null) : null}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}

function SourceBadge({ cell }: { cell: OnboardingCell }) {
  if (cell.status === "done") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <ShieldCheck className="size-3" />
        Verified
      </Badge>
    )
  }
  if (!cell.source) return null
  const map = {
    client: { label: "Client-submitted", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    ghl: { label: "GHL", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
    hub: { label: "From Hub", className: "bg-muted text-muted-foreground" },
    staff: { label: "Staff, not verified", className: "bg-muted text-muted-foreground" },
  } as const
  const s = map[cell.source]
  return (
    <Badge variant="secondary" className={s.className}>
      {s.label}
    </Badge>
  )
}

function whoWhen(name: string | null, at: string | null): string {
  if (!at) return ""
  return `${name ?? "Someone"} · ${formatJourneyDate(at)}`
}

function PrepRow({
  cell,
  canEdit,
  onSave,
  onEdit,
}: {
  cell: OnboardingCell
  canEdit: boolean
  onSave: SaveFn
  onEdit: (cell: OnboardingCell) => void
}) {
  const def = onboardingItemDef(cell.key)
  const [busy, setBusy] = useState(false)
  if (!def) return null
  const readonly = def.input.kind === "readonly"
  const isLink = def.input.kind === "url" && typeof cell.value === "string"

  async function verify() {
    setBusy(true)
    await onSave(cell, { status: "done", value: cell.value, note: cell.note })
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
      <div className="text-sm text-muted-foreground sm:w-48 sm:shrink-0">{def.label}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {cell.display == null ? (
            <span className="text-muted-foreground">Not answered</span>
          ) : isLink ? (
            <a
              href={cell.value as string}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">{cell.display}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : (
            <span className="break-words">{cell.display}</span>
          )}
          <SourceBadge cell={cell} />
        </div>
        {cell.note && <p className="text-xs text-muted-foreground">{cell.note}</p>}
        {cell.status === "done" && cell.completedAt && (
          <p className="text-xs text-muted-foreground">Verified by {whoWhen(cell.completedByName, cell.completedAt)}</p>
        )}
      </div>
      {canEdit && !readonly && (
        <div className="flex shrink-0 items-center gap-1">
          {cell.status !== "done" && cell.value != null && (
            <Button variant="outline" size="sm" onClick={verify} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
              Verify
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(cell)} aria-label={`Edit ${def.label}`}>
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function CheckRow({
  def,
  cell,
  listingName,
  canEdit,
  onSave,
  onEdit,
}: {
  def: OnboardingItemDef
  cell: OnboardingCell
  listingName: string | null
  canEdit: boolean
  onSave: SaveFn
  onEdit: (cell: OnboardingCell) => void
}) {
  const id = `check-${cellId(cell)}`
  const done = cell.status === "done"
  const value = cell.source === "staff" ? cell.value : null
  const set = (status: OnboardingStatus) => onSave(cell, { status, value, note: cell.note })

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={done}
        disabled={!canEdit || cell.status === "not_applicable"}
        onCheckedChange={(checked) => void set(checked === true ? "done" : "open")}
        aria-label={listingName ? `${def.label} — ${listingName}` : def.label}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor={id} className={cn("cursor-pointer", cell.status === "not_applicable" && "line-through text-muted-foreground")}>
            {listingName ?? (done ? "Done" : "Not done yet")}
          </label>
          {cell.display && cell.source === "staff" && <span className="font-medium">{cell.display}</span>}
          {cell.status === "blocked" && (
            <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
              <OctagonAlert className="size-3" />
              Blocked
            </Badge>
          )}
          {cell.status === "not_applicable" && (
            <Badge variant="secondary" className="text-muted-foreground">
              <Ban className="size-3" />
              N/A
            </Badge>
          )}
        </div>
        {cell.note && <p className="text-xs text-muted-foreground">{cell.note}</p>}
        {(done || cell.status === "not_applicable") && cell.completedAt && (
          <p className="text-xs text-muted-foreground">{whoWhen(cell.completedByName, cell.completedAt)}</p>
        )}
      </div>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(cell)}>
              {def.input.kind === "none" ? "Add a note…" : "Record value and note…"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {cell.status !== "blocked" && (
              <DropdownMenuItem onSelect={() => void set("blocked")}>Flag as blocked</DropdownMenuItem>
            )}
            {cell.status !== "not_applicable" && (
              <DropdownMenuItem onSelect={() => void set("not_applicable")}>Not applicable</DropdownMenuItem>
            )}
            {cell.status !== "open" && <DropdownMenuItem onSelect={() => void set("open")}>Reopen</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

const PREP_STATUS_OPTIONS: { value: OnboardingStatus; label: string }[] = [
  { value: "open", label: "Not verified" },
  { value: "done", label: "Verified" },
]
const CALL_STATUS_OPTIONS: { value: OnboardingStatus; label: string }[] = [
  { value: "open", label: "Not done" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "not_applicable", label: "Not applicable" },
]

function EditItemDialog({
  cell,
  listingName,
  onClose,
  onSave,
}: {
  cell: OnboardingCell
  listingName: string | null
  onClose: () => void
  onSave: SaveFn
}) {
  const def = onboardingItemDef(cell.key)
  const prep = def?.section === "prep"
  // Prep items start from the shown value (prefill included); call items only
  // from what staff saved.
  const [value, setValue] = useState<OnboardingValue | null>(prep || cell.source === "staff" ? cell.value : null)
  const [note, setNote] = useState(cell.note ?? "")
  const [status, setStatus] = useState<OnboardingStatus>(cell.status)
  const [saving, setSaving] = useState(false)
  if (!def) return null

  async function submit() {
    setSaving(true)
    const ok = await onSave(cell, { status, value, note: note.trim() || null })
    setSaving(false)
    if (ok) {
      toast.success("Saved")
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{def.label}</DialogTitle>
          <DialogDescription>
            {listingName ? `${listingName}. ` : "Owner-level. "}
            {def.help ?? (prep ? "Record the value staff confirmed with the owner." : "")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {def.input.kind !== "none" && def.input.kind !== "readonly" && (
            <div className="space-y-2">
              <Label htmlFor="onboarding-value">Value</Label>
              <ValueInput def={def} value={value} onChange={setValue} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="onboarding-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OnboardingStatus)}>
              <SelectTrigger id="onboarding-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(prep ? PREP_STATUS_OPTIONS : CALL_STATUS_OPTIONS).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-note">Note</Label>
            <Textarea
              id="onboarding-note"
              value={note}
              maxLength={ONBOARDING_NOTE_MAX}
              rows={3}
              placeholder="What was agreed, who owes what. Never logins or keys."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ValueInput({
  def,
  value,
  onChange,
}: {
  def: OnboardingItemDef
  value: OnboardingValue | null
  onChange: (value: OnboardingValue | null) => void
}) {
  const input = def.input
  switch (input.kind) {
    case "choice":
      return (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id="onboarding-value" className="w-full">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            {input.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case "channels": {
      const picked = Array.isArray(value) ? value : []
      return (
        <div id="onboarding-value" className="flex flex-wrap gap-4">
          {ONBOARDING_CHANNELS.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={picked.includes(c.value)}
                onCheckedChange={(checked) =>
                  onChange(checked === true ? [...picked, c.value] : picked.filter((p) => p !== c.value))
                }
              />
              {c.label}
            </label>
          ))}
        </div>
      )
    }
    case "money":
    case "number":
      return (
        <Input
          id="onboarding-value"
          type="number"
          inputMode="decimal"
          min={0}
          step={input.kind === "money" ? "0.01" : "1"}
          value={value == null ? "" : String(value)}
          placeholder={input.kind === "money" ? input.placeholder : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      )
    case "date":
      return (
        <Input
          id="onboarding-value"
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )
    case "text":
    case "url":
      return (
        <Input
          id="onboarding-value"
          type={input.kind === "url" ? "url" : "text"}
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          placeholder={input.placeholder}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    default:
      return null
  }
}

/** The client's GHL answers exactly as submitted (what the Legacy card used to show). */
function IntakeCard({ data }: { data: ClientOnboardingData }) {
  const intake = data.intake
  const answer = (v: string | null | undefined) => v ?? "Not answered"
  const appt = intake?.appointment
  const callTime = appt?.start ? formatOnboardingTimestamp(appt.start) : ""
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Intake answers</CardTitle>
        <CardDescription>Client-submitted in GHL. Access still needs to be verified on the call.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!intake ? (
          <p className="text-muted-foreground">No GHL intake on file for this client.</p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">Listing quantity</dt>
              <dd>{intake.purchased_listings ?? "Not answered"}</dd>
              <dt className="text-muted-foreground">PMS</dt>
              <dd>{answer(intake.uses_pms)}</dd>
              <dt className="text-muted-foreground">Vrbo</dt>
              <dd>{answer(intake.vrbo)}</dd>
              <dt className="text-muted-foreground">Airbnb readiness</dt>
              <dd>{answer(intake.airbnb_ready)}</dd>
              <dt className="text-muted-foreground">Airbnb audit</dt>
              <dd>{answer(intake.audit_requested)}</dd>
              <dt className="text-muted-foreground">PriceLabs</dt>
              <dd>{answer(intake.uses_pricelabs)}</dd>
              <dt className="text-muted-foreground">Agreement</dt>
              <dd>
                {(intake.agreement_evidence ?? []).length ? "Signed (GHL workflow verified)" : "See signed agreement"}
              </dd>
            </dl>
            {intake.airbnb_listing_url && (
              <a
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                href={intake.airbnb_listing_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View submitted Airbnb listing
                <ExternalLink className="size-3" />
              </a>
            )}
            {appt && (
              <p>
                Onboarding call: {callTime ? `${callTime} (New York)` : "time unknown"}
                {" · "}
                {appt.host_name ?? "Host not assigned"}
                {appt.status ? ` · ${appt.status}` : ""}
              </p>
            )}
            {(intake.readiness ?? []).length > 0 && (
              <ul className="list-disc space-y-1 pl-4">
                {(intake.readiness ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {data.ghlSyncError
            ? "The latest update needs review; showing the last saved answers."
            : data.ghlSyncedAt && formatOnboardingTimestamp(data.ghlSyncedAt)
              ? `Updated ${formatOnboardingTimestamp(data.ghlSyncedAt)}`
              : intake
                ? "Awaiting update"
                : ""}
        </p>
      </CardContent>
    </Card>
  )
}

function ActivityCard({ data, listingNames }: { data: ClientOnboardingData; listingNames: Map<string, string> }) {
  if (!data.itemsAvailable) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
        <CardDescription>Who changed what, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {data.events.map((e, i) => (
              <li key={i} className="text-sm">
                <p>
                  {describeOnboardingEvent(e)}
                  {e.listing_id && listingNames.get(e.listing_id) ? ` · ${listingNames.get(e.listing_id)}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.actor_name ?? "Someone"} · {formatOnboardingTimestamp(e.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
