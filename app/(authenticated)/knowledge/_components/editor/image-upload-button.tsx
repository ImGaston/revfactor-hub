"use client"

import { useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import { ImageIcon, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { uploadImage } from "../../actions"

type Props = {
  editor: Editor
}

export function ImageUploadButton({ editor }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB")
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append("file", file)

    const result = await uploadImage(formData)
    setUploading(false)

    if (result.error || !result.url) {
      toast.error(result.error || "Upload failed")
    } else {
      editor.chain().focus().setImage({ src: result.url }).run()
    }

    // Reset input
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-label="Insert image"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImageIcon className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Image</TooltipContent>
      </Tooltip>
    </>
  )
}
