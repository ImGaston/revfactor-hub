"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { List } from "lucide-react"

type TocItem = {
  id: string
  text: string
  level: number
}

function generateId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function extractHeadings(html: string): TocItem[] {
  if (typeof window === "undefined") return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const headings = doc.querySelectorAll("h2, h3")
  const items: TocItem[] = []
  headings.forEach((h) => {
    const text = h.textContent?.trim() || ""
    if (text) {
      items.push({
        id: generateId(text),
        text,
        level: h.tagName === "H2" ? 2 : 3,
      })
    }
  })
  return items
}

export function ArticleTableOfContents({ html }: { html: string }) {
  const [headings, setHeadings] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState("")

  useEffect(() => {
    setHeadings(extractHeadings(html))
  }, [html])

  useEffect(() => {
    if (headings.length === 0) return

    // Add IDs to headings in the DOM
    const articleEl = document.querySelector("[data-article-content]")
    if (!articleEl) return

    const domHeadings = articleEl.querySelectorAll("h2, h3")
    domHeadings.forEach((h) => {
      const text = h.textContent?.trim() || ""
      if (text && !h.id) {
        h.id = generateId(text)
      }
    })

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    )

    domHeadings.forEach((h) => {
      if (h.id) observer.observe(h)
    })

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav className="space-y-1">
      <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
        <List className="size-4" />
        On this page
      </h4>
      {headings.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={(e) => {
            e.preventDefault()
            document
              .getElementById(item.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
          className={cn(
            "block text-sm transition-colors py-1",
            item.level === 3 && "pl-4",
            activeId === item.id
              ? "text-primary font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {item.text}
        </a>
      ))}
    </nav>
  )
}
