-- 0004: Audit logs — append-only accountability records.
-- Source: docs/DATABASE.md §38.1, §43; docs/AUDIT_SYSTEM.md §5–9, §21–26.
--
-- MEDIUM-6 resolution (docs/DOCUMENTATION_AUDIT.md): the unbounded
-- old_data/new_data JSONB from DATABASE §38.1 is intentionally NOT created;
-- audit payloads are bounded structured metadata only (AUDIT_SYSTEM §24–25).
-- Secrets, tokens, and full payloads are prohibited (AUDIT_SYSTEM §21–23).

create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid references public.branches (id),
  actor_user_id   uuid references auth.users (id),
  actor_type      text not null default 'user'
                  check (actor_type in ('user', 'customer', 'system', 'automation',
                                        'webhook', 'api')),
  action          text not null,
  resource_type   text not null,
  resource_id     text,
  result          text not null default 'success'
                  check (result in ('success', 'failure')),
  metadata        jsonb not null default '{}'::jsonb,
  request_id      text,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now(),

  constraint ck_audit_action_format check (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

comment on table public.audit_logs is
  'Append-only audit trail; immutable for application roles (AUDIT_SYSTEM §26).';

create index idx_audit_logs_organization_id on public.audit_logs (organization_id);
create index idx_audit_logs_branch_id on public.audit_logs (branch_id);
create index idx_audit_logs_actor_user_id on public.audit_logs (actor_user_id);
create index idx_audit_logs_created_at on public.audit_logs (created_at);
create index idx_audit_logs_action on public.audit_logs (action);
