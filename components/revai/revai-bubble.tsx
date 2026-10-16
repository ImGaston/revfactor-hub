"use client"

import { Maximize2, Plus, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RevAiChat } from "./revai-chat"
import { useOptionalRevAi } from "./revai-provider"

/**
 * Floating RevAI launcher on every authenticated screen. It shares the same
 * conversation as the full-screen /revai tab, so a chat started here can be
 * expanded without losing context. Hidden on /revai itself.
 */
export function RevAiBubble() {
  const revai = useOptionalRevAi()
  const pathname = usePathname()
  const onRevAiPage = pathname.startsWith("/revai")
  const open = revai?.bubbleOpen ?? false
  const setOpen = revai?.setBubbleOpen

  useEffect(() => {
    if (!setOpen) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault()
        setOpen(!open)
      } else if (event.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  if (!revai || onRevAiPage) return null

  return (
    <>
      {open ? (
        <div className="fixed right-4 bottom-20 z-50 flex h-[min(640px,calc(100dvh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              RevAI
            </div>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" onClick={revai.newConversation}>
                    <Plus className="size-4" />
                    <span className="sr-only">New chat</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New chat</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" asChild>
                    <Link href="/revai" onClick={() => revai.setBubbleOpen(false)}>
                      <Maximize2 className="size-4" />
                      <span className="sr-only">Open full screen</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open full screen</TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => revai.setBubbleOpen(false)}>
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </div>
          <RevAiChat variant="panel" />
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => revai.setBubbleOpen(!open)}
            className="fixed right-4 bottom-4 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          >
            {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
            <span className="sr-only">{open ? "Close RevAI" : "Open RevAI"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">RevAI (⌘J)</TooltipContent>
      </Tooltip>
    </>
  )
}
