-- Managed geo catalog foundation. This additive migration performs no import or cutover.
-- GeoJSON and API callers must provide coordinates as [longitude, latitude].
-- Legacy keys are immutable source identifiers. After deployment, rollback is forward-fix only.

create schema if not exists extensions;

do $$
declare
  postgis_schema text;
  postgis_relocatable boolean;
begin
  select n.nspname, e.extrelocatable
    into postgis_schema, postgis_relocatable
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if not found then
    execute 'create extension postgis with schema extensions';
  elsif postgis_schema <> 'extensions' then
    if postgis_relocatable then
      execute 'alter extension postgis set schema extensions';
    else
      raise exception
        'PostGIS is installed in schema "%" and is not relocatable; reinstall it in schema "extensions" before applying this migration',
        postgis_schema
        using errcode = '55000';
    end if;
  end if;
end;
$$;

create table public.precincts (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null check (legacy_source ~ '^[a-z][a-z0-9_-]*$'),
  legacy_key text not null check (length(btrim(legacy_key)) between 1 and 255),
  boundary extensions.geometry(MultiPolygon, 4326) not null,
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_source, legacy_key),
  check (not extensions.st_isempty(boundary)),
  check (extensions.st_isvalid(boundary)),
  check (extensions.st_srid(boundary) = 4326),
  check (extensions.st_xmin(extensions.box3d(boundary)) >= -180),
  check (extensions.st_xmax(extensions.box3d(boundary)) <= 180),
  check (extensions.st_ymin(extensions.box3d(boundary)) >= -90),
  check (extensions.st_ymax(extensions.box3d(boundary)) <= 90),
  check ((publication_state = 'published') = (published_at is not null))
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null check (legacy_source ~ '^[a-z][a-z0-9_-]*$'),
  legacy_key text not null check (length(btrim(legacy_key)) between 1 and 255),
  longitude double precision not null check (longitude between -180 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  location extensions.geography(Point, 4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography) stored,
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_source, legacy_key),
  check ((publication_state = 'published') = (published_at is not null))
);

create table public.precinct_places (
  precinct_id uuid not null references public.precincts(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (precinct_id, place_id)
);

create table public.tours (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null check (legacy_source ~ '^[a-z][a-z0-9_-]*$'),
  legacy_key text not null check (length(btrim(legacy_key)) between 1 and 255),
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_source, legacy_key),
  check ((publication_state = 'published') = (published_at is not null))
);

create table public.tour_stops (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete restrict,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tour_id, position),
  unique (tour_id, place_id)
);

