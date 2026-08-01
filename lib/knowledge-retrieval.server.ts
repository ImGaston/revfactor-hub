import { createHash } from "node:crypto"

import { unstable_cache } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { embed, embedMany, gateway } from "ai"

import type {
  AgentStudioRetrievalDiagnostics,
  AgentStudioRetrievalMode,
  AgentStudioSource,
} from "@/lib/agent-studio"
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_FALLBACK_USD_PER_MILLION,
  KNOWLEDGE_EMBEDDING_MODEL,
  buildKnowledgeChunks,
  keywordSearchKnowledge,
  type KnowledgeArticleRecord,
} from "@/lib/knowledge-retrieval"

type HybridKnowledgeRow = {
  chunk_id: string
  article_id: string
  article_title: string
  article_slug: string
  article_updated_at: string
  heading: string | null
  content: string
  embedding_model: string
  keyword_score: number | string
  semantic_score: number | string
  combined_score: number | string
  keyword_rank: number | string
  semantic_rank: number | string
  hybrid_rank: number | string
}

export type KnowledgeSearchOutput = {
  query: string
  results: AgentStudioSource[]
  diagnostics: AgentStudioRetrievalDiagnostics
  note: string
}

type GatewayModelsResponse = {
  data?: Array<{
    id: string
    pricing?: { input?: string }
  }>
}

const getEmbeddingPrice = unstable_cache(
  async () => {
    const fetchedAt = new Date().toISOString()
    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error(`Gateway catalog ${response.status}`)
      const payload = (await response.json()) as GatewayModelsResponse
      const rawPrice = payload.data?.find(
        (model) => model.id === KNOWLEDGE_EMBEDDING_MODEL
      )?.pricing?.input
      const inputUsdPerMillion = Number(rawPrice) * 1_000_000
      return {
        inputUsdPerMillion: Number.isFinite(inputUsdPerMillion)
          ? inputUsdPerMillion
          : KNOWLEDGE_EMBEDDING_FALLBACK_USD_PER_MILLION,
        fetchedAt,
      }
    } catch {
      return {
        inputUsdPerMillion:
          KNOWLEDGE_EMBEDDING_FALLBACK_USD_PER_MILLION,
        fetchedAt,
      }
    }
  },
  ["knowledge-embedding-price-v1"],
  { revalidate: 3_600 }
)

function embeddingCost(tokens: number, inputUsdPerMillion: number) {
  return (tokens / 1_000_000) * inputUsdPerMillion
}

