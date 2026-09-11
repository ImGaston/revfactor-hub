-- Complement existing ledgers; no duplicate payments or expenses.
ALTER TABLE public.expenses ADD COLUMN financial_treatment text NOT NULL DEFAULT 'operating' CHECK (financial_treatment IN ('operating','partner_distribution'));
ALTER TABLE public.expenses ADD COLUMN financial_reviewed_at timestamptz;
ALTER TABLE public.bank_transactions ADD COLUMN income_treatment text NOT NULL DEFAULT 'pending' CHECK (income_treatment IN ('pending','operating','capital','transfer'));
ALTER TABLE public.bank_transactions ADD COLUMN income_reviewed_at timestamptz;
CREATE TABLE public.financial_month_reviews (
 month date PRIMARY KEY CHECK (month = date_trunc('month',month)::date),
 reviewed_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.financial_account_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.bank_accounts(id),
 effective_date date NOT NULL, amount_cents bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE INDEX ON public.financial_account_balances(account_id,effective_date DESC,created_at DESC);
CREATE TABLE public.financial_mrr_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observed_at timestamptz NOT NULL DEFAULT now(),
 calculation_version text NOT NULL, valid boolean NOT NULL, error text,
 mrr_cents bigint, past_due_cents bigint, paying_clients integer, details jsonb NOT NULL,
 CHECK (jsonb_typeof(details)='array'),
 CHECK (NOT valid OR (mrr_cents IS NOT NULL AND past_due_cents IS NOT NULL AND paying_clients IS NOT NULL AND error IS NULL))
);
CREATE INDEX ON public.financial_mrr_snapshots(observed_at DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['financial_month_reviews','financial_account_balances','financial_mrr_snapshots'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role',t);
 EXECUTE format('CREATE POLICY finance_read ON public.%I FOR SELECT TO authenticated USING (public.has_permission(''financials'',''view'') AND public.get_my_role() = ''super_admin'')',t);
 END LOOP;
END $$;
CREATE POLICY review_write ON public.financial_month_reviews FOR ALL TO authenticated USING (public.get_my_role()='super_admin' AND public.has_permission('financials','edit')) WITH CHECK (public.get_my_role()='super_admin' AND public.has_permission('financials','edit'));
CREATE POLICY balance_insert ON public.financial_account_balances FOR INSERT TO authenticated WITH CHECK (public.get_my_role()='super_admin' AND public.has_permission('financials','edit') AND created_by=auth.uid());
-- Snapshots are inserted only by the privileged sync. Even that path cannot edit history.
CREATE FUNCTION public.prevent_financial_snapshot_edit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Financial snapshots are immutable'; END $$;
CREATE TRIGGER immutable_mrr BEFORE UPDATE OR DELETE ON public.financial_mrr_snapshots FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_snapshot_edit();
CREATE TRIGGER immutable_balance BEFORE UPDATE OR DELETE ON public.financial_account_balances FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_snapshot_edit();
-- Invoker trigger is sufficient: existing writers are super_admin or service_role.
CREATE FUNCTION public.invalidate_financial_review() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE before_row jsonb; after_row jsonb; d text; dates text[];
BEGIN
 before_row := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 after_row := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 -- Stripe refreshes synced_at/raw_json without changing the cash ledger.
 IF TG_TABLE_NAME='stripe_payouts' AND TG_OP='UPDATE' AND
   (before_row->'amount_cents',before_row->'currency',before_row->'status',before_row->'arrival_date') IS NOT DISTINCT FROM
   (after_row->'amount_cents',after_row->'currency',after_row->'status',after_row->'arrival_date') THEN RETURN NEW; END IF;
 dates := ARRAY[before_row->>'date',after_row->>'date',before_row->>'paid_at',after_row->>'paid_at',before_row->>'txn_date',after_row->>'txn_date',before_row->>'arrival_date',after_row->>'arrival_date'];
 FOREACH d IN ARRAY dates LOOP
 IF d IS NOT NULL THEN DELETE FROM public.financial_month_reviews WHERE month=(left(d,7)||'-01')::date; END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER invalidate_review AFTER INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.invalidate_financial_review();
CREATE TRIGGER invalidate_review AFTER INSERT OR UPDATE OR DELETE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.invalidate_financial_review();
CREATE TRIGGER invalidate_review AFTER INSERT OR UPDATE OR DELETE ON public.stripe_payouts FOR EACH ROW EXECUTE FUNCTION public.invalidate_financial_review();
-- Confirmation uses an optimistic ledger revision and one transaction. Triggers
-- serialize writers with this row, so a concurrent import cannot be approved unseen.
CREATE TABLE public.financial_ledger_revision (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0);
INSERT INTO public.financial_ledger_revision(id) VALUES (1);
ALTER TABLE public.financial_ledger_revision ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.financial_ledger_revision TO authenticated,service_role;
CREATE POLICY revision_read ON public.financial_ledger_revision FOR SELECT TO authenticated USING(public.get_my_role()='super_admin' AND public.has_permission('financials','view'));
CREATE POLICY revision_update ON public.financial_ledger_revision FOR UPDATE TO authenticated USING(public.get_my_role()='super_admin' AND public.has_permission('financials','edit')) WITH CHECK(public.get_my_role()='super_admin' AND public.has_permission('financials','edit'));
CREATE FUNCTION public.bump_financial_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN UPDATE public.financial_ledger_revision SET revision=revision+1 WHERE id=1; RETURN NULL; END $$;
CREATE TRIGGER bump_finance_revision AFTER INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH STATEMENT EXECUTE FUNCTION public.bump_financial_revision();
CREATE TRIGGER bump_finance_revision AFTER INSERT OR UPDATE OR DELETE ON public.bank_transactions FOR EACH STATEMENT EXECUTE FUNCTION public.bump_financial_revision();
CREATE TRIGGER bump_finance_revision AFTER INSERT OR UPDATE OR DELETE ON public.stripe_payouts FOR EACH STATEMENT EXECUTE FUNCTION public.bump_financial_revision();
CREATE FUNCTION public.confirm_financial_month(p_month date,p_revision bigint) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_revision bigint;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'super_admin' OR public.has_permission('financials','edit') IS NOT TRUE THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 IF p_month>=date_trunc('month',now())::date OR p_month<>date_trunc('month',p_month)::date THEN RAISE EXCEPTION 'Invalid month'; END IF;
 SELECT revision INTO current_revision FROM public.financial_ledger_revision WHERE id=1 FOR UPDATE;
 IF current_revision<>p_revision THEN RAISE EXCEPTION 'Los registros cambiaron. Actualizá y revisá el mes nuevamente.'; END IF;
 INSERT INTO public.financial_month_reviews(month,reviewed_by) VALUES(p_month,auth.uid()) ON CONFLICT(month) DO UPDATE SET reviewed_at=now(),reviewed_by=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.confirm_financial_month(date,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_financial_month(date,bigint) TO authenticated;
