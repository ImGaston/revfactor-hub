"use client"

import { MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { REVAI_MODELS } from "@/lib/revai/models"
import { cn } from "@/lib/utils"
import { RevAiChat } from "./revai-chat"
import { useRevAi } from "./revai-provider"

/** Full-screen RevAI tab: saved chats on the left, the shared chat on the right. */
export function RevAiWorkspace({ snapshotLabel }: { snapshotLabel: string }) {
  const { conversations, activeId, newConversation, selectConversation, deleteConversation } = useRevAi()

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[480px] gap-6">
      <aside className="hidden w-64 shrink-0 flex-col gap-3 lg:flex">
        <Button onClick={newConversation} variant="outline" className="justify-start gap-2">
          <Plus className="size-4" />
          New chat
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">Your chats are saved in this browser.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-left text-sm hover:bg-muted",
                      conversation.id === activeId && "bg-muted font-medium"
                    )}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{conversation.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConversation(conversation.id)}
                    className="absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-1 text-muted-foreground group-hover:block hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Delete chat</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">How RevAI picks a model</p>
          <ul className="flex flex-col gap-1">
            {Object.values(REVAI_MODELS).map((model) => (
              <li key={model.tier}>
                <span className="font-medium text-foreground">{model.label}</span>: {model.purpose.toLowerCase()}
              </li>
            ))}
          </ul>
          <p className="mt-2">{snapshotLabel}</p>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">RevAI</h1>
          </div>
          <Button onClick={newConversation} variant="ghost" size="sm" className="gap-1.5 lg:hidden">
            <Plus className="size-4" />
            New chat
          </Button>
        </div>
        <RevAiChat variant="page" />
      </section>
    </div>
  )
}
