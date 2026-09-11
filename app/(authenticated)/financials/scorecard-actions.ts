"use server"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { revalidatePath } from "next/cache"
import { loadScorecard } from "@/lib/financial-scorecard/repository.server"
import {
  monthlyResult,
  isStripeDeposit,
} from "@/lib/financial-scorecard/calculations"

async function context() {
  const profile = await getProfile()
  if (profile?.role !== "super_admin") throw new Error("Unauthorized")
  return { db: await createClient(), userId: profile.id }
}
export async function reviewIncome(id: string, treatment: string) {
  try {
    const { db } = await context()
    if (!["pending", "operating", "capital", "transfer"].includes(treatment))
      throw new Error("Clasificación inválida")
    const { data, error } = await db
      .from("bank_transactions")
      .select("*")
      .eq("id", id)
      .single()
    if (error) throw new Error(error.message)
    if (
      data.direction !== "in" ||
      data.flow_class !== "external_income" ||
      data.currency !== "usd" ||
      isStripeDeposit(data)
    )
      throw new Error("No es un ingreso adicional revisable")
    const result = await db
      .from("bank_transactions")
      .update({
        income_treatment: treatment,
        income_reviewed_at:
          treatment === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", id)
    if (result.error) throw new Error(result.error.message)
    revalidatePath("/financials")
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" }
  }
}
export type ExpenseReviewPatch = {
  treatment?: string
  categoryId?: string | null
  confirm?: boolean
}
/** Reclassifies one or many expenses from the month review. `treatment` and
 * `confirm` stamp financial_reviewed_at; `categoryId` also realigns `type`
 * with the category (same rule the bank importer applies). */
export async function reviewExpenses(ids: string[], patch: ExpenseReviewPatch) {
  try {
    const { db } = await context()
    const unique = [...new Set(ids)]
    if (unique.length === 0 || unique.length > 500)
      throw new Error("Seleccioná entre 1 y 500 gastos")
    const update: Record<string, string | null> = {}
    if (patch.treatment !== undefined) {
      if (!["operating", "partner_distribution"].includes(patch.treatment))
        throw new Error("Clasificación inválida")
      update.financial_treatment = patch.treatment
    }
    if (patch.categoryId !== undefined) {
      if (patch.categoryId === null) {
        update.category_id = null
      } else {
        const { data: category, error } = await db
          .from("expense_categories")
          .select("id,type")
          .eq("id", patch.categoryId)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!category) throw new Error("Categoría inexistente")
        update.category_id = category.id
        update.type = category.type
      }
    }
    if (patch.treatment !== undefined || patch.confirm)
      update.financial_reviewed_at = new Date().toISOString()
    if (Object.keys(update).length === 0) throw new Error("Nada para guardar")
    const { data, error } = await db
      .from("expenses")
      .update(update)
      .in("id", unique)
      .select("id")
    if (error) throw new Error(error.message)
    if ((data?.length ?? 0) !== unique.length)
      throw new Error(
        `Se actualizaron ${data?.length ?? 0} de ${unique.length} gastos. Actualizá y revisá.`
      )
    revalidatePath("/financials")
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" }
  }
}
export async function confirmMonth(month: string, expectedRevision: number) {
  try {
    const { db } = await context()
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      month >= new Date().toISOString().slice(0, 7)
    )
      throw new Error("Solo se pueden confirmar meses finalizados")
    const fresh = await loadScorecard(db)
    if (fresh.revision !== expectedRevision)
      throw new Error("Los registros cambiaron. Actualizá y revisá nuevamente.")
    const result = monthlyResult(fresh, month)
    if (
      result.incomePending.length ||
      result.expensePending.length ||
      result.unlinkedExpenses.length ||
      result.missingPaymentDates.length ||
      result.unknown.length
    )
      throw new Error("Resolvé los registros pendientes antes de confirmar")
    const { error } = await db.rpc("confirm_financial_month", {
      p_month: month + "-01",
      p_revision: expectedRevision,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/financials")
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo confirmar" }
  }
}
export async function saveAccountBalance(
  accountId: string,
  date: string,
  cents: number
) {
  try {
    const { db, userId } = await context()
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date > new Date().toISOString().slice(0, 10) ||
      !Number.isSafeInteger(cents)
    )
      throw new Error("Saldo o fecha inválidos")
    const { error } = await db.from("financial_account_balances").insert({
      account_id: accountId,
      effective_date: date,
      amount_cents: cents,
      created_by: userId,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/financials")
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" }
  }
}