function numberValue(value: number | string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integerValue(value: number | string): number {
  return Math.max(0, Math.round(numberValue(value)))
}

function keywordSources(
  articles: KnowledgeArticleRecord[],
  query: string,
  requestedMode: AgentStudioRetrievalMode,
  fallbackReason: string | null,
  startedAt: number
): KnowledgeSearchOutput {
  const fetchedAt = new Date().toISOString()
  const results = keywordSearchKnowledge(articles, query).map((result) => ({
    id: result.id,
    title: result.title,
    slug: result.slug,
    excerpt: result.excerpt,
    content: result.content,
    approvedAnswer: result.approvedAnswer,
    canonicalQuestion: result.canonicalQuestion,
    escalationGuidance: result.escalationGuidance,
    type: "knowledge" as const,
    payload: {
      slug: result.slug,
      content: result.content,
      canonicalQuestion: result.canonicalQuestion,
      approvedAnswer: result.approvedAnswer,
      escalationGuidance: result.escalationGuidance,
      retrieval: {
        requestedMode,
        effectiveMode: "keyword",
        keywordScore: result.keywordScore,
        keywordRank: result.keywordRank,
      },
    },
    fetchedAt,
    sourceUpdatedAt: result.sourceUpdatedAt,
    warning: fallbackReason,
  }))
  const diagnostics: AgentStudioRetrievalDiagnostics = {
    query,
    requestedMode,
    effectiveMode: "keyword",
    embeddingModel: null,
    embeddingInputTokens: 0,
    embeddingCostUsd: 0,
    durationMs: Date.now() - startedAt,
    fallbackReason,
    candidates: results.map((source) => ({
      articleId: source.id,
      chunkId: null,
      title: source.title,
      heading: null,
      keywordScore: Number(
        (source.payload?.retrieval as Record<string, unknown>)?.keywordScore ?? 0
      ),
      semanticScore: null,
      combinedScore: null,
      keywordRank: Number(
        (source.payload?.retrieval as Record<string, unknown>)?.keywordRank ?? 0
      ),
      semanticRank: null,
      hybridRank: null,
      selected: true,
    })),
  }

  return {
    query,
    results,
    diagnostics,
    note:
      results.length > 0
        ? fallbackReason ?? "Approved client-safe Knowledge matched by keyword."
        : "No matching approved client-safe Knowledge was found.",
  }
}

export function createKnowledgeSearch({
  supabase,
  articles,
  userId,
  mode,
}: {
  supabase: SupabaseClient
  articles: KnowledgeArticleRecord[]
  userId: string
  mode: AgentStudioRetrievalMode
}) {
  return async (query: string): Promise<KnowledgeSearchOutput> => {
    const startedAt = Date.now()
    if (mode === "keyword") {
      return keywordSources(articles, query, mode, null, startedAt)
    }

    try {
      const [embeddingResult, price] = await Promise.all([
        embed({
          model: gateway.embeddingModel(KNOWLEDGE_EMBEDDING_MODEL),
          value: query,
          abortSignal: AbortSignal.timeout(15_000),
          providerOptions: {
            gateway: {
              user: userId,
              tags: [
                "feature:knowledge-retrieval",
                `environment:${process.env.VERCEL_ENV ?? "development"}`,
              ],
            },
          },
        }),
        getEmbeddingPrice(),
      ])
      if (embeddingResult.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding dimension ${embeddingResult.embedding.length} does not match ${KNOWLEDGE_EMBEDDING_DIMENSIONS}.`
        )
      }

      const { data, error } = await supabase.rpc("search_agent_knowledge", {
        p_query_text: query,
        p_query_embedding: embeddingResult.embedding,
        p_retrieval_mode: "hybrid",
        p_match_count: 16,
      })
      if (error) throw error

      const rows = (data ?? []) as HybridKnowledgeRow[]
      const selectedRows: HybridKnowledgeRow[] = []
      const selectedArticleIds = new Set<string>()
      for (const row of rows) {
        if (selectedArticleIds.has(row.article_id)) continue
        selectedRows.push(row)
        selectedArticleIds.add(row.article_id)
        if (selectedRows.length === 4) break
      }

      if (selectedRows.length === 0) {
        return keywordSources(
          articles,
          query,
          mode,
          "No indexed semantic match was available; keyword fallback was used.",
          startedAt
        )
      }

      const fetchedAt = new Date().toISOString()
      const embeddingInputTokens = Number.isFinite(embeddingResult.usage.tokens)
        ? embeddingResult.usage.tokens
        : Math.ceil(query.length / 4)
      const embeddingCostUsd = embeddingCost(
        embeddingInputTokens,
        price.inputUsdPerMillion
      )
      const selectedChunkIds = new Set(selectedRows.map((row) => row.chunk_id))
      const results: AgentStudioSource[] = selectedRows.map((row) => ({
        id: `${row.article_id}:${row.chunk_id}`,
        title: row.article_title,
        slug: row.article_slug,
        excerpt: row.content.slice(0, 420),
        type: "knowledge",
        payload: {
          slug: row.article_slug,
          chunkId: row.chunk_id,
          heading: row.heading,
          content: row.content,
          articleUpdatedAt: row.article_updated_at,
          embeddingModel: row.embedding_model,
          retrieval: {
            requestedMode: mode,
            effectiveMode: "hybrid",
            keywordScore: numberValue(row.keyword_score),
            semanticScore: numberValue(row.semantic_score),
            combinedScore: numberValue(row.combined_score),
            keywordRank: integerValue(row.keyword_rank),
            semanticRank: integerValue(row.semantic_rank),
            hybridRank: integerValue(row.hybrid_rank),
          },
        },
        fetchedAt,
        sourceUpdatedAt: row.article_updated_at,
      }))
      const diagnostics: AgentStudioRetrievalDiagnostics = {
        query,
        requestedMode: mode,
        effectiveMode: "hybrid",
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        embeddingInputTokens,
        embeddingCostUsd,
        durationMs: Date.now() - startedAt,
        fallbackReason: null,
        candidates: rows.slice(0, 12).map((row) => ({
          articleId: row.article_id,
          chunkId: row.chunk_id,
          title: row.article_title,
          heading: row.heading,
          keywordScore: numberValue(row.keyword_score),
          semanticScore: numberValue(row.semantic_score),
          combinedScore: numberValue(row.combined_score),
          keywordRank: integerValue(row.keyword_rank),
          semanticRank: integerValue(row.semantic_rank),
          hybridRank: integerValue(row.hybrid_rank),
          selected: selectedChunkIds.has(row.chunk_id),
        })),
      }

      return {
        query,
        results,
        diagnostics,
        note:
          mode === "compare"
            ? "Hybrid results were supplied to the agent; keyword and hybrid rankings are included for comparison."
            : "Approved client-safe Knowledge matched with hybrid keyword and semantic retrieval.",
      }
    } catch (error) {
      console.error("Knowledge hybrid retrieval failed", error)
      return keywordSources(
        articles,
        query,
        mode,
        "Hybrid retrieval was unavailable; keyword fallback was used.",
        startedAt
      )
    }
  }
}

function articleContentHash(article: KnowledgeArticleRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: article.title,
        excerpt: article.excerpt,
        contentHtml: article.content_html,
        canonicalQuestion: article.canonical_question,
        approvedAnswer: article.approved_answer,
        escalationGuidance: article.escalation_guidance,
        updatedAt: article.updated_at,
      })
    )
    .digest("hex")
}

export async function indexKnowledgeArticle({
  supabase,
  articleId,
  userId,
}: {
  supabase: SupabaseClient
  articleId: string
  userId: string
}): Promise<
  | { ok: true; chunkCount: number; inputTokens: number; costUsd: number }
  | { ok: false; error: string }
> {
  const { data: article, error: articleError } = await supabase
    .from("knowledge_articles")
    .select(
      "id, title, slug, excerpt, content_html, canonical_question, approved_answer, escalation_guidance, updated_at, status, audience, review_status, agent_enabled"
    )
    .eq("id", articleId)
    .maybeSingle()

  if (articleError || !article) {
    return { ok: false, error: articleError?.message ?? "Article not found." }
  }
  if (
    article.status !== "published" ||
    article.audience !== "client_safe" ||
    article.review_status !== "approved" ||
    !article.agent_enabled
  ) {
    return {
      ok: false,
      error:
        "Only published, approved, client-safe, agent-enabled articles can be indexed.",
    }
  }

  const chunks = buildKnowledgeChunks(article)
  if (chunks.length === 0) {
    return { ok: false, error: "This article has no searchable content." }
  }

  await Promise.all([
    supabase
      .from("knowledge_articles")
      .update({
        agent_index_status: "indexing",
        agent_index_error: null,
      })
      .eq("id", articleId),
    supabase.from("knowledge_index_events").insert({
      article_id: articleId,
      status: "started",
      embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
      created_by: userId,
    }),
  ])

  try {
    const [embeddingResult, price] = await Promise.all([
      embedMany({
        model: gateway.embeddingModel(KNOWLEDGE_EMBEDDING_MODEL),
        values: chunks.map((chunk) => chunk.content),
        maxParallelCalls: 2,
        abortSignal: AbortSignal.timeout(30_000),
        providerOptions: {
          gateway: {
            user: userId,
            tags: [
              "feature:knowledge-indexing",
              `environment:${process.env.VERCEL_ENV ?? "development"}`,
            ],
          },
        },
      }),
      getEmbeddingPrice(),
    ])
    if (
      embeddingResult.embeddings.some(
        (embedding) => embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS
      )
    ) {
      throw new Error(
        `The embedding model did not return ${KNOWLEDGE_EMBEDDING_DIMENSIONS} dimensions.`
      )
    }

    const inputTokens = Number.isFinite(embeddingResult.usage.tokens)
      ? embeddingResult.usage.tokens
      : chunks.reduce((total, chunk) => total + chunk.tokenEstimate, 0)
    const costUsd = embeddingCost(inputTokens, price.inputUsdPerMillion)
    const contentHash = articleContentHash(article)

    const { error: deleteError } = await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("article_id", articleId)
    if (deleteError) throw deleteError

    const { error: insertError } = await supabase.from("knowledge_chunks").insert(
      chunks.map((chunk, index) => ({
        article_id: articleId,
        article_updated_at: article.updated_at,
        chunk_index: chunk.index,
        heading: chunk.heading,
        content: chunk.content,
        token_estimate: chunk.tokenEstimate,
        content_hash: createHash("sha256")
          .update(chunk.content)
          .digest("hex"),
        embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
        embedding: embeddingResult.embeddings[index],
      }))
    )
    if (insertError) throw insertError

    const { error: statusError } = await supabase
      .from("knowledge_articles")
      .update({
        agent_index_status: "indexed",
        agent_indexed_at: new Date().toISOString(),
        agent_index_error: null,
        agent_index_model: KNOWLEDGE_EMBEDDING_MODEL,
        agent_index_content_hash: contentHash,
        agent_chunk_count: chunks.length,
        agent_index_input_tokens: inputTokens,
        agent_index_cost_usd: costUsd,
      })
      .eq("id", articleId)
    if (statusError) throw statusError

    await supabase.from("knowledge_index_events").insert({
      article_id: articleId,
      status: "completed",
      embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
      chunk_count: chunks.length,
      input_tokens: inputTokens,
      estimated_cost_usd: costUsd,
      created_by: userId,
    })

    return { ok: true, chunkCount: chunks.length, inputTokens, costUsd }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Knowledge indexing failed."
    await Promise.all([
      supabase
        .from("knowledge_articles")
        .update({
          agent_index_status: "failed",
          agent_index_error: message.slice(0, 1_000),
        })
        .eq("id", articleId),
      supabase.from("knowledge_index_events").insert({
        article_id: articleId,
        status: "failed",
        embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
        error_message: message.slice(0, 1_000),
        created_by: userId,
      }),
    ])
    return { ok: false, error: message }
  }
}
