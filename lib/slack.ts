import "server-only"

// Slack Web API helper for internal Hub notifications.
//
// Server-only and fail-closed on a missing token: a page that imports this
// module must be able to render when Slack is not configured. Callers treat
// `slack_not_configured` as a typed skip, never as an exception.

export const SLACK_WINS_CHANNEL_ID_DEFAULT = "C0C0EL1UCDV"
export const SLACK_SKIP_NOT_CONFIGURED = "slack_not_configured" as const

const SLACK_CHAT_POST_MESSAGE = "https://slack.com/api/chat.postMessage"

export type SlackSkipReason = typeof SLACK_SKIP_NOT_CONFIGURED

export type SlackPostResult =
  | { ok: true; channelId: string; ts: string }
  | { ok: false; skipReason: SlackSkipReason }
  | { ok: false; error: string }

export function getSlackBotToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token || !token.trim()) return null
  return token
}

export function isSlackConfigured(): boolean {
  return getSlackBotToken() !== null
}

export function getWinsSlackChannelId(): string {
  const override = process.env.SLACK_WINS_CHANNEL_ID
  if (override && override.trim()) return override.trim()
  return SLACK_WINS_CHANNEL_ID_DEFAULT
}

/**
 * Post a plain-text message to Slack.
 *
 * Missing `SLACK_BOT_TOKEN` returns a typed skip and never throws, so a
 * render path that checks configuration cannot crash the page.
 */
export async function postSlackMessage(input: {
  text: string
  channelId?: string
}): Promise<SlackPostResult> {
  const token = getSlackBotToken()
  if (!token) {
    return { ok: false, skipReason: SLACK_SKIP_NOT_CONFIGURED }
  }

  const channelId = input.channelId ?? getWinsSlackChannelId()

  try {
    const response = await fetch(SLACK_CHAT_POST_MESSAGE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text: input.text,
        unfurl_links: false,
        unfurl_media: false,
      }),
      cache: "no-store",
    })

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean
      channel?: string
      ts?: string
      error?: string
    } | null

    if (!response.ok || !payload?.ok || !payload.ts) {
      const error =
        payload?.error ??
        (response.ok ? "slack_response_missing_ts" : `slack_http_${response.status}`)
      return { ok: false, error }
    }

    return {
      ok: true,
      channelId: payload.channel ?? channelId,
      ts: payload.ts,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "slack_request_failed",
    }
  }
}
