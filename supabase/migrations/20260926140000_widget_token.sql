-- Orus — lock screen widget access.
--
-- The widget runs outside the app (Scriptable), so it can't hold a login. It
-- gets one long random token that reads a small snapshot of your own numbers
-- through the `widget` edge function, and nothing else. Delete the row to
-- revoke it.

create table public.widget_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.widget_tokens enable row level security;
-- Owner may read and revoke; only the RPC below creates one (service role reads it).
create policy "read own" on public.widget_tokens for select using (auth.uid() = user_id);
create policy "delete own" on public.widget_tokens for delete using (auth.uid() = user_id);

/** Create (or rotate) the caller's widget token and return it. */
create or replace function public.create_widget_token()
returns text language plpgsql security definer set search_path = public as $$
declare new_token text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- 64 hex characters from two v4 UUIDs (gen_random_uuid is core, no extension).
  new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.widget_tokens (user_id, token)
    values (auth.uid(), new_token)
    on conflict (user_id) do update set token = excluded.token, created_at = now(), last_used_at = null;
  return new_token;
end;
$$;

revoke all on function public.create_widget_token() from public;
grant execute on function public.create_widget_token() to authenticated;
