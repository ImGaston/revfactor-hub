"use server"

import { createClient } from "@/lib/supabase/server"

export type ClientExportRow = {
  name: string
  email: string | null
  status: string
  onboarding_date: string | null
  ending_date: string | null
  contract_term: number | null
  assembly_client_id: string | null
  assembly_link: string | null
  billing_amount: number | null
  listing_count: number
  open_task_count: number
}

export async function getClientsExportData(
  clientIds: string[]
): Promise<ClientExportRow[]> {
  if (clientIds.length === 0) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .select(
      "name, email, status, onboarding_date, ending_date, contract_term, assembly_client_id, assembly_link, billing_amount, listings(id, status), tasks(id, status)"
    )
    .in("id", clientIds)
    .order("name")

  if (error) throw new Error(error.message)

  return (data ?? []).map((c) => ({
    name: c.name,
    email: c.email,
    status: c.status,
    onboarding_date: c.onboarding_date,
    ending_date: c.ending_date,
    contract_term: c.contract_term,
    assembly_client_id: c.assembly_client_id,
    assembly_link: c.assembly_link,
    billing_amount: c.billing_amount,
    listing_count: (c.listings ?? []).filter(
      (l: { status: string }) => l.status !== "inactive"
    ).length,
    open_task_count: (c.tasks ?? []).filter(
      (t: { status: string }) => t.status !== "done"
    ).length,
  }))
}
