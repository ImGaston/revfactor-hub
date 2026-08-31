"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BellRing,
  Check,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { listingReviewSharePath } from "@/lib/listing-reviews"
import { createListingReviewRequestAction } from "./actions"

type LeadOption = {
  id: string
  full_name: string | null
  email: string | null
  project_name: string
}
type ProfileOption = { id: string; full_name: string | null; email: string }
type ReviewFile = {
  id: string
  property_number: number
  file_name: string
  byte_size: number
  download_url: string | null
}
type Delivery = {
  id: string
  recipient_email: string
  recipient_name: string
  recipient_roles: string[]
  status: string
  attempts: number
  sent_at: string | null
}
type ReviewRequest = {
  id: string
  public_token: string
  prospect_name: string
  prospect_email: string
  status: string
  property_count: number
  created_at: string
  last_saved_at: string | null
  submitted_at: string | null
  appointment_owner_name: string
  appointment_owner_email: string
  federico_name: string
  federico_email: string
  listing_review_files: ReviewFile[]
  listing_review_notification_deliveries: Delivery[]
}

export function ListingReviewAdmin({
  requests,
  leads,
  profiles,
  canCreate,
}: {
  requests: ReviewRequest[]
  leads: LeadOption[]
  profiles: ProfileOption[]
  canCreate: boolean
}) {
  const router = useRouter()
  const [leadId, setLeadId] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [federicoId, setFedericoId] = useState(
    () =>
      profiles.find((profile) =>
        profile.full_name?.toLowerCase().includes("federico")
      )?.id ?? ""
  )
  const [propertyCount, setPropertyCount] = useState("1")
  const [ghlContactId, setGhlContactId] = useState("")
  const [ghlAppointmentId, setGhlAppointmentId] = useState("")
  const [isPending, startTransition] = useTransition()

  function createRequest() {
    if (!leadId || !ownerId || !federicoId) {
      toast.error("Select a lead, appointment owner, and Federico.")
      return
    }
    startTransition(async () => {
      const result = await createListingReviewRequestAction({
        leadId,
        appointmentOwnerProfileId: ownerId,
        federicoProfileId: federicoId,
        propertyCount: Number(propertyCount),
        ghlContactId,
        ghlAppointmentId,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      const url = absoluteShareUrl(result.token)
      await navigator.clipboard.writeText(url)
      toast.success("Secure review link created and copied")
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Listing reviews
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create secure prospect links and review completed property financial
          submissions.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>Secure intake is live</AlertTitle>
        <AlertDescription>
          Completion recipients are queued for the appointment owner and
          Federico. Automated completion delivery is not enabled yet, so this
          page does not email, text, or change GHL.
        </AlertDescription>
      </Alert>

      {canCreate && (
        <Card className="shadow-e1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="size-4" /> Create secure review link
            </CardTitle>
            <CardDescription>
              Select the call owner and Federico before copying the link into
              the future GHL path.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Lead">
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a lead" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.full_name || lead.project_name} · {lead.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Appointment owner">
              <ProfileSelect
                value={ownerId}
                onChange={setOwnerId}
                profiles={profiles}
                placeholder="Select Federico, Emily, or Ethan"
              />
            </Field>
            <Field label="Federico (completion copy)">
              <ProfileSelect
                value={federicoId}
                onChange={setFedericoId}
                profiles={profiles}
                placeholder="Select Federico"
              />
            </Field>
            <Field label="Properties">
              <Select value={propertyCount} onValueChange={setPropertyCount}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 property</SelectItem>
                  <SelectItem value="2">2 properties</SelectItem>
                  <SelectItem value="3">3 properties</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="GHL contact ID (optional)">
              <Input
                value={ghlContactId}
                onChange={(event) => setGhlContactId(event.target.value)}
              />
            </Field>
            <Field label="GHL appointment ID (optional)">
              <Input
                value={ghlAppointmentId}
                onChange={(event) => setGhlAppointmentId(event.target.value)}
              />
            </Field>
            <div className="md:col-span-2 xl:col-span-3">
              <Button onClick={createRequest} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Copy />}
                Create and copy private link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No listing-review requests yet.
            </CardContent>
          </Card>
        ) : (
          requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))
        )}
      </div>
    </div>
  )
}

function RequestCard({ request }: { request: ReviewRequest }) {
  async function copyLink() {
    await navigator.clipboard.writeText(absoluteShareUrl(request.public_token))
    toast.success("Private link copied")
  }

  return (
    <Card className="shadow-e1">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="truncate text-lg">
              {request.prospect_name}
            </CardTitle>
            <StatusBadge status={request.status} />
          </div>
          <CardDescription className="mt-1 wrap-anywhere">
            {request.prospect_email} · {request.property_count}{" "}
            {request.property_count === 1 ? "property" : "properties"}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Copy /> Copy link
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link
              href={listingReviewSharePath(request.public_token)}
              target="_blank"
            >
              <ExternalLink /> Open
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Created" value={formatDate(request.created_at)} />
          <Meta
            label="Last saved"
            value={
              request.last_saved_at
                ? formatDate(request.last_saved_at)
                : "Not started"
            }
          />
          <Meta
            label="Submitted"
            value={
              request.submitted_at
                ? formatDate(request.submitted_at)
                : "Pending"
            }
          />
          <Meta label="Call owner" value={request.appointment_owner_name} />
        </div>

        {request.listing_review_files.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FileText className="size-4" /> Secure files
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {request.listing_review_files.map((file) => (
                <Button
                  key={file.id}
                  variant="outline"
                  className="min-w-0 justify-start"
                  disabled={!file.download_url}
                  asChild={Boolean(file.download_url)}
                >
                  {file.download_url ? (
                    <a href={file.download_url}>
                      <FileDown className="shrink-0" />
                      <span className="truncate">
                        Property {file.property_number}: {file.file_name}
                      </span>
                    </a>
                  ) : (
                    <>
                      <FileDown />
                      <span className="truncate">{file.file_name}</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
          </div>
        )}

        {request.listing_review_notification_deliveries.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <BellRing className="size-4" /> Completion notifications
            </h3>
            <div className="space-y-2">
              {request.listing_review_notification_deliveries.map(
                (delivery) => (
                  <div
                    key={delivery.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span>
                      {delivery.recipient_name}{" "}
                      <span className="text-muted-foreground">
                        (
                        {delivery.recipient_roles
                          .join(" + ")
                          .replaceAll("_", " ")}
                        )
                      </span>
                    </span>
                    <Badge variant="outline">
                      {delivery.status === "pending"
                        ? "Queued · sender disabled"
                        : delivery.status}
                    </Badge>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileSelect({
  value,
  onChange,
  profiles,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  profiles: ProfileOption[]
  placeholder: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.full_name || profile.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "submitted")
    return (
      <Badge className="gap-1 bg-emerald-600 text-white">
        <Check className="size-3" /> Submitted
      </Badge>
    )
  if (status === "draft") return <Badge variant="secondary">Draft</Badge>
  return <Badge variant="outline">{status.replaceAll("_", " ")}</Badge>
}

function absoluteShareUrl(token: string) {
  return `${window.location.origin}${listingReviewSharePath(token)}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
