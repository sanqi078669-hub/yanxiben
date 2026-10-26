-- Run as postgres in a dedicated Supabase project, once, before enabling signup.
begin;

-- Stop Auth writes while taking the initial count and installing the triggers.
lock table auth.users in share row exclusive mode;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table app_private.registration_capacity (
  singleton boolean primary key default true check (singleton),
  used integer not null check (used between 0 and 7)
);
alter table app_private.registration_capacity enable row level security;
revoke all on app_private.registration_capacity from public, anon, authenticated;

-- Abort the entire migration if the project already has more than seven users.
insert into app_private.registration_capacity (singleton, used)
select true, count(*)::integer from auth.users;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- No client can insert, delete, or update administrator memberships.
create table app_private.administrators (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table app_private.administrators enable row level security;
revoke all on app_private.administrators from public, anon, authenticated;

create function app_private.is_administrator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.administrators
    where user_id = (select auth.uid())
  );
$$;
revoke all on function app_private.is_administrator() from public, anon, authenticated;
grant execute on function app_private.is_administrator() to authenticated;

revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_read_self_or_admin on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select app_private.is_administrator()));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create function app_private.register_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- An UPDATE on one shared row serializes competing transactions. PostgreSQL
  -- rechecks used < 7 after waiting; do not replace this with SELECT count(*).
  update app_private.registration_capacity
  set used = used + 1
  where singleton = true and used < 7;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'REGISTRATION_LIMIT_REACHED',
      detail = 'This site allows at most 7 accounts.';
  end if;

  insert into public.profiles (id, email, display_name, created_at)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100),
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;
revoke all on function app_private.register_auth_user() from public, anon, authenticated;

-- AFTER INSERT runs only for an actual new row (including ON CONFLICT cases).
-- Failure rolls back the Auth row, capacity claim, and profile together.
create trigger enforce_seven_user_capacity
after insert on auth.users
for each row execute function app_private.register_auth_user();

create function app_private.release_auth_user_capacity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update app_private.registration_capacity
  set used = used - 1 where singleton = true;
  return old;
end;
$$;
revoke all on function app_private.release_auth_user_capacity() from public, anon, authenticated;

create trigger release_seven_user_capacity
after delete on auth.users
for each row execute function app_private.release_auth_user_capacity();

create function app_private.sync_auth_user_email()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
revoke all on function app_private.sync_auth_user_email() from public, anon, authenticated;

create trigger sync_profile_email
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function app_private.sync_auth_user_email();

insert into public.profiles (id, email, display_name, created_at)
select id, email,
  left(coalesce(raw_user_meta_data ->> 'display_name', ''), 100),
  coalesce(created_at, now())
from auth.users;

commit;
