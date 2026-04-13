"use client"

import DOMPurify from "isomorphic-dompurify"

const ALLOWED_IFRAME_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "loom.com",
  "www.loom.com",
]

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "iframe") {
    const el = node as unknown as Element
    const src = el.getAttribute?.("src") || ""
    try {
      const url = new URL(src)
      if (!ALLOWED_IFRAME_HOSTS.includes(url.hostname)) {
        el.remove()
      }
    } catch {
      el.remove()
    }
  }
})

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "frameborder",
      "src",
      "webkitallowfullscreen",
      "mozallowfullscreen",
      "data-loom-id",
      "data-checked",
      "colspan",
      "rowspan",
      "target",
      "rel",
    ],
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "strong", "em", "s", "code", "pre",
      "blockquote",
      "ul", "ol", "li",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "div", "span",
      "iframe",
      "input",
    ],
    ALLOWED_ATTR: [
      "class", "href", "src", "alt", "title", "target", "rel",
      "data-loom-id", "data-checked", "data-type",
      "colspan", "rowspan",
      "frameborder", "allowfullscreen", "allow",
      "webkitallowfullscreen", "mozallowfullscreen",
      "width", "height",
      "type", "checked", "disabled",
    ],
  })
}
