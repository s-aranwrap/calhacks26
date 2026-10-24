#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local PostgreSQL and checks the
# row-level security rules with Supabase-like roles (anon, authenticated,
# service_role). Optional dev tool: needs PostgreSQL 15+ binaries on PATH or
# PG_BIN pointing at them. With the Supabase CLI you can use `supabase db reset` instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT_CHECK:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # PostgreSQL refuses to run as root; use the postgres user if present.
  chown -R postgres "$WORK" 2>/dev/null && RUN_AS=(su postgres -s /bin/bash -c) || true
fi

run() {
  if [ ${#RUN_AS[@]} -gt 0 ]; then "${RUN_AS[@]}" "$*"; else bash -c "$*"; fi
}
cleanup() { run "'$PG_BIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

run "'$PG_BIN/initdb' -D '$WORK/data' -U postgres --auth=trust" >/dev/null
run "'$PG_BIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=' -l '$WORK/log' -w start" >/dev/null
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Mimic Supabase's default privileges so the migration's revokes are meaningful.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

"${PSQL[@]}" <<'SQL'
insert into public.activities (id, kind, title, source_platform, published, verification_status, last_checked_at, start_at)
values
  ('pub', 'event', 'Published', 'organizer', true, 'verified', now(), now() + interval '1 day'),
  ('draft', 'evergreen', 'Draft', 'csv', false, 'unverified', null, null);

do $$
declare n int;
begin
  -- Constraint checks
  begin
    insert into public.activities (id, kind, title, source_platform, published, verification_status) values ('bad1', 'evergreen', 'x', 'instagram', true, 'candidate');
    raise exception 'candidate was published';
  exception when check_violation then null; end;
  begin
    insert into public.activities (id, kind, title, source_platform, verification_status) values ('bad2', 'evergreen', 'x', 'csv', 'verified');
    raise exception 'verified without last_checked_at was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.activities (id, kind, title, source_platform, source_url) values ('bad3', 'evergreen', 'x', 'csv', 'javascript:alert(1)');
    raise exception 'non-http url was accepted';
  exception when check_violation then null; end;

  -- RLS as the app's role
  set local role anon;
  select count(*) into n from public.activities;
  if n <> 1 then raise exception 'anon should see exactly 1 published row, saw %', n; end if;
  begin
    insert into public.activities (id, kind, title, source_platform) values ('hack', 'evergreen', 'x', 'csv');
    raise exception 'anon insert succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.activities set title = 'hacked';
    raise exception 'anon update succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.activity_candidates;
    raise exception 'anon could read candidates';
  exception when insufficient_privilege then null; end;
  reset role;

  set local role authenticated;
  select count(*) into n from public.activities;
  if n <> 1 then raise exception 'authenticated should see 1 row, saw %', n; end if;
  reset role;

  set local role service_role;
  select count(*) into n from public.activities;
  if n <> 2 then raise exception 'service role should see all rows, saw %', n; end if;
  reset role;
end $$;

-- updated_at trigger
update public.activities set title = 'Published!' where id = 'pub';
select 'ok: all RLS and constraint checks passed' as result;
SQL
