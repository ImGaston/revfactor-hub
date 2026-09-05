import "server-only"
export function onboardingCors(request: Request) {
  const origin = request.headers.get("origin")
  const allowed = (process.env.GHL_V1_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  if (!origin || !allowed.includes(origin)) return null
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  }
}
