-- =========================================
-- 003_impostor_game_v01.sql
-- Username + Packs/Items + Game Sessions (Impostor) + RLS
-- =========================================

-- ---------- 1) PROFILES: username ----------
alter table if exists public.profiles
add column if not exists username text;

-- username único (case-insensitive)
create unique index if not exists profiles_username_unique
on public.profiles (lower(username))
where username is not null;

-- Validación mínima (opcional pero recomendada)
alter table public.profiles
drop constraint if exists profiles_username_format;

alter table public.profiles
add constraint profiles_username_format
check (
  username is null
  or (char_length(username) between 3 and 20
      and username ~ '^[a-zA-Z0-9_]+$')
);

-- ---------- 2) PACKS ----------
create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade, -- null cuando es global (opcional)
  is_global boolean not null default false,
  name text not null,
  kind text not null, -- 'places' | 'cities' | 'countries' | 'characters' | etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_packs_owner_id on public.packs(owner_id);
create index if not exists idx_packs_is_global on public.packs(is_global);
create index if not exists idx_packs_kind on public.packs(kind);

create trigger trg_packs_updated_at
before update on public.packs
for each row
execute function public.set_updated_at();

alter table public.packs enable row level security;

-- Leer: global o propio
create policy "packs_select_global_or_own"
on public.packs
for select
using (is_global = true or owner_id = auth.uid());

-- Insert: solo propio (no global)
create policy "packs_insert_own_only"
on public.packs
for insert
with check (owner_id = auth.uid() and is_global = false);

-- Update/Delete: solo propio
create policy "packs_update_own"
on public.packs
for update
using (owner_id = auth.uid() and is_global = false)
with check (owner_id = auth.uid() and is_global = false);

create policy "packs_delete_own"
on public.packs
for delete
using (owner_id = auth.uid() and is_global = false);

-- ---------- 3) PACK ITEMS ----------
create table if not exists public.pack_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade, -- null si item global (opcional)
  is_global boolean not null default false,
  label text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_pack_items_pack_id on public.pack_items(pack_id);
create index if not exists idx_pack_items_is_global on public.pack_items(is_global);

create trigger trg_pack_items_updated_at
before update on public.pack_items
for each row
execute function public.set_updated_at();

alter table public.pack_items enable row level security;

-- Leer: si el pack es global o propio. (La forma más segura es validar contra packs)
create policy "pack_items_select_global_or_own_pack"
on public.pack_items
for select
using (
  exists (
    select 1 from public.packs p
    where p.id = pack_id
      and (p.is_global = true or p.owner_id = auth.uid())
  )
);

-- Insert: solo a packs propios y como item propio (no global)
create policy "pack_items_insert_own_pack"
on public.pack_items
for insert
with check (
  is_global = false
  and owner_id = auth.uid()
  and exists (
    select 1 from public.packs p
    where p.id = pack_id
      and p.owner_id = auth.uid()
      and p.is_global = false
  )
);

-- Update/Delete: solo items propios en packs propios
create policy "pack_items_update_own"
on public.pack_items
for update
using (owner_id = auth.uid() and is_global = false)
with check (owner_id = auth.uid() and is_global = false);

create policy "pack_items_delete_own"
on public.pack_items
for delete
using (owner_id = auth.uid() and is_global = false);

-- ---------- 4) GAME SESSIONS ----------
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft', -- draft | running | paused | ended
  pack_id uuid not null references public.packs(id) on delete restrict,
  impostor_count int not null default 1,
  chosen_item_id uuid references public.pack_items(id) on delete set null, -- item usado en la ronda
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_game_sessions_owner_id on public.game_sessions(owner_id);
create index if not exists idx_game_sessions_pack_id on public.game_sessions(pack_id);

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

-- ---------- 5) GAME PLAYERS ----------
create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_players_session_id on public.game_players(session_id);

alter table public.game_players enable row level security;

create policy "game_players_select_own"
on public.game_players
for select
using (auth.uid() = owner_id);

create policy "game_players_insert_own"
on public.game_players
for insert
with check (auth.uid() = owner_id);

create policy "game_players_update_own"
on public.game_players
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "game_players_delete_own"
on public.game_players
for delete
using (auth.uid() = owner_id);

-- ---------- 6) GAME ASSIGNMENTS ----------
create table if not exists public.game_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  role text not null, -- impostor | crew
  item_id uuid references public.pack_items(id) on delete set null, -- null si impostor
  created_at timestamptz not null default now()
);

create index if not exists idx_game_assignments_session_id on public.game_assignments(session_id);
create unique index if not exists uniq_assignment_player_once
on public.game_assignments(player_id);

alter table public.game_assignments enable row level security;

create policy "game_assignments_select_own"
on public.game_assignments
for select
using (auth.uid() = owner_id);

create policy "game_assignments_insert_own"
on public.game_assignments
for insert
with check (auth.uid() = owner_id);

create policy "game_assignments_update_own"
on public.game_assignments
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "game_assignments_delete_own"
on public.game_assignments
for delete
using (auth.uid() = owner_id);
