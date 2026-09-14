-- 0006: Authorization helper functions (DATABASE.md §57).
-- SECURITY DEFINER + search_path lockdown prevent privilege escalation.
-- STABLE SQL functions over memberships/membership_branches only — the
-- recursion safeguard is that these functions never query the tables they
-- guard (they read identity tables, which have their own non-recursive
-- policies).

create or replace function public.has_organization_access(
  p_user_id uuid,
  p_organization_id uuid
) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user_id
      and m.organization_id = p_organization_id
      and m.status = 'active'
  );
$$;

create or replace function public.has_branch_access(
  p_user_id uuid,
  p_branch_id uuid
) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.membership_branches mb
    join public.memberships m on m.id = mb.membership_id
    where m.user_id = p_user_id
      and m.status = 'active'
      and mb.branch_id = p_branch_id
  );
$$;

create or replace function public.get_membership_role(
  p_user_id uuid,
  p_organization_id uuid
) returns text
language sql
security definer
set search_path = public
stable
as $$
  select m.role
  from public.memberships m
  where m.user_id = p_user_id
    and m.organization_id = p_organization_id
    and m.status = 'active'
  limit 1;
$$;
