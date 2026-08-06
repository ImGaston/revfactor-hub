"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Shield,
  ShieldCheck,
  Plus,
  Trash2,
  Users,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  Lock,
  Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  RESOURCES,
  ACTIONS,
  buildPermissionMap,
  type Role,
  type RolePermission,
} from "@/lib/permissions"
import {
  createRole,
  deleteRole,
  togglePermission,
  bulkToggleResource,
  updateUserRole,
  updateRoleDescription,
} from "./actions"
import { cn } from "@/lib/utils"

type UserProfile = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
}

type RoleWithPermissions = Role & { permissions: RolePermission[] }

type Props = {
  roles: RoleWithPermissions[]
  users: UserProfile[]
}

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  publish: "Publish",
  control: "Control",
}

const ACTION_COLORS: Record<string, string> = {
  view: "text-blue-600 dark:text-blue-400",
  create: "text-green-600 dark:text-green-400",
  edit: "text-amber-600 dark:text-amber-400",
  delete: "text-red-600 dark:text-red-400",
  publish: "text-purple-600 dark:text-purple-400",
  control: "text-teal-600 dark:text-teal-400",
}

// Resource column + one column per action + the "All" column
const GRID_COLS = "grid-cols-[minmax(160px,1fr)_repeat(6,52px)_44px]"

// ─── Create Role Dialog ─────────────────────────────────────

function CreateRoleDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await createRole(formData)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Role created successfully")
      setOpen(false)
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4 mr-1.5" />
          New Role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Role</DialogTitle>
          <DialogDescription>
            Create a custom role and configure its permissions. The role name
            will be formatted as lowercase with underscores.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Role Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. viewer, manager, analyst"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              placeholder="What can this role do?"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Role Permissions Card ──────────────────────────────────

