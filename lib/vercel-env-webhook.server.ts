import "server-only"

import type { EnvChangeDetails, EnvChangeEvent } from "@/lib/vercel-env-webhook"

const VERCEL_API = "https://api.vercel.com"
const LOOKUP_TIMEOUT_MS = 5_000

async function vercelGet<T>(path: string, token: string, teamId: string | null): Promise<T | null> {
  const url = new URL(path, VERCEL_API)
  if (teamId) url.searchParams.set("teamId", teamId)
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * Resolve the project name, env var key + targets, and actor for a change.
 * Every lookup is optional: a failure (e.g. the var is already deleted)
 * leaves that field null and the message falls back to ids.
 *
 * The env list is read without `decrypt`, and only `id`, `key` and `target`
 * are picked from each entry, so no value ever leaves this function.
 */
export async function resolveEnvChangeDetails(
  event: EnvChangeEvent,
  token: string,
): Promise<EnvChangeDetails> {
  const projectId = encodeURIComponent(event.projectId)
  const [project, envList, members] = await Promise.all([
    vercelGet<{ name?: string }>(`/v9/projects/${projectId}`, token, event.teamId),
    event.envVarId && event.type !== "project.env-variable.deleted"
      ? vercelGet<{ envs?: { id?: string; key?: string; target?: string | string[] }[] }>(
          `/v10/projects/${projectId}/env`,
          token,
          event.teamId,
        )
      : Promise.resolve(null),
    event.userId && event.teamId
      ? vercelGet<{ members?: { uid?: string; name?: string | null; username?: string; email?: string }[] }>(
          `/v3/teams/${encodeURIComponent(event.teamId)}/members?limit=100`,
          token,
          null,
        )
      : Promise.resolve(null),
  ])

  const env = envList?.envs?.find((entry) => entry.id === event.envVarId)
  const targets = env?.target ? (Array.isArray(env.target) ? env.target : [env.target]) : []
  const member = members?.members?.find((entry) => entry.uid === event.userId)

  return {
    projectName: project?.name ?? null,
    key: env?.key ?? null,
    targets,
    actor: member ? member.name || member.username || member.email || null : null,
  }
}
