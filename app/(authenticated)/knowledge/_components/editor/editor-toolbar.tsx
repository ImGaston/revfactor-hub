"use client"

import { useState } from "react"
import type { Editor } from "@tiptap/react"
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeSquare,
  Minus,
  Undo2,
  Redo2,
  Video,
  TableIcon,
  Plus,
  Trash2,
  Pilcrow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LinkEditPopover } from "./link-edit-popover"
import { ImageUploadButton } from "./image-upload-button"
import { VideoEmbedDialog } from "./video-embed-dialog"

type ToolbarButtonProps = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  isActive?: boolean
  onClick: () => void
  disabled?: boolean
}

function ToolbarButton({
  icon: Icon,
  label,
  isActive,
  onClick,
  disabled,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 p-0"
          onClick={onClick}
          disabled={disabled}
          data-active={isActive || undefined}
          aria-label={label}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-0.5 overflow-x-auto border-b bg-background p-1.5 rounded-t-lg">
        {/* Undo / Redo */}
        <ToolbarButton
          icon={Undo2}
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        />
        <ToolbarButton
          icon={Redo2}
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        />

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* Headings */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2 text-xs h-8"
                  aria-label="Heading level"
                >
                  <Pilcrow className="size-4" />
                  <span className="hidden sm:inline">Heading</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Heading level</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().setParagraph().run()
              }
            >
              <Pilcrow className="size-4 mr-2" />
              Paragraph
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            >
              <Heading1 className="size-4 mr-2" />
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-4 mr-2" />
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
            >
              <Heading3 className="size-4 mr-2" />
              Heading 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* Inline formatting */}
        <ToolbarButton
          icon={Bold}
          label="Bold"
          isActive={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic"
          isActive={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          isActive={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          icon={Code}
          label="Inline code"
          isActive={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* Lists */}
        <ToolbarButton
          icon={List}
          label="Bullet list"
          isActive={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Ordered list"
          isActive={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={ListChecks}
          label="Task list"
          isActive={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* Block elements */}
        <ToolbarButton
          icon={Quote}
          label="Blockquote"
          isActive={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          icon={CodeSquare}
          label="Code block"
          isActive={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarButton
          icon={Minus}
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* Link */}
        <LinkEditPopover editor={editor} />

        {/* Table */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  data-active={editor.isActive("table") || undefined}
                  aria-label="Table"
                >
                  <TableIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Table</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
              disabled={editor.isActive("table")}
            >
              <Plus className="size-4 mr-2" />
              Insert table
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addRowAfter().run()}
              disabled={!editor.isActive("table")}
            >
              Add row
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteRow().run()}
              disabled={!editor.isActive("table")}
            >
              Delete row
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              disabled={!editor.isActive("table")}
            >
              Add column
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteColumn().run()}
              disabled={!editor.isActive("table")}
            >
              Delete column
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteTable().run()}
              disabled={!editor.isActive("table")}
            >
              <Trash2 className="size-4 mr-2" />
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Image */}
        <ImageUploadButton editor={editor} />

        {/* Video embed */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              onClick={() => setVideoOpen(true)}
              aria-label="Embed video"
            >
              <Video className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Embed video</TooltipContent>
        </Tooltip>
      </div>

      <VideoEmbedDialog
        editor={editor}
        open={videoOpen}
        onOpenChange={setVideoOpen}
      />
    </>
  )
}
