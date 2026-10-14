# Goals form in the onboarding journey — build spec v1 (2026-10-14)

Status: ready for Fede's OK. Nothing built in GHL yet.

## Client sees
1. Books the onboarding call on the GHL calendar.
2. The calendar's confirmation redirects to the goals form page (instead of the plain "thank you"). The page shows:
   - "Your onboarding call is booked."
   - "Please complete these few questions before your call."
   - "No time right now? We've emailed you a link to this form. You can come back and fill it in any time before your call."
3. Within minutes: the email below with their personal link.
4. 24h before the call, only if the form isn't submitted: a short reminder (email + SMS).

## GHL pieces to build
- **Funnel page** `Onboarding Goals` (same funnel styling as the signup). Holds the form (Custom HTML from `goals-form.html`, or a native GHL form with the same fields if we want zero code).
- **Contact custom fields** (one set per contact for v1): `rf_goal_property`, `rf_goal_has_target`, `rf_goal_target_amount`, `rf_goal_target_period`, `rf_goal_target_source`, `rf_goal_happy_amount`, `rf_goal_happy_notes`, `rf_goal_has_breakeven`, `rf_goal_breakeven_amount`, `rf_goal_breakeven_period`, `rf_goal_breakeven_source`, `rf_floor_price_weekday`, `rf_floor_price_weekend`, `rf_floor_minstay_weekday`, `rf_floor_minstay_weekend`, `rf_goal_notes`, plus `rf_goals_submitted_at`.
- **Onboarding calendar settings:** confirmation → redirect to the Onboarding Goals page, passing the contact id/email so the form knows who it is.
- **Workflow `RF ONBOARDING | Call booked → Goals form`** (Draft until Fede approves):
  - Trigger: appointment booked on the onboarding calendar.
  - Send email "Before your onboarding call" (below).
  - Wait until 24h before the appointment.
  - If tag `rf-goals-submitted` is missing → reminder email + SMS.
- **Form submit:** writes the fields, adds tag `rf-goals-submitted`, internal notification to the call host.

Multi-property clients: v1 stores one set on the contact (the main property, with the notes box for the others). Per-listing storage comes with the Hub goals/targets work.

## Email: Before your onboarding call
Subject: A few questions before your onboarding call

> Hi {{contact.first_name}},
>
> Your onboarding call is booked for {{appointment.start_time}}. Thanks!
>
> Please take 3 minutes to answer a few questions about your goals for the property before we talk: your revenue goal, your break-even, and the lowest prices and shortest stays you'd be comfortable with. It lets us spend the call on your property instead of paperwork.
>
> [Complete my goals form]({{goals_form_link}})
>
> Rough numbers are fine, and "I don't know" is a good answer too. You can use this link any time before your call.
>
> See you soon,
> The RevFactor team

## Reminder (24h before, only if not submitted)
Email subject: Your onboarding call is tomorrow
> Hi {{contact.first_name}}, quick reminder: your onboarding call is tomorrow at {{appointment.start_time}}. If you have 3 minutes, please complete your goals form first: {{goals_form_link}}

SMS:
> RevFactor: your onboarding call is tomorrow. If you have 3 min, please fill in your goals form first: {{goals_form_link}}
