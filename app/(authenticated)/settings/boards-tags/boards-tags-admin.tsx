"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  createBoard,
  updateBoard,
  deleteBoard,
  createTag,
  updateTag,
  deleteTag,
} from "@/app/(authenticated)/roadmap/actions"
import type { Board, Tag } from "@/lib/types"

type Props = {
  boards: Board[]
  tags: Tag[]
}

export function BoardsTagsAdmin({ boards, tags }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Board dialog state
  const [boardDialogOpen, setBoardDialogOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<Board | null>(null)

  // Tag dialog state
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)

  function openNewBoard() {
    setEditingBoard(null)
    setBoardDialogOpen(true)
  }

  function openEditBoard(board: Board) {
    setEditingBoard(board)
    setBoardDialogOpen(true)
  }

  function openNewTag() {
    setEditingTag(null)
    setTagDialogOpen(true)
  }

  function openEditTag(tag: Tag) {
    setEditingTag(tag)
    setTagDialogOpen(true)
  }

  async function handleBoardSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    if (editingBoard) {
      await updateBoard(editingBoard.id, {
        name: formData.get("name") as string,
        icon: formData.get("icon") as string,
        description: (formData.get("description") as string) || null,
      })
    } else {
      await createBoard(formData)
    }

    setBoardDialogOpen(false)
    router.refresh()
  }

  async function handleDeleteBoard(boardId: string) {
    startTransition(async () => {
      await deleteBoard(boardId)
      router.refresh()
    })
  }

  async function handleTagSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    if (editingTag) {
      await updateTag(editingTag.id, {
        name: formData.get("name") as string,
        color: formData.get("color") as string,
      })
    } else {
      await createTag(formData)
    }

    setTagDialogOpen(false)
    router.refresh()
  }

  async function handleDeleteTag(tagId: string) {
    startTransition(async () => {
      await deleteTag(tagId)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Boards section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Boards</CardTitle>
            <CardDescription>
              Organize ideas into boards for the Ideas & Roadmap page.
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNewBoard}>
            <Plus className="size-3.5" />
            Add Board
          </Button>
        </CardHeader>
        <CardContent>
          {boards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No boards yet.</p>
          ) : (
            <div className="space-y-2">
              {boards.map((board) => (
                <div
                  key={board.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{board.icon}</span>
                    <div>
                      <p className="text-sm font-medium">{board.name}</p>
                      {board.description && (
                        <p className="text-xs text-muted-foreground">
                          {board.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => openEditBoard(board)}
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
                            Delete &ldquo;{board.name}&rdquo;?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Posts assigned to this board will become unassigned.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteBoard(board.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tags section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Tags</CardTitle>
            <CardDescription>
              Create tags to categorize ideas and roadmap items.
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNewTag}>
            <Plus className="size-3.5" />
            Add Tag
          </Button>
        </CardHeader>
        <CardContent>
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          ) : (
            <div className="space-y-2">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <p className="text-sm font-medium">{tag.name}</p>
                    <span className="text-xs text-muted-foreground">
                      {tag.color}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => openEditTag(tag)}
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
                            Delete &ldquo;{tag.name}&rdquo;?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This tag will be removed from all posts.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteTag(tag.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Board dialog */}
      <Dialog open={boardDialogOpen} onOpenChange={setBoardDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingBoard ? "Edit Board" : "New Board"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBoardSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                name="name"
                defaultValue={editingBoard?.name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="board-icon">Icon (emoji)</Label>
              <Input
                id="board-icon"
                name="icon"
                defaultValue={editingBoard?.icon ?? "📋"}
                className="w-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="board-description">Description</Label>
              <Input
                id="board-description"
                name="description"
                defaultValue={editingBoard?.description ?? ""}
              />
            </div>
            <Button type="submit" className="w-full">
              {editingBoard ? "Update" : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingTag ? "Edit Tag" : "New Tag"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTagSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name</Label>
              <Input
                id="tag-name"
                name="name"
                defaultValue={editingTag?.name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tag-color"
                  name="color"
                  type="color"
                  defaultValue={editingTag?.color ?? "#6b7280"}
                  className="w-12 h-8 p-0.5"
                />
              </div>
            </div>
            <Button type="submit" className="w-full">
              {editingTag ? "Update" : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
