"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Youtube from "@tiptap/extension-youtube"
import { common, createLowlight } from "lowlight"
import { LoomEmbed } from "./loom-embed-extension"
import { EditorToolbar } from "./editor-toolbar"
import { EditorBubbleMenu } from "./editor-bubble-menu"
import { EditorFloatingMenu } from "./editor-floating-menu"
import "./editor.css"

const lowlight = createLowlight(common)

type TiptapEditorProps = {
  content?: string
  onChange: (html: string) => void
  placeholder?: string
}

export function TiptapEditor({
  content = "",
  onChange,
  placeholder = "Start writing your article...",
}: TiptapEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          class: "text-primary underline",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Youtube.configure({
        controls: true,
        nocookie: true,
      }),
      LoomEmbed,
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML())
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral dark:prose-invert max-w-none focus:outline-none",
      },
    },
  })

  if (!editor) return null

  return (
    <div className="rounded-lg border">
      <EditorToolbar editor={editor} />
      <EditorBubbleMenu />
      <EditorFloatingMenu />
      <EditorContent editor={editor} />
    </div>
  )
}
