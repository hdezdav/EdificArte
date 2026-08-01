begin;
select plan(36);

select public.ok(
  exists (select 1 from pg_extension where extname = 'postgis'),
  'PostGIS is installed'
);
select public.ok(
  (select extnamespace = 'extensions'::regnamespace from pg_extension where extname = 'postgis'),
  'PostGIS uses the Supabase extensions schema'
);
select public.ok(
  to_regtype('extensions.geometry') is not null
    and to_regtype('extensions.geography') is not null
    and to_regprocedure('extensions.st_makepoint(double precision,double precision)') is not null,
  'PostGIS types and functions resolve deterministically in extensions'
);

select has_table('public', 'precincts');
select has_table('public', 'places');
select has_table('public', 'precinct_places');
select has_table('public', 'tours');
select has_table('public', 'tour_stops');
select has_table('public', 'precinct_translations');
select has_table('public', 'place_translations');
select has_table('public', 'tour_translations');

select public.ok(
  (select bool_and(relrowsecurity) from pg_class where oid = any(array[
    'public.precincts'::regclass, 'public.places'::regclass,
    'public.precinct_places'::regclass, 'public.tours'::regclass,
    'public.tour_stops'::regclass, 'public.precinct_translations'::regclass,
    'public.place_translations'::regclass, 'public.tour_translations'::regclass
  ])), 'RLS is enabled on every catalog table'
);

select public.ok(
  (select format_type(a.atttypid, a.atttypmod) = 'extensions.geometry(MultiPolygon,4326)'
   from pg_attribute a where a.attrelid = 'public.precincts'::regclass and a.attname = 'boundary'),
  'precinct boundary is a WGS84 MultiPolygon'
);
select public.ok(
  (select format_type(a.atttypid, a.atttypmod) = 'extensions.geography(Point,4326)'
   from pg_attribute a where a.attrelid = 'public.places'::regclass and a.attname = 'location'),
  'place location is a WGS84 geography Point'
);

select throws_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('legacy', 'bad-lon', 181, 0)$$,
  '23514', null, 'out-of-range longitude is rejected'
);
select throws_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('legacy', 'reversed', 43, -120)$$,
  '23514', null, 'reversed longitude/latitude input is rejected'
);
select throws_ok(
  $$insert into public.precincts(legacy_source, legacy_key, boundary)
    values ('legacy', 'invalid', extensions.st_geomfromtext(
      'MULTIPOLYGON(((0 0,1 1,1 0,0 1,0 0)))', 4326))$$,
  '23514', null, 'invalid polygon topology is rejected'
);
select throws_ok(
  $$insert into public.precincts(legacy_source, legacy_key, boundary)
    values ('legacy', 'out-of-range', extensions.st_geomfromtext(
      'MULTIPOLYGON(((181 0,182 0,182 1,181 1,181 0)))', 4326))$$,
  '23514', null, 'out-of-range polygon coordinates are rejected'
);

insert into public.places(legacy_source, legacy_key, longitude, latitude)
values ('legacy', 'place-1', -58.3816, -34.6037);
select public.results_eq(
  $$select extensions.st_srid(location::extensions.geometry) from public.places where legacy_key = 'place-1'$$,
  array[4326], 'generated place location has SRID 4326'
);
select throws_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('legacy', 'place-1', 0, 0)$$,
  '23505', null, 'stable legacy mapping is unique'
);
select throws_ok(
  $$update public.places set legacy_key = 'changed' where legacy_key = 'place-1'$$,
  '23514', 'catalog legacy mapping is immutable', 'stable legacy mapping cannot change'
);

insert into public.tours(legacy_source, legacy_key) values ('legacy', 'tour-1');
insert into public.tour_stops(tour_id, place_id, position)
select t.id, p.id, 1 from public.tours t cross join public.places p
where t.legacy_key = 'tour-1' and p.legacy_key = 'place-1';
select throws_ok(
  $$insert into public.tour_stops(tour_id, place_id, position)
    select t.id, p.id, 1 from public.tours t cross join public.places p
    where t.legacy_key = 'tour-1' and p.legacy_key = 'place-1'$$,
  '23505', null, 'tour stop position is unique per tour'
);
select throws_ok(
  $$insert into public.tour_translations(tour_id, locale, title)
    select id, 'english', 'Tour' from public.tours where legacy_key = 'tour-1'$$,
  '23514', null, 'invalid translation locale is rejected'
);
select throws_ok(
  $$update public.tours set publication_state = 'published' where legacy_key = 'tour-1'$$,
  '23514', null, 'published state requires a publication timestamp'
);

select public.ok(
  not has_table_privilege('anon', 'public.places', 'select'),
  'anonymous catalog reads have no grant'
);
select public.ok(
  has_table_privilege('authenticated', 'public.places', 'insert'),
  'authenticated role has grant subject to RLS'
);
select public.ok(
  has_table_privilege('service_role', 'public.places', 'update'),
  'service role has maintenance CRUD'
);
select public.ok(
  not exists (select 1 from pg_policy where polrelid = 'public.places'::regclass and polroles @> array['anon'::regrole]::oid[]),
  'no anonymous place policy exists'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at, is_anonymous, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000098', 'authenticated', 'authenticated',
  'editor@example.test', now(), false, now(), now()
);
insert into public.user_roles(user_id, role_id)
select '00000000-0000-0000-0000-000000000098', id
from public.roles where key = 'content_editor';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
select throws_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('test', 'denied', 0, 0)$$,
  '42501', null, 'unassigned authenticated user cannot write'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000098', true);
select lives_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('test', 'permitted', 0, 0)$$,
  'content editor can manage places through RLS'
);
reset role;

set local role service_role;
select lives_ok(
  $$insert into public.places(legacy_source, legacy_key, longitude, latitude)
    values ('maintenance', 'service-role', 1, 1)$$,
  'service role can perform maintenance writes'
);
reset role;

select public.ok(
  (select count(*) = 2 from pg_indexes where schemaname = 'public'
   and indexname in ('precincts_boundary_gist_idx', 'places_location_gist_idx')),
  'both spatial GiST indexes exist'
);
select public.ok(
  (select count(*) = 2 from pg_indexes where schemaname = 'public'
   and indexname in ('precinct_places_place_id_idx', 'tour_stops_place_id_idx')),
  'non-leading foreign keys are indexed'
);
select public.ok(
  (select count(*) = 3 from pg_indexes where schemaname = 'public'
   and indexname in ('precincts_published_idx', 'places_published_idx', 'tours_published_idx')),
  'published-list indexes exist'
);
select public.is_empty(
  $$select 1 from public.precincts union all select 1 from public.tours where legacy_key <> 'tour-1'$$,
  'migration itself seeds no catalog content'
);
select public.results_eq(
  $$select count(*)::bigint from public.places where legacy_source = 'legacy'$$,
  array[1::bigint], 'test fixture confirms no migration seed rows'
);

select * from finish();
rollback;
