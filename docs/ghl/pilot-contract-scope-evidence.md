# Pilot Q1 signed scope draft — 2026-09-04

Created and saved a separate native GHL template, then cold-reloaded and inspected its fields and payment settings. It is **unpublished and unrouted**. No document was generated, sent or signed; no payment/contact/workflow action occurred.

- Name: `RF_NATIVE_Standard_Q1_Fee150_PILOT_SCOPE_DRAFT_v1`
- Pilot template ID: `6a9b537fd8153e5b6a99bc47`
- [Pilot editor](https://app.gohighlevel.com/v2/location/ErABPRqWbMyIicvzvCFt/payments/proposals-estimates/templates/edit/6a9b537fd8153e5b6a99bc47)
- Source Q1 v2 remains `6a9a8d9de484907c8908e073`; no source edit or route replacement was made.

## Persisted changes

| Native field | Editor DOM identity | Cold-reloaded state |
| --- | --- | --- |
| Client legal business name | `a2b29746-feec-4d3f-813e-034243241b60` | Required; assigned Contact / Primary / Signer; 690px wide |
| Property address | `70e3fc1e-1590-4e10-bef4-6275ebf8791b` | Required; assigned Contact / Primary / Signer; 690×40px |
| Existing client signature | `28f0d214-0921-4073-a476-899c390f9960` | Sole signature, same identity and Contact assignment; repositioned below acceptance text so new scope spacing does not overlap it |

The scope sentence now reads: “The property covered by this Agreement is identified in the Property address field below and maintained in the Client's account record.” A PROPERTY ADDRESS label and field space follow that scope paragraph. Other contractual terms are unchanged. The original rich-text legal-name merge `{{opportunity.rf_billing_legal_business_name}}` remains visible below the new legal-name field.

Pricing remains one $350 monthly primary listing plus one $150 one-time onboarding fee; $500 initial total. Cold reload confirms recurring Monthly/Never, generate at signing ON, Direct Payment ON, Send Invoice ON and auto payment ON. No Test/Live setting was visible in template payment/document settings. Draft/PILOT naming is not test-mode proof.

## Still blocked before a real journey can use this draft

**Prefill is not implemented or proven.** Native text-field properties expose placeholder, required and “Add custom fields.” Its linkage modal explicitly describes updating Contact Custom Value or Document Variable with the signer's response after completion; it does not establish opportunity prefill. No response-writeback linkage or literal merge token was inserted into the native field. Both native fields are therefore currently empty. They must be populated from the known business/property scope before sending, with exact rendered-value verification, so the client does not retype the same answers. Until a supported prefill path is proven, keep this pilot unrouted.

**DOM IDs are not completed-document API proof.** Do not install these as production mappings until a controlled generated/completed document proves field IDs, actual values, `hasCompleted`, contact assignment, document/invoice identity and immutable signed scope through authenticated provider reads. Clones may require per-template mapping. Never substitute mutable contact/opportunity values or unrelated legacy documents for signed evidence.

**Direct-payment test mode remains unverified.** Do not infer it from a Draft template or a separate test payment link. Verify authoritative invoice/Stripe test mode before any signing/payment trial; no such trial occurred here.

The official [custom-value linkage guide](https://help.gohighlevel.com/support/solutions/articles/155000004040-link-custom-values-to-text-and-date-fields-documents-and-contracts) describes post-signature updates. It does not prove this template's forward prefill behavior. Only Q1 Standard was prepared; the other commercial variants and native SMS/workflow wiring remain pending.

## Sender-prefill probe — 2026-09-04 continuation

A separate document draft `RF_NATIVE_Q1_PREFILL_PROBE_UNSENT_v1` (`6a9b5cc288329849475734bd`) was generated using **Use Template**. It has no recipient, was not sent or signed, and has `paymentStatus=no_payment`. The template remains unrouted.

Using the native sender editor, saved invented business `RevFactor Pilot Example LLC` and address `101 Example Lane, Unit A, Austin, TX 00000, US` in the existing fillable controls. Native Preview renders both values. The authenticated document API returns:

| Field | `fieldId` | `id` (editor UUID) | `hasCompleted` | Recipient |
| --- | --- | --- | --- | --- |
| Legal business | `text_field_3` | `a2b29746-feec-4d3f-813e-034243241b60` | `true` | empty |
| Property address | `text_field_2` | `70e3fc1e-1590-4e10-bef4-6275ebf8791b` | `true` | empty |

The values exactly match the saved invented strings while the document status is **draft** and recipient count is zero. `hasCompleted` means field completion, not signature evidence. The runtime already requires completed document status plus the exact completed signer; a regression now explicitly rejects sender-prefilled drafts. API `fieldId` differs from the UUID `id`, so neither should be guessed from DOM identity. No production mapping has been enabled.

This proves a supported **manual sender-prefill** path. It does not prove automated population from a journey or signed recipient binding. The native preview leaves the unbound opportunity pricing merges blank; its separate product list still shows $350 recurring plus $150 one-time. This probe must not be used as the client agreement. The generated document payment panel still exposes no Test/Live control. No payment/invoice test-mode proof was obtained.

HighLevel's [fillable-field custom-value preservation changelog](https://ideas.gohighlevel.com/changelog/documents-contracts-retaining-custom-values-when-converting-to-templates) describes retaining sender values when converting a document to a template. It is not evidence that arbitrary opportunity merge tokens populate these controls automatically.
