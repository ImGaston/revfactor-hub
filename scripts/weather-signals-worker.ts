// Trigger one leased Market Signals weather work cycle from Atlas or Sage.
//
// Required environment:
//   REVFACTOR_WEATHER_WORKER_API_KEY=rvf_live_...
// Optional:
//   REVFACTOR_HUB_URL=https://hub.revfactor.io
//   WEATHER_SIGNAL_MAXIMUM_JOBS=5

export {}

const hubUrl = (
  process.env.REVFACTOR_HUB_URL || "https://hub.revfactor.io"
).replace(/\/$/, "")
const apiKey = process.env.REVFACTOR_WEATHER_WORKER_API_KEY
const maximumJobs = Number(process.env.WEATHER_SIGNAL_MAXIMUM_JOBS || "5")

if (!apiKey) {
  console.error("REVFACTOR_WEATHER_WORKER_API_KEY is required")
  process.exit(1)
}

if (!Number.isInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 10) {
  console.error("WEATHER_SIGNAL_MAXIMUM_JOBS must be an integer from 1 to 10")
  process.exit(1)
}

const response = await fetch(`${hubUrl}/api/v1/weather-signals/work`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ maximumJobs }),
  signal: AbortSignal.timeout(295_000),
})

const responseText = await response.text()
let result: unknown = null
try {
  result = responseText ? JSON.parse(responseText) : null
} catch {
  result = responseText
}

if (!response.ok) {
  console.error(`Weather signal worker failed (${response.status})`, result)
  process.exit(1)
}

console.log(JSON.stringify(result))
