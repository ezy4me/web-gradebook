-- ============================================================================
-- web-gradebook — схема Supabase (этап 2)
-- ============================================================================
-- Принципы:
--   * каждая строка принадлежит пользователю (`user_id = auth.uid()`), RLS включён везде;
--   * удаление только мягкое (`deleted_at`), физических DELETE из приложения нет;
--   * имена snake_case соответствуют локальным camelCase-полям Dexie (см. docs/ARCHITECTURE.md);
--   * `updated_at` обновляется триггером, клиент присылает только `updated_at` из своей записи
--     при LWW-разрешении конфликтов.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Профили (1:1 с auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  yandex_id    text unique,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Предметы
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  scale_max       numeric(8, 2) not null default 100,
  pass_threshold  numeric(5, 2) not null default 60,
  scale_kind      text not null default 'points' check (scale_kind in ('points', 'pass-fail')),
  enabled_types   text[] not null default array['lecture', 'practice', 'lab'],
  type_weights    jsonb not null default '{"lecture":1,"practice":1,"lab":2}'::jsonb,
  archived_at     timestamptz,
  comment         text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ---------------------------------------------------------------------------
-- Группы и подгруппы
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.subgroups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  idx        integer not null check (idx > 0),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists subgroups_subject_group_idx_key
  on public.subgroups (subject_id, group_id, idx)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Студенты (глобальная сущность) и зачисления
-- ---------------------------------------------------------------------------
create table if not exists public.students (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  comment    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  subgroup_id uuid references public.subgroups (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists enrollments_subject_student_key
  on public.enrollments (subject_id, student_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Занятия и сессии
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  type        text not null check (type in ('lecture', 'practice', 'lab')),
  title       text not null,
  order_index integer not null default 0,
  max_score   numeric(8, 2) not null default 0,
  weight      numeric(6, 2),
  deadline    date,
  auto_rotate boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.activity_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  subgroup_id uuid references public.subgroups (id) on delete set null,
  date        date not null,
  deadline    date,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Требование «лабораторная сессия обязана иметь подгруппу» проверяется в приложении
-- (домен planSessions) и дублируется мягкой проверкой на клиенте; на сервере можно
-- добавить триггер, если появятся другие клиенты.

create index if not exists activity_sessions_activity_date_idx
  on public.activity_sessions (activity_id, date);
create index if not exists activity_sessions_subject_date_idx
  on public.activity_sessions (subject_id, date);

-- ---------------------------------------------------------------------------
-- Оценки и посещаемость (обе — на уровне сессии)
-- ---------------------------------------------------------------------------
create table if not exists public.grades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  session_id  uuid not null references public.activity_sessions (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  score       numeric(8, 2),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists grades_session_student_key
  on public.grades (session_id, student_id)
  where deleted_at is null;
create index if not exists grades_subject_student_idx
  on public.grades (subject_id, student_id);

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  session_id uuid not null references public.activity_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  present    boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists attendance_session_student_key
  on public.attendance (session_id, student_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Индексы под синхронизацию (выборка «что изменилось с прошлого pull»)
-- ---------------------------------------------------------------------------
create index if not exists subjects_user_updated_idx on public.subjects (user_id, updated_at);
create index if not exists groups_user_updated_idx on public.groups (user_id, updated_at);
create index if not exists subgroups_user_updated_idx on public.subgroups (user_id, updated_at);
create index if not exists students_user_updated_idx on public.students (user_id, updated_at);
create index if not exists enrollments_user_updated_idx on public.enrollments (user_id, updated_at);
create index if not exists activities_user_updated_idx on public.activities (user_id, updated_at);
create index if not exists activity_sessions_user_updated_idx on public.activity_sessions (user_id, updated_at);
create index if not exists grades_user_updated_idx on public.grades (user_id, updated_at);
create index if not exists attendance_user_updated_idx on public.attendance (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- updated_at триггер
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'subjects', 'groups', 'subgroups', 'students', 'enrollments',
    'activities', 'activity_sessions', 'grades', 'attendance'
  ]
  loop
    execute format(
      'drop trigger if exists %I_touch on public.%I;
       create trigger %I_touch before update on public.%I
       for each row execute function public.touch_updated_at();',
      t, t, t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Профиль создаётся автоматически при регистрации
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS: на каждой таблице пользователь видит и меняет только свои строки
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.groups enable row level security;
alter table public.subgroups enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.activities enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.grades enable row level security;
alter table public.attendance enable row level security;

-- profiles: ключ — id, а не user_id
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Остальные таблицы: одинаковый паттерн user_id = auth.uid().
do $$
declare
  t text;
begin
  foreach t in array array[
    'subjects', 'groups', 'subgroups', 'students', 'enrollments',
    'activities', 'activity_sessions', 'grades', 'attendance'
  ]
  loop
    execute format('drop policy if exists %I_select_own on public.%I;', t, t);
    execute format(
      'create policy %I_select_own on public.%I for select using (auth.uid() = user_id);', t, t
    );
    execute format('drop policy if exists %I_insert_own on public.%I;', t, t);
    execute format(
      'create policy %I_insert_own on public.%I for insert with check (auth.uid() = user_id);', t, t
    );
    execute format('drop policy if exists %I_update_own on public.%I;', t, t);
    execute format(
      'create policy %I_update_own on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t, t
    );
    execute format('drop policy if exists %I_delete_own on public.%I;', t, t);
    execute format(
      'create policy %I_delete_own on public.%I for delete using (auth.uid() = user_id);', t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Пример запроса из приложения (pull):
--   select * from activity_sessions
--    where user_id = auth.uid() and updated_at > :last_pulled_at
--    order by updated_at asc;
-- Push выполняется через upsert по id с проверкой updated_at (LWW на клиенте).
--
-- Пример RLS-проверки:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>"}';
--   select count(*) from grades;  -- только строки этого пользователя
-- ---------------------------------------------------------------------------
