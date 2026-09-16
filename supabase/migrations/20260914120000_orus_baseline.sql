-- ═══════════════════════════════════════════════════════════════════
-- Orus — baseline schema for a fresh Supabase project.
-- Run via: supabase db push
--
-- Sharing model: users belong to at most one `circle` (you + partner).
-- Everything is readable by circle members (can_view) and writable only
-- by its owner. Tokens and rate-limit counters are service-role only.
-- ═══════════════════════════════════════════════════════════════════

-- ── circles ──────────────────────────────────────────────────────

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Us',
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.circles enable row level security;

-- ── profiles ─────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  sex text check (sex in ('male', 'female')),
  birth_year integer check (birth_year between 1900 and 2100),
  height_cm numeric check (height_cm between 100 and 250),
  weight_kg numeric check (weight_kg between 30 and 300),
  activity_level text not null default 'moderate'
    check (activity_level in ('low', 'moderate', 'high', 'athlete')),
  goal text not null default 'maintain' check (goal in ('lose', 'maintain', 'gain')),
  kcal_target integer,
  protein_target_g integer,
  sleep_target_min integer not null default 480,
  preferred_sleep_source text,
  circle_id uuid references public.circles (id) on delete set null,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, new.raw_user_meta_data ->> 'name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── sharing helpers ──────────────────────────────────────────────
-- SECURITY DEFINER so they can read profiles without recursing into RLS.

create or replace function public.my_circle()
returns uuid language sql stable security definer set search_path = public as $$
  select circle_id from public.profiles where id = auth.uid()
$$;

create or replace function public.can_view(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target = auth.uid() or exists (
    select 1 from public.profiles p
    where p.id = target and p.circle_id is not null and p.circle_id = public.my_circle()
  )
$$;

create policy "view self and circle" on public.profiles
  for select using (public.can_view(id));
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- circle_id may only change through the RPCs below (which require the invite
-- code), never via a direct profile update.
revoke update on public.profiles from anon, authenticated;
grant update (
  name, sex, birth_year, height_cm, weight_kg, activity_level, goal, kcal_target,
  protein_target_g, sleep_target_min, preferred_sleep_source, onboarded, updated_at
) on public.profiles to authenticated;

create policy "members see their circle" on public.circles
  for select using (id = public.my_circle());

-- Circles are created/joined via RPC so the caller's profile is linked atomically.
create or replace function public.create_circle(circle_name text default 'Us')
returns public.circles language plpgsql security definer set search_path = public as $$
declare c public.circles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.circles (name, created_by) values (coalesce(circle_name, 'Us'), auth.uid())
    returning * into c;
  update public.profiles set circle_id = c.id, updated_at = now() where id = auth.uid();
  return c;
end;
$$;

create or replace function public.join_circle(code text)
returns public.circles language plpgsql security definer set search_path = public as $$
declare c public.circles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from public.circles where invite_code = upper(trim(code));
  if c.id is null then raise exception 'invalid invite code'; end if;
  if (select count(*) from public.profiles where circle_id = c.id) >= 6 then
    raise exception 'circle is full';
  end if;
  update public.profiles set circle_id = c.id, updated_at = now() where id = auth.uid();
  return c;
end;
$$;

create or replace function public.leave_circle()
returns void language sql security definer set search_path = public as $$
  update public.profiles set circle_id = null, updated_at = now() where id = auth.uid()
$$;

-- ── meals ────────────────────────────────────────────────────────

create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null,
  score integer not null default 0,
  calories integer,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  micronutrients jsonb not null default '{}',
  analysis jsonb not null,
  photo_paths text[] not null default '{}',
  note text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index meal_logs_user_time on public.meal_logs (user_id, logged_at desc);

-- v2 payloads for the deterministic scoring engine
create table public.meal_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_log_id uuid references public.meal_logs (id) on delete cascade,
  logged_at timestamptz not null default now(),
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

create index meal_analyses_user_time on public.meal_analyses (user_id, logged_at desc);

create table public.system_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  system text not null check (system in
    ('gut_microbiome', 'digestion', 'metabolic', 'hormonal', 'cardiovascular')),
  score integer not null,
  confidence numeric not null default 0,
  drivers jsonb not null default '[]',
  meta jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, date, system)
);

