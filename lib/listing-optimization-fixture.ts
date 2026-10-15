// Fictional sample data for the local owner-portal preview (/portal/optimization?preview=1).
// Never real client content.

import type { OptimizationItem, OptimizationReport } from "@/lib/listing-optimization"

function item(partial: Partial<OptimizationItem> & Pick<OptimizationItem, "id" | "section" | "headline">): OptimizationItem {
  return {
    kind: "change",
    priority: "medium",
    sort_order: 0,
    rationale: null,
    current_value: null,
    proposed_value: null,
    options: [],
    photo_url: null,
    action_url: null,
    check_id: null,
    client_status: "pending",
    client_choice: null,
    client_note: null,
    decided_at: null,
    apply_status: "not_started",
    ...partial,
  }
}

export const PREVIEW_REPORTS: OptimizationReport[] = [
  {
    id: "preview-report",
    listing_title: "Cozy Lakeside Cabin | Hot Tub | Dock | Fire Pit",
    listing_url: null,
    cover_photo_url: null,
    overall_score: 61,
    score_breakdown: { completion: 72, structure: 58, ota_style: 45, seo: 64 },
    section_grades: {
      title: "C",
      description: "C",
      captions: "D",
      amenities: "B",
      rules_settings: "C",
    },
    owner_line:
      "The listing hides its best feature: guests see a generic cabin before they see the lake.",
    summary:
      "Your reviews are strong. The biggest wins are a clearer title, captions on every photo, and two amenities guests filter for.",
    published_at: new Date().toISOString(),
    checks: [],
    items: [
      item({
        id: "p-title",
        section: "title",
        priority: "high",
        headline: "Lead the title with the lake and the hot tub",
        rationale:
          "Guests scan titles in search. Pipes and generic words like cozy push your best features off the screen on phones.",
        current_value: "Cozy Lakeside Cabin | Hot Tub | Dock | Fire Pit",
        proposed_value: "Lakefront cabin with private dock and hot tub",
        options: [
          "Lakefront cabin with private dock and hot tub",
          "Private dock, hot tub and lake views",
          "Lake cabin with hot tub, steps to the water",
        ],
      }),
      item({
        id: "p-desc",
        section: "description",
        headline: "Open the description with who it's for and the best thing",
        rationale: "The first lines show before 'Show more'. Right now they describe the parking.",
        current_value: "Parking for 2 cars in the driveway. The cabin has...",
        proposed_value:
          "A quiet lakefront cabin for couples and small families, with a private dock and a hot tub facing the water.",
      }),
      item({
        id: "p-cap-1",
        section: "captions",
        sort_order: 1,
        headline: "Photo 1",
        current_value: null,
        proposed_value: "Private dock at sunset, steps from the deck",
      }),
      item({
        id: "p-cap-2",
        section: "captions",
        sort_order: 2,
        headline: "Photo 2",
        current_value: "Living room",
        proposed_value: "Living room with lake view and wood stove",
      }),
      item({
        id: "p-cap-3",
        section: "captions",
        sort_order: 3,
        headline: "Photo 3",
        current_value: null,
        proposed_value: "Bedroom 1: queen bed",
      }),
      item({
        id: "p-amen",
        section: "amenities",
        headline: "Tag the kayaks",
        rationale: "Kayaks show in your photos but aren't tagged, so filter searches miss you.",
        proposed_value: "Add amenity: Kayak",
      }),
      item({
        id: "p-pets",
        section: "rules_settings",
        kind: "owner_choice",
        headline: "Allow dogs?",
        rationale:
          "Pet-friendly searches are a big share of lake stays. Trade-off: more cleaning and a pet fee to set. Your call.",
        current_value: "No pets",
        proposed_value: "Up to 2 dogs, $75 pet fee per stay",
      }),
    ],
  },
]
