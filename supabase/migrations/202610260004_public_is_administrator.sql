begin;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(app_private.is_administrator(), false);
$$;

revoke all on function public.is_administrator() from public, anon;
grant execute on function public.is_administrator() to authenticated;

comment on function public.is_administrator() is
  'Client-callable wrapper for app_private.is_administrator(); app_private schema stays unexposed to PostgREST.';

commit;
