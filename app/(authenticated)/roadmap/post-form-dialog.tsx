"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { createPost } from "./actions"
import type { Board, RoadmapProject, Tag } from "@/lib/types"

const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "next", label: "Next" },
  { value: "in_progress", label: "In Progress" },
  { value: "limited_release", label: "Limited Release" },
  { value: "completed", label: "Completed" },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStatus: string
  defaultProjectId?: string
  projects: RoadmapProject[]
  boards: Board[]
  tags: Tag[]
}

export function PostFormDialog({
  open,
  onOpenChange,
  defaultStatus,
  defaultProjectId,
  projects,
  boards,
  tags,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const router = useRouter()

  function handleTagToggle(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    formData.delete("tag_ids")
    for (const tagId of selectedTags) {
      formData.append("tag_ids", tagId)
    }

    const result = await createPost(formData)
    setLoading(false)

    if (result.error) {
      setError(result.error)
    } else {
      setSelectedTags(new Set())
      toast.success("Task created")
      onOpenChange(false)
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="post-title">Task title</FieldLabel>
              <Input
                id="post-title"
                name="title"
                placeholder="Task title"
                aria-invalid={Boolean(error)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="post-description">Description</FieldLabel>
              <Textarea
                id="post-description"
                name="description"
                placeholder="Describe the work... (Markdown supported)"
                rows={5}
              />
            </Field>

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="task-project">Project</FieldLabel>
                <Select
                  key={defaultProjectId}
                  name="project_id"
                  defaultValue={defaultProjectId ?? projects[0]?.id}
                  required
                >
                  <SelectTrigger id="task-project" className="w-full">
                    <SelectValue placeholder="Select project..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-status">Status</FieldLabel>
                <Select name="status" defaultValue={defaultStatus}>
                  <SelectTrigger id="task-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-category">Category</FieldLabel>
                <Select name="board_id">
                  <SelectTrigger id="task-category" className="w-full">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {boards.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.icon} {b.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="post-deadline">Task deadline</FieldLabel>
                <Input id="post-deadline" name="deadline" type="date" />
              </Field>
            </FieldGroup>

            <FieldSet>
              <FieldLegend variant="label">Tags</FieldLegend>
              <div className="flex flex-wrap gap-3">
                {tags.map((t) => (
                  <Field key={t.id} orientation="horizontal" className="w-auto">
                    <Checkbox
                      id={`task-tag-${t.id}`}
                      checked={selectedTags.has(t.id)}
                      onCheckedChange={() => handleTagToggle(t.id)}
                    />
                    <FieldLabel htmlFor={`task-tag-${t.id}`}>
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      {t.name}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>

            <FieldError>{error}</FieldError>
          </FieldGroup>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner data-icon="inline-start" />}
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
