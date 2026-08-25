"use client"

import { useMemo, useState } from "react"
import {
  CalendarDays,
  CheckCircle2,
  FolderKanban,
  Pencil,
  Plus,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { ProjectFormDialog } from "./project-form-dialog"
import { PostDetailDialog } from "./post-detail-dialog"
import type { Board, Post, RoadmapProject } from "@/lib/types"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  next: "Next",
  in_progress: "In progress",
  limited_release: "Limited release",
  completed: "Completed",
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

type Props = {
  projects: RoadmapProject[]
  posts: Post[]
  boards: Board[]
  onOpenProjectBoard: (projectId: string) => void
}

export function ProjectsView({
  projects,
  posts,
  boards,
  onOpenProjectBoard,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<RoadmapProject | null>(
    null
  )
  const [detailProject, setDetailProject] = useState<RoadmapProject | null>(
    null
  )
  const [detailPost, setDetailPost] = useState<Post | null>(null)

  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, Post[]>()
    for (const post of posts) {
      const projectTasks = grouped.get(post.project_id) ?? []
      projectTasks.push(post)
      grouped.set(post.project_id, projectTasks)
    }
    return grouped
  }, [posts])

  function openCreateProject() {
    setEditingProject(null)
    setFormOpen(true)
  }

  function openEditProject(project: RoadmapProject) {
    setDetailProject(null)
    setEditingProject(project)
    setFormOpen(true)
  }

  function openTask(post: Post) {
    setDetailProject(null)
    setDetailPost(post)
  }

  function openProjectBoard(projectId: string) {
    setDetailProject(null)
    onOpenProjectBoard(projectId)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Open a project to see every task, or jump straight to its board.
          </p>
        </div>
        <Button size="sm" onClick={openCreateProject}>
          <Plus data-icon="inline-start" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban />
            </EmptyMedia>
            <EmptyTitle>Create your first project</EmptyTitle>
            <EmptyDescription>
              Projects keep related roadmap tasks and deadlines together.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={openCreateProject}>
              <Plus data-icon="inline-start" />
              New project
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const tasks = tasksByProject.get(project.id) ?? []
            const completedCount = tasks.filter(
              (task) => task.status === "completed"
            ).length

            return (
              <Card key={project.id} size="sm">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription className="line-clamp-2 min-h-10">
                    {project.description || "No project description yet."}
                  </CardDescription>
                  <CardAction>
                    <Badge variant="secondary">
                      {completedCount}/{tasks.length} done
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {project.deadline && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays />
                      Project deadline {formatDate(project.deadline)}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {tasks.slice(0, 4).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted"
                        onClick={() => openTask(task)}
                      >
                        <span className="truncate text-sm">{task.title}</span>
                        {task.status === "completed" ? (
                          <CheckCircle2 className="shrink-0 text-primary" />
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {STATUS_LABELS[task.status] ?? task.status}
                          </span>
                        )}
                      </button>
                    ))}
                    {tasks.length === 0 && (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        No tasks in this project yet.
                      </p>
                    )}
                    {tasks.length > 4 && (
                      <p className="text-xs text-muted-foreground">
                        +{tasks.length - 4} more tasks
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex-wrap justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditProject(project)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetailProject(project)}
                    >
                      View all tasks
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openProjectBoard(project.id)}
                  >
                    Open board
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        project={editingProject}
      />

      {detailProject && (
        <Dialog open onOpenChange={(open) => !open && setDetailProject(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{detailProject.name}</DialogTitle>
              <DialogDescription>
                {detailProject.description ||
                  "All tasks attached to this project."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {detailProject.deadline
                  ? `Project deadline ${formatDate(detailProject.deadline)}`
                  : "No project deadline"}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditProject(detailProject)}
                >
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={() => openProjectBoard(detailProject.id)}
                >
                  Open board
                </Button>
              </div>
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              {(tasksByProject.get(detailProject.id) ?? []).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="flex items-start justify-between gap-4 rounded-2xl border p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => openTask(task)}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{task.title}</p>
                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      variant={
                        task.status === "completed" ? "default" : "secondary"
                      }
                    >
                      {STATUS_LABELS[task.status] ?? task.status}
                    </Badge>
                    {task.deadline && (
                      <span className="text-xs text-muted-foreground">
                        Due {formatDate(task.deadline)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {(tasksByProject.get(detailProject.id) ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  This project does not have any tasks yet.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {detailPost && (
        <PostDetailDialog
          key={detailPost.id}
          post={detailPost}
          projects={projects}
          boards={boards}
          open
          onOpenChange={(open) => !open && setDetailPost(null)}
        />
      )}
    </div>
  )
}
