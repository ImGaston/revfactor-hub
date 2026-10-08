# How hotels and airlines handle event demand — lessons for RevFactor

Research summary, 2026-10-08. Evidence tags: **[V]** vendor claim, **[I]** independent (academic, press or government), **[P]** standard RM practice. Hotel and airline system internals (IDeaS, FLYR, PROS, Sabre) sit behind customer logins, so they are only partly visible.

## Hotels

- **Events tag dates; they don't replace the forecast.**
  - IDeaS G3 uses user-defined "Special Events", some marked "informational only" [V].
  - Most hotel systems give each event an impact scale and a one-time or repeating flag, and keep event dates out of the normal-day baseline [V].
- **Events do two jobs in forecasting** [P][I]:
  1. Remove event days from the "normal" baseline.
  2. Forecast the event from earlier runs of the same event plus current pickup.
  - Simple pickup forecasting is among the most robust methods (Weatherford & Kimes 2003) [I].
  - Analysts are still how most systems catch unusual demand. Automatically flagging booking curves that diverge from forecast raised revenue in simulation (Rennie et al. 2021) [I].
- **Sold-out history understates demand.** It is "censored" data. If it isn't corrected, forecasts drift downward, costing about 3% of revenue in one survey [I].
- **Stay rules.** Hotels pair minimum length of stay with closed-to-arrival on peak nights, so short stays don't strand the nights around them [P]. Blanket rules backfire, so stay rules should follow the booking pace [V].
- **Overreaction is common.**
  - Paris 2024: hotel rates fell about 41% from their peak, minimum stays were dropped late, and Accor withdrew its RevPAR uplift guidance [I].
  - World Cup 2026: about 80% of US hoteliers expected to finish below forecast, and host-city rates fell more than 40% from peak [I].
  - The lesson is that **the event alone isn't demand; pickup is.**

## Data vendors

- **PredictHQ** [V]:
  - Gives event ranks, modelled attendance and impact patterns that spread demand onto the days before and after.
  - Advises learning which event types move each property's demand, rather than hardcoding categories.
  - Widens the radius only for very large events.
  - Its accuracy claims don't disclose how they were tested.
- **Forward booking data beats event lists:**
  - Amadeus Demand360 provides market on-the-books data [V].
  - Lighthouse combines search demand, events and a market vs. own on-the-books benchmark [V].
- **PriceLabs** [V]:
  - Detects demand from about 350 nearby comparable listings, even when no event is known.
  - Its event price factors taper with distance and fade as real bookings come in.
- **STR event booking windows run longer:** Beyond's Super Bowl LX data shows bookings about 30 days out vs. about 11 days normally, with ADR +58% [V].
- **Signal ranking** [I+P]:
  1. Own and market forward pickup vs. same-time-last-year.
  2. Search and lead-time signals.
  3. Competitor rate moves.
  4. Event metadata.

## Airlines

- **Controls** [P]. Bid-price controls accept a fare only if it beats the opportunity cost of the seat. Events raise bid prices on affected routes and dates, which closes cheap fare classes.
- **Analyst overrides.**
  - Analysts compare bookings with the forecast and apply "influences" [I].
  - Their adjustments add value, especially around competitor changes (Mukhopadhyay et al. 2007) [I].
  - Too many overrides erode trust in the system (JetBlue/PROS) [V].
- **Measurement.**
  - The Revenue Opportunity Model compares achieved revenue with a perfect-hindsight maximum and a no-control minimum [I].
  - Counterfactual estimates have reached about 1% error (Air Canada) [I].
- **Weather and disasters.**
  - Hurricane Irma fare spikes led airlines to cap fares under political pressure [I].
  - SC and TN price-gouging laws cover lodging during declared emergencies, and California's 10% cap was used against Airbnb pricing during the LA wildfires [I].

## Governance

- **Most human adjustments don't help** (Fildes & Goodwin) [I]:
  - Small adjustments add little or hurt.
  - Upward adjustments carry optimism bias.
  - Large, well-informed downward adjustments help most.
  - Forecasters adjusted about 75% of forecasts, which is too often.
- **Measure forecast value added.** Log the system value, the human-approved value and the actual result.
- **Signals expire.** Event placeholders fade as pickup comes in, and event records are re-checked for date changes and cancellations.
- **Late price surges hurt on average.** Raising Airbnb prices close to the stay date lowered revenue on average, with wide differences between listings (Leoni & Nilsson 2021) [I].

## What RevFactor should do

