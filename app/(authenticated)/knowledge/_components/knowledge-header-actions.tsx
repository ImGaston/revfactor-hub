"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ManageCategoriesDialog } from "./manage-categories-dialog"
import type { KnowledgeCategory } from "../_lib/types"

type Props = {
  categories: KnowledgeCategory[]
  canCreate?: boolean
  canManageCategories?: boolean
}

export function KnowledgeHeaderActions({
  categories,
  canCreate = true,
  canManageCategories = true,
}: Props) {
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <>
      <div className="flex items-center gap-2">
        {canManageCategories && (
          <Button
            variant="outline"
            onClick={() => setManageOpen(true)}
            className="gap-2"
          >
            <Settings2 className="size-4" />
            <span className="hidden sm:inline">Manage </span>Categories
          </Button>
        )}
        {canCreate && (
          <Button asChild>
            <Link href="/knowledge/new">
              <Plus data-icon="inline-start" />
              Add<span className="hidden sm:inline"> Article</span>
            </Link>
          </Button>
        )}
      </div>

      <ManageCategoriesDialog
        categories={categories}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
    </>
  )
}
