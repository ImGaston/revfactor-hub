"use client"

import { useChat } from "@ai-sdk/react"
import { isToolUIPart, getToolName } from "ai"
import {
  ArrowUp,
  BookOpen,
  Building2,
  Check,
  Database,
  Library,
  LoaderCircle,
  Square,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { REVAI_MODELS, type RevAiTierChoice } from "@/lib/revai/models"
import { cn } from "@/lib/utils"
import { useRevAi, type RevAiUIMessage } from "./revai-provider"

const STARTERS = [
  "How is the portfolio doing over the next 30 days vs market?",
  "What open adjustments and tickets need attention?",
  "What does our playbook say about minimum stay gap nights?",
  "Walk me through the ontology chain for a listing review.",
]

const TOOL_LABELS: Record<string, { label: string; icon: typeof BookOpen }> = {
  searchWikifactor: { label: "Searched Wikifactor", icon: Library },
  readWikifactorPage: { label: "Read Wikifactor page", icon: Library },
  searchHubKnowledge: { label: "Searched Hub Knowledge", icon: BookOpen },
  findClients: { label: "Looked up clients", icon: Users },
  findListings: { label: "Looked up listings", icon: Building2 },
  getClientDetail: { label: "Read client record", icon: Users },
  getClientPerformance: { label: "Read Report Builder metrics", icon: Database },
  getPortfolioSnapshot: { label: "Computed portfolio snapshot", icon: Database },
  listOpenWork: { label: "Read open work", icon: Database },
}

function toolDetail(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const value = record.query ?? record.path ?? record.kind
  return typeof value === "string" && value ? value : null
}

function MessageView({ message }: { message: RevAiUIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
      </div>
    )
  }

  const meta = message.metadata
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <div
              key={index}
              className="prose prose-sm max-w-none wrap-anywhere dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0.5"
            >
              <ReactMarkdown
                components={{
                  a: ({ href, children }) =>
                    href?.startsWith("/") ? (
                      <Link href={href}>{children}</Link>
                    ) : (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                }}
              >
                {part.text}
              </ReactMarkdown>
            </div>
          )
        }
        if (isToolUIPart(part)) {
          const name = getToolName(part)
          const config = TOOL_LABELS[name] ?? { label: name, icon: Database }
          const Icon = config.icon
          const detail = toolDetail(part.input)
          const done = part.state === "output-available"
          const failed = part.state === "output-error"
          return (
            <div
              key={index}
              className="flex w-fit max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">
                {config.label}
                {detail ? `: ${detail}` : ""}
              </span>
              {done ? (
                <Check className="size-3.5 shrink-0 text-emerald-600" />
              ) : failed ? (
                <span className="text-destructive">failed</span>
              ) : (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
              )}
            </div>
          )
        }
        return null
      })}
      {meta?.modelLabel ? (
        <p className="text-[11px] text-muted-foreground">
          {meta.modelLabel} · {meta.reason}
          {typeof meta.costUsd === "number" ? ` · $${meta.costUsd.toFixed(4)}` : ""}
        </p>
      ) : null}
    </div>
  )
}

export function RevAiChat({ variant }: { variant: "page" | "panel" }) {
  const { chat, tier, setTier } = useRevAi()
  const { messages, sendMessage, status, stop, error } = useChat({ chat })
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, status])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setInput("")
    void sendMessage({ text: trimmed }, { body: { tier } })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", variant === "page" ? "px-1 py-4" : "p-4")}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-4">
            <div>
              <p className="text-base font-semibold">Ask RevAI anything about RevFactor</p>
              <p className="text-sm text-muted-foreground">
                Answers come from Wikifactor, the Hub knowledge base, and live Hub data. Numbers are computed from the data, never guessed.
              </p>
            </div>
            <div className={cn("grid gap-2", variant === "page" && "sm:grid-cols-2")}>
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => send(starter)}
                  className="rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn("flex flex-col gap-5", variant === "page" && "mx-auto max-w-3xl")}>
            {messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))}
            {status === "submitted" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Thinking…
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive">
                {error.message || "RevAI could not answer. Try again."}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          send(input)
        }}
        className={cn("border-t pt-3", variant === "panel" ? "px-3 pb-3" : "mx-auto w-full max-w-3xl")}
      >
        <div className="rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send(input)
              }
            }}
            placeholder="Ask about a client, a listing, a policy, or a situation…"
            rows={variant === "page" ? 3 : 2}
            className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <Select value={tier} onValueChange={(value) => setTier(value as RevAiTierChoice)}>
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
              <Button type="button" size="icon" variant="secondary" className="size-8 rounded-full" onClick={() => stop()}>
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
    </div>
  )
}
