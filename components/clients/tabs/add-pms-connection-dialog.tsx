"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { AlertTriangle, Eye, EyeOff, Info, Lock, Plus, ShieldCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatJourneyDate } from "@/lib/client-journey"
import {
  findSameProviderConnections,
  PMS_PROVIDER_CONFIG,
  PMS_PROVIDERS,
  PMS_STAFF_READ_ONLY_REMINDER,
  pmsStatusLabel,
  validatePmsCredential,
  validatePmsLabel,
  type PmsProvider,
} from "@/lib/pms-connections"
import {
  addPmsConnectionStaffAction,
  type StaffPmsConnection,
} from "@/app/(authenticated)/clients/[id]/connections-actions"

/**
 * Staff "Add connection" form on the client Data Connections tab. Uses the
 * same provider catalog and validation as the portal form; the key is sent to
 * the server action once and dropped from state as soon as it is saved.
 */
export function AddPmsConnectionDialog({
  clientId,
  connections,
  onAdded,
}: {
  clientId: string
  connections: StaffPmsConnection[]
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<PmsProvider | "">("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [label, setLabel] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const config = provider ? PMS_PROVIDER_CONFIG[provider] : null
  const duplicates = useMemo(
    () => (provider ? findSameProviderConnections(connections, provider, values.provider_name) : []),
    [connections, provider, values.provider_name]
  )

  function reset(next: PmsProvider | "") {
    setProvider(next)
    setValues({})
    setLabel("")
    setExpiresAt("")
    setRevealed({})
    setFieldErrors({})
    setFormError(null)
  }

  function onOpenChange(next: boolean) {
    if (pending) return
    setOpen(next)
    // Never keep a pasted key around after the dialog closes.
    if (!next) reset("")
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!config) return
    const check = validatePmsCredential({ provider: config.key, values, expiresAt })
    const labelCheck = validatePmsLabel(label)
    if (!check.ok || !labelCheck.ok) {
      setFieldErrors({
        ...(check.ok ? {} : check.fieldErrors),
        ...(labelCheck.ok ? {} : { label: labelCheck.error }),
      })
      setFormError(check.ok ? "Check the highlighted fields" : check.error)
      return
    }
    setFieldErrors({})
    setFormError(null)

    const payload = {
      clientId,
      provider: config.key,
      values: { ...values },
      label: label || null,
      expiresAt: expiresAt || null,
    }
    startTransition(async () => {
      const result = await addPmsConnectionStaffAction(payload)
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        setFormError(result.error)
        toast.error(result.error)
        return
      }
      reset("")
      setOpen(false)
      if (result.warning) toast.warning(result.warning)
      else if (result.status === "connected") {
        const n = result.propertyCount ?? 0
        toast.success(`${config.label} connected · ${n} ${n === 1 ? "property" : "properties"} found`)
      } else toast.success(`${payload.provider === "other" ? "Connection" : config.label} saved and marked verified`)
      onAdded()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-4" />
          Add connection
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add PMS connection</DialogTitle>
          <DialogDescription>
            Paste the client&apos;s PMS API credentials. Hospitable is checked live before saving; other PMSs are
            saved as verified by you.
          </DialogDescription>
        </DialogHeader>

        <form
          id="add-pms-connection"
          className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1"
          onSubmit={submit}
          autoComplete="off"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="staff-pms-provider">Select PMS</Label>
            <Select value={provider} onValueChange={(v) => reset(v as PmsProvider)} disabled={pending}>
              <SelectTrigger id="staff-pms-provider" className="w-full">
                <SelectValue placeholder="Choose the client's PMS" />
              </SelectTrigger>
              <SelectContent position="popper">
                {PMS_PROVIDERS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {PMS_PROVIDER_CONFIG[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Alert>
            <ShieldCheck aria-hidden="true" />
            <AlertDescription>{PMS_STAFF_READ_ONLY_REMINDER}</AlertDescription>
          </Alert>

          {config && (
            <>
              {duplicates.length > 0 && (
                <Alert>
                  <AlertTriangle aria-hidden="true" className="text-amber-600" />
                  <AlertDescription>
                    This client already has {duplicates.length === 1 ? "an active" : `${duplicates.length} active`}{" "}
                    {duplicates[0].providerLabel} connection
                    {duplicates.length === 1 ? "" : "s"} (
                    {duplicates
                      .map(
                        (d) =>
                          `${d.label ? `${d.label}, ` : ""}${d.tokenLast4 ? `•••• ${d.tokenLast4}, ` : ""}${pmsStatusLabel(d.status).toLowerCase()} since ${formatJourneyDate(d.createdAt)}`
                      )
                      .join("; ")}
                    ). You can still add this one if it&apos;s a different account.
                  </AlertDescription>
                </Alert>
              )}

              {config.fields.map((field) => {
                const id = `staff-pms-${field.key}`
                const secret = field.kind === "secret"
                const error = fieldErrors[field.key]
                return (
                  <div className="space-y-1.5" key={field.key}>
                    <Label htmlFor={id}>{field.label}</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        id={id}
                        name={field.key}
                        type={secret && !revealed[field.key] ? "password" : "text"}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        placeholder={field.placeholder}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${id}-error` : undefined}
                        className={secret || field.kind === "identifier" ? "font-mono" : undefined}
                        disabled={pending}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                      {secret && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={revealed[field.key] ? "Hide" : "Show"}
                          onClick={() => setRevealed((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        >
                          {revealed[field.key] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </Button>
                      )}
                    </div>
                    {error && (
                      <p id={`${id}-error`} className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                )
              })}

              <div className="space-y-1.5">
                <Label htmlFor="staff-pms-label">Label (optional)</Label>
                <Input
                  id="staff-pms-label"
                  placeholder="e.g. Main account, Lake houses"
                  maxLength={80}
                  disabled={pending}
                  aria-invalid={Boolean(fieldErrors.label)}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                {fieldErrors.label && <p className="text-sm text-destructive">{fieldErrors.label}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-pms-expires">Key expiry date (optional)</Label>
                <Input
                  id="staff-pms-expires"
                  type="date"
                  className="w-48"
                  disabled={pending}
                  aria-invalid={Boolean(fieldErrors.expires_at)}
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                {fieldErrors.expires_at ? (
                  <p className="text-sm text-destructive">{fieldErrors.expires_at}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Leave empty to get a renewal reminder 11 months from today.
                  </p>
                )}
              </div>

              <p className="flex gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{config.hint}</span>
              </p>

              {formError && (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
            </>
          )}
        </form>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Encrypted on save. Only the last 4 characters are shown.</p>
          <Button type="submit" form="add-pms-connection" disabled={!config || pending}>
            <Lock className="mr-1 size-4" aria-hidden="true" />
            {pending
              ? config?.liveCheck
                ? `Checking with ${config.label}…`
                : "Saving…"
              : config?.liveCheck
                ? "Check and connect"
                : "Save connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
