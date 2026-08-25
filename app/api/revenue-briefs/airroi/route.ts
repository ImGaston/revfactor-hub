import { AirRoiRevenueBriefIntakeSchema } from "@/lib/airroi"
import {
  AirRoiApiError,
  buildAirRoiRevenueBriefDraft,
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
    return Response.json(
      {
        error:
          "AirROI is not connected. Add AIRROI_API_KEY to enable listing research.",
      },
      { status: 503 }
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json(
      { error: "The intake data could not be read." },
      { status: 400 }
    )
  }

  const parsed = AirRoiRevenueBriefIntakeSchema.safeParse(payload)
  if (!parsed.success) {
    return Response.json(
      {
        error: "Review the prospect intake before researching the listing.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  try {
    const result = await buildAirRoiRevenueBriefDraft(parsed.data)
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
    console.error("Revenue brief AirROI research failed", error)
    return Response.json(
      { error: "AirROI listing research could not be completed." },
      { status: 502 }
    )
  }
}
