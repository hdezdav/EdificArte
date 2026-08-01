import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../supabase/migrations/', import.meta.url);
const names = readdirSync(directory).filter((name) =>
  name.endsWith('_geo_catalog_foundation.sql')
);
const sql =
  names.length === 1
    ? readFileSync(new URL(names[0], directory), 'utf8').toLowerCase()
    : '';

const tables = [
  'precincts',
  'places',
  'precinct_places',
  'tours',
  'tour_stops',
  'precinct_translations',
  'place_translations',
  'tour_translations',
];

describe('managed geo catalog migration', () => {
  it('is a CLI-created imperative migration with unpinned PostGIS', () => {
    expect(names).toEqual(['20260723160803_geo_catalog_foundation.sql']);
    const preflightEnd = sql.indexOf('create table public.precincts');
    const preflight = sql.slice(0, preflightEnd);
    expect(preflightEnd).toBeGreaterThan(0);
    expect(preflight).toContain('create schema if not exists extensions');
    expect(preflight).toContain(
      'create extension postgis with schema extensions'
    );
    expect(preflight).toContain(
      'alter extension postgis set schema extensions'
    );
    expect(preflight).toContain('e.extrelocatable');
    expect(preflight).toContain("using errcode = '55000'");
    expect(preflight).toContain('reinstall it in schema "extensions"');
    expect(sql).not.toMatch(/postgis[^;]*version/);
  });

  it('creates typed geo entities and normalized translations', () => {
    for (const table of tables) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(
        `alter table public.${table} enable row level security`
      );
    }
    expect(sql).toContain('extensions.geometry(multipolygon, 4326)');
    expect(sql).toContain('extensions.geography(point, 4326)');
    expect(sql).toContain('longitude between -180 and 180');
    expect(sql).toContain('latitude between -90 and 90');
    expect(sql).toContain('extensions.st_isvalid(boundary)');
    expect(sql).toContain(
      'extensions.st_xmax(extensions.box3d(boundary)) <= 180'
    );
    expect(sql).toContain(
      'extensions.st_ymax(extensions.box3d(boundary)) <= 90'
    );
  });

  it('enforces stable mappings, publication state, locale, and stop order', () => {
    expect(sql.match(/unique \(legacy_source, legacy_key\)/g)).toHaveLength(3);
    expect(sql).toContain('catalog legacy mapping is immutable');
    expect(sql).toContain("('draft', 'review', 'published', 'archived')");
    expect(sql).toContain("locale ~ '^[a-z]{2}(-[a-z]{2})?$'");
    expect(sql).toContain('unique (tour_id, position)');
    expect(sql).toContain('unique (tour_id, place_id)');
  });

  it('indexes spatial data, foreign keys, and published lookups', () => {
    for (const index of [
      'precincts_boundary_gist_idx',
      'places_location_gist_idx',
      'precinct_places_place_id_idx',
      'tour_stops_place_id_idx',
      'precincts_published_idx',
      'places_published_idx',
      'tours_published_idx',
    ]) {
      expect(sql).toContain(`create index ${index}`);
    }
  });

  it('keeps public reads closed and gates editor writes by U3 permissions', () => {
    expect(sql).not.toMatch(/create policy .* for select to anon/);
    expect(sql).not.toMatch(/grant select[^;]* to anon/);
    expect(sql).toContain("public.has_permission('places.manage')");
    expect(sql).toContain("public.has_permission('tours.manage')");
    expect(sql).toContain('public.tour_translations to authenticated');
    expect(sql).toContain('public.tour_translations to service_role');
    expect(sql).not.toMatch(/grant all[^;]*(precincts|places|tours)/);
  });

  it('does not add imports, media, application cutover, or mutation RPCs', () => {
    expect(sql).not.toMatch(/insert into public\.(precincts|places|tours)/);
    expect(sql).not.toContain('media_assets');
    expect(sql).not.toContain('security definer');
    expect(sql).not.toContain('write_audit_event');
  });
});
