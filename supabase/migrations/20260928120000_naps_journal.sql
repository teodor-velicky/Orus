-- Orus — naps and the behaviour journal.

-- Naps: logged by hand, or detected from the ring (a daytime stretch at
-- sleeping heart rate with no steps). A detected nap you say wasn't one is
-- kept as dismissed, so detection doesn't add it back.
create table public.naps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  source text not null check (source in ('manual', 'ring')),
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create index naps_user_time on public.naps (user_id, start_at desc);

-- One row per day: what you did that day, which shapes the night after it.
-- behaviors: { "alcohol": true, "late_caffeine": false, ... } — keys in lib/journal.ts
create table public.journal_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  behaviors jsonb not null default '{}'::jsonb,
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

do $$
declare t text;
begin
  foreach t in array array['naps', 'journal_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read self and circle" on public.%I for select using (public.can_view(user_id))', t);
    execute format('create policy "insert own" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "update own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "delete own" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