function RoleCard({
  role,
  users,
  allRoles,
}: {
  role: RoleWithPermissions
  users: UserProfile[]
  allRoles: RoleWithPermissions[]
}) {
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(role.description ?? "")
  // Optimistic checkbox state: overrides win over server data until refresh
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const isSuperAdmin = role.name === "super_admin"
  const permMap = buildPermissionMap(role.permissions)
  const roleUsers = users.filter((u) => u.role === role.name)

  function isAllowed(resource: string, action: string) {
    if (isSuperAdmin) return true
    const key = `${resource}:${action}`
    return overrides[key] ?? permMap[key] ?? false
  }

  function toggleResource(resource: string) {
    setExpandedResources((prev) => {
      const next = new Set(prev)
      if (next.has(resource)) next.delete(resource)
      else next.add(resource)
      return next
    })
  }

  async function handleToggle(resource: string, action: string, allowed: boolean) {
    const key = `${resource}:${action}`
    setOverrides((prev) => ({ ...prev, [key]: allowed }))
    const result = await togglePermission(role.name, resource, action, allowed)
    if (result.error) {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast.error(result.error)
    } else {
      router.refresh()
    }
  }

  async function handleBulkToggle(resource: string, allowed: boolean) {
    const keys = ACTIONS.map((action) => `${resource}:${action}`)
    setOverrides((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = allowed
      return next
    })
    const result = await bulkToggleResource(role.name, resource, allowed)
    if (result.error) {
      setOverrides((prev) => {
        const next = { ...prev }
        for (const key of keys) delete next[key]
        return next
      })
      toast.error(result.error)
    } else {
      router.refresh()
    }
  }

  async function handleDelete() {
    setLoading("delete")
    const result = await deleteRole(role.name)
    setLoading(null)
    setDeleteOpen(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Role "${role.name}" deleted`)
      router.refresh()
    }
  }

  async function handleSaveDescription() {
    const result = await updateRoleDescription(role.name, descValue)
    setEditingDesc(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      router.refresh()
    }
  }

  async function handleChangeUserRole(userId: string, newRole: string) {
    const result = await updateUserRole(userId, newRole)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("User role updated")
      router.refresh()
    }
  }

  // Count from the canonical RESOURCES × ACTIONS grid (not raw DB rows) so
  // totals stay correct even if the table has gaps or stale resources
  const totalCount = RESOURCES.length * ACTIONS.length
  const enabledCount = RESOURCES.reduce(
    (acc, r) => acc + ACTIONS.filter((a) => isAllowed(r.key, a)).length,
    0
  )

  function getResourcePermCount(resource: string) {
    const enabled = ACTIONS.filter((a) => isAllowed(resource, a)).length
    return { enabled, total: ACTIONS.length }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {isSuperAdmin ? (
              <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
                <ShieldCheck className="size-5 text-primary" />
              </div>
            ) : (
              <div className="flex items-center justify-center size-10 rounded-lg bg-muted">
                <Shield className="size-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {role.name.replace(/_/g, " ")}
                {role.is_system && (
                  <Badge variant="outline" className="text-[9px] font-normal">
                    System
                  </Badge>
                )}
              </CardTitle>
              {editingDesc ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <Input
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    className="h-6 text-xs px-2"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveDescription()
                      if (e.key === "Escape") setEditingDesc(false)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={handleSaveDescription}
                  >
                    <Check className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => setEditingDesc(false)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ) : (
                <CardDescription
                  className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1"
                  onClick={() => {
                    setDescValue(role.description ?? "")
                    setEditingDesc(true)
                  }}
                >
                  {role.description || "No description"}
                  <Pencil className="size-2.5" />
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs tabular-nums">
              {enabledCount}/{totalCount}
            </Badge>
            <Badge variant="outline" className="text-xs gap-1">
              <Users className="size-3" />
              {roleUsers.length}
            </Badge>
            {!role.is_system && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete role &quot;{role.name}&quot;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this role and all its
                        permissions. Users must be reassigned before deleting.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={loading === "delete"}
                      >
                        {loading === "delete" ? "Deleting..." : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ─── Users with this role ─── */}
        {roleUsers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Users ({roleUsers.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {roleUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
                >
                  <Avatar className="size-5">
                    <AvatarImage src={u.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[8px]">
                      {(
                        u.full_name?.[0] ??
                        u.email[0] ??
                        "?"
                      ).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">
                    {u.full_name ?? u.email}
                  </span>
                  {!isSuperAdmin && (
                    <Select
                      defaultValue={u.role}
                      onValueChange={(v) => handleChangeUserRole(u.id, v)}
                    >
                      <SelectTrigger className="h-6 w-auto text-[10px] px-2 border-dashed">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allRoles.map((r) => (
                          <SelectItem key={r.name} value={r.name}>
                            {r.name.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* ─── Permissions grid ─── */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Permissions
          </p>

          {isSuperAdmin ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <Lock className="size-4" />
              Super Admin has full access to all resources and actions. Permissions cannot be modified.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[620px] space-y-0.5">
                {/* Header row */}
                <div className={cn("grid items-center gap-1 px-3 py-1.5", GRID_COLS)}>
                  <span className="text-xs font-medium text-muted-foreground">
                    Resource
                  </span>
                  {ACTIONS.map((action) => (
                    <span
                      key={action}
                      className={cn(
                        "text-[9px] font-medium text-center uppercase tracking-wide",
                        ACTION_COLORS[action]
                      )}
                    >
                      {ACTION_LABELS[action]}
                    </span>
                  ))}
                  <span className="text-[9px] font-medium text-center text-muted-foreground uppercase tracking-wide">
                    All
                  </span>
                </div>

                {RESOURCES.map((resource) => {
                  const { enabled, total } = getResourcePermCount(resource.key)
                  const allEnabled = enabled === total
                  const isExpanded = expandedResources.has(resource.key)

                  return (
                    <Collapsible
                      key={resource.key}
                      open={isExpanded}
                      onOpenChange={() => toggleResource(resource.key)}
                    >
                      <div
                        className={cn(
                          "grid items-center gap-1 rounded-md px-3 py-2 transition-colors",
                          GRID_COLS,
                          "hover:bg-muted/50"
                        )}
                      >
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-2 text-sm font-medium text-left">
                            {isExpanded ? (
                              <ChevronDown className="size-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-3.5 text-muted-foreground" />
                            )}
                            {resource.label}
                            <Badge
                              variant="secondary"
                              className="text-[9px] tabular-nums ml-1"
                            >
                              {enabled}/{total}
                            </Badge>
                          </button>
                        </CollapsibleTrigger>

                        {ACTIONS.map((action) => (
                          <div key={action} className="flex justify-center">
                            <Checkbox
                              checked={isAllowed(resource.key, action)}
                              onCheckedChange={(checked) =>
                                handleToggle(
                                  resource.key,
                                  action,
                                  checked === true
                                )
                              }
                              aria-label={`${resource.label} ${action}`}
                            />
                          </div>
                        ))}

                        <div className="flex justify-center">
                          <Checkbox
                            checked={allEnabled}
                            onCheckedChange={(checked) =>
                              handleBulkToggle(resource.key, checked === true)
                            }
                            aria-label={`Toggle all ${resource.label}`}
                          />
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="pl-10 pr-3 pb-2">
                          <p className="text-xs text-muted-foreground">
                            {resource.description}
                          </p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Component ─────────────────────────────────────────

export function RolesManager({ roles, users }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage roles and configure what each role can access across the hub.
          </p>
        </div>
        <CreateRoleDialog />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3">
        <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Changes take effect immediately. Toggle individual checkboxes or use
          the &quot;All&quot; column to enable/disable all actions for a resource at once.
        </p>
      </div>

      <div className="space-y-4">
        {roles.map((role) => (
          <RoleCard
            key={role.name}
            role={role}
            users={users}
            allRoles={roles}
          />
        ))}
      </div>
    </div>
  )
}
