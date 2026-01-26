-- =========================================
-- 002_core_tables.sql
-- Core tables (projects, tasks) + triggers + RLS
-- Ownership model: user owns their rows (auth.uid()).
-- =========================================

-- -----------------------------------------
-- Table: projects
-- -----------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);

create trigger trg_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

alter table public.projects enable row level security;

-- RLS policies for projects
create policy "projects_select_own"
on public.projects
for select
using (auth.uid() = owner_id);

create policy "projects_insert_own"
on public.projects
for insert
with check (auth.uid() = owner_id);

create policy "projects_update_own"
on public.projects
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "projects_delete_own"
on public.projects
for delete
using (auth.uid() = owner_id);

-- -----------------------------------------
-- Table: tasks
-- -----------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text,
  status text not null default 'todo',          -- todo | doing | done (simple)
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_tasks_owner_id on public.tasks(owner_id);
create index if not exists idx_tasks_status on public.tasks(status);

create trigger trg_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

alter table public.tasks enable row level security;

-- RLS policies for tasks (ownership)
create policy "tasks_select_own"
on public.tasks
for select
using (auth.uid() = owner_id);

create policy "tasks_insert_own"
on public.tasks
for insert
with check (auth.uid() = owner_id);

create policy "tasks_update_own"
on public.tasks
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "tasks_delete_own"
on public.tasks
for delete
using (auth.uid() = owner_id);

-- Optional safety: ensure task owner matches project owner
-- (prevents inserting a task into someone else's project)
create or replace function public.enforce_task_project_ownership()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner
  from public.projects
  where id = new.project_id;

  if v_owner is null then
    raise exception 'Invalid project_id';
  end if;

  if new.owner_id <> v_owner then
    raise exception 'Task owner_id must match project owner_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_enforce_owner on public.tasks;

create trigger trg_tasks_enforce_owner
before insert or update on public.tasks
for each row
execute function public.enforce_task_project_ownership();
