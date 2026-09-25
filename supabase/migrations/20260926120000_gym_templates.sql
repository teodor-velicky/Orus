-- Orus — gym templates: a named list of exercises (push day, upper day, …)
-- that starts a session with its sets already laid out.

create table public.gym_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- [{ "exercise_id": uuid, "sets": 3 }, …] in the order they're performed
  items jsonb not null default '[]'::jsonb,
  -- so the list can show what you use most
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_templates_user on public.gym_templates (user_id, name);

alter table public.gym_templates enable row level security;
create policy "read self and circle" on public.gym_templates for select using (public.can_view(user_id));
create policy "insert own" on public.gym_templates for insert with check (auth.uid() = user_id);
create policy "update own" on public.gym_templates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own" on public.gym_templates for delete using (auth.uid() = user_id);
