-- 0005: Deferred foreign keys — link identity tables to branches, now that
-- the branches table exists (SQL requires the referenced table first).

alter table public.membership_branches
  add constraint fk_membership_branches_branch
  foreign key (branch_id) references public.branches (id) on delete cascade;

alter table public.audit_logs
  add constraint fk_audit_logs_branch
  foreign key (branch_id) references public.branches (id);
