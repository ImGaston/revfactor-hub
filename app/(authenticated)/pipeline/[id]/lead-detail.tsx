"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Archive,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RotateCcw,
  Send,
  Trash2,
  User,
  UserPlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LeadFormDialog } from "../lead-form-dialog"
import { STAGE_COLUMNS } from "../pipeline-kanban"
import { updateLead, deleteLead, archiveLead, unarchiveLead, completeLead, uncompleteLead, createAssemblyClientForLead, sendContractToAssembly } from "../actions"
import type { Lead, LeadTag } from "@/lib/types"

type ProfileOption = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

type ContractTemplate = {
  id: string
  name: string
}

type Props = {
  lead: Lead
  tags: LeadTag[]
  profiles: ProfileOption[]
  contractTemplates?: ContractTemplate[]
}

const LEAD_SOURCE_LABELS: Record<string, string> = {
  landing_page: "Landing Page",
  referral: "Referral",
  web_form: "Web Form",
  social_media: "Social Media",
  cold_outreach: "Cold Outreach",
  other: "Other",
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  a_ideal_fit: "A – Ideal Fit",
  b_needs_evaluation: "B – Needs Evaluation",
  c_not_a_fit: "C – Not a Fit",
}

export function LeadDetail({ lead, tags, profiles, contractTemplates = [] }: Props) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
  const [sendingContract, setSendingContract] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    contractTemplates[0]?.id ?? ""
  )

  const leadTags = lead.lead_tag_assignments?.map((a) => a.lead_tags) ?? []
  const team = lead.lead_team_assignments ?? []

  function getStageColor(stage: string) {
    return STAGE_COLUMNS.find((c) => c.id === stage)?.color ?? "#6b7280"
  }

  function getStageLabel(stage: string) {
    return STAGE_COLUMNS.find((c) => c.id === stage)?.label ?? stage
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return null
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return null
    const d = new Date(dateStr)
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }

  async function handleStageChange(newStage: string) {
    await updateLead(lead.id, { stage: newStage })
    router.refresh()
  }

  async function handleContractToggle(
    field: "contract_sent" | "contract_signed",
    checked: boolean
  ) {
    await updateLead(lead.id, { [field]: checked })
    router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    const result = await deleteLead(lead.id)
    if (result.error) {
      toast.error(result.error)
      setDeleting(false)
    } else {
      router.push("/pipeline")
    }
  }

  async function handleArchive() {
    const result = await archiveLead(lead.id)
    if (result.error) toast.error(result.error)
    else { toast.success("Lead archived"); router.refresh() }
  }

  async function handleUnarchive() {
    const result = await unarchiveLead(lead.id)
    if (result.error) toast.error(result.error)
    else { toast.success("Lead reactivated"); router.refresh() }
  }

  async function handleComplete() {
    const result = await completeLead(lead.id)
    if (result.error) toast.error(result.error)
    else { toast.success("Lead marked as completed"); router.refresh() }
  }

  async function handleUncomplete() {
    const result = await uncompleteLead(lead.id)
    if (result.error) toast.error(result.error)
    else { toast.success("Lead reopened"); router.refresh() }
  }

  async function handleCreateAssemblyClient() {
    setCreatingClient(true)
    const result = await createAssemblyClientForLead(lead.id)
    setCreatingClient(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Client created in Assembly", {
        description: "The client has been invited to the portal.",
      })
      router.refresh()
    }
  }

  async function handleSendContract() {
    if (!selectedTemplateId) {
      toast.error("Select a contract template first")
      return
    }
    setSendingContract(true)
    const result = await sendContractToAssembly(lead.id, selectedTemplateId)
    setSendingContract(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      const name = result.contractName ?? "Contract"
      toast.success(`${name} sent via Assembly`, {
        description: "Contract created and welcome message sent.",
      })
      router.refresh()
    }
  }

  function copyPortalUrl() {
    if (lead.client_portal_url) {
      navigator.clipboard.writeText(lead.client_portal_url)
      toast.success("Portal URL copied")
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/pipeline")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {lead.project_name}
          </h1>
          {lead.full_name && (
            <p className="text-sm text-muted-foreground">{lead.full_name}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-3.5 mr-1.5" />
          Edit
        </Button>
      </div>

      {/* Archive/Complete banner */}
      {lead.is_archived && (
        <div className="flex items-center justify-between rounded-lg border border-muted bg-muted/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Archive className="size-4" />
            <span>
              This lead was archived
              {lead.archived_at && ` on ${formatDate(lead.archived_at)}`}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleUnarchive}>
            <RotateCcw className="size-3.5 mr-1.5" />
            Reactivate
          </Button>
        </div>
      )}
      {lead.is_completed && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4" />
            <span>
              This lead was completed
              {lead.completed_at && ` on ${formatDate(lead.completed_at)}`}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleUncomplete}>
            <RotateCcw className="size-3.5 mr-1.5" />
            Reopen
          </Button>
        </div>
      )}

      {/* Main layout: Content + Sidebar */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Content area */}
        <div className="flex-1 space-y-6">
          {/* Description */}
          {lead.description && (
            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold mb-2">Description</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {lead.description}
              </p>
            </div>
          )}

          {/* Contact Info */}
          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Contact Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lead.full_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="size-4 text-muted-foreground" />
                  <span>{lead.full_name}</span>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="size-4 text-muted-foreground" />
                  <span>{lead.email}</span>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="size-4 text-muted-foreground" />
                  <span>{lead.phone}</span>
                </div>
              )}
              {lead.location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span>{lead.location}</span>
                </div>
              )}
              {lead.timezone && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="size-4 text-muted-foreground" />
                  <span>{lead.timezone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Details Grid */}
          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">
                  Service Type
                </p>
                <p>
                  {lead.service_type
                    ? SERVICE_TYPE_LABELS[lead.service_type] ?? lead.service_type
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">
                  Lead Source
                </p>
                <p>
                  {lead.lead_source
                    ? LEAD_SOURCE_LABELS[lead.lead_source] ?? lead.lead_source
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">
                  Scheduled Date
                </p>
                <p>{formatDateTime(lead.scheduled_date) ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">
                  Start Date
                </p>
                <p>{formatDate(lead.start_date) ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">
                  End Date
                </p>
                <p>{formatDate(lead.end_date) ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Created</p>
                <p>{formatDateTime(lead.created_at) ?? "—"}</p>
              </div>
            </div>
          </div>

          {/* Phase 2 tabs placeholder */}
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            Activity, Files, Tasks, Financials & Notes tabs coming soon.
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[270px] shrink-0 space-y-5">
          {/* Stage */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Stage
            </p>
            <Select value={lead.stage} onValueChange={handleStageChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_COLUMNS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Archive / Complete */}
          <div className="flex gap-2">
            {lead.is_archived ? (
              <Button variant="outline" size="sm" className="flex-1" onClick={handleUnarchive}>
                <RotateCcw className="size-3.5 mr-1.5" />
                Unarchive
              </Button>
            ) : lead.is_completed ? (
              <Button variant="outline" size="sm" className="flex-1" onClick={handleUncomplete}>
                <RotateCcw className="size-3.5 mr-1.5" />
                Reopen
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleComplete}>
                  <CheckCircle2 className="size-3.5 mr-1.5" />
                  Complete
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleArchive}>
                  <Archive className="size-3.5 mr-1.5" />
                  Archive
                </Button>
              </>
            )}
          </div>

          <Separator />

          {/* Contract Status */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Contract
            </p>

            {/* Step 1: Create Assembly Client */}
            {!lead.assembly_client_id ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={creatingClient || !lead.email || !lead.full_name}
                  onClick={handleCreateAssemblyClient}
                >
                  {creatingClient ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <UserPlus className="size-3.5 mr-1.5" />
                  )}
                  {creatingClient ? "Creating..." : "Create Client in Assembly"}
                </Button>
                {(!lead.email || !lead.full_name) && (
                  <p className="text-[10px] text-muted-foreground">
                    Requires lead email and name.
                  </p>
                )}
              </>
            ) : (
              <>
                {/* Client exists — show status */}
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <CheckCircle2 className="size-3" />
                  <span>Assembly client linked</span>
                </div>

                {/* Step 2: Select template + Send Contract */}
                {contractTemplates.length > 0 ? (
                  <div className="space-y-2">
                    <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select contract..." />
                      </SelectTrigger>
                      <SelectContent>
                        {contractTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={sendingContract || !selectedTemplateId}
                      onClick={handleSendContract}
                    >
                      {sendingContract ? (
                        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Send className="size-3.5 mr-1.5" />
                      )}
                      {sendingContract ? "Sending..." : "Send Contract"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    No contract templates found in Assembly.
                  </p>
                )}
              </>
            )}

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={lead.contract_sent}
                onCheckedChange={(checked) =>
                  handleContractToggle("contract_sent", !!checked)
                }
              />
              Contract Sent
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={lead.contract_signed}
                onCheckedChange={(checked) =>
                  handleContractToggle("contract_signed", !!checked)
                }
              />
              Contract Signed
            </label>
          </div>

          {/* Client Portal */}
          {lead.client_portal_url && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Client Portal
                </p>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={copyPortalUrl}
                  >
                    <Copy className="size-3 mr-1" />
                    Copy URL
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={lead.client_portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </Button>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Team */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Team
            </p>
            {team.length > 0 ? (
              <div className="space-y-2">
                {team.map((t) => (
                  <div
                    key={t.profile_id}
                    className="flex items-center gap-2"
                  >
                    <Avatar className="size-6">
                      <AvatarImage
                        src={t.profiles?.avatar_url ?? undefined}
                      />
                      <AvatarFallback className="text-[9px]">
                        {(
                          t.profiles?.full_name?.[0] ??
                          t.profiles?.email[0] ??
                          "?"
                        ).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">
                      {t.profiles?.full_name ?? t.profiles?.email}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No team assigned</p>
            )}
          </div>

          <Separator />

          {/* Tags */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Tags
            </p>
            {leadTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {leadTags.map((t) => (
                  <Badge
                    key={t.id}
                    variant="outline"
                    className="text-[10px]"
                    style={{
                      backgroundColor: t.color,
                      color: "white",
                      borderColor: t.color,
                    }}
                  >
                    {t.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No tags</p>
            )}
          </div>

          <Separator />

          {/* Key Dates */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Key Dates
            </p>
            <div className="space-y-1.5 text-sm">
              {lead.scheduled_date && (
                <div className="flex items-center gap-2">
                  <Calendar className="size-3.5 text-muted-foreground" />
                  <span>{formatDateTime(lead.scheduled_date)}</span>
                </div>
              )}
              {lead.start_date && (
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span>Start: {formatDate(lead.start_date)}</span>
                </div>
              )}
              {lead.end_date && (
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span>End: {formatDate(lead.end_date)}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5 mr-1.5" />
                Delete Lead
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{lead.project_name}&quot;
                  and all associated data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Edit dialog */}
      <LeadFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        defaultStage={lead.stage}
        tags={tags}
        profiles={profiles}
        lead={lead}
      />
    </div>
  )
}
