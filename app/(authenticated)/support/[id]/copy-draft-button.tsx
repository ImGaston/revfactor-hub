"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function CopyDraftButton({
  text,
  label = "Copy draft",
  copiedToast = "Draft copied. Fill any [brackets], then send it in Assembly.",
}: {
  text: string
  label?: string
  copiedToast?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(copiedToast)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.")
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!text.trim()}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  )
}
