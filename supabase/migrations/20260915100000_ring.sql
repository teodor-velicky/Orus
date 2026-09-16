-- ═══════════════════════════════════════════════════════════════════
-- Orus — smart ring data (Colmi R09 via the in-app Bluetooth decoder).
--
-- Raw streams stay on the phone. The app uploads one row per minute and
-- one rollup row per day. Live vitals between partners go over a private
-- Realtime broadcast channel and are never stored.
-- ═══════════════════════════════════════════════════════════════════

create table public.ring_minutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null,
  hr_avg numeric,
  hr_min numeric,
  hr_max numeric,
  hrv_ms numeric,            -- RMSSD
  skin_temp_c numeric,
  spo2_pct numeric,
  motion_g numeric,          -- mean ENMO (gravity-removed acceleration)
  steps integer,
  primary key (user_id, minute)
);

create table public.ring_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  source text not null,
  resting_hr numeric,        -- lowest 30-min rolling mean, sleep window preferred
  hr_avg numeric,
  hr_min numeric,
  hr_max numeric,
  hrv_rmssd_ms numeric,      -- nightly mean
  skin_temp_c numeric,       -- nightly mean
  spo2_pct numeric,          -- nightly mean
  steps integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

do $$
declare t text;
begin
  foreach t in array array['ring_minutes', 'ring_daily'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read self and circle" on public.%I for select using (public.can_view(user_id))', t);
    execute format('create policy "insert own" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "update own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "delete own" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ── Realtime: private broadcast topic "circle:<circle_id>" ───────

create policy "circle members receive vitals" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'circle:' || public.my_circle()::text
  );

create policy "circle members send vitals" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'circle:' || public.my_circle()::text
  );
