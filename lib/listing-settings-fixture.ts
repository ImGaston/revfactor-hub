// Fictional data for the listing Setup tab preview (?setupPreview=1, dev only).
// No real client values.

import type { ListingSetup } from "@/lib/listing-settings"

const CS1 = "00000000-0000-4000-8000-0000000000c1"
const CS2 = "00000000-0000-4000-8000-0000000000c2"

export const PREVIEW_LISTING_SETUP: ListingSetup = {
  available: true,
  changeSets: [
    {
      id: CS2,
      title: "Cleaning fee and Vrbo markup",
      status: "applied",
      plan_ref: null,
      approved_by_label: "Staff (chat)",
      approved_at: "2026-01-12T20:00:00Z",
      notes: "Recover cleaning per stay; bring Vrbo in line.",
      created_at: "2026-01-12T20:00:00Z",
    },
    {
      id: CS1,
      title: "PriceLabs takeover",
      status: "verified",
      plan_ref: "Setup spec (example)",
      approved_by_label: "Staff (chat)",
      approved_at: "2026-01-10T18:00:00Z",
      notes: null,
      created_at: "2026-01-10T18:00:00Z",
    },
  ],
  settings: [
    { id: "s1", setting_key: "sync.pricing_tool", channel: "all", date_from: null, date_to: null, value: { text: "PriceLabs" }, system: "pricelabs", status: "verified", last_change_id: "c1", updated_at: "2026-01-10T18:10:00Z" },
    { id: "s2", setting_key: "price.min", channel: "all", date_from: null, date_to: null, value: { amount: 150 }, system: "pricelabs", status: "verified", last_change_id: "c2", updated_at: "2026-01-10T18:12:00Z" },
    { id: "s3", setting_key: "price.base", channel: "all", date_from: null, date_to: null, value: { amount: 200 }, system: "pricelabs", status: "verified", last_change_id: "c3", updated_at: "2026-01-10T18:12:00Z" },
    { id: "s4", setting_key: "stay.min_stay", channel: "all", date_from: "2026-12-24", date_to: "2026-12-31", value: { nights: 4 }, system: "pricelabs", status: "applied", last_change_id: "c4", updated_at: "2026-01-10T18:20:00Z" },
    { id: "s5", setting_key: "fee.cleaning", channel: "all", date_from: null, date_to: null, value: { amount: 100, per: "stay" }, system: "guesty", status: "applied", last_change_id: "c5", updated_at: "2026-01-12T20:05:00Z" },
    { id: "s6", setting_key: "markup.channel", channel: "vrbo", date_from: null, date_to: null, value: { percent: 18 }, system: "guesty", status: "applied", last_change_id: "c6", updated_at: "2026-01-12T20:06:00Z" },
    { id: "s7", setting_key: "discount.trip_length", channel: "airbnb", date_from: null, date_to: null, value: { tiers: [{ label: "3+ nights", percent: 15 }, { label: "2+ weeks", percent: 20 }] }, system: "airbnb", status: "drift", last_change_id: "c7", updated_at: "2026-01-11T09:00:00Z" },
  ],
  changes: [
    { id: "c6", change_set_id: CS2, setting_key: "markup.channel", channel: "vrbo", date_from: null, date_to: null, action: "ApplySetting", old_value: { percent: 30 }, new_value: { percent: 18 }, system: "guesty", reason: "Same payout as Airbnb after the cleaning fee.", evidence: { response: "PATCH 200" }, adjustment_id: null, actor_type: "staff", approved_by_label: "Staff (chat)", occurred_at: "2026-01-12T20:06:00Z" },
    { id: "c5", change_set_id: CS2, setting_key: "fee.cleaning", channel: "all", date_from: null, date_to: null, action: "ApplySetting", old_value: { amount: 0, per: "stay" }, new_value: { amount: 100, per: "stay" }, system: "guesty", reason: "Recover cleaning per turnover.", evidence: { response: "PATCH 200" }, adjustment_id: null, actor_type: "staff", approved_by_label: "Staff (chat)", occurred_at: "2026-01-12T20:05:00Z" },
    { id: "c7", change_set_id: CS1, setting_key: "discount.trip_length", channel: "airbnb", date_from: null, date_to: null, action: "FlagDrift", old_value: { tiers: [{ label: "3+ nights", percent: 15 }, { label: "2+ weeks", percent: 20 }] }, new_value: { tiers: [] }, system: "airbnb", reason: "Discounts missing on Airbnb after a PMS sync.", evidence: { observed: "Airbnb discounts panel" }, adjustment_id: null, actor_type: "system", approved_by_label: null, occurred_at: "2026-01-11T09:00:00Z" },
    { id: "c4", change_set_id: CS1, setting_key: "stay.min_stay", channel: "all", date_from: "2026-12-24", date_to: "2026-12-31", action: "ApplySetting", old_value: null, new_value: { nights: 4 }, system: "pricelabs", reason: "Holiday minimum.", evidence: { response: "200, 8 dates" }, adjustment_id: null, actor_type: "agent", approved_by_label: "Staff (chat)", occurred_at: "2026-01-10T18:20:00Z" },
    { id: "c3", change_set_id: CS1, setting_key: "price.base", channel: "all", date_from: null, date_to: null, action: "VerifySetting", old_value: null, new_value: { amount: 200 }, system: "pricelabs", reason: "PriceLabs API matches.", evidence: {}, adjustment_id: null, actor_type: "system", approved_by_label: null, occurred_at: "2026-01-10T18:12:00Z" },
    { id: "c2", change_set_id: CS1, setting_key: "price.min", channel: "all", date_from: null, date_to: null, action: "ApplySetting", old_value: { amount: 120 }, new_value: { amount: 150 }, system: "pricelabs", reason: "Owner minimum = payout floor ÷ tightest channel share.", evidence: { response: "200" }, adjustment_id: null, actor_type: "agent", approved_by_label: "Staff (chat)", occurred_at: "2026-01-10T18:12:00Z" },
    { id: "c1", change_set_id: CS1, setting_key: "sync.pricing_tool", channel: "all", date_from: null, date_to: null, action: "ApplySetting", old_value: { text: "PMS optimizer" }, new_value: { text: "PriceLabs" }, system: "pricelabs", reason: "One tool prices the listing.", evidence: {}, adjustment_id: null, actor_type: "staff", approved_by_label: "Staff (chat)", occurred_at: "2026-01-10T18:10:00Z" },
  ],
}
