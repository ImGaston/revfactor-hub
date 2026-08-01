import type { AgentStudioSource } from "@/lib/agent-studio"

export const KNOWLEDGE_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536
export const KNOWLEDGE_EMBEDDING_FALLBACK_USD_PER_MILLION = 0.02

export type KnowledgeArticleRecord = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content_html: string | null
  canonical_question?: string | null
  approved_answer?: string | null
  escalation_guidance?: string | null
  updated_at?: string | null
}

export type KnowledgeChunkDraft = {
  index: number
  heading: string
  content: string
  tokenEstimate: number
}

export type KeywordKnowledgeResult = AgentStudioSource & {
  content: string
  canonicalQuestion: string
  approvedAnswer: string
  escalationGuidance: string
  keywordScore: number
  keywordRank: number
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
}

export function htmlToKnowledgeText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function contentSections(html: string): Array<{ heading: string; text: string }> {
  const marked = html.replace(
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    (_, heading: string) =>
      `\n\n__KNOWLEDGE_HEADING__${htmlToKnowledgeText(heading)}\n`
  )
  const sections: Array<{ heading: string; text: string }> = []
  let heading = "Article"
  let body: string[] = []

  function flush() {
    const text = htmlToKnowledgeText(body.join("\n"))
    if (text) sections.push({ heading, text })
    body = []
  }

  for (const line of marked.split("\n")) {
    if (line.startsWith("__KNOWLEDGE_HEADING__")) {
      flush()
      heading = line.replace("__KNOWLEDGE_HEADING__", "").trim() || "Article"
    } else {
      body.push(line)
    }
  }
  flush()

  return sections
}

function splitLongText(text: string, maximumCharacters: number): string[] {
  if (text.length <= maximumCharacters) return [text]

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ""

  function pushCurrent() {
    if (current.trim()) chunks.push(current.trim())
    current = ""
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumCharacters) {
      pushCurrent()
      for (let offset = 0; offset < paragraph.length; offset += maximumCharacters - 180) {
        chunks.push(paragraph.slice(offset, offset + maximumCharacters).trim())
      }
      continue
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > maximumCharacters) pushCurrent()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  pushCurrent()

  return chunks
}

export function buildKnowledgeChunks(
  article: KnowledgeArticleRecord,
  maximumCharacters = 1_600
): KnowledgeChunkDraft[] {
  const drafts: Array<{ heading: string; content: string }> = []
  const answerCard = [
    article.canonical_question?.trim()
      ? `Common client question: ${article.canonical_question.trim()}`
      : null,
    article.approved_answer?.trim()
      ? `Approved answer: ${article.approved_answer.trim()}`
      : null,
    article.escalation_guidance?.trim()
      ? `Escalate when: ${article.escalation_guidance.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  if (answerCard) {
    drafts.push({ heading: "Approved answer", content: answerCard })
  }

  for (const section of contentSections(article.content_html ?? "")) {
    for (const content of splitLongText(section.text, maximumCharacters)) {
      drafts.push({ heading: section.heading, content })
    }
  }

  if (drafts.length === 0 && article.excerpt?.trim()) {
    drafts.push({ heading: "Summary", content: article.excerpt.trim() })
  }

  return drafts.map((draft, index) => ({
    index,
    heading: draft.heading,
    content: `${article.title}\n\n${draft.content}`,
    tokenEstimate: Math.ceil(
      (`${article.title}\n\n${draft.content}`).length / 4
    ),
  }))
}

function countOccurrences(text: string, term: string): number {
  let count = 0
  let offset = 0

  while (count < 6) {
    const index = text.indexOf(term, offset)
    if (index === -1) break
    count += 1
    offset = index + term.length
  }

  return count
}

export function keywordSearchKnowledge(
  articles: KnowledgeArticleRecord[],
  query: string,
  limit = 4
): KeywordKnowledgeResult[] {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3)
    )
  ).slice(0, 12)

  if (terms.length === 0) return []

  return articles
    .map((article) => {
      const content = htmlToKnowledgeText(article.content_html ?? "")
      const approvedAnswer = article.approved_answer?.trim() ?? ""
      const canonicalQuestion = article.canonical_question?.trim() ?? ""
      const title = article.title.toLowerCase()
      const excerpt = (article.excerpt ?? "").toLowerCase()
      const searchableContent =
        `${canonicalQuestion} ${approvedAnswer} ${content}`.toLowerCase()
      const keywordScore = terms.reduce(
        (total, term) =>
          total +
          countOccurrences(title, term) * 8 +
          countOccurrences(excerpt, term) * 3 +
          countOccurrences(searchableContent, term),
        0
      )

      return {
        id: article.id,
        title: article.title,
        slug: article.slug,
        excerpt:
          article.excerpt?.trim() ||
          `${content.slice(0, 180)}${content.length > 180 ? "…" : ""}`,
        content: content.slice(0, 1_400),
        approvedAnswer,
        canonicalQuestion,
        escalationGuidance: article.escalation_guidance?.trim() ?? "",
        sourceUpdatedAt: article.updated_at ?? null,
        keywordScore,
      }
    })
    .filter((article) => article.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, limit)
    .map((article, index) => ({
      ...article,
      keywordRank: index + 1,
    }))
}