create table public.precinct_translations (
  precinct_id uuid not null references public.precincts(id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name text not null check (length(btrim(name)) between 1 and 160),
  description text check (description is null or length(btrim(description)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (precinct_id, locale)
);

create table public.place_translations (
  place_id uuid not null references public.places(id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name text not null check (length(btrim(name)) between 1 and 160),
  description text check (description is null or length(btrim(description)) between 1 and 10000),
  address text check (address is null or length(btrim(address)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, locale)
);

create table public.tour_translations (
  tour_id uuid not null references public.tours(id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  summary text check (summary is null or length(btrim(summary)) between 1 and 500),
  description text check (description is null or length(btrim(description)) between 1 and 10000),
  meeting_point text check (meeting_point is null or length(btrim(meeting_point)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tour_id, locale)
);

comment on column public.precincts.boundary is
  'Valid WGS84 MultiPolygon. Normalize Polygon input with ST_Multi; coordinate order is longitude, latitude.';
comment on column public.places.location is
  'Generated WGS84 geography point from validated longitude and latitude columns.';
comment on column public.places.legacy_key is
  'Immutable identifier within legacy_source; import execution is deferred to U4B.';
comment on table public.tours is
  'Draft-only foundation. Atomic publish validation/audit and public reads are deferred.';

create function private.reject_catalog_legacy_key_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.legacy_source is distinct from old.legacy_source
     or new.legacy_key is distinct from old.legacy_key then
    raise exception 'catalog legacy mapping is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger precincts_legacy_key_immutable before update on public.precincts
for each row execute function private.reject_catalog_legacy_key_change();
create trigger places_legacy_key_immutable before update on public.places
for each row execute function private.reject_catalog_legacy_key_change();
create trigger tours_legacy_key_immutable before update on public.tours
for each row execute function private.reject_catalog_legacy_key_change();

create trigger precincts_set_updated_at before update on public.precincts
for each row execute function private.set_updated_at();
create trigger places_set_updated_at before update on public.places
for each row execute function private.set_updated_at();
create trigger tours_set_updated_at before update on public.tours
for each row execute function private.set_updated_at();
create trigger tour_stops_set_updated_at before update on public.tour_stops
for each row execute function private.set_updated_at();
create trigger precinct_translations_set_updated_at before update on public.precinct_translations
for each row execute function private.set_updated_at();
create trigger place_translations_set_updated_at before update on public.place_translations
for each row execute function private.set_updated_at();
create trigger tour_translations_set_updated_at before update on public.tour_translations
for each row execute function private.set_updated_at();

create index precincts_boundary_gist_idx on public.precincts using gist (boundary);
create index places_location_gist_idx on public.places using gist (location);
create index precinct_places_place_id_idx on public.precinct_places(place_id);
create index tour_stops_place_id_idx on public.tour_stops(place_id);
create index precincts_published_idx on public.precincts(updated_at desc) where publication_state = 'published';
create index places_published_idx on public.places(updated_at desc) where publication_state = 'published';
create index tours_published_idx on public.tours(updated_at desc) where publication_state = 'published';

alter table public.precincts enable row level security;
alter table public.places enable row level security;
alter table public.precinct_places enable row level security;
alter table public.tours enable row level security;
alter table public.tour_stops enable row level security;
alter table public.precinct_translations enable row level security;
alter table public.place_translations enable row level security;
alter table public.tour_translations enable row level security;

create policy precincts_manage on public.precincts for all to authenticated
using ((select public.has_permission('places.manage')) and publication_state <> 'published')
with check ((select public.has_permission('places.manage')) and publication_state <> 'published');
create policy places_manage on public.places for all to authenticated
using ((select public.has_permission('places.manage')) and publication_state <> 'published')
with check ((select public.has_permission('places.manage')) and publication_state <> 'published');
create policy precinct_places_manage on public.precinct_places for all to authenticated
using ((select public.has_permission('places.manage')) and exists (
  select 1 from public.precincts p where p.id = precinct_id and p.publication_state <> 'published'
))
with check ((select public.has_permission('places.manage')) and exists (
  select 1 from public.precincts p where p.id = precinct_id and p.publication_state <> 'published'
));
create policy precinct_translations_manage on public.precinct_translations for all to authenticated
using ((select public.has_permission('places.manage')) and exists (
  select 1 from public.precincts p where p.id = precinct_id and p.publication_state <> 'published'
))
with check ((select public.has_permission('places.manage')) and exists (
  select 1 from public.precincts p where p.id = precinct_id and p.publication_state <> 'published'
));
create policy place_translations_manage on public.place_translations for all to authenticated
using ((select public.has_permission('places.manage')) and exists (
  select 1 from public.places p where p.id = place_id and p.publication_state <> 'published'
))
with check ((select public.has_permission('places.manage')) and exists (
  select 1 from public.places p where p.id = place_id and p.publication_state <> 'published'
));
create policy tours_manage on public.tours for all to authenticated
using ((select public.has_permission('tours.manage')) and publication_state <> 'published')
with check ((select public.has_permission('tours.manage')) and publication_state <> 'published');
create policy tour_stops_manage on public.tour_stops for all to authenticated
using ((select public.has_permission('tours.manage')) and exists (
  select 1 from public.tours t where t.id = tour_id and t.publication_state <> 'published'
))
with check ((select public.has_permission('tours.manage')) and exists (
  select 1 from public.tours t where t.id = tour_id and t.publication_state <> 'published'
));
create policy tour_translations_manage on public.tour_translations for all to authenticated
using ((select public.has_permission('tours.manage')) and exists (
  select 1 from public.tours t where t.id = tour_id and t.publication_state <> 'published'
))
with check ((select public.has_permission('tours.manage')) and exists (
  select 1 from public.tours t where t.id = tour_id and t.publication_state <> 'published'
));

revoke all on table public.precincts, public.places, public.precinct_places,
  public.tours, public.tour_stops, public.precinct_translations,
  public.place_translations, public.tour_translations from public, anon, authenticated;
revoke all on function private.reject_catalog_legacy_key_change()
  from public, anon, authenticated;
grant select, insert, update, delete on table public.precincts, public.places,
  public.precinct_places, public.tours, public.tour_stops,
  public.precinct_translations, public.place_translations,
  public.tour_translations to authenticated;
grant select, insert, update, delete, truncate on table public.precincts,
  public.places, public.precinct_places, public.tours, public.tour_stops,
  public.precinct_translations, public.place_translations,
  public.tour_translations to service_role;
grant execute on function private.reject_catalog_legacy_key_change() to service_role;

-- No anon/public read policy exists: required translations, published stops, and audit
-- must be enforced atomically by the deferred publish RPC before exposure is safe.
