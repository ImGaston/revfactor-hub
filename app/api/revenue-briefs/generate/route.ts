import { hasPermission } from "@/lib/permissions.server"
import { renderRevenueBriefPdf } from "@/lib/revenue-brief/pdf"
import {
  RevenueBriefSchema,
  revenueBriefFilename,
} from "@/lib/revenue-brief/schema"

export async function POST(request: Request) {
  if (!(await hasPermission("pipeline", "view"))) {
    return Response.json({ error: "You do not have access to revenue briefs." }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: "The brief data could not be read." }, { status: 400 })
  }

  const parsed = RevenueBriefSchema.safeParse(payload)
  if (!parsed.success) {
    return Response.json(
      {
        error: "Review the highlighted brief fields before generating the PDF.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  try {
    const pdf = await renderRevenueBriefPdf(parsed.data)
    const filename = revenueBriefFilename(parsed.data)

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/pdf",
      },
    })
  } catch (error) {
    console.error("Revenue brief PDF generation failed", error)
    return Response.json(
      { error: "The PDF could not be generated. Try again in a moment." },
      { status: 500 }
    )
  }
}
