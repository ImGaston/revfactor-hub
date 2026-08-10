import { AirRoiNewPropertyIntakeSchema } from "@/lib/airroi-estimate"
import {
  AirRoiApiError,
  buildAirRoiNewPropertyDraft,
  isAirRoiConfigured,
} from "@/lib/airroi.server"
import { hasPermission } from "@/lib/permissions.server"

export async function POST(request: Request) {
  if (!(await hasPermission("pipeline", "view"))) {
    return Response.json(
      { error: "You do not have access to revenue briefs." },
      { status: 403 }
    )
  }

  if (!isAirRoiConfigured()) {
    return Response.json({ error: "AirROI is not connected." }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json(
      { error: "The property intake could not be read." },
      { status: 400 }
    )
  }

  const parsed = AirRoiNewPropertyIntakeSchema.safeParse(payload)
  if (!parsed.success) {
    return Response.json(
      {
        error: "Review the pre-launch property intake.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  try {
    const result = await buildAirRoiNewPropertyDraft(parsed.data)
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    if (error instanceof AirRoiApiError) {
      return Response.json(
        { error: error.message },
        {
          status:
            error.status >= 400 && error.status < 600 ? error.status : 502,
        }
      )
    }
    console.error("Revenue brief AirROI estimate failed", error)
    return Response.json(
      { error: "AirROI revenue estimation could not be completed." },
      { status: 502 }
    )
  }
}
