"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import { deleteArticle } from "../actions"

type Props = {
  articleId: string
  articleTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteArticleDialog({
  articleId,
  articleTitle,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    const result = await deleteArticle(articleId)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Article deleted")
      onOpenChange(false)
      router.push("/knowledge")
      router.refresh()
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete article?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete &quot;{articleTitle}&quot;. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
