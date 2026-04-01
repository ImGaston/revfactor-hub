"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Camera, Trash2, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { updateAvatarUrl } from "./actions"
import { toast } from "sonner"

export function AvatarUpload({
  userId,
  currentUrl,
  initials,
}: {
  userId: string
  currentUrl: string | null
  initials: string
}) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB")
      return
    }

    setUploading(true)

    const supabase = createClient()
    const ext = file.name.split(".").pop()
    const path = `${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true })

    if (uploadError) {
      toast.error("Upload failed: " + uploadError.message)
      setUploading(false)
      return
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path)

    // Append timestamp to bust cache
    const url = `${publicUrl}?t=${Date.now()}`

    const result = await updateAvatarUrl(url)
    setUploading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      setPreview(url)
      toast.success("Avatar updated")
      router.refresh()
    }
  }

  async function handleRemove() {
    setUploading(true)

    const supabase = createClient()

    // List and delete all files in user's avatar folder
    const { data: files } = await supabase.storage
      .from("avatars")
      .list(userId)

    if (files?.length) {
      await supabase.storage
        .from("avatars")
        .remove(files.map((f) => `${userId}/${f.name}`))
    }

    const result = await updateAvatarUrl(null)
    setUploading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      setPreview(null)
      toast.success("Avatar removed")
      router.refresh()
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar className="size-16">
          {preview && <AvatarImage src={preview} />}
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/80">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-1.5 size-3.5" />
          Upload
        </Button>
        {preview && (
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={handleRemove}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
