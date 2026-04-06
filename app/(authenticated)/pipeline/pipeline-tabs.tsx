"use client"

import { useState } from "react"
import { Columns3, Table as TableIcon, Download, Upload } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { PipelineKanban, STAGE_COLUMNS } from "./pipeline-kanban"
import { PipelineTable } from "./pipeline-table"
import { ImportLeadsDialog } from "./import-leads-dialog"
import type { Lead, LeadTag } from "@/lib/types"

type ProfileOption = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

type PipelineTabsProps = {
  leads: Lead[]
  tags: LeadTag[]
  profiles: ProfileOption[]
}

function escapeCSV(value: string | null | undefined): string {
  if (!value) return ""
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function exportLeadsCSV(leads: Lead[]) {
  const headers = [
    "project_name",
    "full_name",
    "email",
    "phone",
    "service_type",
    "lead_source",
    "stage",
    "description",
    "scheduled_date",
    "timezone",
    "location",
    "start_date",
    "end_date",
    "contract_sent",
    "contract_signed",
    "client_portal_url",
    "tags",
    "team",
    "created_at",
  ]

  const rows = leads.map((l) => [
    escapeCSV(l.project_name),
    escapeCSV(l.full_name),
    escapeCSV(l.email),
    escapeCSV(l.phone),
    escapeCSV(l.service_type),
    escapeCSV(l.lead_source),
    escapeCSV(l.stage),
    escapeCSV(l.description),
    escapeCSV(l.scheduled_date),
    escapeCSV(l.timezone),
    escapeCSV(l.location),
    escapeCSV(l.start_date),
    escapeCSV(l.end_date),
    l.contract_sent ? "true" : "false",
    l.contract_signed ? "true" : "false",
    escapeCSV(l.client_portal_url),
    escapeCSV(
      l.lead_tag_assignments?.map((a) => a.lead_tags.name).join("; ") ?? ""
    ),
    escapeCSV(
      l.lead_team_assignments
        ?.map((a) => a.profiles?.full_name ?? a.profiles?.email)
        .join("; ") ?? ""
    ),
    escapeCSV(l.created_at),
  ])

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `pipeline-leads-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function PipelineTabs({ leads, tags, profiles }: PipelineTabsProps) {
  const [tab, setTab] = useState("board")
  const [importOpen, setImportOpen] = useState(false)

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabsList>
          <TabsTrigger value="board" className="gap-1.5">
            <Columns3 className="size-4" />
            Board
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5">
            <TableIcon className="size-4" />
            Table
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-3.5 mr-1.5" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportLeadsCSV(leads)}
            disabled={leads.length === 0}
          >
            <Download className="size-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>
      <TabsContent value="board" className="mt-4">
        <PipelineKanban leads={leads} tags={tags} profiles={profiles} />
      </TabsContent>
      <TabsContent value="table" className="mt-4">
        <PipelineTable leads={leads} tags={tags} profiles={profiles} />
      </TabsContent>

      <ImportLeadsDialog open={importOpen} onOpenChange={setImportOpen} />
    </Tabs>
  )
}
