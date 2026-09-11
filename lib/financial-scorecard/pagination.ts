import type { SupabaseClient } from "@supabase/supabase-js"

// Range in pages below PostgREST's cap; never treat a read failure as an empty ledger.
export async function allRows<T>(
  db: SupabaseClient,
  table: string,
  columns = "*"
): Promise<T[]> {
  const rows: T[] = []
  const order = table === "financial_month_reviews" ? "month" : "id"
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(order)
      .range(from, from + 499)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data as T[]))
    if (data.length < 500) return rows
  }
}
