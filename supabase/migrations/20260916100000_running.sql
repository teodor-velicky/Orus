-- Orus — running: GPS + heart-rate runs, a race goal per person, HR zone settings.
--
-- A run comes from one of three places:
--   orus          recorded in the app (phone GPS + ring heart rate)
--   apple_health  a running workout from HealthKit (Garmin / Apple Watch / …)
--   strava        a Strava run with streams
-- The client dedupes overlapping runs from different sources.

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('orus', 'apple_health', 'strava')),
  external_id text not null,
  name text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- elapsed wall time vs. time actually moving (pauses excluded)
  duration_s integer not null check (duration_s >= 0),
  moving_s integer check (moving_s >= 0),
  distance_m numeric not null default 0 check (distance_m >= 0),
  elevation_gain_m numeric,
  avg_hr numeric,
  max_hr numeric,
  kcal integer,
  -- where the heart rate came from: ring | watch | strava | null
  hr_source text,
  -- simplified track: [[lat, lng, t_offset_s, alt|null, seg], …]
  route jsonb,
  -- downsampled heart rate: [[t_offset_s, bpm], …]
  hr jsonb,
  -- [{ km, distanceM, durationS, paceS, avgHr, elevDeltaM }, …]
  splits jsonb,
  -- fastest GPS efforts in seconds keyed by metres: { "1000": 241, "5000": 1290 }
  best_efforts jsonb,
  -- seconds per HR zone [z1..z5] and Banister TRIMP at write time
  zones jsonb,
  trimp numeric,
  kind text check (kind in ('recovery', 'easy', 'long', 'tempo', 'intervals', 'race')),
  perceived_effort smallint check (perceived_effort between 1 and 10),
  notes text,
  -- LLM run analysis (analyze-run edge function)
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index runs_user_time on public.runs (user_id, start_at desc);

create table public.run_goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  distance_m numeric not null check (distance_m between 400 and 100000),
  target_s integer not null check (target_s > 0),
  race_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['runs', 'run_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read self and circle" on public.%I for select using (public.can_view(user_id))', t);
    execute format('create policy "insert own" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "update own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "delete own" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- HR zone settings. null = estimated (208 − 0.7 × age, resting HR from data).
alter table public.profiles
  add column max_hr smallint check (max_hr between 120 and 230),
  add column resting_hr smallint check (resting_hr between 30 and 100);

-- Keep the column-level update grant in sync (circle_id stays RPC-only).
grant update (max_hr, resting_hr) on public.profiles to authenticated;
