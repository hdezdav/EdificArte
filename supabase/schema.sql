-- EdificARTE — Supabase / PostGIS schema scaffold
-- Migration target: Postgres 15+ with PostGIS 3.x (Supabase ships it by default).
--
-- Status: NOT yet applied. This file is a forward-looking scaffold for the
-- pivot off Cloudflare D1. Run via `supabase db push` or paste into the
-- Supabase SQL editor when ready.
--
-- Why Supabase: the user wants admin-panel-driven seed entries in the future,
-- PostGIS gives us proper geo queries (ST_DWithin for proximity, ST_Distance
-- for sorting), and Postgres jsonb holds the per-locale translations without
-- a second table.

-- Required extensions (Supabase has these enabled by default).
create extension if not exists "pgcrypto";     -- gen_random_uuid()
create extension if not exists "postgis";      -- geography/geometry types

-- ============================================================================
-- places: the worldwide catalog of landmarks, museums, temples, parks,
-- viewpoints, archaeological sites. Seeded initially from the legacy
-- CDMX data, then grown via the admin panel.
-- ============================================================================
create table if not exists public.places (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,                     -- default (fallback) name, usually English
  category        text not null,                     -- museum | temple | park | historic | viewpoint | remote
  country_code    char(2) not null,                   -- ISO 3166-1 alpha-2: MX, ES, FR, ...
  city            text not null,
  lat             double precision not null,
  lng             double precision not null,
  cover_image_url text,
  audio_url       text,                              -- /audio/<slug>.mp3 (R2) or external
  video_url       text,                              -- VR / 360 video link
  is_vr_available boolean not null default false,
  price_cents     integer,                           -- nullable when free
  currency        text default 'USD',
  emoji           text,                              -- single-glyph fallback for place cards
  -- Per-locale overrides: { es: { name, desc, category }, en: { name, desc, category }, ... }
  translations    jsonb not null default '{}'::jsonb,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint places_category_chk check (
    category in ('museum','temple','park','historic','viewpoint','remote')
  ),
  constraint places_currency_chk check (
    currency is null or length(currency) = 3
  )
);

create index if not exists places_city_country_idx
  on public.places (country_code, city);

create index if not exists places_category_idx
  on public.places (category)
  where is_published = true;

-- PostGIS geo index for ST_DWithin proximity queries.
create index if not exists places_geo_idx
  on public.places using gist (ll_to_earth(lat, lng));

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_places_updated_at on public.places;
create trigger trg_places_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();

