"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import {
  checkSetupNowAction,
  flagSettingDriftAction,
  recordSettingChangesAction,
  verifySettingAction,
  type RecordChangeInput,
  type RecordChangeRow,
} from "@/app/(authenticated)/listings/[id]/setup-actions"
import { Button } from "@/components/ui/button"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  CHANNEL_LABELS,
  SETTING_CHANNELS,
  SETTING_GROUPS,
  SETTING_KEYS,
  SYSTEM_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  baseSettingKey,
  formatDateRange,
  formatSettingValue,
  settingKeyDef,
  settingValueKind,
  type ListingSettingRow,
  type SettingChannel,
} from "@/lib/listing-settings"

// ─── Draft rows (form state) ────────────────────────────────

type Draft = {
  id: number
  key: string
  name: string
  channel: SettingChannel
  date_from: string
  date_to: string
  system: string
  reason: string
  asNote: boolean
  note: string
  amount: string
  per: "" | "stay" | "night" | "guest"
  percent: string
  nights: string
  fallback: string
  enabled: boolean
  checkin: string[]
  checkout: string[]
  tiers: { label: string; percent: string }[]
}

let nextId = 1

function emptyDraft(key = ""): Draft {
  return {
    id: nextId++,
    key,
    name: "",
    channel: "all",
    date_from: "",
    date_to: "",
    system: settingKeyDef(key)?.system ?? "pricelabs",
    reason: "",
    asNote: false,
    note: "",
    amount: "",
    per: "",
    percent: "",
    nights: "",
    fallback: "",
    enabled: true,
    checkin: [...WEEKDAYS],
    checkout: [...WEEKDAYS],
    tiers: [{ label: "", percent: "" }],
  }
}

/** Prefills a draft from a current setting ("Record a new value"). */
function draftFromSetting(s: ListingSettingRow): Draft {
  const key = baseSettingKey(s.setting_key)
  const d = emptyDraft(key)
  const v = s.value as Record<string, unknown>
  d.name = s.setting_key.includes("/") ? s.setting_key.split("/")[1] : ""
  d.channel = s.channel
  d.date_from = s.date_from ?? ""
  d.date_to = s.date_to ?? ""
  d.system = s.system
  if (typeof v.text === "string") {
    d.asNote = true
    d.note = v.text
    return d
  }
  if (typeof v.amount === "number") d.amount = String(v.amount)
  if (v.per === "stay" || v.per === "night" || v.per === "guest") d.per = v.per
  if (typeof v.percent === "number") d.percent = String(v.percent)
  if (typeof v.nights === "number") d.nights = String(v.nights)
  if (typeof v.fallback_after_days === "number") d.fallback = String(v.fallback_after_days)
  if (typeof v.enabled === "boolean") d.enabled = v.enabled
  const days = (x: unknown) => (x === "all" ? [...WEEKDAYS] : Array.isArray(x) ? (x as string[]) : [...WEEKDAYS])
  if ("checkin" in v) d.checkin = days(v.checkin)
  if ("checkout" in v) d.checkout = days(v.checkout)
  if (Array.isArray(v.tiers)) {
    d.tiers = (v.tiers as { label: string; percent: number }[]).map((t) => ({ label: t.label, percent: String(t.percent) }))
  }
  return d
}

const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s))

function draftValue(d: Draft): unknown {
  if (d.asNote) return { text: d.note }
  switch (settingValueKind(d.key)) {
    case "amount":
      return d.per ? { amount: toNum(d.amount), per: d.per } : { amount: toNum(d.amount) }
    case "percent":
      return { percent: toNum(d.percent) }
    case "nights":
      return d.fallback.trim()
        ? { nights: toNum(d.nights), fallback_after_days: toNum(d.fallback) }
        : { nights: toNum(d.nights) }
    case "tiers":
      return { tiers: d.tiers.map((t) => ({ label: t.label, percent: toNum(t.percent) })) }
    case "enabled":
      return { enabled: d.enabled }
    case "checkin_checkout":
      return { checkin: d.checkin, checkout: d.checkout }
    default:
      return { text: d.note }
  }
}

function toRow(d: Draft): RecordChangeRow {
  const def = settingKeyDef(d.key)
  const dated = def?.scope === "date_range"
  return {
    key: d.key,
    name: d.key === "promotion.pms" ? d.name : undefined,
    channel: d.channel,
    date_from: dated ? d.date_from || null : null,
    date_to: dated ? d.date_to || null : null,
    value: draftValue(d),
    system: d.system,
    reason: d.reason,
  }
}

// ─── Value editor ───────────────────────────────────────────

function DayPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-3">
        {WEEKDAYS.map((w) => (
          <label key={w} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={value.includes(w)}
              onCheckedChange={(c) => onChange(c ? [...value, w] : value.filter((x) => x !== w))}
            />
            {WEEKDAY_LABELS[w]}
          </label>
        ))}
      </div>
    </div>
  )
}

