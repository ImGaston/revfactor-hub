"use client"

import { ArrowUp, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  REVAI_MENTION_KIND_LABELS,
  activeMentionQuery,
  expandMentions,
  mentionText,
  presentMentions,
  type RevAiMention,
} from "@/lib/revai/mentions"
import { REVAI_MODELS, type RevAiTierChoice } from "@/lib/revai/models"
import { cn } from "@/lib/utils"
import { REVAI_MENTION_ICONS, RevAiMentionPill } from "./revai-mention-pill"

type MentionState = { query: string; start: number }

/**
 * Message box with @-mentions. Typing "@" searches clients, listings, tickets
 * and adjustments; picking one inserts a readable `@Name` and shows it as a
 * pill. On send each tag becomes `[@Name](/listings/<id>)`, which the model
 * reads as an exact record id and the transcript renders as a pill again.
 */
export function RevAiComposer({
  variant,
  busy,
  tier,
  onTierChange,
  onSend,
  onStop,
}: {
  variant: "page" | "panel"
  busy: boolean
  tier: RevAiTierChoice
  onTierChange: (tier: RevAiTierChoice) => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [input, setInput] = useState("")
  const [mention, setMention] = useState<MentionState | null>(null)
  const [results, setResults] = useState<RevAiMention[]>([])
  const [highlight, setHighlight] = useState(0)
  const [tags, setTags] = useState<RevAiMention[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mentionQuery = mention?.query ?? null
  useEffect(() => {
    if (mentionQuery === null) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/revai/mentions?q=${encodeURIComponent(mentionQuery)}`, {
          signal: controller.signal,
        })
        const payload = (await response.json()) as { results?: RevAiMention[] }
        setResults(payload.results ?? [])
        setHighlight(0)
      } catch {
        // Aborted or offline: keep the previous list.
      }
    }, 150)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [mentionQuery])

  const updateMention = (text: string, caret: number) => {
    const next = activeMentionQuery(text, caret)
    setMention(next)
    if (!next) setResults([])
  }

  const pick = (item: RevAiMention) => {
    if (!mention) return
    const element = textareaRef.current
    const caret = element?.selectionStart ?? input.length
    const token = `${mentionText(item)} `
    const next = input.slice(0, mention.start) + token + input.slice(caret)
    setInput(next)
    setTags((previous) =>
      previous.some((tag) => tag.kind === item.kind && tag.id === item.id) ? previous : [...previous, item]
    )
    setMention(null)
    setResults([])
    const position = mention.start + token.length
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(position, position)
    })
  }

  const submit = () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setInput("")
    setTags([])
    setMention(null)
    setResults([])
    onSend(expandMentions(trimmed, tags))
  }

  const open = mention !== null && results.length > 0
  const shownTags = presentMentions(input, tags)

  const removeTag = (tag: RevAiMention) => {
    setTags((previous) => previous.filter((candidate) => candidate !== tag))
    setInput((previous) => previous.split(`${mentionText(tag)} `).join("").split(mentionText(tag)).join(""))
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className={cn("border-t pt-3", variant === "panel" ? "px-3 pb-3" : "mx-auto w-full max-w-3xl")}
    >
      <div className="relative rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring/30">
        {open ? (
          <div className="absolute right-0 bottom-full left-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
            {results.map((item, index) => {
              const Icon = REVAI_MENTION_ICONS[item.kind]
              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(item)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                    index === highlight && "bg-muted"
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{item.label}</span>
                    {item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {REVAI_MENTION_KIND_LABELS[item.kind]}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        {shownTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {shownTags.map((tag) => (
              <RevAiMentionPill
                key={`${tag.kind}-${tag.id}`}
                kind={tag.kind}
                label={tag.label}
                onRemove={() => removeTag(tag)}
              />
            ))}
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
            updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }}
          onClick={(event) => updateMention(input, event.currentTarget.selectionStart ?? input.length)}
          onBlur={() => setMention(null)}
          onKeyDown={(event) => {
            if (open) {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setHighlight((value) => (value + 1) % results.length)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setHighlight((value) => (value - 1 + results.length) % results.length)
                return
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault()
                pick(results[highlight])
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                setMention(null)
                return
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="Ask about a client, a listing, a policy, or a situation… Type @ to tag a record."
          rows={variant === "page" ? 3 : 2}
          className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <Select value={tier} onValueChange={(value) => onTierChange(value as RevAiTierChoice)}>
            <SelectTrigger size="sm" className="h-7 w-auto gap-1 border-0 bg-muted/60 text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto model</SelectItem>
              {Object.values(REVAI_MODELS).map((model) => (
                <SelectItem key={model.tier} value={model.tier}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {busy ? (
            <Button type="button" size="icon" variant="secondary" className="size-8 rounded-full" onClick={onStop}>
              <Square className="size-3.5" />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button type="submit" size="icon" className="size-8 rounded-full" disabled={!input.trim()}>
              <ArrowUp className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
