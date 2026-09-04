import type {
  CheckoutState,
  StoredEntitlement,
} from "@/lib/server-checkout/contracts"

export type CheckoutAttempt = {
  id: string
  entitlementId: string
  generation: number
  idempotencyKey: string
  state: CheckoutState
  checkoutSessionId: string | null
  checkoutUrl: string | null
}

export type RpcResult<T> = Promise<{
  data: T | null
  error: { message: string } | null
}>

export type CheckoutRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): RpcResult<unknown>
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        maybeSingle(): RpcResult<Record<string, unknown>>
      }
    }
  }
}

export class DbCheckoutAttemptRepository {
  constructor(private readonly database: CheckoutRpcClient) {}

  async findEntitlementByJti(jti: string): Promise<StoredEntitlement | null> {
    const result = await this.database
      .from("agreement_entitlements")
      .select(
        "id,jti,status,expires_at,environment,stripe_account_id,highlevel_location_id,highlevel_contact_id,highlevel_opportunity_id,onboarding_group_id,billing_account_id,account_sequence,account_count,total_listing_count,billing_mode,agreement_document_id,agreement_template_id,agreement_revision,agreement_content_sha256,primary_quantity,child_quantity,onboarding_fee_cents,service_start_mode,service_start_date,currency,price_book_version,tax_policy"
      )
      .eq("jti", jti)
      .maybeSingle()
    if (result.error) throw new Error(result.error.message)
    if (!result.data) return null
    const row = result.data
    return {
      id: String(row.id),
      jti: String(row.jti),
      status: row.status as StoredEntitlement["status"],
      expiresAt: String(row.expires_at),
      environment: row.environment as StoredEntitlement["environment"],
      stripeAccountId: String(row.stripe_account_id),
      highLevelLocationId: String(row.highlevel_location_id),
      highLevelContactId: String(row.highlevel_contact_id),
      highLevelOpportunityId: String(row.highlevel_opportunity_id),
      onboardingGroupId: String(row.onboarding_group_id),
      billingAccountId: String(row.billing_account_id),
      accountSequence: Number(row.account_sequence),
      accountCount: Number(row.account_count),
      totalListingCount: Number(row.total_listing_count),
      billingMode: row.billing_mode as StoredEntitlement["billingMode"],
      agreementDocumentId: String(row.agreement_document_id),
      agreementTemplateId: String(row.agreement_template_id),
      agreementRevision: Number(row.agreement_revision),
      agreementContentSha256: String(row.agreement_content_sha256),
      primaryQuantity: Number(row.primary_quantity),
      childQuantity: Number(row.child_quantity),
      onboardingFeeCents: Number(row.onboarding_fee_cents),
      serviceStartMode:
        row.service_start_mode as StoredEntitlement["serviceStartMode"],
      serviceStartDate: row.service_start_date
        ? String(row.service_start_date)
        : null,
      currency: row.currency as "usd",
      priceBookVersion: String(row.price_book_version),
      taxPolicy: row.tax_policy as StoredEntitlement["taxPolicy"],
    }
  }

  async claimAttempt(
    entitlementId: string,
    identitySha256: string,
    lineItems: Array<{
      priceId: string
      quantity: number
      kind: "one_time" | "recurring"
      unitAmount: number
      currency: "usd"
    }>
  ): Promise<CheckoutAttempt> {
    const result = await this.database.rpc("claim_server_checkout_attempt", {
      p_entitlement_id: entitlementId,
      p_identity_sha256: identitySha256,
      p_line_items: lineItems,
    })
    if (result.error) throw new Error(result.error.message)
    const row = result.data as Record<string, unknown> | null
    if (!row) throw new Error("Checkout claim returned no attempt")
    return mapAttempt(row)
  }

  async attachSession(input: {
    attemptId: string
    expectedState: "session_creating"
    checkoutSessionId: string
    checkoutUrl: string
  }): Promise<CheckoutAttempt> {
    const result = await this.database.rpc("attach_server_checkout_session", {
      p_attempt_id: input.attemptId,
      p_expected_state: input.expectedState,
      p_checkout_session_id: input.checkoutSessionId,
      p_checkout_url: input.checkoutUrl,
    })
    if (result.error) throw new Error(result.error.message)
    const row = result.data as Record<string, unknown> | null
    if (!row) throw new Error("Checkout session attach returned no attempt")
    return mapAttempt(row)
  }
}

function mapAttempt(row: Record<string, unknown>): CheckoutAttempt {
  return {
    id: String(row.id),
    entitlementId: String(row.entitlement_id),
    generation: Number(row.generation),
    idempotencyKey: String(row.idempotency_key),
    state: row.state as CheckoutState,
    checkoutSessionId: row.checkout_session_id
      ? String(row.checkout_session_id)
      : null,
    checkoutUrl: row.checkout_url ? String(row.checkout_url) : null,
  }
}

export type CheckoutAttemptRepository = Pick<
  DbCheckoutAttemptRepository,
  "findEntitlementByJti" | "claimAttempt" | "attachSession"
>
