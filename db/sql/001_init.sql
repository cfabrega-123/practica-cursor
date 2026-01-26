-- =========================================
-- 001_init.sql
-- Base schema + utility functions
-- =========================================

-- Asegurar extensiones comunes
create extension if not exists "uuid-ossp";

-- =========================================
-- Utility function: set_updated_at
-- =========================================
-- Actualiza automáticamente el campo updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================
-- Table: profiles
-- =========================================
-- Perfil de usuario asociado a auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Trigger para updated_at
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- =========================================
-- Row Level Security (RLS)
-- =========================================
alter table public.profiles enable row level security;

-- Policy: el usuario solo puede ver su propio perfil
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

-- Policy: el usuario puede insertar su propio perfil
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

-- Policy: el usuario puede actualizar su propio perfil
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id);
