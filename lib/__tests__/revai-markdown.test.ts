import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RevAiMarkdown } from "@/components/revai/revai-markdown"

describe("RevAiMarkdown", () => {
  it("renders GFM tables with Hub links", () => {
    const html = renderToStaticMarkup(
      createElement(RevAiMarkdown, null, "| Listing | Gap |\n|---|---|\n| [The Vista](/listings/1) | -47 |")
    )
    expect(html).toContain("<table")
    expect(html).toContain('href="/listings/1"')
    expect(html).not.toContain("|---|")
  })
})
