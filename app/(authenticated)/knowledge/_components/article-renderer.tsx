"use client"

import { useEffect, useRef } from "react"
import { sanitizeHtml } from "../_lib/sanitize"

export function ArticleRenderer({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  const clean = sanitizeHtml(html)

  // Post-process: wrap bare iframes in aspect-video containers
  useEffect(() => {
    if (!containerRef.current) return
    const iframes = containerRef.current.querySelectorAll("iframe")
    iframes.forEach((iframe) => {
      const parent = iframe.parentElement
      if (parent && !parent.classList.contains("aspect-video")) {
        const wrapper = document.createElement("div")
        wrapper.className =
          "aspect-video rounded-lg overflow-hidden my-4"
        parent.insertBefore(wrapper, iframe)
        wrapper.appendChild(iframe)
        iframe.className = "w-full h-full"
        iframe.removeAttribute("width")
        iframe.removeAttribute("height")
      }
    })
  }, [clean])

  return (
    <div
      ref={containerRef}
      data-article-content
      className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-table:border prose-th:border prose-th:p-2 prose-th:bg-muted prose-td:border prose-td:p-2 prose-img:rounded-lg prose-a:text-primary prose-code:before:content-none prose-code:after:content-none"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
