"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createCategory, updateCategory } from "../actions"
import { AVAILABLE_ICONS, getCategoryIcon } from "../_lib/utils"
import {
  CATEGORY_COLOR_PRESETS,
  findPresetByColor,
} from "../_lib/category-presets"
import type { KnowledgeCategory } from "../_lib/types"

type Props = {
  category?: KnowledgeCategory | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CategoryFormDialog({ category, open, onOpenChange }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [icon, setIcon] = useState("BookOpen")
  const [presetKey, setPresetKey] = useState(CATEGORY_COLOR_PRESETS[0].key)

  useEffect(() => {
    if (open) {
      if (category) {
        setName(category.name)
        setDescription(category.description ?? "")
        setIcon(category.icon)
        setPresetKey(findPresetByColor(category.color).key)
      } else {
        setName("")
        setDescription("")
        setIcon("BookOpen")
        setPresetKey(CATEGORY_COLOR_PRESETS[0].key)
      }
    }
  }, [open, category])

  const preset =
    CATEGORY_COLOR_PRESETS.find((p) => p.key === presetKey) ??
    CATEGORY_COLOR_PRESETS[0]
  const PreviewIcon = getCategoryIcon(icon)

  function handleSubmit() {
    startTransition(async () => {
      const input = {
        name,
        description,
        icon,
        color: preset.color,
        dark_color: preset.dark_color,
        accent_color: preset.accent_color,
      }

      const result = category
        ? await updateCategory(category.id, input)
        : await createCategory(input)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(category ? "Category updated" : "Category created")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {category ? "Edit Category" : "New Category"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4",
              preset.color,
              preset.dark_color
            )}
          >
            <div className="rounded-lg bg-white/60 p-2.5 dark:bg-white/10">
              <PreviewIcon className={cn("size-5", preset.accent_color)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">
                {name || "Category Name"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {description || "Category description"}
              </p>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operations"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cat-description">Description</Label>
            <Textarea
              id="cat-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this category covers"
              rows={2}
            />
          </div>

          {/* Icon */}
          <div className="space-y-2">
            <Label>Icon</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_ICONS.map((iconName) => {
                  const Icon = getCategoryIcon(iconName)
                  return (
                    <SelectItem key={iconName} value={iconName}>
                      <div className="flex items-center gap-2">
                        <Icon className="size-4" />
                        <span>{iconName}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Color preset */}
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLOR_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPresetKey(p.key)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                    presetKey === p.key
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:bg-accent"
                  )}
                >
                  <span className={cn("size-3 rounded-full", p.swatch)} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending
              ? "Saving..."
              : category
                ? "Save Changes"
                : "Create Category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
