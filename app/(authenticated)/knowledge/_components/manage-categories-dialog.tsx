"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Edit, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
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
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CategoryFormDialog } from "./category-form-dialog"
import { deleteCategory } from "../actions"
import { getCategoryIcon } from "../_lib/utils"
import type { KnowledgeCategory } from "../_lib/types"

type Props = {
  categories: KnowledgeCategory[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ManageCategoriesDialog({
  categories,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeCategory | null>(null)
  const [toDelete, setToDelete] = useState<KnowledgeCategory | null>(null)
  const [deleting, setDeleting] = useState(false)

  function handleEdit(category: KnowledgeCategory) {
    setEditing(category)
    setFormOpen(true)
  }

  function handleCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    const result = await deleteCategory(toDelete.id)
    setDeleting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Category deleted")
      setToDelete(null)
      router.refresh()
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col gap-0">
          <DialogHeader className="p-4 sm:p-6 pb-2 sm:pb-2 shrink-0">
            <DialogTitle>Manage Categories</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 space-y-2 min-h-0">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No categories yet. Create the first one.
              </p>
            ) : (
              categories.map((category) => {
                const Icon = getCategoryIcon(category.icon)
                return (
                  <div
                    key={category.id}
                    className={cn(
                      "flex items-center gap-2 sm:gap-3 rounded-lg border p-2.5 sm:p-3 min-w-0",
                      category.color,
                      category.dark_color
                    )}
                  >
                    <div className="shrink-0 rounded-lg bg-white/60 p-2 dark:bg-white/10">
                      <Icon className={cn("size-4", category.accent_color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-medium truncate text-sm">
                          {category.name}
                        </p>
                        {typeof category.article_count === "number" && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] shrink-0 h-5 px-1.5"
                          >
                            {category.article_count}
                          </Badge>
                        )}
                      </div>
                      {category.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {category.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        onClick={() => handleEdit(category)}
                        aria-label="Edit category"
                      >
                        <Edit className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => setToDelete(category)}
                        aria-label="Delete category"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <DialogFooter className="shrink-0 flex flex-row items-center justify-between gap-2 border-t p-4 sm:p-6 sm:pt-4">
            <Button
              variant="outline"
              onClick={handleCreate}
              className="gap-2"
              size="sm"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">New Category</span>
              <span className="sm:hidden">New</span>
            </Button>
            <Button onClick={() => onOpenChange(false)} size="sm">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit form dialog */}
      <CategoryFormDialog
        category={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{toDelete?.name}&quot;. Any
              articles in this category must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
