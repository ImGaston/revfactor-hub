"use client"

import { useState, useMemo } from "react"
import { Plus, Pencil, Trash2, Link2, Unlink, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClientDialog } from "./client-dialog"
import { deleteClientAction, linkAssemblyClientAction, unlinkAssemblyClientAction } from "./actions"

type SettingsClient = {
  id: string
  name: string
  email: string | null
  status: string
  assembly_link: string | null
  assembly_client_id: string | null
  assembly_company_id: string | null
  onboarding_date: string | null
  ending_date: string | null
  billing_amount: number | null
  autopayment_set_up: boolean
  stripe_dashboard: string | null
  listingCount: number
}

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  onboarding: "secondary",
  inactive: "outline",
}

export function ClientsSettings({
  clients,
  assemblyConfigured,
  isSuperAdmin = false,
}: {
  clients: SettingsClient[]
  assemblyConfigured: boolean
  isSuperAdmin?: boolean
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SettingsClient | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<SettingsClient | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clients.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false
      if (q && !c.name.toLowerCase().includes(q) && !(c.email?.toLowerCase().includes(q))) return false
      return true
    })
  }, [clients, search, statusFilter])

  async function handleAssemblyLink(client: SettingsClient) {
    setLinkingId(client.id)
    if (client.assembly_client_id) {
      const result = await unlinkAssemblyClientAction(client.id)
      if (result.error) toast.error(result.error)
      else toast.success(`${client.name} unlinked from Assembly`)
    } else {
      const result = await linkAssemblyClientAction(client.id)
      if (result.error) toast.error(result.error)
      else toast.success(`${client.name} linked to Assembly`)
    }
    setLinkingId(null)
  }

  function handleNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  function handleEdit(client: SettingsClient) {
    setEditing(client)
    setDialogOpen(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteClientAction(deleteTarget.id)
    setDeleting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Client deleted")
    }
    setDeleteTarget(null)
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="onboarding">Onboarding</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              {filtered.length} of {clients.length}
            </p>
          </div>
          <Button size="sm" onClick={handleNew}>
            <Plus className="mr-1 size-4" />
            Add Client
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Email</TableHead>
                {isSuperAdmin && (
                  <TableHead className="text-right font-mono">Billing</TableHead>
                )}
                <TableHead className="text-center">Listings</TableHead>
                {assemblyConfigured && (
                  <TableHead className="text-center">Assembly</TableHead>
                )}
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[client.status] ?? "outline"}>
                      {client.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {client.email ?? "—"}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell className="text-right font-mono">
                      {client.billing_amount
                        ? `$${Number(client.billing_amount).toLocaleString()}`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    {client.listingCount}
                  </TableCell>
                  {assemblyConfigured && (
                    <TableCell className="text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={linkingId === client.id || (!client.email && !client.assembly_client_id)}
                            onClick={() => handleAssemblyLink(client)}
                          >
                            {linkingId === client.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : client.assembly_client_id ? (
                              <Link2 className="size-3.5 text-green-600" />
                            ) : (
                              <Unlink className="size-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {client.assembly_client_id
                            ? "Linked — click to unlink"
                            : client.email
                              ? "Click to link via email"
                              : "No email — cannot link"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleEdit(client)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(client)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={(isSuperAdmin ? 1 : 0) + (assemblyConfigured ? 7 : 6)} className="text-center text-muted-foreground py-8">
                    {clients.length === 0 ? "No clients yet." : "No clients match your filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ClientDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editing}
        isSuperAdmin={isSuperAdmin}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this client and all their listings, tasks, and associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
