// The client's ask in plain English (ASD-STE100 Simplified Technical English),
// shown above the original message on /support/[id]. Pure and client-safe:
// the model call lives in lib/support-ask-plain.server.ts.

import { z } from "zod"

import { SUPPORT_ANSWER_MODEL_ID } from "@/lib/support-answers"
import { redactSupportText, stableHash } from "@/lib/support-tickets"

export const SUPPORT_ASK_PLAIN_MODEL_ID = SUPPORT_ANSWER_MODEL_ID
/** ASD-STE100 caps descriptive sentences at 25 words. */
export const SUPPORT_ASK_PLAIN_MAX_WORDS = 25
const SENTENCE_MAX = 240

export const supportAskPlainSchema = z.object({
  wants: z.array(z.string().trim().min(1).max(SENTENCE_MAX)).min(1).max(5),
  says: z.array(z.string().trim().min(1).max(SENTENCE_MAX)).max(5),
})
export type SupportAskPlain = z.infer<typeof supportAskPlainSchema>

export const SUPPORT_ASK_PLAIN_INSTRUCTIONS = `You rewrite one message from a short-term rental owner (our client) to RevFactor, their revenue management team. Write it in ASD-STE100 Simplified Technical English so the team sees at once what the client wants.

Return two lists of sentences:
- wants: what the client wants to know or wants us to do. 1 to 5 sentences. Start each with "The client asks" or "The client wants". If the client asks a question, write it as a sentence, not a question.
- says: the facts, comparisons, and feelings the client gives as context. 0 to 5 sentences. Start each with "The client says" or "The client thinks" when it is an opinion.

ASD-STE100 rules:
- One idea in each sentence. No more than 20 words in a sentence, and never more than 25.
- Use the active voice and simple tenses (present, past, future).
- Use simple, common words. Do not use idioms, slang, or abbreviations that a non-native reader can misunderstand.
- Use the same word for the same thing every time ("nightly rate", not "price" then "rate").
- Keep every property name, date, number, and percentage exactly as the client wrote it.

Do not add facts, guesses, reasons, or advice that are not in the message. Do not answer the client. If the message is not in English, translate it. If a link is in the message, say what it points to ("an Airbnb listing"), not the URL. "[redacted: credential]" means the capture bot removed a value; write "a removed value" if you must mention it.`

export function buildAskPlainPrompt(message: string, violations: string[] = []): string {
  const parts = [`Client message:\n"""\n${redactSupportText(message)}\n"""`]
  if (violations.length)
    parts.push(
      `Your last version broke these rules. Fix them:\n${violations.map((v) => `- ${v}`).join("\n")}`
    )
  return parts.join("\n\n")
}

const wordCount = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length

/** Sentences over the ASD-STE100 length cap, phrased for a retry prompt. */
export function askPlainViolations(plain: SupportAskPlain): string[] {
  return [...plain.wants, ...plain.says]
    .filter((s) => wordCount(s) > SUPPORT_ASK_PLAIN_MAX_WORDS)
    .map((s) => `Too long (${wordCount(s)} words, max ${SUPPORT_ASK_PLAIN_MAX_WORDS}): "${s}"`)
}

/** Ties a saved version to the message it was written from. */
export function askPlainSourceHash(message: string): string {
  return stableHash(message)
}
