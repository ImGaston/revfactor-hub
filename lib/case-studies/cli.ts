import path from "node:path"

export type CaseStudyCliArgs = {
  asOf: string
  output: string
  templateId: string
  selectionFile: string | undefined
}

export function parseCaseStudyCliArgs(args: string[]): CaseStudyCliArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${key ?? "end"}`)
    }
    if (
      !new Set([
        "--as-of",
        "--output",
        "--template-id",
        "--selection-file",
      ]).has(key)
    ) {
      throw new Error(`Unknown argument ${key}`)
    }
    if (values.has(key)) throw new Error(`Duplicate argument ${key}`)
    values.set(key, value)
  }

  const asOf = values.get("--as-of")
  const output = values.get("--output")
  const templateId = values.get("--template-id")?.trim()
  const parsedAsOf = asOf ? new Date(`${asOf}T00:00:00Z`) : null
  if (
    !asOf ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !parsedAsOf ||
    Number.isNaN(parsedAsOf.valueOf()) ||
    parsedAsOf.toISOString().slice(0, 10) !== asOf
  ) {
    throw new Error("--as-of must be a valid YYYY-MM-DD date")
  }
  if (!output) throw new Error("--output is required")
  if (
    !templateId ||
    templateId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(templateId)
  ) {
    throw new Error(
      "--template-id must be the reviewed exact Report Builder template ID"
    )
  }

  return {
    asOf,
    output: path.resolve(output),
    templateId,
    selectionFile: values.get("--selection-file"),
  }
}
