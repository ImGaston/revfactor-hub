import { createClient } from "@supabase/supabase-js"

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function fetchAllRecords(tableName: string) {
  const records: Record<string, unknown>[] = []
  let offset: string | undefined

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`
    )
    if (offset) url.searchParams.set("offset", offset)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    })
    const data = await res.json()
    records.push(...data.records)
    offset = data.offset
  } while (offset)

  return records
}

async function migrate() {
  console.log("Fetching clients from Airtable...")
  const airtableClients = await fetchAllRecords("clients")
  console.log(`Found ${airtableClients.length} clients`)

  console.log("Fetching listings from Airtable...")
  const airtableListings = await fetchAllRecords("Listings")
  console.log(`Found ${airtableListings.length} listings`)

  // Insert clients
  const clientRows = airtableClients.map((r: any) => ({
    airtable_id: r.id,
    name: r.fields["Name"] || "Unknown",
    status: (r.fields["Status"] || "active").toLowerCase(),
    onboarding_date: r.fields["Onboarding Date"] || null,
    contract_term: r.fields["Contract Term"] || null,
    ending_date: r.fields["Ending Date"] || null,
    billing_amount: r.fields["Billing Amount / Month"] || null,
    autopayment_set_up: r.fields["Autopayment Set Up"] === "Set Up",
    stripe_dashboard: r.fields["Stripe Dashboard"] || null,
  }))

  console.log("Inserting clients into Supabase...")
  const { data: insertedClients, error: clientError } = await supabase
    .from("clients")
    .upsert(clientRows, { onConflict: "airtable_id" })
    .select("id, airtable_id")

  if (clientError) {
    console.error("Client insert error:", clientError.message)
    return
  }

  console.log(`Inserted ${insertedClients.length} clients`)

  // Build airtable_id → supabase uuid map
  const clientMap = new Map<string, string>()
  for (const c of insertedClients) {
    clientMap.set(c.airtable_id, c.id)
  }

  // Insert listings
  const listingRows = airtableListings
    .map((r: any) => {
      const clientAirtableIds: string[] = r.fields["Clients"] || []
      const clientId = clientAirtableIds.length
        ? clientMap.get(clientAirtableIds[0])
        : null

      const cityState = r.fields["City,State"] || ""
      const [city, state] = cityState.split(",").map((s: string) => s.trim())

      return {
        airtable_id: r.id,
        client_id: clientId || null,
        name: r.fields["Listing"] || "Unknown",
        listing_id: r.fields["Listing ID"] || null,
        pricelabs_link: r.fields["Pricelab Link"] || null,
        airbnb_link: (r.fields["Airbnb link"] || "").trim() || null,
        city: city || null,
        state: state || null,
      }
    })
    .filter((l: any) => l.client_id !== null)

  console.log(`Inserting ${listingRows.length} listings into Supabase...`)
  const { data: insertedListings, error: listingError } = await supabase
    .from("listings")
    .upsert(listingRows, { onConflict: "airtable_id" })
    .select("id")

  if (listingError) {
    console.error("Listing insert error:", listingError.message)
    return
  }

  console.log(`Inserted ${insertedListings.length} listings`)

  // Summary
  const orphaned = airtableListings.length - listingRows.length
  if (orphaned > 0) {
    console.log(`Skipped ${orphaned} listings with no matching client`)
  }

  console.log("Migration complete!")
}

migrate().catch(console.error)
