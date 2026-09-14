-- 0007: Row Level Security — organization and branch isolation.
-- Source: docs/DATABASE.md §39–40, §57, §66; docs/SECURITY_PRIVACY.md §11.
--
-- RLS is the second boundary; application authorization is the first
-- (SECURITY.md). Policies use auth.uid() and the 0006 helpers; no policy
-- queries a table it protects (recursion safeguard).
--
-- FORCE ROW LEVEL SECURITY is intentionally NOT used. The 0006 helpers are
-- SECURITY DEFINER functions owned by the migration role (postgres on hosted
-- Supabase) and read memberships/membership_branches; with FORCE, the
-- function bodies would themselves be subject to RLS whose policies call the
-- same helpers (recursion). Without FORCE, table owners are exempt while
-- anon/authenticated/service_role remain fully governed. Table owners do not
-- service user requests: all domain writes run the application authorization
-- layer first and connect with the privileged server credentials.

-- =====================================================================
-- organizations
-- =====================================================================
alter table public.organizations enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy organizations_select on public.organizations
  for select using (
    public.has_organization_access(auth.uid(), id)
  );

-- =====================================================================
-- profiles: a user manages their own profile
-- =====================================================================
alter table public.profiles enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- =====================================================================
-- memberships: visible to fellow members of the same organization
-- =====================================================================
alter table public.memberships enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy memberships_select on public.memberships
  for select using (
    public.has_organization_access(auth.uid(), organization_id)
  );

-- =====================================================================
-- membership_branches: visible to members of the same organization
-- =====================================================================
alter table public.membership_branches enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy membership_branches_select on public.membership_branches
  for select using (
    public.has_organization_access(
      auth.uid(),
      (select b.organization_id from public.branches b where b.id = membership_branches.branch_id)
    )
  );

-- =====================================================================
-- branches: HQ roles see their organization's branches organization-wide;
-- branch-scoped roles only see branches with a membership_branches row
-- (BRANCH_SYSTEM §12; spec "Dashboard context availability"). Mutation
-- happens through the privileged server client after application
-- authorization (design §8).
-- =====================================================================
alter table public.branches enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy branches_select on public.branches
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), id)
  );

-- =====================================================================
-- branch_websites + website_*: follow the parent branch's organization
-- =====================================================================
alter table public.branch_websites enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy branch_websites_select on public.branch_websites
  for select using (
    exists (
      select 1 from public.branches b
      where b.id = branch_websites.branch_id
        and public.has_organization_access(auth.uid(), b.organization_id)
    )
  );

alter table public.website_locales enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy website_locales_select on public.website_locales
  for select using (
    exists (
      select 1
      from public.branch_websites w
      join public.branches b on b.id = w.branch_id
      where w.id = website_locales.website_id
        and public.has_organization_access(auth.uid(), b.organization_id)
    )
  );

alter table public.website_pages enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy website_pages_select on public.website_pages
  for select using (
    exists (
      select 1
      from public.branch_websites w
      join public.branches b on b.id = w.branch_id
      where w.id = website_pages.website_id
        and public.has_organization_access(auth.uid(), b.organization_id)
    )
  );

alter table public.website_page_translations enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy website_page_translations_select on public.website_page_translations
  for select using (
    exists (
      select 1
      from public.website_pages p
      join public.branch_websites w on w.id = p.website_id
      join public.branches b on b.id = w.branch_id
      where p.id = website_page_translations.page_id
        and public.has_organization_access(auth.uid(), b.organization_id)
    )
  );

alter table public.website_sections enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy website_sections_select on public.website_sections
  for select using (
    exists (
      select 1
      from public.website_pages p
      join public.branch_websites w on w.id = p.website_id
      join public.branches b on b.id = w.branch_id
      where p.id = website_sections.page_id
        and public.has_organization_access(auth.uid(), b.organization_id)
    )
  );

-- =====================================================================
-- audit_logs: append-only, read scoped by organization membership.
-- Application users have no insert/update/delete grants — only the
-- privileged server client writes audit records; reads go through the
-- scoped select policy (AUDIT_SYSTEM §26).
-- =====================================================================
alter table public.audit_logs enable row level security;
-- (FORCE intentionally omitted: SECURITY DEFINER helpers owned by postgres read
-- memberships/membership_branches; FORCE would subject the definer body to
-- RLS and recurse. anon/authenticated/service_role remain fully governed.)

create policy audit_logs_select on public.audit_logs
  for select using (
    public.has_organization_access(auth.uid(), organization_id)
  );

-- =====================================================================
-- Default privileges: the app roles must not be able to bypass RLS on
-- writes for these tables; all mutations flow through the privileged
-- server client (server-only) after application-level authorization.
-- =====================================================================
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
