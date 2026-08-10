"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { createRoadmapProject, updateRoadmapProject } from "./actions"
import type { RoadmapProject } from "@/lib/types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: RoadmapProject | null
}

export function ProjectFormDialog({ open, onOpenChange, project }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")

    const formData = new FormData(event.currentTarget)
    const result = project
      ? await updateRoadmapProject(project.id, {
          name: String(formData.get("name") ?? ""),
          description: String(formData.get("description") ?? "") || null,
          deadline: String(formData.get("deadline") ?? "") || null,
        })
      : await createRoadmapProject(formData)

    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(project ? "Project updated" : "Project created")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setError("")
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <form
          key={project?.id ?? "new-project"}
          onSubmit={handleSubmit}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <Input
                id="project-name"
                name="name"
                defaultValue={project?.name ?? ""}
                placeholder="Website redesign"
                aria-invalid={Boolean(error)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">Description</FieldLabel>
              <Textarea
                id="project-description"
                name="description"
                defaultValue={project?.description ?? ""}
                placeholder="What does this project need to accomplish?"
                rows={4}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-deadline">
                Project deadline
              </FieldLabel>
              <Input
                id="project-deadline"
                name="deadline"
                type="date"
                defaultValue={project?.deadline ?? ""}
              />
            </Field>
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
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {project ? "Save project" : "Create project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
