"use client"

import { useState } from "react"
import type { Editor } from "@tiptap/react"
import { Link2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Props = {
  editor: Editor
}

export function LinkEditPopover({ editor }: Props) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")

  function handleOpen(isOpen: boolean) {
    if (isOpen) {
      const existing = editor.getAttributes("link").href || ""
      setUrl(existing)
    }
    setOpen(isOpen)
  }

  function handleSave() {
    if (url.trim()) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url.trim() })
        .run()
    }
    setOpen(false)
  }

  function handleUnlink() {
    editor.chain().focus().unsetLink().run()
    setOpen(false)
  }

  const isActive = editor.isActive("link")

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              data-active={isActive || undefined}
              aria-label="Link"
            >
              <Link2 className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Link</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="flex items-center gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSave()
              }
            }}
          />
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          {isActive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  onClick={handleUnlink}
                  aria-label="Remove link"
                >
                  <Unlink className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove link</TooltipContent>
            </Tooltip>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
