#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <postgres-bin-dir> <migration-087-path> <migration-088-path>" >&2
  exit 64
fi

pg_bin="$1"
migration_087="$2"
migration_088="$3"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cluster_dir="$(mktemp -d "${TMPDIR:-/tmp}/rf-checkout-pg.XXXXXX")"
socket_dir="$(mktemp -d "${TMPDIR:-/tmp}/rf-checkout-socket.XXXXXX")"
port=55439

cleanup() {
  "$pg_bin/pg_ctl" -D "$cluster_dir" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$cluster_dir" "$socket_dir"
}
trap cleanup EXIT

"$pg_bin/initdb" -D "$cluster_dir" -A trust -U postgres >/dev/null
"$pg_bin/pg_ctl" -D "$cluster_dir" -o "-k $socket_dir -p $port -c listen_addresses=''" -w start >/dev/null

psql=("$pg_bin/psql" -h "$socket_dir" -p "$port" -U postgres -v ON_ERROR_STOP=1)
createdb=("$pg_bin/createdb" -h "$socket_dir" -p "$port" -U postgres)
dropdb=("$pg_bin/dropdb" -h "$socket_dir" -p "$port" -U postgres)

prepare_baseline() {
  local database="$1"
  "${createdb[@]}" "$database"
  "${psql[@]}" -d "$database" -f "$repo_root/supabase/rehearsal/087_prerequisites.sql" >/dev/null
  "${psql[@]}" -d "$database" -f "$migration_087" >/dev/null
}

prepare_baseline rf_checkout_rehearsal_a
"${psql[@]}" -d rf_checkout_rehearsal_a <<SQL >/dev/null
BEGIN;
\i $migration_088
ROLLBACK;
DO \$\$ BEGIN
  IF to_regclass('public.server_checkout_attempts') IS NOT NULL THEN
    RAISE EXCEPTION 'Transactional rollback left migration 088 objects behind';
  END IF;
END \$\$;
SQL
"${psql[@]}" -d rf_checkout_rehearsal_a -f "$migration_088" >/dev/null
"${psql[@]}" -d rf_checkout_rehearsal_a -f "$repo_root/supabase/rehearsal/088_assertions.sql" >/dev/null

entitlement_id="$("${psql[@]}" -At -d rf_checkout_rehearsal_a -c "SELECT id FROM public.agreement_entitlements WHERE jti='rehearsal-agreement-revision-1'")"
lines='[{"priceId":"price_child","quantity":1,"kind":"recurring","unitAmount":5000,"currency":"usd"},{"priceId":"price_onboarding","quantity":1,"kind":"one_time","unitAmount":15000,"currency":"usd"},{"priceId":"price_primary","quantity":2,"kind":"recurring","unitAmount":35000,"currency":"usd"}]'
claim_dir="$(mktemp -d "${TMPDIR:-/tmp}/rf-checkout-claims.XXXXXX")"
for index in $(seq 1 20); do
  "${psql[@]}" -At -d rf_checkout_rehearsal_a -c \
    "SELECT (public.claim_server_checkout_attempt('$entitlement_id', repeat('b',64), '$lines'::jsonb)).id" \
    >"$claim_dir/$index" &
done
wait
if [[ "$(sort -u "$claim_dir"/* | wc -l | tr -d ' ')" != "1" ]]; then
  echo "20 concurrent claims returned more than one attempt" >&2
  exit 1
fi
if [[ "$("${psql[@]}" -At -d rf_checkout_rehearsal_a -c "SELECT count(*) FROM public.server_checkout_attempts WHERE entitlement_id='$entitlement_id'")" != "1" ]]; then
  echo "20 concurrent claims created more than one generation" >&2
  exit 1
fi
rm -rf "$claim_dir"

"${dropdb[@]}" rf_checkout_rehearsal_a
prepare_baseline rf_checkout_rehearsal_b
"${psql[@]}" -d rf_checkout_rehearsal_b -f "$migration_088" >/dev/null
"${psql[@]}" -d rf_checkout_rehearsal_b -f "$repo_root/supabase/rehearsal/088_assertions.sql" >/dev/null

echo "PASS: 087->088 forward, transactional rollback, forward-again, 20-claim concurrency, success/conflict replay, out-of-order fail-closed, RLS/grants/signatures, immutability, billing transitions, outbox atomicity, and final Assembly gate"
