import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai"
import { z } from "zod"

import { isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import { hasPermission } from "@/lib/permissions.server"
import { buildRevAiInstructions } from "@/lib/revai/instructions"
import {
  REVAI_MODELS,
  REVAI_TIERS,
  estimateRevAiCostUsd,
  routeRevAiQuestion,
  type RevAiMessageMetadata,
  type RevAiTier,
} from "@/lib/revai/models"
import { createRevAiTools } from "@/lib/revai/tools.server"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 300

type RevAiUIMessage = UIMessage<RevAiMessageMetadata>

const BodySchema = z.object({
  messages: z.array(z.any()).min(1).max(80),
  tier: z.enum(["auto", ...REVAI_TIERS]).optional(),
})

function latestUserText(messages: RevAiUIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user")
  return (
    last?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim() ?? ""
  )
}

function previousTier(messages: RevAiUIMessage[]): RevAiTier | null {
  const last = [...messages].reverse().find((message) => message.role === "assistant")
  return last?.metadata?.tier ?? null
}

export async function POST(request: Request) {
  if (!(await hasPermission("agent_studio", "view"))) {
    return Response.json({ error: "RevAI is limited to the RevFactor team." }, { status: 403 })
  }
  if (!isAiGatewayConfigured()) {
    return Response.json({ error: "The AI Gateway is not configured for this environment." }, { status: 503 })
  }

  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await request.json())
  } catch {
    return Response.json({ error: "The conversation could not be read." }, { status: 400 })
  }

  const [profile, supabase] = await Promise.all([getProfile(), createClient()])
  if (!profile) return Response.json({ error: "Sign in again." }, { status: 401 })

  const messages = parsed.messages as RevAiUIMessage[]
  const route = routeRevAiQuestion(latestUserText(messages), {
    choice: parsed.tier ?? "auto",
    previousTier: previousTier(messages),
  })
  const model = REVAI_MODELS[route.tier]
  const isSuperAdmin = profile.role === "super_admin"
  const tools = createRevAiTools({ supabase, isSuperAdmin })

  const result = streamText({
    model: model.id,
    instructions: buildRevAiInstructions({
      userName: profile.full_name?.trim() || profile.email,
      isSuperAdmin,
      today: new Date().toISOString().slice(0, 10),
    }),
    messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    reasoning: model.reasoning,
    stopWhen: isStepCount(model.maxSteps),
    maxOutputTokens: model.maxOutputTokens,
    abortSignal: request.signal,
    providerOptions: {
      gateway: {
        models: model.fallbacks,
        user: profile.id,
        tags: [
          "feature:revai",
          `revai-tier:${route.tier}`,
          `environment:${process.env.VERCEL_ENV ?? "development"}`,
        ],
      },
    },
  })

  return result.toUIMessageStreamResponse<RevAiUIMessage>({
    originalMessages: messages,
    sendReasoning: false,
    onError: (error) => {
      console.error("[revai] stream failed", error)
      return "RevAI hit an error answering that. Try again, or pick a different model."
    },
    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return {
          tier: route.tier,
          model: model.id,
          modelLabel: model.label,
          reason: route.reason,
          forced: route.forced,
        }
      }
      if (part.type === "finish") {
        return { costUsd: Math.round(estimateRevAiCostUsd(route.tier, part.totalUsage) * 10_000) / 10_000 }
      }
      return undefined
    },
  })
}