**Copy:**
1. Use pace as the trigger and the event as the explanation. An event with flat pickup means hold/watch.
2. Treat the 0.6 own / 0.4 playbook lift as a starting estimate:
   - Shrink it toward pickup as the date nears.
   - Cap the own-history weight by the number of prior runs of the event.
   - Mark sold-out history as censored.
3. Recommend stay rules (minimum stay, arrival day) as well as price, plus automatic relaxing when pickup lags.
4. Keep the approval log as a dataset: suggestion, approved value, approver, reason, outcome. Report system vs. human vs. PriceLabs alone.
5. Weather alerts allow only hold or decrease, never an increase. This is a legal guardrail.

**Skip at RevFactor's scale:** bid prices and route optimisation, overbooking, group displacement, full sold-out correction models, and PredictHQ-grade attendance modelling.

**Workflow:**
- Start with a modest placeholder 90–180 days out, then review at about 60, 30 and 14 days. Most of the decision value is in the 30–7 day window.
- Review markets weekly, with a daily exception queue.
- Expire unapproved recommendations at their decision date.

**Metrics:**
- Event-date revenue vs. a counterfactual (difference-in-differences against unaffected comparable listings).
- Acceptance and reversal rates.
- Underpricing signals (booked very early, sold out below market) and overpricing signals (unsold, late discounting).
- Gap nights created by stay rules.
- Accuracy of the materiality score against realized pickup.
- Value added by human edits, split by upward vs. downward.

## Sources

- IDeaS G3: https://help.ideasrms.com/g3rms_rp/Content/Reports/Operations-Report.htm
- Access Group RMS events: https://help-rms.theaccessgroup.com/en/articles/12066929-update-and-analyze-events
- Event history exclusion: https://ufhelp.atlassian.net/wiki/spaces/Docs9x/pages/136904924/Special+Forecasting+Circumstances
- Duetto + PredictHQ: https://www.predicthq.com/customers/duetto
- Stay restrictions: https://www.rateboard.io/en/blog/restrictions-in-hotel-revenue-management ; https://www.mews.com/en/blog/hotel-minimum-length-of-stay
- Weatherford & Kimes 2003: https://ecommons.cornell.edu/bitstream/handle/1813/72130/Kimes30_Comparison_of_Forecasting.pdf
- Rennie et al.: https://spiral.imperial.ac.uk/entities/publication/5215b22a-509b-48f0-b678-f18d9f5fd352
- Unconstraining survey: https://www.doi.org/10.1155/2012/270910
- PredictHQ impact patterns: https://docs.predicthq.com/getting-started/predicthq-data/impact-patterns ; accommodation guide: https://docs.predicthq.com/getting-started/use-case-guides/accommodation-the-proven-path-to-value
- Amadeus Demand360: https://www.hospitalitynet.org/news/4103710.html ; Lighthouse: https://www.hospitalitynet.org/news/4106466.html
- PriceLabs events: https://help.pricelabs.co/portal/en/kb/articles/how-pricelabs-handles-event-pricing
- Beyond, Super Bowl LX: https://beyondpricing.com/blog/super-bowl-2026-short-term-rental-trends-bay-area-pricing-occupancy-and-revenue-insights-for-hosts
- Paris 2024: https://www.bloomberg.com/news/articles/2024-07-24/paris-olympics-hotel-prices-are-down-41-since-last-fall
- World Cup 2026: https://www.newsnationnow.com/us-news/sports/world-cup-hotel-bookings-falling-short/
- Mukhopadhyay et al. 2007: https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-5915.2007.00160.x
- JetBlue / PROS: https://pros.com/learn/case-studies-testimonials/jetblue-redefining-forecasting-accuracy-and-analyst-efficiency
- Revenue Opportunity Model: https://link.springer.com/article/10.1057/rpm.2016.32 ; counterfactual: https://arxiv.org/abs/2101.10249
- Fildes & Goodwin: https://forecasters.org/wp-content/uploads/Good-and-Bad-Judgment-in-Forecasting_Issue8.pdf
- Leoni & Nilsson 2021: https://ideas.repec.org/p/ubi/deawps/92.html
- Irma fare caps: https://cbsnews.com/news/hurricane-irma-airfares-airlines-price-gouging ; SC: https://www.live5news.com/2024/08/04/sc-price-gouging-law-effect-after-emergency-declaration/ ; Airbnb LA suit: https://www.foxla.com/news/airbnb-facing-lawsuit-allegedly-price-gouging-during-la-wildfires
