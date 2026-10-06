-- Review with the churn tracker PR. Metadata-only: neither status nor date is
-- changed. Do not overwrite an exit the team has already tagged independently.
UPDATE public.listings l
SET exit_reason = 'sold_property',
    exit_note = 'Owner selling; Stripe already adjusted by Fede.',
    stripe_item_status = 'adjusted',
    exit_handled_by = 'Fede'
WHERE l.id = 'a6631aaf-3b5f-477b-8a60-d59a69927d75'
  AND l.status = 'inactive'
  AND l.deactivated_date = DATE '2026-10-06'
  AND l.exit_reason IS NULL AND l.exit_note IS NULL AND l.exit_handled_by IS NULL
  AND l.stripe_item_status = 'pending'
  AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = l.client_id AND c.status = 'active');
