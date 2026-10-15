"use client"

import { useCallback, useState } from "react"
import { HelpCircle, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  CLIENT_PROFILE_TEXT_FIELDS,
  CLIENT_PROFILE_TEXT_MAX,
  EMPTY_CLIENT_PROFILE,
  EXPERIENCE_LEVELS,
  type ClientProfileValues,
} from "@/lib/client-profile"
import { formatJourneyDate } from "@/lib/client-journey"
import {
  loadClientProfileAction,
  saveClientProfileAction,
  type ClientProfileData,
} from "@/app/(authenticated)/clients/[id]/tab-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

const NO_LEVEL = "none"

export function ProfileTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientProfileAction(clientId), [clientId])
  const { state, reload, refresh } = useLazyTabData(load)

  if (state.status === "loading") return <TabSkeleton variant="cards" />
  if (state.status === "error") return <TabError error={state.error} onRetry={reload} />

  const data = state.data
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <ProfileForm
        key={data.profile?.updated_at ?? "new"}
        clientId={clientId}
        data={data}
        onSaved={refresh}
      />
      <div className="space-y-4">
        <GlanceCard glance={data.glance} />
        <QuestionsCard questions={data.questions} />
      </div>
    </div>
  )
}

function ProfileForm({
  clientId,
  data,
  onSaved,
}: {
  clientId: string
  data: ClientProfileData
  onSaved: () => void
}) {
  const initial: ClientProfileValues = data.profile ?? EMPTY_CLIENT_PROFILE
  const [values, setValues] = useState<ClientProfileValues>(initial)
  const [saving, setSaving] = useState(false)
  const readOnly = !data.canEdit || !data.profileAvailable
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  function set<K extends keyof ClientProfileValues>(key: K, value: ClientProfileValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function save() {
    setSaving(true)
    const result = await saveClientProfileAction(clientId, values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Profile saved")
    onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Client profile</CardTitle>
        <CardDescription>
          {data.profile?.updated_at
            ? `Updated ${formatJourneyDate(data.profile.updated_at)}${data.profile.updated_by_name ? ` by ${data.profile.updated_by_name}` : ""}`
            : "Who this owner is and how they like to work. Never store logins or card numbers here."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.profileAvailable && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              Saving the profile needs the client tabs migration, which isn&apos;t applied yet.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-experience">Experience</Label>
            <Select
              value={values.experience_level ?? NO_LEVEL}
              onValueChange={(v) =>
                set("experience_level", v === NO_LEVEL ? null : (v as ClientProfileValues["experience_level"]))
              }
              disabled={readOnly}
            >
              <SelectTrigger id="profile-experience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEVEL}>Not set</SelectItem>
                {EXPERIENCE_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-timezone">Timezone</Label>
            <Input
              id="profile-timezone"
              value={values.timezone ?? ""}
              maxLength={100}
              placeholder="e.g. America/Chicago"
              disabled={readOnly}
              onChange={(e) => set("timezone", e.target.value)}
            />
          </div>
        </div>
        {CLIENT_PROFILE_TEXT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`profile-${field.key}`}>{field.label}</Label>
            <Textarea
              id={`profile-${field.key}`}
              value={values[field.key] ?? ""}
              maxLength={CLIENT_PROFILE_TEXT_MAX}
              placeholder={field.placeholder}
              disabled={readOnly}
              onChange={(e) => set(field.key, e.target.value)}
            />
          </div>
        ))}
        {!readOnly && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={!dirty || saving} onClick={() => setValues(initial)}>
              Discard
            </Button>
            <Button disabled={!dirty || saving} onClick={save}>
              {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
              Save profile
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function GlanceCard({ glance }: { glance: ClientProfileData["glance"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">At a glance</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <GlanceRow label="Listings">
            <span className="font-mono">{glance.activeListings}</span> active
            {glance.totalListings > glance.activeListings && (
              <span className="text-muted-foreground"> · {glance.totalListings - glance.activeListings} inactive</span>
            )}
          </GlanceRow>
          <GlanceRow label="Channels">
            {glance.channels.length ? (
              <span className="flex flex-wrap gap-1">
                {glance.channels.map((c) => (
                  <Badge key={c} variant="secondary">
                    {c}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </GlanceRow>
          <GlanceRow label="PMS">{glance.pms ?? <span className="text-muted-foreground">Not recorded</span>}</GlanceRow>
          <GlanceRow label="Contract start">
            {glance.onboardingDate ? (
              formatJourneyDate(glance.onboardingDate)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </GlanceRow>
        </dl>
      </CardContent>
    </Card>
  )
}

function GlanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function QuestionsCard({ questions }: { questions: ClientProfileData["questions"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="size-4" />
          Open questions for the owner
          {questions && questions.length > 0 && <Badge variant="secondary">{questions.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {questions == null ? (
          <p className="text-muted-foreground">Pricing plan questions aren&apos;t in the Hub yet.</p>
        ) : questions.length === 0 ? (
          <p className="text-muted-foreground">No open questions.</p>
        ) : (
          <ul className="space-y-3">
            {questions.map((q) => (
              <li key={q.id}>
                <p className="wrap-anywhere">{q.question}</p>
                <p className="text-xs text-muted-foreground">{q.listing_name}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
