-- =========================================
-- 006_game_sessions_make_title_optional_pack.sql
-- Fix for local dev:
-- - Some DBs were created with 003_impostor_game_v01.sql where `game_sessions.pack_id` is NOT NULL
-- - The current UI expects a simple session with `title`
-- This migration:
-- - Adds `title` if missing
-- - Makes `pack_id` nullable if it exists (so UI can create sessions without selecting a pack)
-- =========================================

-- 1) Ensure title exists
alter table if exists public.game_sessions
add column if not exists title text not null default 'Impostor Game';

-- 2) If pack_id exists, drop NOT NULL so UI can insert without pack selection
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_sessions'
      and column_name = 'pack_id'
  ) then
    execute 'alter table public.game_sessions alter column pack_id drop not null';
  end if;
end $$;

