import { History, Info } from "lucide-react"

import { ListingOutcomes } from "@/components/listings/listing-outcomes"
import { SettingRowMenu, SetupToolbar } from "@/components/listings/listing-setup-controls"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ACTION_LABELS,
  CHANNEL_LABELS,
  STATUS_LABELS,
  SYSTEM_LABELS,
  formatDateRange,
  formatSettingValue,
  groupSettings,
  settingKeyDef,
  type ListingSettingChangeRow,
  type ListingSetup,
  type SettingStatus,
} from "@/lib/listing-settings"
import { cn } from "@/lib/utils"

const statusClasses: Record<SettingStatus, string> = {
  planned: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  applied: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  drift: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  retired: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
}

// Rendered on the server, so the zone is the server's (UTC on Vercel); label it.
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

const newestFirst = <T,>(rows: T[], at: (row: T) => string) =>
  [...rows].sort((a, b) => at(b).localeCompare(at(a)))

function settingLabel(key: string) {
  return settingKeyDef(key)?.label ?? key
}

function scopeLabel(row: { channel: keyof typeof CHANNEL_LABELS; date_from: string | null; date_to: string | null }) {
  const parts: string[] = []
  if (row.channel !== "all") parts.push(CHANNEL_LABELS[row.channel])
  const range = formatDateRange(row.date_from, row.date_to)
  if (range) parts.push(range)
  return parts.join(" · ")
}

/** Read-only Setup tab: current decided settings and their change history. */
export function ListingSetupTab({
  listingId,
  setup,
  preview = false,
  canEdit = false,
  canViewResults = false,
}: {
  listingId: string
  setup: ListingSetup
  preview?: boolean
  /** listings:edit — record changes, verify, flag drift, run the PriceLabs check. */
  canEdit?: boolean
  /** reservations:view — the Results section reads booking revenue. */
  canViewResults?: boolean
}) {
  // Preview data is a local fixture; never offer writes against it.
  const editable = canEdit && !preview
  if (!setup.available) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-6 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          {setup.reason === "not_migrated"
            ? "Setup tracking isn't enabled yet (the listing settings tables haven't been created)."
            : "Couldn't load the setup for this listing. Try again in a moment."}
        </CardContent>
      </Card>
    )
  }

  const { settings } = setup
  const changes = newestFirst(setup.changes, (c) => c.occurred_at)
  const changeSets = newestFirst(setup.changeSets, (cs) => cs.created_at)
  if (settings.length === 0 && changes.length === 0) {
    return (
      <div className="space-y-4">
        {editable && <SetupToolbar listingId={listingId} />}
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No setup recorded for this listing yet.
            {editable && " Use Record change to log the first decisions (min/base/max, markups, fees, stay rules)."}
          </CardContent>
        </Card>
      </div>
    )
  }

  const changesById = new Map(changes.map((c) => [c.id, c]))
  const changesBySet = new Map<string | null, ListingSettingChangeRow[]>()
  for (const c of changes) {
    const list = changesBySet.get(c.change_set_id) ?? []
    list.push(c)
    changesBySet.set(c.change_set_id, list)
  }
  const ungrouped = changesBySet.get(null) ?? []
  const counts = settings.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {preview && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Preview data (local only). Nothing here is read from or written to the database.
        </p>
      )}

      {editable && <SetupToolbar listingId={listingId} />}

      {canViewResults && !preview && changeSets.length > 0 && (
        <ListingOutcomes listingId={listingId} canSummarize={editable} />
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_LABELS) as SettingStatus[])
          .filter((s) => counts[s])
          .map((s) => (
            <Badge key={s} variant="secondary" className={cn("font-normal", statusClasses[s])}>
              {STATUS_LABELS[s]}: {counts[s]}
            </Badge>
          ))}
      </div>

      {groupSettings(settings).map((group) => (
        <Card key={group.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Setting</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className={editable ? undefined : "pr-6"}>Last change</TableHead>
                  {editable && <TableHead className="w-10 pr-4" aria-label="Actions" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((s) => {
                  const last = s.last_change_id ? changesById.get(s.last_change_id) : undefined
                  const scope = scopeLabel(s)
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="pl-6 align-top">
                        <div className="font-medium">{settingLabel(s.setting_key)}</div>
                        {scope && <div className="text-xs text-muted-foreground">{scope}</div>}
                      </TableCell>
                      <TableCell className="min-w-36 align-top whitespace-normal break-words">
                        {formatSettingValue(s.value)}
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">
                        {SYSTEM_LABELS[s.system] ?? s.system}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="secondary" className={cn("font-normal", statusClasses[s.status])}>
                          {STATUS_LABELS[s.status]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "align-top text-xs text-muted-foreground whitespace-normal",
                          !editable && "pr-6"
                        )}
                      >
                        {last ? (
                          <>
                            <div>{fmtDateTime(last.occurred_at)}</div>
                            {last.reason && <div className="text-foreground/80">{last.reason}</div>}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {editable && (
                        <TableCell className="pr-4 align-top">
                          <SettingRowMenu listingId={listingId} setting={s} />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <History className="size-4" />
            Change history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {changeSets.map((cs) => (
            <ChangeSetBlock
              key={cs.id}
              title={cs.title}
              subtitle={[
                cs.approved_by_label ? `Approved by ${cs.approved_by_label}` : null,
                cs.approved_at ? fmtDateTime(cs.approved_at) : null,
                cs.plan_ref,
              ]
                .filter(Boolean)
                .join(" · ")}
              status={cs.status}
              notes={cs.notes}
              changes={changesBySet.get(cs.id) ?? []}
            />
          ))}
          {ungrouped.length > 0 && (
            <ChangeSetBlock title="Automatic checks and one-off updates" subtitle="PriceLabs check, Mark verified, Flag drift" status={null} notes={null} changes={ungrouped} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ChangeSetBlock({
  title,
  subtitle,
  status,
  notes,
  changes,
}: {
  title: string
  subtitle: string
  status: string | null
  notes: string | null
  changes: ListingSettingChangeRow[]
}) {
  return (
    <details className="group rounded-md border px-4 py-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status && (
            <Badge variant="outline" className="font-normal capitalize">
              {status}
            </Badge>
          )}
          <span>
            {changes.length} change{changes.length === 1 ? "" : "s"}
          </span>
        </div>
      </summary>
      {notes && <p className="mt-2 text-sm text-muted-foreground">{notes}</p>}
      <ul className="mt-3 space-y-2">
        {changes.map((c) => {
          const scope = scopeLabel(c)
          return (
            <li key={c.id} className="rounded border-l-2 border-muted pl-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{settingLabel(c.setting_key)}</span>
                {scope && <span className="text-xs text-muted-foreground">{scope}</span>}
                <span className="text-xs text-muted-foreground">
                  {ACTION_LABELS[c.action]} · {SYSTEM_LABELS[c.system] ?? c.system} · {fmtDateTime(c.occurred_at)}
                </span>
              </div>
              <div className="wrap-anywhere">
                {c.old_value != null && (
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                    {formatSettingValue(c.old_value)}
                  </span>
                )}
                {c.old_value != null && c.new_value != null && <span className="text-muted-foreground"> → </span>}
                {c.new_value != null && <span>{formatSettingValue(c.new_value)}</span>}
              </div>
              {c.reason && <div className="text-xs text-muted-foreground">{c.reason}</div>}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
