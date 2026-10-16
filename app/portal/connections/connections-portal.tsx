"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, Eye, EyeOff, Info, Lock, PlugZap, ShieldCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PMS_PROVIDER_CONFIG,
  PMS_PROVIDERS,
  PMS_STATUS_TONE,
  pmsStatusLabel,
  validatePmsCredential,
  type PmsProvider,
  type PortalPmsConnection,
} from "@/lib/pms-connections"
import { disconnectPmsConnectionAction, submitPmsConnectionAction } from "./actions"

type Props = {
  connections: PortalPmsConnection[]
  token: string | null
  canSubmit: boolean
  preview: boolean
}

function consent(pmsLabel = "your PMS"): string {
  return `RevFactor only reads your properties, bookings and reports. We never change anything in ${pmsLabel}.`
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export function ConnectionsPortal({ connections: initial, token, canSubmit, preview }: Props) {
  const [connections, setConnections] = useState(initial)
  const [justConnected, setJustConnected] = useState<PortalPmsConnection | null>(null)

  return (
    <main className="rf-portal-main">
      <div className="rf-portal-container rf-report-stack">
        {preview && (
          <Alert className="rf-preview-notice">
            <Info aria-hidden="true" />
            <AlertDescription>Local preview with sample data. Nothing is saved or sent to a PMS.</AlertDescription>
          </Alert>
        )}

        <header className="rf-report-header">
          <div className="rf-report-hero">
            <div className="rf-report-identity">
              <div className="rf-brand-line">
                <span className="rf-wordmark">revfactor</span>
                <span className="rf-brand-separator" aria-hidden="true" />
                <span>Data connections</span>
              </div>
              <p className="rf-eyebrow">Your PMS</p>
              <h1 className="rf-report-title">Connect your PMS</h1>
              <p className="rf-conn-hero-copy">
                Give us read-only access to your property management system so we can see your bookings and
                results without asking you for reports.
              </p>
            </div>
          </div>
          <div className="rf-report-intro">
            <p className="rf-conn-consent">
              <ShieldCheck aria-hidden="true" />
              <span>{consent()}</span>
            </p>
          </div>
        </header>

        {justConnected && (
          <section className="rf-section-card rf-conn-result" aria-live="polite">
            <div className="rf-conn-result-body">
              <CheckCircle2 aria-hidden="true" />
              <div>
                {justConnected.status === "connected" ? (
                  <>
                    <p className="rf-conn-result-title">
                      Connected · {justConnected.propertyCount ?? 0}{" "}
                      {justConnected.propertyCount === 1 ? "property" : "properties"} found
                    </p>
                    {justConnected.propertyNames.length > 0 && (
                      <ul className="rf-conn-property-list">
                        {justConnected.propertyNames.map((name, i) => (
                          <li key={`${name}-${i}`}>{name}</li>
                        ))}
                      </ul>
                    )}
                    <p className="rf-conn-muted">
                      Our team will match these to your listings. Nothing is imported until they confirm each one.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="rf-conn-result-title">Received – pending verification</p>
                    <p className="rf-conn-muted">
                      Thanks. Our team will check your {justConnected.providerLabel} details and let you know in the
                      portal.
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {connections.length > 0 && (
          <section className="rf-section-card">
            <div className="rf-section-heading">
              <h2>Your connections</h2>
            </div>
            <ul className="rf-conn-list">
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  token={token}
                  canSubmit={canSubmit}
                  preview={preview}
                  onDisconnected={() => {
                    setConnections((prev) => prev.filter((c) => c.id !== connection.id))
                    setJustConnected((prev) => (prev?.id === connection.id ? null : prev))
                  }}
                />
              ))}
            </ul>
          </section>
        )}

        <ConnectForm
          token={token}
          canSubmit={canSubmit}
          preview={preview}
          onConnected={(connection) => {
            setConnections((prev) => [connection, ...prev.filter((c) => c.id !== connection.id)])
            setJustConnected(connection)
          }}
        />
      </div>
    </main>
  )
}

function ConnectionRow({
  connection,
  token,
  canSubmit,
  preview,
  onDisconnected,
}: {
  connection: PortalPmsConnection
  token: string | null
  canSubmit: boolean
  preview: boolean
  onDisconnected: () => void
}) {
  const [pending, startTransition] = useTransition()

  function disconnect() {
    if (preview) {
      onDisconnected()
      toast.success("Disconnected (preview)")
      return
    }
    if (!token) return
    startTransition(async () => {
      const result = await disconnectPmsConnectionAction({ token, connectionId: connection.id })
      if (result.ok) {
        onDisconnected()
        toast.success(`${connection.providerLabel} disconnected. We deleted the stored key.`)
      } else {
        toast.error(result.error)
      }
    })
  }

  const live = connection.status === "connected" || connection.status === "error"

  return (
    <li className="rf-conn-row">
      <div className="rf-conn-row-main">
        <div className="rf-conn-row-title">
          <PlugZap aria-hidden="true" />
          <span>{connection.providerLabel}</span>
          <Badge variant="outline" className="rf-status-badge" data-tone={PMS_STATUS_TONE[connection.status]}>
            {pmsStatusLabel(connection.status)}
          </Badge>
        </div>
        <dl className="rf-conn-meta">
          {connection.tokenLast4 && (
            <div>
              <dt>Key</dt>
              <dd className="rf-conn-mono">•••• {connection.tokenLast4}</dd>
            </div>
          )}
          <div>
            <dt>{live ? "Connected" : "Submitted"}</dt>
            <dd>{formatDate(connection.createdAt)}</dd>
          </div>
          {connection.expiresAt ? (
            <div>
              <dt>Expires</dt>
              <dd>{formatDate(connection.expiresAt)}</dd>
            </div>
          ) : (
            <div>
              <dt>Renewal reminder</dt>
              <dd>{formatDate(connection.remindAt)}</dd>
            </div>
          )}
          {connection.propertyCount != null && (
            <div>
              <dt>Properties</dt>
              <dd>{connection.propertyCount}</dd>
            </div>
          )}
        </dl>
        {connection.status === "error" && (
          <p className="rf-conn-error">
            We couldn&apos;t read your account with this key anymore. It may have expired. Disconnect it and add a new
            one.
          </p>
        )}
        {connection.status === "rejected" && (
          <p className="rf-conn-error">
            These details didn&apos;t work for us. Disconnect them and add new ones, or message us in the portal.
          </p>
        )}
      </div>
      {canSubmit && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={pending}>
              {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {connection.providerLabel}?</AlertDialogTitle>
              <AlertDialogDescription>
                We&apos;ll delete the stored key and stop reading your account. To revoke it completely, also delete
                the key in {connection.providerLabel}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={disconnect}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  )
}

function ConnectForm({
  token,
  canSubmit,
  preview,
  onConnected,
}: {
  token: string | null
  canSubmit: boolean
  preview: boolean
  onConnected: (connection: PortalPmsConnection) => void
}) {
  const [provider, setProvider] = useState<PmsProvider | "">("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [expiresAt, setExpiresAt] = useState("")
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const config = provider ? PMS_PROVIDER_CONFIG[provider] : null

  function reset(next: PmsProvider | "") {
    setProvider(next)
    setValues({})
    setExpiresAt("")
    setRevealed({})
    setFieldErrors({})
    setFormError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!config) return
    const check = validatePmsCredential({ provider: config.key, values, expiresAt })
    if (!check.ok) {
      setFieldErrors(check.fieldErrors)
      setFormError(check.error)
      return
    }
    setFieldErrors({})
    setFormError(null)

    if (preview) {
      const fake: PortalPmsConnection = {
        id: crypto.randomUUID(),
        provider: config.key,
        providerLabel: config.key === "other" ? values.provider_name?.trim() || "Other PMS" : config.label,
        status: config.liveCheck ? "connected" : "pending_verification",
        tokenLast4: check.value.tokenLast4,
        createdAt: new Date().toISOString(),
        remindAt: expiresAt || "2027-09-16",
        expiresAt: expiresAt || null,
        propertyCount: config.liveCheck ? 1 : null,
        lastValidatedAt: null,
        propertyNames: config.liveCheck ? ["Sample property"] : [],
      }
      reset("")
      onConnected(fake)
      return
    }
    if (!token) return

    const submitted = { provider: config.key, values: { ...values }, expiresAt: expiresAt || null }
    startTransition(async () => {
      const result = await submitPmsConnectionAction({ token, ...submitted })
      if (result.ok) {
        // The key is dropped from the browser as soon as it is saved.
        reset("")
        onConnected(result.connection)
        toast.success(result.liveChecked ? "Connected" : "Received – we'll verify it shortly")
      } else {
        setFieldErrors(result.fieldErrors ?? {})
        setFormError(result.error)
      }
    })
  }

  return (
    <section className="rf-section-card">
      <div className="rf-section-heading">
        <h2>Add a connection</h2>
      </div>
      {!canSubmit ? (
        <p className="rf-section-hint">Team preview: only the client can add or disconnect a connection.</p>
      ) : (
        <form className="rf-conn-form" onSubmit={submit} autoComplete="off" noValidate>
          <div className="rf-conn-field">
            <Label htmlFor="pms-provider">Select PMS</Label>
            <Select value={provider} onValueChange={(v) => reset(v as PmsProvider)}>
              <SelectTrigger id="pms-provider" className="rf-conn-select">
                <SelectValue placeholder="Choose your PMS" />
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

          {config && (
            <>
              {config.steps ? (
                <ol className="rf-conn-steps">
                  {config.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}

              {config.fields.map((field) => {
                const id = `pms-${field.key}`
                const secret = field.kind === "secret"
                const error = fieldErrors[field.key]
                return (
                  <div className="rf-conn-field" key={field.key}>
                    <Label htmlFor={id}>{field.label}</Label>
                    <div className="rf-conn-input-row">
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
                        className={secret || field.kind === "identifier" ? "rf-conn-mono" : undefined}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                      {secret && (
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={revealed[field.key] ? "Hide" : "Show"}
                          onClick={() => setRevealed((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        >
                          {revealed[field.key] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </Button>
                      )}
                    </div>
                    {error && (
                      <p id={`${id}-error`} className="rf-conn-error">
                        {error}
                      </p>
                    )}
                  </div>
                )
              })}

              <div className="rf-conn-field">
                <Label htmlFor="pms-expires">Key expiry date (optional)</Label>
                <Input
                  id="pms-expires"
                  type="date"
                  className="rf-conn-date"
                  value={expiresAt}
                  aria-invalid={Boolean(fieldErrors.expires_at)}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                {fieldErrors.expires_at ? (
                  <p className="rf-conn-error">{fieldErrors.expires_at}</p>
                ) : (
                  <p className="rf-conn-muted">If you leave this empty, we&apos;ll remind you to renew in 11 months.</p>
                )}
              </div>

              <p className="rf-conn-hint">
                <Info aria-hidden="true" />
                <span>{config.hint}</span>
              </p>

              {formError && (
                <p className="rf-conn-error" role="alert">
                  {formError}
                </p>
              )}

              <div className="rf-conn-actions">
                <Button type="submit" disabled={pending}>
                  <Lock aria-hidden="true" />
                  {pending
                    ? config.liveCheck
                      ? `Checking with ${config.label}…`
                      : "Saving…"
                    : config.liveCheck
                      ? "Connect"
                      : "Submit securely"}
                </Button>
                <p className="rf-conn-muted">
                  Your key is encrypted as soon as it reaches us and is never shown again.{" "}
                  {consent(config.key === "other" ? "your PMS" : config.label)}
                </p>
              </div>
            </>
          )}
        </form>
      )}
    </section>
  )
}
