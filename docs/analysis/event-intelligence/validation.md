# Validation Report

## Overall Assessment: Share with caveats

The analysis is suitable for the proposed decision—run a read-only hybrid pilot before a full PredictHQ purchase. It is not suitable for claiming causal revenue uplift, setting production alert thresholds, or accepting a vendor quote without further evidence.

## Question and Sources

Question: should RevFactor buy PredictHQ broadly, build internally, or use a hybrid approach to detect market events early enough for revenue-management action?

Sources as of August 21, 2026:

- live PriceLabs active/syncing listing response, reduced to aggregate location and completeness measures;
- live PredictHQ Events, Suggested Radius, and Demand Surge responses for five markets over August 21–November 19, 2026;
- user-supplied PredictHQ discovery-call summary for commercial assumptions;
- official PredictHQ, Ticketmaster, National Weather Service, and GDELT documentation;
- local RevFactor Hub architecture and integration documentation.

## Methodology Review

- The population is 351 active, syncing, non-hidden PriceLabs listings. IDs were unique and all 351 records had coordinates.
- Raw market breadth is defined as normalized city/state label pairs. Coordinate clusters are presented only as 15-mile and 30-mile sensitivity checks, not final markets or billing units.
- The five PredictHQ samples use each market's accommodation Suggested Radius and the same 90-day window.
- The local-rank diagnostic uses `local_rank >= 50` only to demonstrate the weakness of a naive global threshold.
- Commercial sensitivity applies the call-note sticker prices to the observed portfolio. It does not assume an unprovided volume discount.
- The recommendation is based on coverage, portfolio shape, commercial sensitivity, and operational fit—not on causal revenue uplift.

## Calculation Spot-Checks

- Density bucket listings: **verified** — 100 + 127 + 68 + 56 = 351.
- Density bucket city/state labels: **verified** — 100 + 48 + 11 + 3 = 162.
- Low-density portfolio share: **verified** — 227 / 351 = 64.7%.
- Annual RevFactor fee base assumption: **verified** — 351 × $300 × 12 = $1,263,600.
- PredictHQ per-property sticker: **verified** — 351 × $600 = $210,600, or 16.7% of the stated fee base.
- Raw small-city floor: **verified** — 162 × $2,500 = $405,000, or 32.1% of the stated fee base before any major-city uplift.
- Five-market property sticker: **verified** — 79 × $600 = $47,400.
- Market rank shares: **verified** independently from numerator/denominator pairs; values range from 41.4% in Washington, DC to 99.3% in Park City.
- Notebook execution: **verified** — eight code cells executed with zero error outputs.
- Portable report: **verified** — artifact validation, packaging, chart extraction, source dialog, desktop viewport, and 390px responsive checks passed.

## Issues Found

1. **High — outcome impact is not measured.** There is no defensible counterfactual for the NFL Draft miss or the sampled alerts. The report must not claim captured revenue, ADR lift, or ROI.
2. **High — the announcement horizon is outside the trial.** The 90-day subscription cannot validate 2027 NFL Draft detection or broad 12–24 month recall.
3. **Medium — commercial assumptions are not a quote.** Volume discount, minimum commitment, international treatment, and cluster-based pricing are unknown.
4. **Medium — location labels need normalization.** Three listings have no state, country labels use two United States variants, and at least one city/state label conflicts with its coordinates.
5. **Medium — connected-component radii can chain nearby towns.** The 15-mile and 30-mile counts are useful sensitivity bounds but require reviewed market definitions.
6. **Medium — source coverage is asymmetric.** Ticketmaster is ticketing-platform dependent, NWS is US-only, news needs corroboration, and PredictHQ Demand Surge did not surface Park City or Smokies dates in the sample.
7. **Low — Assembly evidence was not reviewed.** No local `ASSEMBLY_API_KEY` was available, so the Corey Hudson conversation remains optional qualitative enrichment rather than required evidence for the current recommendation.

## Required Caveats for Stakeholders

- Treat all price figures as discovery-call assumptions until a written quote is received.
- Treat cluster counts as sensitivity analysis, not vendor billing units or final operating markets.
- Treat the five-market feed snapshot as a coverage/noise case study, not an accuracy or ROI proof.
- Do not use Demand Surge alone and do not ship `local_rank >= 50` as a production action threshold.
- Keep the pilot read-only and human-approved until current restriction data, action governance, and outcome measurement are validated.

