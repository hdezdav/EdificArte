-- Additive country-level catalog contract. No data import or cutover is performed here.
-- The legacy D1/SQLite compatibility path remains authoritative until records are migrated.

alter table if exists public.places add column if not exists country_code text;
alter table if exists public.tours add column if not exists country_code text;

do $$
begin
  if to_regclass('public.places') is not null then
    execute 'alter table public.places add constraint places_country_code_iso check (country_code is null or country_code ~ ''^[A-Z]{2}$'')';
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if to_regclass('public.tours') is not null then
    execute 'alter table public.tours add constraint tours_country_code_iso check (country_code is null or country_code ~ ''^[A-Z]{2}$'')';
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if to_regclass('public.places') is not null then
    execute 'create index if not exists places_published_country_idx on public.places(country_code, updated_at desc) where publication_state = ''published''';
  end if;
  if to_regclass('public.tours') is not null then
    execute 'create index if not exists tours_published_country_idx on public.tours(country_code, updated_at desc) where publication_state = ''published''';
  end if;
end $$;

-- Products are kept separate from the existing geo scaffold because the scaffold
-- does not define a product shape. This table is service-role managed until its
-- authenticated admin UI is intentionally cut over.
create table if not exists public.managed_products (
  id uuid primary key default gen_random_uuid(),
  legacy_key text not null unique,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'review', 'published', 'archived')),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text,
  updated_at timestamptz not null default now()
);
alter table public.managed_products enable row level security;
revoke all on public.managed_products from public, anon, authenticated;
grant select, insert, update, delete on public.managed_products to service_role;
create index if not exists managed_products_published_country_idx
  on public.managed_products(country_code, updated_at desc) where publication_state = 'published';