create table public.symptom_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('bloating', 'low_energy', 'stomach_discomfort', 'low_mood')),
  severity integer not null check (severity between 1 and 3),
  logged_at timestamptz not null default now()
);

create index symptom_logs_user_time on public.symptom_logs (user_id, logged_at desc);

-- ── health data (Apple Health / ring / Strava) ───────────────────

create table public.daily_metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  steps integer,
  active_kcal integer,
  basal_kcal integer,
  exercise_min integer,
  distance_m integer,
  resting_hr numeric,
  hr_avg numeric,
  hr_min numeric,
  hr_max numeric,
  hrv_ms numeric,
  respiratory_rate numeric,
  spo2_pct numeric,
  vo2max numeric,
  weight_kg numeric,
  body_fat_pct numeric,
  sources text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table public.sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  night date not null,            -- local date the sleep ended (wake-up day)
  source text not null,           -- HealthKit source name ("Colmi", "Apple Watch", ...)
  start_at timestamptz not null,
  end_at timestamptz not null,
  in_bed_min integer not null default 0,
  asleep_min integer not null default 0,
  awake_min integer not null default 0,
  core_min integer not null default 0,
  deep_min integer not null default 0,
  rem_min integer not null default 0,
  stages jsonb not null default '[]',  -- [{ v: 'core'|'deep'|'rem'|'awake'|'asleep', s: minOffset, d: min }]
  updated_at timestamptz not null default now(),
  unique (user_id, night, source)
);

create index sleep_sessions_user_night on public.sleep_sessions (user_id, night desc);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('apple_health', 'strava')),
  external_id text not null,
  activity text not null,
  name text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_s integer not null,
  distance_m numeric,
  kcal integer,
  avg_hr numeric,
  max_hr numeric,
  elevation_m numeric,
  source_name text,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index workouts_user_time on public.workouts (user_id, start_at desc);

-- ── gym logging ──────────────────────────────────────────────────

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade, -- null = built-in
  name text not null,
  muscle_group text not null check (muscle_group in
    ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings',
     'glutes', 'calves', 'core', 'full_body', 'cardio')),
  equipment text not null default 'barbell' check (equipment in
    ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other')),
  created_at timestamptz not null default now()
);

create table public.gym_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Workout',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index gym_sessions_user_time on public.gym_sessions (user_id, started_at desc);

create table public.gym_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gym_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  exercise_order integer not null default 0,
  set_index integer not null default 0,
  weight_kg numeric not null default 0 check (weight_kg >= 0),
  reps integer not null default 0 check (reps >= 0),
  rpe numeric check (rpe between 1 and 10),
  is_warmup boolean not null default false,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index gym_sets_session on public.gym_sets (session_id, exercise_order, set_index);
create index gym_sets_user_exercise on public.gym_sets (user_id, exercise_id, created_at desc);

-- ── integrations & rate limiting (service role only) ─────────────

create table public.strava_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  athlete_id bigint,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.edge_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  fn text not null,
  date date not null,
  calls integer not null default 0,
  primary key (user_id, fn, date)
);

alter table public.strava_tokens enable row level security;
alter table public.edge_usage enable row level security;

