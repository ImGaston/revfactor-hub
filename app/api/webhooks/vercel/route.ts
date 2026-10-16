import { NextRequest, NextResponse } from "next/server"
import { postSlackMessage } from "@/lib/slack"
import {
  ENV_CHANGE_SLACK_TARGET_DEFAULT,
  createEventDeduper,
  formatEnvChangeMessage,
  parseEnvChangeEvent,
  verifyVercelSignature,
} from "@/lib/vercel-env-webhook"
import { resolveEnvChangeDetails } from "@/lib/vercel-env-webhook.server"

export const dynamic = "force-dynamic"

const dedupe = createEventDeduper()

/**
 * Vercel team webhook (All Team Projects scope) for env var created /
 * updated / deleted. DMs Gaston (or ENV_CHANGE_SLACK_TARGET) with the
 * project, key, targets and actor — never the value. Unconfigured → 200 no-op
 * so Vercel does not keep retrying.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim()
  const token = process.env.VERCEL_API_TOKEN_READONLY?.trim()
  if (!secret || !token) {
    return NextResponse.json({ ok: true, skipped: "not_configured" })
  }

  const rawBody = await request.text()
  if (!verifyVercelSignature(rawBody, request.headers.get("x-vercel-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = parseEnvChangeEvent(body)
  if (!event) return NextResponse.json({ ok: true, skipped: "ignored_event" })
  if (!dedupe.claim(event.id)) return NextResponse.json({ ok: true, skipped: "duplicate" })

  const details = await resolveEnvChangeDetails(event, token)
  const result = await postSlackMessage({
    channelId: process.env.ENV_CHANGE_SLACK_TARGET?.trim() || ENV_CHANGE_SLACK_TARGET_DEFAULT,
    text: formatEnvChangeMessage(event, details),
  })

  if (!result.ok) {
    if ("skipReason" in result) return NextResponse.json({ ok: true, skipped: result.skipReason })
    // Let Vercel retry a failed post.
    dedupe.release(event.id)
    console.error("vercel env webhook: slack post failed", result.error)
    return NextResponse.json({ error: "Slack post failed" }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
