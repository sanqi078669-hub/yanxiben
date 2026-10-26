begin;

-- Keep the final consistency check stable while Auth writes are paused.
lock table auth.users in share row exclusive mode;
lock table app_private.registration_capacity in share row exclusive mode;

-- AFTER DELETE trigger release_seven_user_capacity already exists in
-- 202610260001_seven_user_auth.sql: skip creating another release trigger.

create or replace function public.registration_open()
returns table (
  open boolean,
  remaining int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (used < 7) as open,
    greatest(7 - used, 0)::int as remaining
  from app_private.registration_capacity
  where singleton = true;
$$;

revoke all on function public.registration_open() from public, anon, authenticated;
grant execute on function public.registration_open() to anon, authenticated;

do $$
declare
  capacity_used integer;
  auth_user_count bigint;
begin
  select used into capacity_used
  from app_private.registration_capacity
  where singleton = true;

  select count(*) into auth_user_count
  from auth.users;

  if capacity_used is distinct from auth_user_count then
    raise exception
      'Registration capacity mismatch: registration_capacity.used=%, auth.users count=%. Manually correct the capacity row before rerunning this migration.',
      coalesce(capacity_used::text, 'NULL (missing singleton row)'),
      auth_user_count;
  end if;
end;
$$;

commit;
