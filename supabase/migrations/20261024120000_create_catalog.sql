-- Huddle shared activity catalog.
--
-- Access model
--   * anon / authenticated (the mobile app, using the publishable key):
--       SELECT only, and only rows that are published and not candidates.
--   * service role / secret key (server/ingest scripts, admins):
--       bypasses RLS for imports and review. Never shipped in the app.
--
-- Private user data (preferences, reflections, history) is NOT stored here.
-- It stays on the device in SQLite.
--
-- Location is two plain double columns. PostGIS isn't needed while the
-- catalog is small enough to filter on-device; see README "Future extension points".

-- ---------------------------------------------------------------------------
-- Published catalog
-- ---------------------------------------------------------------------------
create table public.activities (
  id                   text primary key check (id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  kind                 text not null check (kind in ('event', 'evergreen')),
  title                text not null check (char_length(title) between 1 and 140),
  description          text not null default '',
  category             text not null default 'other' check (category in (
                         'outdoors', 'arts', 'music', 'food', 'learning', 'community',
                         'wellness', 'fitness', 'games', 'culture', 'other')),
  moods                text[] not null default '{}'
                         check (moods <@ array['chill', 'social', 'active', 'creative']::text[]),
  tags                 text[] not null default '{}',

  venue_name           text,
  address              text,
  area                 text,
  latitude             double precision check (latitude between -90 and 90),
  longitude            double precision check (longitude between -180 and 180),

  start_at             timestamptz,
  end_at               timestamptz,
  time_zone            text,
  opening_hours        text,
  duration_min_minutes integer check (duration_min_minutes > 0),
  duration_max_minutes integer,
  duration_certainty   text check (duration_certainty in ('verified', 'estimated')),

  is_free              boolean,
  price_min            numeric(10, 2) check (price_min >= 0),
  price_max            numeric(10, 2),
  currency             text check (currency ~ '^[A-Z]{3}$'),
  price_certainty      text check (price_certainty in ('verified', 'estimated')),
  price_note           text,

  source_platform      text not null check (source_platform in ('organizer', 'csv', 'json', 'instagram', 'manual', 'supabase')),
  source_id            text,
  source_url           text check (source_url ~ '^https?://'),
  canonical_url        text,
  source_label         text,
  -- When the source published the listing; distinct from start_at.
  source_published_at  timestamptz,

  verification_status  text not null default 'unverified' check (verification_status in ('verified', 'unverified', 'candidate')),
  last_checked_at      timestamptz,
  availability         text not null default 'unknown' check (availability in ('available', 'limited', 'sold_out', 'cancelled', 'unknown')),

  image_url            text check (image_url ~ '^https://'),
  what_to_expect       text,
  why_try              text,
  restrictions         text,
  challenge_novelty    smallint check (challenge_novelty between 0 and 2),
  challenge_social     smallint check (challenge_social between 0 and 2),
  challenge_physical   smallint check (challenge_physical between 0 and 2),
  challenge_commitment smallint check (challenge_commitment between 0 and 2),

  published            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint activities_verified_needs_check check (verification_status <> 'verified' or last_checked_at is not null),
  constraint activities_candidates_unpublished check (not (published and verification_status = 'candidate')),
  constraint activities_end_after_start check (end_at is null or start_at is null or end_at > start_at),
  constraint activities_duration_range check (duration_max_minutes is null or duration_max_minutes >= duration_min_minutes),
  constraint activities_price_range check (price_max is null or price_max >= price_min),
  constraint activities_event_has_start check (kind <> 'event' or start_at is not null or not published)
);

comment on table public.activities is 'Shared activity catalog. Public read access is limited to published, non-candidate rows by RLS.';

-- Deduplication: one row per listing per source platform.
create unique index activities_source_uidx on public.activities (source_platform, source_id) where source_id is not null;
create index activities_canonical_url_idx on public.activities (canonical_url) where canonical_url is not null;
create index activities_published_start_idx on public.activities (published, start_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

alter table public.activities enable row level security;

create policy "Published activities are readable by everyone"
  on public.activities
  for select
  to anon, authenticated
  using (published and verification_status <> 'candidate');

-- No insert/update/delete policies exist, so RLS already blocks writes from
-- the app. Revoking the privileges as well is defense in depth.
revoke insert, update, delete, truncate on public.activities from anon, authenticated;
grant select on public.activities to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Discovered candidates (e.g. Instagram posts) awaiting human review
-- ---------------------------------------------------------------------------
create table public.activity_candidates (
  id              text primary key,
  source_platform text not null,
  source_id       text,
  source_url      text,
  -- Normalized candidate as produced by the ingestion script.
  candidate       jsonb not null,
  -- Original payload, kept for auditing what the source actually said.
  raw             jsonb,
  -- Date/price-looking phrases from the caption, for the reviewer to verify.
  review_hints    text[] not null default '{}',
  review_status   text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewer_notes  text,
  discovered_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.activity_candidates is 'Unverified discoveries. Not readable by the app; promote reviewed rows into public.activities.';

create trigger activity_candidates_set_updated_at
  before update on public.activity_candidates
  for each row execute function public.set_updated_at();

-- RLS on with no policies: only the service role (which bypasses RLS) can access.
alter table public.activity_candidates enable row level security;
revoke all on public.activity_candidates from anon, authenticated;
