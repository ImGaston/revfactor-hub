"use client"

import { useState } from "react"
import {
  Copy,
  MessageSquareText,
  Send,
  SmilePlus,
  SquareCheckBig,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { EMOJI_PICKER, QUICK_REACTIONS } from "./emoji"

// Floating hover bar for a comment: quick emoji reactions on the left,
// message actions on the right. The parent comment row must be
// `relative group/comment`; the bar shows on hover, anchored above the
// message, aligned to its left edge.
export function CommentActionBar({
  onReact,
  onReply,
  onCreateTask,
  onCopy,
  onCopyForWhatsapp,
  onDelete,
}: {
  onReact: (emoji: string) => void
  // Omit to hide the action (e.g. reply on thread replies, create-task
  // without tasks:create, internal thread without adjustments:control,
  // delete when neither author nor resource delete-holder)
  onReply?: () => void
  onCreateTask?: () => void
  onCopy: () => void
  // Copies the comment with ticket context for pasting into the WhatsApp
  // group (adjustments: internal top-level notes only)
  onCopyForWhatsapp?: () => void
  onDelete?: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div
      className={`absolute -top-4 left-8 z-10 items-center gap-0.5 rounded-full border bg-popover px-1 py-0.5 shadow-sm ${
        pickerOpen ? "flex" : "hidden group-hover/comment:flex"
      }`}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          className="rounded-full px-1 text-base leading-none transition-transform hover:scale-125"
          title={`React ${emoji}`}
        >
          {emoji}
        </button>
      ))}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 rounded-full"
            title="Choose another emoji"
          >
            <SmilePlus className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_PICKER.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onReact(emoji)
                  setPickerOpen(false)
                }}
                className="rounded p-1 text-lg leading-none hover:bg-accent"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {onReply && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full"
          onClick={onReply}
          title="Comment in internal thread"
        >
          <MessageSquareText className="size-3.5" />
        </Button>
      )}
      {onCreateTask && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full"
          onClick={onCreateTask}
          title="Create task"
        >
          <SquareCheckBig className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 rounded-full"
        onClick={onCopy}
        title="Copy"
      >
        <Copy className="size-3.5" />
      </Button>
      {onCopyForWhatsapp && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full"
          onClick={onCopyForWhatsapp}
          title="Copy for WhatsApp"
        >
          <Send className="size-3.5" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
