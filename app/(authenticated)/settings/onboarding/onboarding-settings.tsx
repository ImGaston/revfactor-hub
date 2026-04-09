"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ExternalLink,
} from "lucide-react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  createOnboardingTemplate,
  updateOnboardingTemplate,
  deleteOnboardingTemplate,
  reorderOnboardingTemplates,
  createOnboardingResource,
  updateOnboardingResource,
  deleteOnboardingResource,
  reorderOnboardingResources,
} from "@/app/(authenticated)/onboarding/actions"
import type { OnboardingTemplate, OnboardingResource } from "@/lib/types"

type Props = {
  templates: OnboardingTemplate[]
  resources: OnboardingResource[]
}

export function OnboardingSettings({ templates, resources }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Template dialog state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] =
    useState<OnboardingTemplate | null>(null)

  // Resource dialog state
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false)
  const [editingResource, setEditingResource] =
    useState<OnboardingResource | null>(null)

  // ─── Template handlers ─────────────────────────────

  function openNewTemplate() {
    setEditingTemplate(null)
    setTemplateDialogOpen(true)
  }

  function openEditTemplate(t: OnboardingTemplate) {
    setEditingTemplate(t)
    setTemplateDialogOpen(true)
  }

  async function handleTemplateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    if (editingTemplate) {
      await updateOnboardingTemplate(editingTemplate.id, {
        step_name: formData.get("step_name") as string,
        description: (formData.get("description") as string) || null,
      })
    } else {
      await createOnboardingTemplate(formData)
    }

    setTemplateDialogOpen(false)
    router.refresh()
  }

  async function handleDeleteTemplate(id: string) {
    startTransition(async () => {
      await deleteOnboardingTemplate(id)
      router.refresh()
    })
  }

  async function handleToggleActive(t: OnboardingTemplate) {
    startTransition(async () => {
      await updateOnboardingTemplate(t.id, { is_active: !t.is_active })
      router.refresh()
    })
  }

  function handleTemplateDragEnd(result: DropResult) {
    if (!result.destination || result.source.index === result.destination.index) return
    const newList = [...templates]
    const [moved] = newList.splice(result.source.index, 1)
    newList.splice(result.destination.index, 0, moved)
    startTransition(async () => {
      await reorderOnboardingTemplates(newList.map((t) => t.id))
      router.refresh()
    })
  }

  // ─── Resource handlers ─────────────────────────────

  function openNewResource() {
    setEditingResource(null)
    setResourceDialogOpen(true)
  }

  function openEditResource(r: OnboardingResource) {
    setEditingResource(r)
    setResourceDialogOpen(true)
  }

  async function handleResourceSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    if (editingResource) {
      await updateOnboardingResource(editingResource.id, {
        title: formData.get("title") as string,
        description: (formData.get("description") as string) || null,
        url: (formData.get("url") as string) || null,
        icon: (formData.get("icon") as string) || "📄",
      })
    } else {
      await createOnboardingResource(formData)
    }

    setResourceDialogOpen(false)
    router.refresh()
  }

  async function handleDeleteResource(id: string) {
    startTransition(async () => {
      await deleteOnboardingResource(id)
      router.refresh()
    })
  }

  function handleResourceDragEnd(result: DropResult) {
    if (!result.destination || result.source.index === result.destination.index) return
    const newList = [...resources]
    const [moved] = newList.splice(result.source.index, 1)
    newList.splice(result.destination.index, 0, moved)
    startTransition(async () => {
      await reorderOnboardingResources(newList.map((r) => r.id))
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Steps section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Onboarding Steps</CardTitle>
            <CardDescription>
              Configure the checklist steps for onboarding new clients.
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNewTemplate}>
            <Plus className="size-3.5" />
            Add Step
          </Button>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No onboarding steps yet.
            </p>
          ) : (
            <DragDropContext onDragEnd={handleTemplateDragEnd}>
              <Droppable droppableId="templates">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-2"
                  >
                    {templates.map((t, idx) => (
                      <Draggable key={t.id} draggableId={t.id} index={idx}>
                        {(drag, snapshot) => (
                          <div
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            className={`flex items-center justify-between rounded-md border px-3 py-2 bg-card ${
                              snapshot.isDragging ? "shadow-md ring-2 ring-primary/20" : ""
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                {...drag.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <GripVertical className="size-4" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">
                                  {t.step_name}
                                </p>
                                {t.description && (
                                  <p className="text-xs text-muted-foreground">
                                    {t.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={t.is_active}
                                onCheckedChange={() => handleToggleActive(t)}
                                disabled={isPending}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => openEditTemplate(t)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Delete &ldquo;{t.step_name}&rdquo;?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This step will be removed from all client
                                      onboarding progress.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteTemplate(t.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </CardContent>
      </Card>

      {/* Resources section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Resources</CardTitle>
            <CardDescription>
              Helpful links and documents shown on the onboarding page.
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNewResource}>
            <Plus className="size-3.5" />
            Add Resource
          </Button>
        </CardHeader>
        <CardContent>
          {resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No resources yet.
            </p>
          ) : (
            <DragDropContext onDragEnd={handleResourceDragEnd}>
              <Droppable droppableId="resources">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-2"
                  >
                    {resources.map((r, idx) => (
                      <Draggable key={r.id} draggableId={r.id} index={idx}>
                        {(drag, snapshot) => (
                          <div
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            className={`flex items-center justify-between rounded-md border px-3 py-2 bg-card ${
                              snapshot.isDragging ? "shadow-md ring-2 ring-primary/20" : ""
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                {...drag.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <GripVertical className="size-4" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{r.icon}</span>
                                <div>
                                  <p className="text-sm font-medium">
                                    {r.title}
                                  </p>
                                  {r.url && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <ExternalLink className="size-3" />
                                      {r.url.length > 50
                                        ? r.url.slice(0, 50) + "..."
                                        : r.url}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => openEditResource(r)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Delete &ldquo;{r.title}&rdquo;?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This resource will be permanently removed.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteResource(r.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </CardContent>
      </Card>

      {/* Template dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Edit Step" : "New Step"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTemplateSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="step_name">Step Name</Label>
              <Input
                id="step_name"
                name="step_name"
                defaultValue={editingTemplate?.step_name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={editingTemplate?.description ?? ""}
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full">
              {editingTemplate ? "Update" : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resource dialog */}
      <Dialog open={resourceDialogOpen} onOpenChange={setResourceDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingResource ? "Edit Resource" : "New Resource"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResourceSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="res-title">Title</Label>
              <Input
                id="res-title"
                name="title"
                defaultValue={editingResource?.title ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="res-description">Description</Label>
              <Textarea
                id="res-description"
                name="description"
                defaultValue={editingResource?.description ?? ""}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="res-url">URL</Label>
              <Input
                id="res-url"
                name="url"
                type="url"
                placeholder="https://..."
                defaultValue={editingResource?.url ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="res-icon">Icon (emoji)</Label>
              <Input
                id="res-icon"
                name="icon"
                defaultValue={editingResource?.icon ?? "📄"}
                className="w-20"
              />
            </div>
            <Button type="submit" className="w-full">
              {editingResource ? "Update" : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
