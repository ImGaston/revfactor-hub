import Link from "next/link"
import ReactMarkdown from "react-markdown"

import { resolveWikiLinks } from "@/lib/skills"

/** Renders a wikifactor section: wiki links resolved, internal links via next/link. */
export function SkillMarkdown({
  markdown,
  knownSkillIds,
}: {
  markdown: string
  knownSkillIds: string[]
}) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert [&_a]:text-primary [&_a]:underline-offset-4 [&_a:hover]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        components={{
          a: ({ href, children }) =>
            href?.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {resolveWikiLinks(markdown, new Set(knownSkillIds))}
      </ReactMarkdown>
    </div>
  )
}
