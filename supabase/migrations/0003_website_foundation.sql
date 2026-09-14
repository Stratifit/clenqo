-- 0003: Branch website foundation — template instances, locales, pages,
-- translations, sections. All natural-key UNIQUE constraints per DATABASE.md
-- §13, §42 back provisioning idempotency (BRANCH_SYSTEM §17).

-- =====================================================================
-- branch_websites (DATABASE.md §13.1)
-- =====================================================================
create table public.branch_websites (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id) on delete cascade,
  template_key     text not null default 'clenqo-main',
  status           text not null default 'draft'
                   check (status in ('draft', 'published', 'archived')),
  default_locale   text not null,
  seo_title        text,
  seo_description  text,
  logo_path        text,
  favicon_path     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One active primary website per operational branch (DATABASE.md §13.1).
  constraint uq_branch_websites_branch unique (branch_id)
);

comment on table public.branch_websites is
  'Website configuration instance of the clenqo-main master template (CONTENT_SYSTEM §11).';

create index idx_branch_websites_branch_id on public.branch_websites (branch_id);

-- =====================================================================
-- website_locales (DATABASE.md §13.2) — enabled languages for a website
-- =====================================================================
create table public.website_locales (
  id         uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.branch_websites (id) on delete cascade,
  locale     text not null,
  is_default boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_website_locales_website_locale unique (website_id, locale)
);

-- Exactly one default locale per website (LOCALIZATION.md §6/§11).
create unique index uq_website_locales_single_default
  on public.website_locales (website_id)
  where is_default;

create index idx_website_locales_website_id on public.website_locales (website_id);

-- =====================================================================
-- website_pages (DATABASE.md §13.3) — one row per public route
-- =====================================================================
create table public.website_pages (
  id           uuid primary key default gen_random_uuid(),
  website_id   uuid not null references public.branch_websites (id) on delete cascade,
  slug         text not null,
  page_type    text not null
               check (page_type in ('home', 'services', 'service_detail', 'about',
                                    'contact', 'booking', 'faq', 'reviews', 'legal',
                                    'custom')),
  status       text not null default 'draft'
               check (status in ('draft', 'published', 'archived')),
  sort_order   integer not null default 0,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Slugs are unique within the website (CONTENT_SYSTEM §14, DATABASE.md §42).
  constraint uq_website_pages_website_slug unique (website_id, slug)
);

create index idx_website_pages_website_id on public.website_pages (website_id);

-- =====================================================================
-- website_page_translations (DATABASE.md §13.4) — page-level localized fields
-- =====================================================================
create table public.website_page_translations (
  id               uuid primary key default gen_random_uuid(),
  page_id          uuid not null references public.website_pages (id) on delete cascade,
  locale           text not null,
  title            text not null,
  meta_title       text,
  meta_description text,
  content          jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint uq_website_page_translations_page_locale unique (page_id, locale)
);

create index idx_website_page_translations_page_id on public.website_page_translations (page_id);

-- =====================================================================
-- website_sections (DATABASE.md §13.5) — ordered, typed page sections
-- =====================================================================
create table public.website_sections (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.website_pages (id) on delete cascade,
  section_type text not null,
  section_key  text not null,
  sort_order   integer not null default 0,
  is_enabled   boolean not null default true,
  content      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Section keys are unique within a page (DATABASE.md §42 per CONTENT_SYSTEM §19).
  constraint uq_website_sections_page_key unique (page_id, section_key)
);

create index idx_website_sections_page_id on public.website_sections (page_id);