function ValueEditor({ d, set }: { d: Draft; set: (patch: Partial<Draft>) => void }) {
  const kind = settingValueKind(d.key)
  if (d.asNote || kind === "text") {
    return (
      <Input
        value={d.note}
        onChange={(e) => set({ note: e.target.value })}
        placeholder="e.g. 365 days (12 months)"
        aria-label="Value"
      />
    )
  }
  switch (kind) {
    case "amount":
      return (
        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={d.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="Amount ($)"
            aria-label="Amount in dollars"
          />
          <Select value={d.per || "none"} onValueChange={(v) => set({ per: v === "none" ? "" : (v as Draft["per"]) })}>
            <SelectTrigger className="w-36" aria-label="Charged per">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="stay">per stay</SelectItem>
              <SelectItem value="night">per night</SelectItem>
              <SelectItem value="guest">per guest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )
    case "percent":
      return (
        <Input
          type="number"
          inputMode="decimal"
          value={d.percent}
          onChange={(e) => set({ percent: e.target.value })}
          placeholder="Percent"
          aria-label="Percent"
        />
      )
    case "nights":
      return (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            value={d.nights}
            onChange={(e) => set({ nights: e.target.value })}
            placeholder="Nights"
            aria-label="Nights"
          />
          <Input
            type="number"
            min={1}
            value={d.fallback}
            onChange={(e) => set({ fallback: e.target.value })}
            placeholder="Relax within (days, optional)"
            aria-label="Lead-time fallback in days"
          />
        </div>
      )
    case "enabled":
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={d.enabled} onCheckedChange={(c) => set({ enabled: c })} />
          {d.enabled ? "On" : "Off"}
        </label>
      )
    case "checkin_checkout":
      return (
        <div className="space-y-2">
          <DayPicker label="Check-in days" value={d.checkin} onChange={(v) => set({ checkin: v })} />
          <DayPicker label="Check-out days" value={d.checkout} onChange={(v) => set({ checkout: v })} />
        </div>
      )
    case "tiers":
      return (
        <div className="space-y-2">
          {d.tiers.map((t, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={t.label}
                onChange={(e) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                placeholder="e.g. 3+ nights"
                aria-label={`Tier ${i + 1} label`}
              />
              <Input
                type="number"
                className="w-28"
                value={t.percent}
                onChange={(e) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)) })}
                placeholder="%"
                aria-label={`Tier ${i + 1} percent`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={d.tiers.length === 1}
                onClick={() => set({ tiers: d.tiers.filter((_, j) => j !== i) })}
                aria-label={`Remove tier ${i + 1}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => set({ tiers: [...d.tiers, { label: "", percent: "" }] })}>
            <Plus className="size-4" /> Add tier
          </Button>
        </div>
      )
  }
}

function DraftRow({
  d,
  index,
  set,
  remove,
  canRemove,
}: {
  d: Draft
  index: number
  set: (patch: Partial<Draft>) => void
  remove: () => void
  canRemove: boolean
}) {
  const def = settingKeyDef(d.key)
  const kind = settingValueKind(d.key)
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Change {index + 1}</div>
        {canRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={remove}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Setting</Label>
          <Select
            value={d.key}
            onValueChange={(key) => set({ key, system: settingKeyDef(key)?.system ?? d.system, asNote: false })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a setting" />
            </SelectTrigger>
            <SelectContent>
              {SETTING_GROUPS.map((g) => (
                <SelectGroup key={g.id}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {SETTING_KEYS.filter((k) => k.group === g.id).map((k) => (
                    <SelectItem key={k.key} value={k.key}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={d.channel} onValueChange={(v) => set({ channel: v as SettingChannel })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTING_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Where it&apos;s set</Label>
            <Select value={d.system} onValueChange={(v) => set({ system: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SYSTEM_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {d.key === "promotion.pms" && (
        <div className="space-y-1">
          <Label htmlFor={`name-${d.id}`}>Promotion name</Label>
          <Input id={`name-${d.id}`} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Early bird" />
        </div>
      )}

      {def?.scope === "date_range" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`from-${d.id}`}>From</Label>
            <Input id={`from-${d.id}`} type="date" value={d.date_from} onChange={(e) => set({ date_from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`to-${d.id}`}>To</Label>
            <Input id={`to-${d.id}`} type="date" value={d.date_to} onChange={(e) => set({ date_to: e.target.value })} />
          </div>
        </div>
      )}

      {d.key && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>New value</Label>
            {kind !== "text" && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={d.asNote} onCheckedChange={(c) => set({ asNote: c === true })} />
                Write as a note
              </label>
            )}
          </div>
          <ValueEditor d={d} set={set} />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`reason-${d.id}`}>Why</Label>
        <Input
          id={`reason-${d.id}`}
          value={d.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="One line, e.g. covers cleaning after the Vrbo markup cut"
        />
      </div>
    </div>
  )
}

// ─── Record change dialog ───────────────────────────────────

export function RecordChangeDialog({
  listingId,
  open,
  onOpenChange,
  initial,
}: {
  listingId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ListingSettingRow
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState("")
  const [approvedBy, setApprovedBy] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState<RecordChangeInput["status"]>("applied")
  const [drafts, setDrafts] = useState<Draft[]>(() => [initial ? draftFromSetting(initial) : emptyDraft()])

  const reset = () => {
    setTitle("")
    setApprovedBy("")
    setNotes("")
    setStatus("applied")
    setDrafts([initial ? draftFromSetting(initial) : emptyDraft()])
  }

  const submit = () => {
    if (drafts.some((d) => !d.key)) {
      toast.error("Pick a setting for every change.")
      return
    }
    startTransition(async () => {
      const res = await recordSettingChangesAction(listingId, {
        title,
        approvedBy,
        notes,
        status,
        rows: drafts.map(toRow),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Recorded ${drafts.length} change${drafts.length === 1 ? "" : "s"}`)
      onOpenChange(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record change</DialogTitle>
          <DialogDescription>
            Log an approved setting change. Nothing is pushed to PriceLabs, the PMS or the channels — make the change there,
            then record it here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cs-title">Batch title</Label>
              <Input id="cs-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cleaning fee + Vrbo 20%" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cs-approver">Approved by</Label>
              <Input id="cs-approver" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Defaults to you" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as RecordChangeInput["status"])}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="applied">Applied — changed in the system</SelectItem>
                <SelectItem value="verified">Verified — also confirmed on the channel</SelectItem>
                <SelectItem value="planned">Planned — proposal only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {drafts.map((d, i) => (
            <DraftRow
              key={d.id}
              d={d}
              index={i}
              canRemove={drafts.length > 1}
              set={(patch) => setDrafts((all) => all.map((x) => (x.id === d.id ? { ...x, ...patch } : x)))}
              remove={() => setDrafts((all) => all.filter((x) => x.id !== d.id))}
            />
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((all) => [...all, emptyDraft()])}>
            <Plus className="size-4" /> Add another change
          </Button>

          <div className="space-y-1">
            <Label htmlFor="cs-notes">Notes (optional)</Label>
            <Textarea id="cs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Toolbar and row menu ───────────────────────────────────

export function SetupToolbar({ listingId }: { listingId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [checking, startCheck] = useTransition()

  const checkNow = () =>
    startCheck(async () => {
      const res = await checkSetupNowAction(listingId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`PriceLabs check: ${res.summary || "nothing to check"}`)
      router.refresh()
    })

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Record change
      </Button>
      <Button size="sm" variant="outline" onClick={checkNow} disabled={checking}>
        <RefreshCw className={checking ? "size-4 animate-spin" : "size-4"} />
        {checking ? "Checking…" : "Check PriceLabs now"}
      </Button>
      <RecordChangeDialog listingId={listingId} open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function SettingRowMenu({ listingId, setting }: { listingId: string; setting: ListingSettingRow }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | "edit" | "verify" | "drift">(null)
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()
  const label = settingKeyDef(setting.setting_key)?.label ?? setting.setting_key
  const range = formatDateRange(setting.date_from, setting.date_to)
  const scope = [setting.channel !== "all" ? CHANNEL_LABELS[setting.channel] : null, range].filter(Boolean).join(" · ")

  const submit = () =>
    startTransition(async () => {
      const res =
        mode === "verify" ? await verifySettingAction(setting.id, text) : await flagSettingDriftAction(setting.id, text)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(mode === "verify" ? "Marked verified" : "Drift flagged")
      setMode(null)
      setText("")
      router.refresh()
    })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${label}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode("edit")}>
            <Pencil className="size-4" /> Record a new value
          </DropdownMenuItem>
          {setting.status !== "verified" && (
            <DropdownMenuItem onSelect={() => setMode("verify")}>
              <CheckCircle2 className="size-4" /> Mark verified
            </DropdownMenuItem>
          )}
          {setting.status !== "drift" && (
            <DropdownMenuItem onSelect={() => setMode("drift")}>
              <TriangleAlert className="size-4" /> Flag drift
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {mode === "edit" && (
        <RecordChangeDialog
          listingId={listingId}
          open
          onOpenChange={(o) => !o && setMode(null)}
          initial={setting}
        />
      )}

      <Dialog open={mode === "verify" || mode === "drift"} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "verify" ? "Mark verified" : "Flag drift"}</DialogTitle>
            <DialogDescription>
              {label}
              {scope ? ` (${scope})` : ""}: {formatSettingValue(setting.value)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`row-note-${setting.id}`}>{mode === "verify" ? "Where you checked (optional)" : "What you saw instead"}</Label>
            <Input
              id={`row-note-${setting.id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={mode === "verify" ? "e.g. Airbnb guest quote, Dec 24–28" : "e.g. Airbnb still allows checkout on Dec 25"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || (mode === "drift" && !text.trim())}>
              {pending ? "Saving…" : mode === "verify" ? "Mark verified" : "Flag drift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
