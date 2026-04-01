"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
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
import { Checkbox } from "@/components/ui/checkbox"
import { createPost } from "./actions"
import type { Board, Tag } from "@/lib/types"

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
  boards: Board[]
  tags: Tag[]
}

export function PostFormDialog({
  open,
  onOpenChange,
  defaultStatus,
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
      onOpenChange(false)
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Post</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              name="title"
              placeholder="Post title"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-description">Description</Label>
            <Textarea
              id="post-description"
              name="description"
              placeholder="Describe your idea... (Markdown supported)"
              rows={5}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Board</Label>
              <Select name="board_id">
                <SelectTrigger>
                  <SelectValue placeholder="Select board..." />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.icon} {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select name="status" defaultValue={defaultStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-3">
              {tags.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTags.has(t.id)}
                    onCheckedChange={() => handleTagToggle(t.id)}
                  />
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-eta">ETA (optional)</Label>
            <Input id="post-eta" name="eta" type="date" />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-rose-500 hover:bg-rose-600"
              disabled={loading}
            >
              {loading ? "Creating..." : "Submit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
