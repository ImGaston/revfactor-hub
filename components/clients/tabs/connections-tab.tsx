"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Check, EyeOff, PlugZap, RefreshCw, RotateCcw, Unplug, X } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatJourneyDate } from "@/lib/client-journey"
import { formatSupportDateTime } from "@/lib/support-display"
import { pmsErrorMessage, pmsStatusLabel, PMS_STATUS_TONE, type PmsStatusTone } from "@/lib/pms-connections"
import {
  disconnectPmsConnectionStaffAction,
  loadClientConnectionsAction,
  recheckPmsConnectionAction,
  reviewPmsConnectionAction,
  updatePmsPropertyMappingAction,
  type ClientConnectionsData,
  type StaffPmsConnection,
  type StaffPmsProperty,
} from "@/app/(authenticated)/clients/[id]/connections-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

const TONE_CLASS: Record<PmsStatusTone, string> = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  bad: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
  muted: "bg-muted text-muted-foreground",
}

const MAPPING_LABEL: Record<StaffPmsProperty["mappingStatus"], string> = {
  suggested: "Suggested",
  unmatched: "Unmatched",
  confirmed: "Confirmed",
  ignored: "Ignored",
}

const MAPPING_CLASS: Record<StaffPmsProperty["mappingStatus"], string> = {
  suggested: TONE_CLASS.pending,
  unmatched: TONE_CLASS.muted,
  confirmed: TONE_CLASS.good,
  ignored: TONE_CLASS.muted,
}

const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted",
  validated: "Checked OK",
  validation_failed: "Check failed",
  verified: "Verified",
  rejected: "Rejected",
  disconnected: "Disconnected",
  mapping_confirmed: "Mapping confirmed",
  mapping_ignored: "Property ignored",
  mapping_reset: "Mapping reset",
}

function StatusBadge({ status }: { status: StaffPmsConnection["status"] }) {
  return (
    <Badge variant="outline" className={TONE_CLASS[PMS_STATUS_TONE[status]] ?? ""}>
      {pmsStatusLabel(status)}
    </Badge>
  )
}