-- ============================================================================
-- tours: bookable guided experiences. Linked to places via stop_order[].
-- ============================================================================
create table if not exists public.tours (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text not null,
  subtitle        text,
  description     text,
  city            text not null,
  country_code    char(2) not null,
  price_cents     integer not null,
  currency        text not null default 'USD',
  duration_min    integer,                           -- minutes
  meeting_point   text,
  cover_image_url text,
  guide_name      text,
  guide_title     text,
  guide_bio       text,
  stops           uuid[] not null default '{}',      -- ordered list of places.id
  highlights      text[] not null default '{}',
  translations    jsonb not null default '{}'::jsonb,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tours_country_city_idx
  on public.tours (country_code, city);

drop trigger if exists trg_tours_updated_at on public.tours;
create trigger trg_tours_updated_at
  before update on public.tours
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Helper view: places_with_geo for Mapbox / proximity endpoints.
-- ============================================================================
create or replace view public.places_with_geo as
  select p.*, ll_to_earth(p.lat, p.lng) as geo
  from public.places p
  where p.is_published = true;

-- ============================================================================
-- RLS: enable Row Level Security. Public reads on published rows only.
-- Writes go through service-role key from the admin panel (server-side).
-- ============================================================================
alter table public.places enable row level security;
alter table public.tours enable row level security;

drop policy if exists "places_public_read_published" on public.places;
create policy "places_public_read_published"
  on public.places
  for select
  using (is_published = true);

drop policy if exists "tours_public_read_published" on public.tours;
create policy "tours_public_read_published"
  on public.tours
  for select
  using (is_published = true);

-- Writes (insert/update/delete) intentionally have NO policy — they require
-- the service_role key (used by the admin panel Cloudflare Worker) which
-- bypasses RLS. Anon/authenticated users cannot mutate catalog data.

-- ============================================================================
-- Seed: legacy CDMX entries (initial import from src/data/monuments.ts).
-- Use INSERT ... ON CONFLICT DO NOTHING so re-runs are idempotent.
-- The full multi-city seed grows from this starting point via the admin UI.
-- ============================================================================
insert into public.places (slug, name, category, country_code, city, lat, lng, emoji, cover_image_url, audio_duration_seconds, translations) values
  ('bellas-artes', 'Palace of Fine Arts', 'museum', 'MX', 'Mexico City', 19.4352, -99.1412, '🏛️',
    'https://images.unsplash.com/photo-1604340923514-0a2b69fcc51f', 255,
    '{"es":{"name":"Palacio de Bellas Artes","desc":"Una de las casas de ópera más famosas del mundo, conocida por su arquitectura Art Nouveau exterior y Art Déco interior."}}'::jsonb),
  ('catedral', 'Metropolitan Cathedral', 'temple', 'MX', 'Mexico City', 19.4326, -99.1332, '⛪',
    'https://images.unsplash.com/photo-1610220260088-07fafc859f87', 330,
    '{"es":{"name":"Catedral Metropolitana","desc":"La catedral más antigua de América Latina, sede de la Arquidiócesis Primada de México."}}'::jsonb),
  ('templo-mayor', 'Templo Mayor', 'historic', 'MX', 'Mexico City', 19.4345, -99.1317, '🏺',
    null, 405,
    '{"es":{"name":"Templo Mayor","desc":"El centro neurálgico del imperio mexica, dedicado a Huitzilopochtli y Tláloc."}}'::jsonb),
  ('palacio-nacional', 'National Palace', 'museum', 'MX', 'Mexico City', 19.4320, -99.1312, '🏰',
    'https://images.unsplash.com/photo-1564975930846-3da8c44284a5', 230,
    '{"es":{"name":"Palacio Nacional","desc":"Sede del Poder Ejecutivo Federal de México, albergando increíbles murales de Diego Rivera."}}'::jsonb),
  ('torre-latino', 'Torre Latinoamericana', 'viewpoint', 'MX', 'Mexico City', 19.4338, -99.1404, '🗼',
    null, 250,
    '{"es":{"name":"Torre Latinoamericana","desc":"Rascacielos histórico de 44 pisos, famoso por resistir los terremotos más fuertes sin sufrir daños."}}'::jsonb),
  ('revolucion', 'Monument to the Revolution', 'historic', 'MX', 'Mexico City', 19.4362, -99.1546, '🏛️',
    null, 310,
    '{"es":{"name":"Monumento a la Revolución","desc":"Un mausoleo dedicado a la conmemoración de la Revolución Mexicana, con un mirador de 65 metros de altura."}}'::jsonb),
  ('angel', 'Angel of Independence', 'historic', 'MX', 'Mexico City', 19.4270, -99.1677, '🗽',
    null, 290,
    '{"es":{"name":"Ángel de la Independencia","desc":"Monumento triunfal erigido para conmemorar el centenario del inicio de la Guerra de Independencia de México."}}'::jsonb),
  ('chapultepec', 'Chapultepec Castle', 'museum', 'MX', 'Mexico City', 19.4204, -99.1818, '🏰',
    null, 435,
    '{"es":{"name":"Castillo de Chapultepec","desc":"El único castillo real de América, antigua residencia imperial y hoy sede del Museo Nacional de Historia."}}'::jsonb),
  ('piramides-sol', 'Pyramid of the Sun', 'remote', 'MX', 'Teotihuacán', 19.6925, -98.8438, '🔺',
    null, 480,
    '{"es":{"name":"Pirámides del Sol","desc":"La Pirámide del Sol es la estructura más grande de Teotihuacán, construida en el siglo I d.C."}}'::jsonb)
on conflict (slug) do nothing;