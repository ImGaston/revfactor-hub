"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  KeyRound,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createCredential,
  updateCredential,
  deleteCredential,
} from "@/app/(authenticated)/clients/[id]/credentials-actions"
import type { ClientCredential } from "@/lib/types"

const SOFTWARE_OPTIONS = [
  "Airbnb",
  "Vrbo",
  "PMS",
  "PriceLabs",
  "Booking.com",
  "Direct",
  "Other",
]

const softwareColor: Record<string, string> = {
  Airbnb: "bg-rose-500/10 text-rose-700 border-rose-300 dark:text-rose-400",
  Vrbo: "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400",
  PMS: "bg-violet-500/10 text-violet-700 border-violet-300 dark:text-violet-400",
  PriceLabs: "bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-400",
  "Booking.com": "bg-indigo-500/10 text-indigo-700 border-indigo-300 dark:text-indigo-400",
  Direct: "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  Other: "bg-muted text-muted-foreground border-border",
}

// ─── Credential Form Dialog ─────────────────────────────

function CredentialFormDialog({
  clientId,
  credential,
  trigger,
}: {
  clientId: string
  credential?: ClientCredential
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(credential?.name ?? "")
  const [software, setSoftware] = useState(credential?.software ?? "")
  const [email, setEmail] = useState(credential?.email ?? "")
  const [password, setPassword] = useState(credential?.password ?? "")
  const [notes, setNotes] = useState(credential?.notes ?? "")
  const router = useRouter()

  const isEdit = !!credential

  function resetForm() {
    if (!isEdit) {
      setName("")
      setSoftware("")
      setEmail("")
      setPassword("")
      setNotes("")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !software) return

    setLoading(true)
    const input = {
      name: name.trim(),
      software,
      email: email.trim() || null,
      password: password || null,
      notes: notes.trim() || null,
    }

    const result = isEdit
      ? await updateCredential(credential.id, clientId, input)
      : await createCredential(clientId, input)

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(isEdit ? "Credential updated" : "Credential added")
      setOpen(false)
      resetForm()
      router.refresh()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v && isEdit) {
          setName(credential.name)
          setSoftware(credential.software)
          setEmail(credential.email ?? "")
          setPassword(credential.password ?? "")
          setNotes(credential.notes ?? "")
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Credential" : "Add Credential"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the login credentials for this service."
              : "Add login credentials for a platform or service."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cred-name">Name</Label>
              <Input
                id="cred-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Client - Vrbo"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cred-software">Software</Label>
              <Select value={software} onValueChange={setSoftware} required>
                <SelectTrigger id="cred-software">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {SOFTWARE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-email">Email / Username</Label>
            <Input
              id="cred-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-password">Password</Label>
            <Input
              id="cred-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-notes">Notes</Label>
            <Input
              id="cred-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 2FA enabled, phone verified"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim() || !software}>
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : isEdit ? (
                "Save Changes"
              ) : (
                "Add Credential"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Password Cell ──────────────────────────────────────

function PasswordCell({ value }: { value: string | null }) {
  const [visible, setVisible] = useState(false)

  if (!value) return <span className="text-muted-foreground">—</span>

  async function handleCopy() {
    await navigator.clipboard.writeText(value!)
    toast.success("Password copied")
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-sm">
        {visible ? value : "••••••••"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setVisible((v) => !v)
        }}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title={visible ? "Hide" : "Show"}
      >
        {visible ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleCopy()
        }}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────

export function ClientCredentials({
  clientId,
  credentials,
}: {
  clientId: string
  credentials: ClientCredential[]
}) {
  const [open, setOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    const result = await deleteCredential(deleteId, clientId)
    setDeleting(false)
    setDeleteId(null)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Credential deleted")
      router.refresh()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80 transition-colors"
        >
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <KeyRound className="size-4" />
          Credentials
          <span className="text-muted-foreground">
            ({credentials.length})
          </span>
        </button>
        {open && (
          <CredentialFormDialog
            clientId={clientId}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-3.5 mr-1.5" />
                Add
              </Button>
            }
          />
        )}
      </div>

      {open && (credentials.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground text-center py-6 border rounded-lg border-dashed">
          No credentials yet. Click &quot;Add&quot; to store login details.
        </p>
      ) : (
        <div className="mt-3 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Software</TableHead>
                <TableHead>Email / Username</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[70px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((cred) => (
                <TableRow key={cred.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${softwareColor[cred.software] ?? softwareColor["Other"]}`}
                    >
                      {cred.software}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {cred.email ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <PasswordCell value={cred.password} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {cred.notes ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <CredentialFormDialog
                        clientId={clientId}
                        credential={cred}
                        trigger={
                          <Button variant="ghost" size="icon" className="size-7">
                            <Pencil className="size-3" />
                          </Button>
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(cred.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete credential?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this credential. This action cannot
              be undone.
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
  )
}
