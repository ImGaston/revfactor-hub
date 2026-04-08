"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowUpDown, Building2, ListChecks, Link2, Mail, Plus, Check, X, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { updateClientEmailAction } from "@/app/(authenticated)/settings/clients/actions"
import type { Client } from "@/lib/types"

const statusColor: Record<string, string> = {
  active: "bg-green-500/10 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700",
  onboarding: "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400 dark:border-blue-700",
  inactive: "bg-muted text-muted-foreground border-border",
  paused: "bg-yellow-500/10 text-yellow-700 border-yellow-300 dark:text-yellow-400 dark:border-yellow-700",
  churned: "bg-red-500/10 text-red-700 border-red-300 dark:text-red-400 dark:border-red-700",
}

type SortField = "name" | "status" | "listings" | "tasks" | "onboarding_date" | "ending_date"
type SortDir = "asc" | "desc"

export function ClientsTable({
  clients,
  isSuperAdmin,
}: {
  clients: Client[]
  isSuperAdmin: boolean
}) {
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [emailValue, setEmailValue] = useState("")
  const [savingEmail, setSavingEmail] = useState(false)
  const router = useRouter()

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  function startEditEmail(clientId: string) {
    setEditingEmailId(clientId)
    setEmailValue("")
  }

  function cancelEditEmail() {
    setEditingEmailId(null)
    setEmailValue("")
  }

  async function saveEmail(clientId: string) {
    if (!emailValue.trim()) return
    setSavingEmail(true)
    const result = await updateClientEmailAction(clientId, emailValue.trim())
    setSavingEmail(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Email added")
      setEditingEmailId(null)
      setEmailValue("")
      router.refresh()
    }
  }

  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name)
          break
        case "status":
          cmp = a.status.localeCompare(b.status)
          break
        case "listings":
          cmp = a.listings.length - b.listings.length
          break
        case "tasks": {
          const aOpen = a.tasks.filter((t) => t.status !== "done").length
          const bOpen = b.tasks.filter((t) => t.status !== "done").length
          cmp = aOpen - bOpen
          break
        }
        case "onboarding_date":
          cmp = (a.onboarding_date ?? "").localeCompare(b.onboarding_date ?? "")
          break
        case "ending_date":
          cmp = (a.ending_date ?? "").localeCompare(b.ending_date ?? "")
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [clients, sortField, sortDir])

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—"
    const d = new Date(dateStr + "T00:00:00")
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  function SortHeader({
    field,
    children,
  }: {
    field: SortField
    children: React.ReactNode
  }) {
    return (
      <TableHead
        className="cursor-pointer select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          {children}
          <ArrowUpDown className="size-3 text-muted-foreground" />
        </div>
      </TableHead>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader field="name">Name</SortHeader>
            <TableHead>Email</TableHead>
            <SortHeader field="status">Status</SortHeader>
            <SortHeader field="listings">Listings</SortHeader>
            <SortHeader field="tasks">Open Tasks</SortHeader>
            {isSuperAdmin && <TableHead className="text-right">Billing</TableHead>}
            <SortHeader field="onboarding_date">Onboarding</SortHeader>
            <SortHeader field="ending_date">End Date</SortHeader>
            <TableHead>Assembly</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={isSuperAdmin ? 9 : 8}
                className="text-center text-muted-foreground py-12"
              >
                No clients found
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((client) => {
              const openTasks = client.tasks.filter((t) => t.status !== "done").length
              const isEditingEmail = editingEmailId === client.id
              return (
                <TableRow
                  key={client.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/clients/${client.id}`)}
                >
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isEditingEmail ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          placeholder="email@example.com"
                          className="h-7 text-sm w-48"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEmail(client.id)
                            if (e.key === "Escape") cancelEditEmail()
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-green-600"
                          onClick={() => saveEmail(client.id)}
                          disabled={savingEmail || !emailValue.trim()}
                        >
                          {savingEmail ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={cancelEditEmail}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : client.email ? (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Mail className="size-3.5 shrink-0" />
                        {client.email}
                      </span>
                    ) : (
                      <button
                        onClick={() => startEditEmail(client.id)}
                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="size-3.5" />
                        Add email
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${statusColor[client.status] ?? ""}`}
                    >
                      {client.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      <Building2 className="size-3.5 text-muted-foreground" />
                      {client.listings.length}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      <ListChecks className="size-3.5 text-muted-foreground" />
                      {openTasks > 0 ? (
                        <span>{openTasks}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </span>
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell className="text-right font-mono text-sm">
                      {client.billing_amount != null
                        ? `$${client.billing_amount.toLocaleString()}`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-sm">
                    {formatDate(client.onboarding_date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(client.ending_date)}
                  </TableCell>
                  <TableCell>
                    {client.assembly_client_id ? (
                      <Link2 className="size-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
