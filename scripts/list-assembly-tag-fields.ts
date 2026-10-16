/**
 * Read-only: lists the Assembly Tags (multiSelect) custom fields and their
 * options, so the Listing Review app grant can be pointed at the right field.
 * Only GET requests; never prints the API key.
 * Usage: set -a && source .env.local && set +a && pnpm assembly:tag-fields
 */

import { findTagsField, listAssemblyCustomFields, resolveTagOption } from "../lib/assembly"

async function main() {
  if (!process.env.ASSEMBLY_API_KEY) {
    console.error("ASSEMBLY_API_KEY is not set")
    process.exit(1)
  }

  const fields = await listAssemblyCustomFields()
  const tagFields = fields.filter((f) => f.type === "multiSelect")
  if (tagFields.length === 0) console.log("No Tags (multiSelect) custom fields yet.")

  for (const entityType of ["client", "company"] as const) {
    const ofType = tagFields.filter((f) => f.entityType === entityType)
    if (ofType.length === 0) continue
    console.log(`\n${entityType.toUpperCase()} tags fields`)
    for (const field of ofType) {
      console.log(`  key=${field.key}  name="${field.name}"  id=${field.id}`)
      for (const o of field.options ?? []) {
        console.log(`    option key=${o.key}  label="${o.label ?? o.name ?? ""}"  id=${o.id}`)
      }
    }
  }

  const clientKey = process.env.ASSEMBLY_LISTING_REVIEW_TAG_FIELD?.trim()
  const companyKey = process.env.ASSEMBLY_LISTING_REVIEW_COMPANY_TAG_FIELD?.trim() || clientKey
  const option = process.env.ASSEMBLY_LISTING_REVIEW_TAG_OPTION?.trim()
  console.log("\nListing Review grant env")
  if (!clientKey || !option) {
    console.log("  Not set. Set ASSEMBLY_LISTING_REVIEW_TAG_FIELD=<client field key>,")
    console.log("  ASSEMBLY_LISTING_REVIEW_COMPANY_TAG_FIELD=<company field key> (if it differs)")
    console.log("  and ASSEMBLY_LISTING_REVIEW_TAG_OPTION=<option key or label>.")
    return
  }
  for (const [entityType, key] of [["client", clientKey], ["company", companyKey!]] as const) {
    const field = findTagsField(tagFields.filter((f) => f.entityType === entityType), key)
    const resolved = field ? resolveTagOption(field, option) : null
    console.log(
      `  ${entityType}: field ${field ? `"${field.key}" found` : `"${key}" NOT FOUND`}` +
        (field ? `, option ${resolved ? `"${resolved.key}" found` : `"${option}" NOT FOUND`}` : "")
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
