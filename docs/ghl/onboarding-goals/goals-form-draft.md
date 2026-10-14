# Onboarding goals & pricing form — draft v1 (2026-10-14)

Status: draft for Fede's review. Nothing is built in GHL yet.

## Where it runs
- **Booking page (onboarding call):** only Q1 (goal yes/no + amount). Fast, so nobody drops off.
- **Right after booking:** email + SMS with the full form link.
- **24h before the call, if not submitted:** one reminder.
- **One submission per property.** The form opens with "Which property is this for?" and the email says "fill this once per property". (Listing is the anchor; GHL forms can't loop per listing.)
- Answers save to GHL contact custom fields (names below) so they show in call prep, and later feed the Hub goals/targets work.

## Intro text (top of form)
> A few quick questions so your onboarding call is about your property, not paperwork. Takes about 3 minutes. Rough numbers are fine — "I don't know" is a perfectly good answer.

---

## Section 0 — Property
**Q0. Which property is this for?** (short text: name or Airbnb link) → `rf_goal_property`

## Section 1 — Your revenue goal
**Q1. Do you have a revenue goal for this property?** (Yes / No / Not sure) → `rf_goal_has_target`

If **Yes**:
- **Q1a. What is it?** (amount) + **per** (Year / Month) → `rf_goal_target_amount`, `rf_goal_target_period`
- **Q1b. Where does that number come from?** (pick all that apply) → `rf_goal_target_source`
  - My own past bookings on this property
  - A previous manager, co-host or PMS report
  - AirDNA, PriceLabs or another data tool
  - My purchase / financing plan for the property
  - Another host or a friend
  - An estimate or gut feeling
  - Other (text)

If **No / Not sure**:
- **Q1c. What would make you happy with this property in a year?** (amount, optional) + **Q1d. What would you like to see change?** (long text) → `rf_goal_happy_amount`, `rf_goal_happy_notes`

## Section 2 — Your break-even
**Q2. Do you know how much the property needs to make to cover its costs?** (mortgage or rent, utilities, cleaning, fees, etc.) (Yes / No) → `rf_goal_has_breakeven`

If **Yes**:
- **Q2a. Break-even amount** + **per** (Year / Month) → `rf_goal_breakeven_amount`, `rf_goal_breakeven_period`
- **Q2b. Where does that number come from?** (My own bookkeeping / An accountant / A rough estimate / Other) → `rf_goal_breakeven_source`

If **No**: helper text "No problem, we can work it out together on the call."

## Section 3 — Your comfort floors
Explainer (shown above the questions, must read clearly):
> **This is not the price we will set.** Our pricing moves every day with demand. We just want to know the lowest you would ever be comfortable with, so we never go below it without talking to you first. Leave it blank if you have no floor.

**Q3. Lowest nightly price you'd accept**
- Weeknights (Sun–Thu): $____ → `rf_floor_price_weekday`
- Weekend nights (Fri–Sat): $____ → `rf_floor_price_weekend`

**Q4. Shortest stay you'd accept**
- Weeknights: 1 / 2 / 3 / 4+ nights / No preference → `rf_floor_minstay_weekday`
- Weekends: 1 / 2 / 3 / 4+ nights / No preference → `rf_floor_minstay_weekend`

**Q5. Anything else we should know?** (dates you block, seasons that matter, past pricing that went badly) (long text, optional) → `rf_goal_notes`

---

## Open questions for Fede
1. Ask Q3–Q4 per season too (high/low), or keep weekday/weekend only for v1? Draft keeps it simple.
2. Should the booking page also ask break-even (Q2), or goal only?
3. Who gets the internal alert when a form comes in (you, Emily/Ethan, or the call host)?
