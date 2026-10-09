import "server-only"

import { isStepCount, Output, ToolLoopAgent } from "ai"

import { SUPPORT_ASK_PLAIN_MODEL_ID, type AskListing } from "@/lib/support-ask-plain"
import {
  SUPPORT_MERGE_CHECK_INSTRUCTIONS,
  buildMergeCheckPrompt,
  supportMergeCheckSchema,
  type MergeCheckTicket,
  type SupportMergeCheck,
} from "@/lib/support-merge-check"

const TIMEOUT_MS = 45_000

export async function generateMergeCheck(
  input: { target: MergeCheckTicket; source: MergeCheckTicket; listings: AskListing[] },
  userLabel: string
): Promise<SupportMergeCheck> {
  const agent = new ToolLoopAgent({
    id: "revfactor-support-merge-check",
    model: SUPPORT_ASK_PLAIN_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_MERGE_CHECK_INSTRUCTIONS,
    providerOptions: {
      gateway: {
        user: userLabel,
        tags: ["feature:support-merge-check", `environment:${process.env.VERCEL_ENV ?? "development"}`],
      },
    },
    output: Output.object({ schema: supportMergeCheckSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 700,
  })
  const result = await agent.generate({
    prompt: buildMergeCheckPrompt(input),
    timeout: { totalMs: TIMEOUT_MS, stepMs: TIMEOUT_MS },
  })
  return result.output
}
