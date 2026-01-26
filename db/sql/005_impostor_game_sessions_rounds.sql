-- =========================================
-- 005_impostor_game_sessions_rounds.sql
-- Impostor Game v0.2
-- Sessions (group), editable roster, multiple rounds, reveal tracking
-- =========================================

-- ---------- ENUM-LIKE CHECKS (simple text) ----------
-- statuses: session (optional), round: draft | running | ended
-- roles: impostor | crew

-- ---------- 1) GAME SESSIONS ----------
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Impostor Game',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_game_sessions_owner_id on public.game_sessions(owner_id);

create trigger trg_game_sessions_updated_at
before update on public.game_sessions
for each row
execute function public.set_updated_at();

alter table public.game_sessions enable row level security;

create policy "game_sessions_select_own"
on public.game_sessions
for select
using (auth.uid() = owner_id);

create policy "game_sessions_insert_own"
on public.game_sessions
for insert
with check (auth.uid() = owner_id);

create policy "game_sessions_update_own"
on public.game_sessions
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "game_sessions_delete_own"
on public.game_sessions
for delete
using (auth.uid() = owner_id);

-- ---------- 2) SESSION PLAYERS (roster reusable) ----------
create table if not exists public.game_session_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_gsp_session_id on public.game_session_players(session_id);
create index if not exists idx_gsp_owner_id on public.game_session_players(owner_id);
create index if not exists idx_gsp_active on public.game_session_players(is_active);

alter table public.game_session_players enable row level security;

create policy "gsp_select_own"
on public.game_session_players
for select
using (auth.uid() = owner_id);

create policy "gsp_insert_own"
on public.game_session_players
for insert
with check (auth.uid() = owner_id);

create policy "gsp_update_own"
on public.game_session_players
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "gsp_delete_own"
on public.game_session_players
for delete
using (auth.uid() = owner_id);

-- ---------- 3) ROUNDS ----------
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,

  round_number int not null,
  status text not null default 'draft', -- draft | running | ended

  pack_id uuid references public.packs(id) on delete restrict,
  impostor_count int not null default 1,
  chosen_item_id uuid references public.pack_items(id) on delete set null,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz
);

create unique index if not exists uniq_round_per_session
on public.game_rounds(session_id, round_number);

create index if not exists idx_rounds_session_id on public.game_rounds(session_id);
create index if not exists idx_rounds_owner_id on public.game_rounds(owner_id);
create index if not exists idx_rounds_status on public.game_rounds(status);

create trigger trg_game_rounds_updated_at
before update on public.game_rounds
for each row
execute function public.set_updated_at();

alter table public.game_rounds enable row level security;

create policy "rounds_select_own"
on public.game_rounds
for select
using (auth.uid() = owner_id);

create policy "rounds_insert_own"
on public.game_rounds
for insert
with check (auth.uid() = owner_id);

create policy "rounds_update_own"
on public.game_rounds
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "rounds_delete_own"
on public.game_rounds
for delete
using (auth.uid() = owner_id);

-- ---------- 4) ROUND ASSIGNMENTS ----------
create table if not exists public.game_round_assignments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_player_id uuid not null references public.game_session_players(id) on delete cascade,

  role text not null, -- impostor | crew
  revealed_at timestamptz,

  created_at timestamptz not null default now()
);

create unique index if not exists uniq_assignment_per_round_player
on public.game_round_assignments(round_id, session_player_id);

create index if not exists idx_assign_round_id on public.game_round_assignments(round_id);
create index if not exists idx_assign_owner_id on public.game_round_assignments(owner_id);

alter table public.game_round_assignments enable row level security;

create policy "assign_select_own"
on public.game_round_assignments
for select
using (auth.uid() = owner_id);

create policy "assign_insert_own"
on public.game_round_assignments
for insert
with check (auth.uid() = owner_id);

create policy "assign_update_own"
on public.game_round_assignments
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "assign_delete_own"
on public.game_round_assignments
for delete
using (auth.uid() = owner_id);

-- ---------- 5) SAFETY TRIGGERS (optional but recommended) ----------
-- Prevent editing roster while there is a running round in the session.
create or replace function public.prevent_roster_edit_when_round_running()
returns trigger
language plpgsql
as $$
declare
  v_running boolean;
begin
  select exists(
    select 1
    from public.game_rounds r
    where r.session_id = coalesce(new.session_id, old.session_id)
      and r.status = 'running'
  ) into v_running;

  if v_running then
    raise exception 'Roster cannot be modified while a round is running';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_gsp_no_edit_when_running on public.game_session_players;

create trigger trg_gsp_no_edit_when_running
before insert or update or delete on public.game_session_players
for each row
execute function public.prevent_roster_edit_when_round_running();
