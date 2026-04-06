"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createLead, updateLead, updateLeadTags, updateLeadTeam } from "./actions"
import { STAGE_COLUMNS } from "./pipeline-kanban"
import type { Lead, LeadTag } from "@/lib/types"

const SERVICE_TYPES = [
  { value: "a_ideal_fit", label: "A – Ideal Fit" },
  { value: "b_needs_evaluation", label: "B – Needs Evaluation" },
  { value: "c_not_a_fit", label: "C – Not a Fit" },
]

const LEAD_SOURCES = [
  { value: "landing_page", label: "Landing Page" },
  { value: "referral", label: "Referral" },
  { value: "web_form", label: "Web Form" },
  { value: "social_media", label: "Social Media" },
  { value: "cold_outreach", label: "Cold Outreach" },
  { value: "other", label: "Other" },
]

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (ART)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Madrid", label: "Madrid (CET)" },
]

type ProfileOption = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStage: string
  tags: LeadTag[]
  profiles: ProfileOption[]
  lead?: Lead
}

export function LeadFormDialog({
  open,
  onOpenChange,
  defaultStage,
  tags,
  profiles,
  lead,
}: Props) {
  const isEditing = !!lead
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    new Set(lead?.lead_tag_assignments?.map((a) => a.lead_tags.id) ?? [])
  )
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(
    new Set(lead?.lead_team_assignments?.map((a) => a.profile_id) ?? [])
  )
  const router = useRouter()

  function handleTagToggle(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  function handleTeamToggle(profileId: string) {
    setSelectedTeam((prev) => {
      const next = new Set(prev)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)

    if (isEditing) {
      const result = await updateLead(lead.id, {
        project_name: formData.get("project_name") as string,
        full_name: (formData.get("full_name") as string) || null,
        email: (formData.get("email") as string) || null,
        phone: (formData.get("phone") as string) || null,
        service_type: (formData.get("service_type") as string) || null,
        lead_source: (formData.get("lead_source") as string) || null,
        description: (formData.get("description") as string) || null,
        scheduled_date: (formData.get("scheduled_date") as string) || null,
        timezone: (formData.get("timezone") as string) || null,
        location: (formData.get("location") as string) || null,
        stage: (formData.get("stage") as string) || lead.stage,
      })

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      await updateLeadTags(lead.id, Array.from(selectedTags))
      await updateLeadTeam(lead.id, Array.from(selectedTeam))
    } else {
      formData.delete("tag_ids")
      formData.delete("team_ids")
      for (const tagId of selectedTags) {
        formData.append("tag_ids", tagId)
      }
      for (const profileId of selectedTeam) {
        formData.append("team_ids", profileId)
      }

      const result = await createLead(formData)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
    }

    setLoading(false)
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Lead" : "New Lead"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="space-y-2">
            <Label htmlFor="lead-project-name">Project Name</Label>
            <Input
              id="lead-project-name"
              name="project_name"
              placeholder="Project name"
              defaultValue={lead?.project_name ?? ""}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lead-full-name">Contact Name</Label>
              <Input
                id="lead-full-name"
                name="full_name"
                placeholder="Full name"
                defaultValue={lead?.full_name ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-email">Email</Label>
              <Input
                id="lead-email"
                name="email"
                type="email"
                placeholder="email@example.com"
                defaultValue={lead?.email ?? ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-phone">Phone</Label>
            <Input
              id="lead-phone"
              name="phone"
              placeholder="+1 (555) 000-0000"
              defaultValue={lead?.phone ?? ""}
            />
          </div>

          {/* Lead Details */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Service Type</Label>
              <Select name="service_type" defaultValue={lead?.service_type ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lead Source</Label>
              <Select name="lead_source" defaultValue={lead?.lead_source ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-description">Description</Label>
            <Textarea
              id="lead-description"
              name="description"
              placeholder="Notes about this lead..."
              rows={3}
              defaultValue={lead?.description ?? ""}
            />
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lead-scheduled-date">Scheduled Date</Label>
              <Input
                id="lead-scheduled-date"
                name="scheduled_date"
                type="datetime-local"
                defaultValue={
                  lead?.scheduled_date
                    ? new Date(lead.scheduled_date).toISOString().slice(0, 16)
                    : ""
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select name="timezone" defaultValue={lead?.timezone ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone..." />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-location">Location</Label>
            <Input
              id="lead-location"
              name="location"
              placeholder="City, State or Address"
              defaultValue={lead?.location ?? ""}
            />
          </div>

          {/* Pipeline */}
          <div className="space-y-2">
            <Label>Stage</Label>
            <Select name="stage" defaultValue={lead?.stage ?? defaultStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_COLUMNS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-3">
                {tags.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedTags.has(t.id)}
                      onCheckedChange={() => handleTagToggle(t.id)}
                    />
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Team */}
          {profiles.length > 0 && (
            <div className="space-y-2">
              <Label>Team Members</Label>
              <div className="flex flex-wrap gap-3">
                {profiles.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedTeam.has(p.id)}
                      onCheckedChange={() => handleTeamToggle(p.id)}
                    />
                    {p.full_name ?? p.email}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save Changes"
                  : "Create Lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
