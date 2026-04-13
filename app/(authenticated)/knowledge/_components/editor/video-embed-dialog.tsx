"use client"

import { useState } from "react"
import type { Editor } from "@tiptap/react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type VideoInfo = {
  provider: "youtube" | "loom"
  id: string
}

function parseVideoUrl(url: string): VideoInfo | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace("www.", "")

    // YouTube
    if (
      host === "youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "youtu.be"
    ) {
      let id: string | null = null
      if (host === "youtu.be") {
        id = u.pathname.slice(1)
      } else if (u.pathname.startsWith("/watch")) {
        id = u.searchParams.get("v")
      } else if (u.pathname.startsWith("/shorts/")) {
        id = u.pathname.split("/shorts/")[1]
      } else if (u.pathname.startsWith("/embed/")) {
        id = u.pathname.split("/embed/")[1]
      }
      if (id) return { provider: "youtube", id }
    }

    // Loom
    if (host === "loom.com") {
      const match = u.pathname.match(/\/(share|embed)\/([a-f0-9]+)/)
      if (match?.[2]) return { provider: "loom", id: match[2] }
    }
  } catch {
    // invalid URL
  }
  return null
}

type Props = {
  editor: Editor
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoEmbedDialog({ editor, open, onOpenChange }: Props) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")

  function handleInsert() {
    setError("")
    const info = parseVideoUrl(url)
    if (!info) {
      setError("Unsupported URL. Use YouTube or Loom.")
      return
    }

    if (info.provider === "youtube") {
      editor.commands.setYoutubeVideo({
        src: url,
        width: 640,
        height: 360,
      })
    } else {
      editor.commands.insertLoomEmbed({ loomId: info.id })
    }

    setUrl("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Embed Video</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="video-url">Video URL</Label>
            <Input
              id="video-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError("")
              }}
              placeholder="https://youtube.com/watch?v=... or https://loom.com/share/..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleInsert()
                }
              }}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          {url && parseVideoUrl(url) && (
            <p className="text-xs text-muted-foreground">
              Detected: {parseVideoUrl(url)!.provider} video
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInsert}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