-- ── RLS: read = self + circle, write = owner ─────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'meal_logs', 'meal_analyses', 'system_scores', 'symptom_logs',
    'daily_metrics', 'sleep_sessions', 'workouts', 'gym_sessions', 'gym_sets'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read self and circle" on public.%I for select using (public.can_view(user_id))', t);
    execute format('create policy "insert own" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "update own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "delete own" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

alter table public.exercises enable row level security;
create policy "read built-in and circle exercises" on public.exercises
  for select using (user_id is null or public.can_view(user_id));
create policy "insert own exercises" on public.exercises
  for insert with check (auth.uid() = user_id);
create policy "update own exercises" on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own exercises" on public.exercises
  for delete using (auth.uid() = user_id);

-- ── storage: private meal photos at meal-photos/<user_id>/<file> ─

insert into storage.buckets (id, name, public) values ('meal-photos', 'meal-photos', false)
  on conflict (id) do nothing;

create policy "meal photos: upload own" on storage.objects
  for insert with check (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "meal photos: read self and circle" on storage.objects
  for select using (
    bucket_id = 'meal-photos' and public.can_view(((storage.foldername(name))[1])::uuid)
  );
create policy "meal photos: delete own" on storage.objects
  for delete using (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── built-in exercise library ────────────────────────────────────

insert into public.exercises (name, muscle_group, equipment) values
  ('Bench Press', 'chest', 'barbell'),
  ('Incline Bench Press', 'chest', 'barbell'),
  ('Incline Dumbbell Press', 'chest', 'dumbbell'),
  ('Dumbbell Fly', 'chest', 'dumbbell'),
  ('Cable Crossover', 'chest', 'cable'),
  ('Chest Press Machine', 'chest', 'machine'),
  ('Push-up', 'chest', 'bodyweight'),
  ('Dip', 'triceps', 'bodyweight'),
  ('Deadlift', 'back', 'barbell'),
  ('Barbell Row', 'back', 'barbell'),
  ('Dumbbell Row', 'back', 'dumbbell'),
  ('Pull-up', 'back', 'bodyweight'),
  ('Chin-up', 'back', 'bodyweight'),
  ('Lat Pulldown', 'back', 'cable'),
  ('Seated Cable Row', 'back', 'cable'),
  ('T-Bar Row', 'back', 'machine'),
  ('Overhead Press', 'shoulders', 'barbell'),
  ('Dumbbell Shoulder Press', 'shoulders', 'dumbbell'),
  ('Lateral Raise', 'shoulders', 'dumbbell'),
  ('Rear Delt Fly', 'shoulders', 'dumbbell'),
  ('Face Pull', 'shoulders', 'cable'),
  ('Barbell Curl', 'biceps', 'barbell'),
  ('Dumbbell Curl', 'biceps', 'dumbbell'),
  ('Hammer Curl', 'biceps', 'dumbbell'),
  ('Cable Curl', 'biceps', 'cable'),
  ('Triceps Pushdown', 'triceps', 'cable'),
  ('Overhead Triceps Extension', 'triceps', 'cable'),
  ('Skull Crusher', 'triceps', 'barbell'),
  ('Back Squat', 'quads', 'barbell'),
  ('Front Squat', 'quads', 'barbell'),
  ('Leg Press', 'quads', 'machine'),
  ('Leg Extension', 'quads', 'machine'),
  ('Bulgarian Split Squat', 'quads', 'dumbbell'),
  ('Goblet Squat', 'quads', 'dumbbell'),
  ('Walking Lunge', 'quads', 'dumbbell'),
  ('Romanian Deadlift', 'hamstrings', 'barbell'),
  ('Lying Leg Curl', 'hamstrings', 'machine'),
  ('Seated Leg Curl', 'hamstrings', 'machine'),
  ('Hip Thrust', 'glutes', 'barbell'),
  ('Glute Bridge', 'glutes', 'bodyweight'),
  ('Cable Kickback', 'glutes', 'cable'),
  ('Hip Abduction', 'glutes', 'machine'),
  ('Standing Calf Raise', 'calves', 'machine'),
  ('Seated Calf Raise', 'calves', 'machine'),
  ('Plank', 'core', 'bodyweight'),
  ('Hanging Leg Raise', 'core', 'bodyweight'),
  ('Cable Crunch', 'core', 'cable'),
  ('Ab Wheel Rollout', 'core', 'other'),
  ('Kettlebell Swing', 'full_body', 'kettlebell'),
  ('Clean', 'full_body', 'barbell'),
  ('Rowing Machine', 'cardio', 'machine');
