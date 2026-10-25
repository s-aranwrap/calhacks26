-- All-day events (a date with no clock time, or a multi-day run) and the
-- source of a place's opening hours. Both are optional.
alter table public.activities
  add column if not exists all_day boolean not null default false,
  add column if not exists opening_hours_source text check (char_length(opening_hours_source) <= 120);