export function ConnectionsTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientConnectionsAction(clientId), [clientId])
  const { state, reload, refresh } = useLazyTabData(load)
  const [showDisconnected, setShowDisconnected] = useState(false)

  const data = state.status === "ready" ? state.data : null
  const visible = useMemo(
    () => (data?.connections ?? []).filter((c) => showDisconnected || c.status !== "disconnected"),
    [data, showDisconnected]
  )
  const disconnectedCount = (data?.connections ?? []).filter((c) => c.status === "disconnected").length

  if (state.status === "loading") return <TabSkeleton variant="cards" />
  if (state.status === "error") return <TabError error={state.error} onRetry={reload} />
  if (!data) return null

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Clients add read-only PMS credentials from the portal&apos;s “Connect your PMS” page. Hospitable is checked
        live; other PMSs need a manual check. Nothing is imported until each property is mapped here.
      </p>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <PlugZap className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No PMS connections yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask the client to open “Connect your PMS” in their portal.
            </p>
          </CardContent>
        </Card>
      ) : (
        visible.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            data={data}
            onChanged={refresh}
          />
        ))
      )}

      {disconnectedCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowDisconnected((v) => !v)}>
          {showDisconnected ? "Hide" : "Show"} {disconnectedCount} disconnected
        </Button>
      )}

      {data.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.events.map((e) => {
                const conn = data.connections.find((c) => c.id === e.connectionId)
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-muted-foreground">{formatSupportDateTime(e.createdAt)}</span>
                    <span className="font-medium">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                    {conn && <span className="text-muted-foreground">· {conn.providerLabel}</span>}
                    <span className="text-muted-foreground">
                      · {e.actor ?? (e.viaPortal ? "Client (portal)" : "System")}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ConnectionCard({
  connection,
  data,
  onChanged,
}: {
  connection: StaffPmsConnection
  data: ClientConnectionsData
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState("")
  const properties = data.properties.filter((p) => p.connectionId === connection.id)
  const open = connection.status !== "disconnected"
  const reviewable = ["pending_verification", "verified", "rejected"].includes(connection.status)
  const live = connection.provider === "hospitable"

  function run(task: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await task()
      if (result.ok) {
        toast.success(success)
        onChanged()
      } else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{connection.providerLabel}</CardTitle>
            <StatusBadge status={connection.status} />
            {connection.tokenLast4 && (
              <span className="font-mono text-xs text-muted-foreground">•••• {connection.tokenLast4}</span>
            )}
          </div>
          {open && data.canManage && (
            <div className="flex flex-wrap gap-2">
              {live && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => recheckPmsConnectionAction(connection.id), "Hospitable checked")}
                >
                  <RefreshCw className="mr-1 size-4" />
                  Re-check
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={pending}>
                    <Unplug className="mr-1 size-4" />
                    Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {connection.providerLabel}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The stored key is deleted from the vault and can&apos;t be recovered. Mappings and history stay.
                      The client would need to submit a new key to reconnect.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() =>
                        run(() => disconnectPmsConnectionStaffAction(connection.id), "Disconnected; key deleted")
                      }
                    >
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Submitted</dt>
            <dd>{formatJourneyDate(connection.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{connection.expiresAt ? "Expires" : "Renewal reminder"}</dt>
            <dd>{formatJourneyDate(connection.expiresAt ?? connection.remindAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last checked</dt>
            <dd>{connection.lastValidatedAt ? formatSupportDateTime(connection.lastValidatedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Properties</dt>
            <dd>{connection.propertyCount ?? "—"}</dd>
          </div>
        </dl>
        {connection.status === "error" && connection.lastErrorCode && (
          <p className="text-sm text-destructive">{pmsErrorMessage(connection.lastErrorCode)}</p>
        )}
        {connection.clientNote && (
          <p className="text-sm">
            <span className="text-muted-foreground">Client note: </span>
            {connection.clientNote}
          </p>
        )}
        {connection.reviewedAt && (
          <p className="text-sm text-muted-foreground">
            {pmsStatusLabel(connection.status)} by {connection.reviewedBy ?? "staff"} on{" "}
            {formatJourneyDate(connection.reviewedAt)}
            {connection.reviewNote ? ` — ${connection.reviewNote}` : ""}
          </p>
        )}
        {open && reviewable && data.canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 max-w-sm"
              placeholder="Review note (optional, no secrets)"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={pending || connection.status === "verified"}
              onClick={() =>
                run(
                  () => reviewPmsConnectionAction({ connectionId: connection.id, decision: "verified", note }),
                  "Marked verified"
                )
              }
            >
              <Check className="mr-1 size-4" />
              Mark verified
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || connection.status === "rejected"}
              onClick={() =>
                run(
                  () => reviewPmsConnectionAction({ connectionId: connection.id, decision: "rejected", note }),
                  "Marked rejected"
                )
              }
            >
              <X className="mr-1 size-4" />
              Reject
            </Button>
          </div>
        )}
      </CardHeader>

      {properties.length > 0 && (
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PMS property</TableHead>
                <TableHead>Airbnb ID</TableHead>
                <TableHead>Vrbo ID</TableHead>
                <TableHead>Hub listing</TableHead>
                <TableHead>Mapping</TableHead>
                {data.canMap && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((p) => (
                <PropertyRow key={p.id} property={p} data={data} disabled={!open} onChanged={onChanged} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  )
}

function PropertyRow({
  property,
  data,
  disabled,
  onChanged,
}: {
  property: StaffPmsProperty
  data: ClientConnectionsData
  disabled: boolean
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<string>(property.mappedListingId ?? property.suggestedListingId ?? "")
  const listingName = (id: string | null) => data.listings.find((l) => l.id === id)?.name ?? null
  const shown = property.mappedListingId ?? property.suggestedListingId

  function save(change: Parameters<typeof updatePmsPropertyMappingAction>[1], success: string) {
    startTransition(async () => {
      const result = await updatePmsPropertyMappingAction(property.id, change)
      if (result.ok) {
        toast.success(success)
        onChanged()
      } else toast.error(result.error)
    })
  }

  return (
    <TableRow>
      <TableCell className="min-w-48 whitespace-normal font-medium">{property.name ?? "Unnamed property"}</TableCell>
      <TableCell className="font-mono text-xs">{property.airbnbId ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs">{property.vrboId ?? "—"}</TableCell>
      <TableCell className="min-w-56 whitespace-normal">
        {data.canMap && !disabled && property.mappingStatus !== "confirmed" ? (
          <Select value={choice} onValueChange={setChoice} disabled={pending}>
            <SelectTrigger className="h-8 w-full max-w-64">
              <SelectValue placeholder="Pick a listing" />
            </SelectTrigger>
            <SelectContent>
              {data.listings.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.status !== "active" ? ` (${l.status})` : ""}
                  {l.id === property.suggestedListingId ? " · suggested" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span>
            {listingName(shown) ?? "—"}
            {property.mappingStatus === "suggested" && property.suggestionReason && (
              <span className="text-muted-foreground"> (by {property.suggestionReason === "airbnb_id" ? "Airbnb" : "Vrbo"} ID)</span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={MAPPING_CLASS[property.mappingStatus]}>
          {MAPPING_LABEL[property.mappingStatus]}
        </Badge>
        {property.confirmedBy && property.confirmedAt && (
          <div className="mt-1 text-xs text-muted-foreground">
            {property.confirmedBy} · {formatJourneyDate(property.confirmedAt)}
          </div>
        )}
      </TableCell>
      {data.canMap && (
        <TableCell className="text-right">
          {!disabled && (
            <div className="flex justify-end gap-1">
              {property.mappingStatus !== "confirmed" && (
                <Button
                  size="sm"
                  disabled={pending || !choice}
                  onClick={() => save({ mode: "confirm", listingId: choice }, "Mapping confirmed")}
                >
                  <Check className="mr-1 size-4" />
                  Confirm
                </Button>
              )}
              {property.mappingStatus !== "ignored" && property.mappingStatus !== "confirmed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => save({ mode: "ignore" }, "Property ignored")}
                >
                  <EyeOff className="mr-1 size-4" />
                  Ignore
                </Button>
              )}
              {(property.mappingStatus === "confirmed" || property.mappingStatus === "ignored") && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => save({ mode: "reset" }, "Mapping reset")}
                >
                  <RotateCcw className="mr-1 size-4" />
                  Change
                </Button>
              )}
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  )
}
