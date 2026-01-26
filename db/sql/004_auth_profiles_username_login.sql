-- =========================================
-- 004_auth_profiles_username_login.sql
-- - Ensure profiles has email/username
-- - Create profile row on auth.users insert
-- - Provide RPC to resolve username -> email for login
-- =========================================

-- Keep profiles aligned with auth.users
alter table if exists public.profiles
add column if not exists email text;

alter table if exists public.profiles
add column if not exists username text;

-- Create/refresh profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, username)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'username'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(profiles.full_name, excluded.full_name),
    username = coalesce(profiles.username, excluded.username);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- RPC: resolve username/email to email for signInWithPassword
create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_trimmed text;
begin
  v_trimmed := lower(btrim(coalesce(p_identifier, '')));
  if v_trimmed = '' then
    return null;
  end if;

  -- If already email, just return it.
  if position('@' in v_trimmed) > 0 then
    return v_trimmed;
  end if;

  -- Lookup email by username (case-insensitive)
  select u.email
    into v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = v_trimmed
  limit 1;

  return lower(v_email);
end;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;
