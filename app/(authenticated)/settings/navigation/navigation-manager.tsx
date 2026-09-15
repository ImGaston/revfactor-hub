"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  FolderPlus,
  Info,
  PanelLeft,
  Pencil,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  NAV_GROUP_ICON_OPTIONS,
  NAV_ITEMS,
  buildNavTree,
  NavGroupIcon,
  type NavConfig,
  type NavGroup,
  type NavGroupIconName,
  type NavItem,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  createNavGroupAction,
  deleteNavGroupAction,
  moveNavGroupAction,
  moveNavItemAction,
  setNavItemGroupAction,
  updateNavGroupAction,
  type NavGroupInput,
} from "./actions"

const TOP_LEVEL = "__top__"

type ActionResult = Awaited<ReturnType<typeof createNavGroupAction>>

export function NavigationManager({ initialConfig }: { initialConfig: NavConfig }) {
  const router = useRouter()
  const [config, setConfig] = useState<NavConfig>(initialConfig)
  const [pending, startTransition] = useTransition()
  const [dialog, setDialog] = useState<{ open: boolean; group: NavGroup | null }>({
    open: false,
    group: null,
  })
  const [deleting, setDeleting] = useState<NavGroup | null>(null)

  // The manager shows every section regardless of the editor's own
  // permissions — folders are shared config, filtering happens per viewer.
  const tree = buildNavTree(NAV_ITEMS, config, { includeEmptyGroups: true })

  function run(task: () => Promise<ActionResult>, successMessage?: string) {
    startTransition(async () => {
      const result = await task()
      if (result.error !== null) {
        toast.error(result.error)
        return
      }
      setConfig(result.config)
      if (successMessage) toast.success(successMessage)
      // Re-render the sidebar in the authenticated layout.
      router.refresh()
    })
  }

  function moveItem(item: NavItem, target: string) {
    const groupId = target === TOP_LEVEL ? null : target
    run(() => setNavItemGroupAction(item.key, groupId))
  }

  const folderOptions = tree.groups.map((g) => g.group)

  function renderItemRow(
    item: NavItem,
    currentGroupId: string | null,
    position?: { index: number; count: number }
  ) {
    return (
      <div
        key={item.key}
        className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
      >
        <item.icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">{item.title}</span>
        {position && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending || position.index === 0}
              onClick={() => run(() => moveNavItemAction(item.key, "up"))}
              aria-label={`Move ${item.title} up`}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending || position.index === position.count - 1}
              onClick={() => run(() => moveNavItemAction(item.key, "down"))}
              aria-label={`Move ${item.title} down`}
            >
              <ArrowDown />
            </Button>
          </div>
        )}
        <Select
          value={currentGroupId ?? TOP_LEVEL}
          onValueChange={(v) => moveItem(item, v)}
          disabled={pending}
        >
          <SelectTrigger size="sm" className="w-[170px]" aria-label={`Folder for ${item.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOP_LEVEL}>Top level</SelectItem>
            {folderOptions.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Organize the sidebar into folders. Sections at the top level show as
          they do today; sections in a folder collapse under its name — handy
          for keeping beta features apart from day-to-day work. Changes apply
          to everyone, but each person still only sees the sections their role
          can view.
        </p>
        <Button onClick={() => setDialog({ open: true, group: null })} disabled={pending}>
          <FolderPlus data-icon="inline-start" />
          New folder
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3">
        <Info className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Top-level sections keep their built-in order. Folders come after
          them, in the order below; Settings always stays last. A folder with
          no sections is hidden from the sidebar.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <PanelLeft className="size-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Top level</CardTitle>
              <CardDescription>
                {tree.topLevel.length} of {NAV_ITEMS.length} sections
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tree.topLevel.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Every section is in a folder.
            </p>
          ) : (
            <div className="space-y-0.5">
              {tree.topLevel.map((item) => renderItemRow(item, null))}
            </div>
          )}
        </CardContent>
      </Card>

      {tree.groups.map((g, index) => {
        return (
          <Card key={g.group.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <NavGroupIcon name={g.group.icon} className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="truncate">{g.group.label}</span>
                    {g.group.default_collapsed && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        Collapsed by default
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {g.items.length} {g.items.length === 1 ? "section" : "sections"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending || index === 0}
                    onClick={() => run(() => moveNavGroupAction(g.group.id, "up"))}
                    aria-label={`Move folder ${g.group.label} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending || index === tree.groups.length - 1}
                    onClick={() => run(() => moveNavGroupAction(g.group.id, "down"))}
                    aria-label={`Move folder ${g.group.label} down`}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    onClick={() => setDialog({ open: true, group: g.group })}
                    aria-label={`Edit folder ${g.group.label}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                    onClick={() => setDeleting(g.group)}
                    aria-label={`Delete folder ${g.group.label}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {g.items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No sections yet — pick this folder from a section&apos;s
                  dropdown to add it.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {g.items.map((item, i) =>
                    renderItemRow(item, g.group.id, { index: i, count: g.items.length })
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      <GroupDialog
        key={dialog.group?.id ?? "new"}
        open={dialog.open}
        group={dialog.group}
        pending={pending}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSubmit={(input) => {
          const group = dialog.group
          run(
            () =>
              group
                ? updateNavGroupAction(group.id, input)
                : createNavGroupAction(input),
            group ? "Folder updated" : "Folder created"
          )
          setDialog({ open: false, group: null })
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder &ldquo;{deleting?.label}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sections go back to the top level of the sidebar. Nothing
              else changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
              onClick={() => {
                const group = deleting
                setDeleting(null)
                if (group) run(() => deleteNavGroupAction(group.id), "Folder deleted")
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function GroupDialog({
  open,
  group,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  group: NavGroup | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: NavGroupInput) => void
}) {
  const [label, setLabel] = useState(group?.label ?? "")
  const [icon, setIcon] = useState<NavGroupIconName>(
    (group?.icon as NavGroupIconName | undefined) ?? "folder"
  )
  const [defaultCollapsed, setDefaultCollapsed] = useState(
    group?.default_collapsed ?? false
  )
  const canSubmit = label.trim().length > 0 && label.trim().length <= 40

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            onSubmit({ label: label.trim(), icon, defaultCollapsed })
          }}
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>{group ? "Edit folder" : "New folder"}</DialogTitle>
            <DialogDescription>
              A folder groups sidebar sections under one collapsible entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="nav-group-label">Name</Label>
            <Input
              id="nav-group-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Beta"
              maxLength={40}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nav-group-icon">Icon</Label>
            <Select value={icon} onValueChange={(v) => setIcon(v as NavGroupIconName)}>
              <SelectTrigger id="nav-group-icon" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAV_GROUP_ICON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <NavGroupIcon name={opt.value} className="size-4 text-muted-foreground" />
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="nav-group-collapsed">Collapsed by default</Label>
              <p className="text-xs text-muted-foreground">
                Start closed on each page load. The folder still opens itself
                when you are inside one of its sections.
              </p>
            </div>
            <Switch
              id="nav-group-collapsed"
              checked={defaultCollapsed}
              onCheckedChange={setDefaultCollapsed}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || pending}>
              {group ? "Save" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
