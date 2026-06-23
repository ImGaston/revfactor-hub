"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  createReportGroupOverrideAction,
  deleteReportGroupOverrideAction,
  getClientOptionsAction,
} from "./actions"

export type ReportOverrideRow = {
  id: string
  group_name: string
  client_id: string
  note: string | null
  created_by: string | null
  created_at: string
  client_name: string | null
}

export function ReportOverrides({ overrides }: { overrides: ReportOverrideRow[] }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null)
  const [groupName, setGroupName] = useState("")
  const [clientId, setClientId] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  // Lazy-load client options only when the dialog opens.
  useEffect(() => {
    if (dialogOpen && !clients) {
      getClientOptionsAction().then(setClients)
    }
  }, [dialogOpen, clients])

  async function handleCreate() {
    if (!groupName.trim() || !clientId) {
      toast.error("Group name and client are required")
      return
    }
    setSaving(true)
    const result = await createReportGroupOverrideAction({
      group_name: groupName,
      client_id: clientId,
      note: note || null,
    })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Override saved")
    setGroupName("")
    setClientId("")
    setNote("")
    setDialogOpen(false)
    router.refresh()
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteReportGroupOverrideAction(id)
      if (result.error) toast.error(result.error)
      else {
        toast.success("Override removed")
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Report Group Overrides
          </CardTitle>
          <CardDescription>
            Map a PriceLabs Group Name to a client when listings don&apos;t match
            by id. Used for legacy first-name groups.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 size-4" />
          Add Override
        </Button>
      </CardHeader>
      <CardContent>
        {overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No overrides. Listings resolve to clients by Listing ID or Group Name
            automatically.
          </p>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {o.group_name}
                  </Badge>
                  <span className="text-muted-foreground text-sm">→</span>
                  <span className="truncate text-sm font-medium">
                    {o.client_name ?? "Unknown client"}
                  </span>
                  {o.note && (
                    <span className="truncate text-xs text-muted-foreground">
                      ({o.note})
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(o.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Group Override</DialogTitle>
            <DialogDescription>
              Listings under this Group Name will attribute to the chosen client
              when they don&apos;t match a hub listing by id.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Group Name</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Carolyn"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Client</label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={clients ? "Select client..." : "Loading clients..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this override exists"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Saving..." : "Save Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
