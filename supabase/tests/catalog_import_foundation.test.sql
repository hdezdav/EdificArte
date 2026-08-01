begin;
select plan(22);

select has_schema('catalog_import');
select has_table('catalog_import', 'import_runs');
select has_table('catalog_import', 'staged_rows');
select has_table('catalog_import', 'stable_id_maps');
select has_table('catalog_import', 'import_rejects');
select has_table('catalog_import', 'receipts');
select has_function('catalog_import', 'finalize_run', array['uuid', 'text', 'integer', 'integer', 'integer']);

select public.ok((select bool_and(relrowsecurity) from pg_class where oid = any(array[
  'catalog_import.import_runs'::regclass, 'catalog_import.staged_rows'::regclass,
  'catalog_import.stable_id_maps'::regclass, 'catalog_import.import_rejects'::regclass,
  'catalog_import.receipts'::regclass
])), 'RLS is enabled on every import table');
select public.ok(not has_schema_privilege('public', 'catalog_import', 'usage'), 'PUBLIC cannot use import schema');
select public.ok(not has_schema_privilege('anon', 'catalog_import', 'usage'), 'anon cannot use import schema');
select public.ok(not has_schema_privilege('authenticated', 'catalog_import', 'usage'), 'authenticated cannot use import schema');
select public.ok(has_schema_privilege('service_role', 'catalog_import', 'usage'), 'service role can use import schema');
select public.ok(not has_function_privilege('public', 'catalog_import.finalize_run(uuid,text,integer,integer,integer)', 'execute'), 'PUBLIC cannot finalize');

insert into catalog_import.import_runs(id, source_name, source_sha256, canonical_sha256, expected_rows)
values ('10000000-0000-0000-0000-000000000001', 'static', repeat('a', 64), repeat('b', 64), 2);
insert into catalog_import.staged_rows(run_id, ordinal, entity_type, legacy_key, canonical_row, row_sha256)
values ('10000000-0000-0000-0000-000000000001', 0, 'place', 'museum', '{"legacyKey":"museum"}', repeat('c', 64));
insert into catalog_import.import_rejects(run_id, ordinal, entity_type, legacy_key, code, row_sha256)
values ('10000000-0000-0000-0000-000000000001', 1, 'place', 'bad', 'INVALID_COORDINATES', repeat('d', 64));
insert into catalog_import.stable_id_maps(source_name, entity_type, legacy_key, catalog_id, target_table, first_run_id)
values ('static', 'place', 'museum', '20000000-0000-0000-0000-000000000001', 'places', '10000000-0000-0000-0000-000000000001');

set local role service_role;
select throws_ok($$update catalog_import.import_runs set source_sha256 = repeat('e', 64)$$, '42501', null, 'source identity has no update grant');
reset role;
select throws_ok($$insert into catalog_import.import_runs(source_name, source_sha256, canonical_sha256, expected_rows) values ('static', repeat('a',64), repeat('f',64), 0)$$, '23505', null, 'manifest source identity is unique');
select throws_ok($$insert into catalog_import.stable_id_maps(source_name, entity_type, legacy_key, catalog_id, target_table, first_run_id) values ('static','place','museum',gen_random_uuid(),'places','10000000-0000-0000-0000-000000000001')$$, '23505', null, 'stable mapping cannot be replaced');
select throws_ok($$select catalog_import.finalize_run('10000000-0000-0000-0000-000000000001', repeat('b',64), 2, 0, 1)$$, '23514', 'catalog import receipt evidence does not match durable rows', 'mismatched counts are rejected');
select lives_ok($$select catalog_import.finalize_run('10000000-0000-0000-0000-000000000001', repeat('b',64), 1, 1, 1)$$, 'matching receipt finalizes');
select lives_ok($$select catalog_import.finalize_run('10000000-0000-0000-0000-000000000001', repeat('b',64), 1, 1, 1)$$, 'identical finalization is idempotent');
select throws_ok($$select catalog_import.finalize_run('10000000-0000-0000-0000-000000000001', repeat('b',64), 1, 1, 0)$$, '23505', 'catalog import run already finalized with different evidence', 'first terminal receipt is preserved');
select results_eq($$select accepted_count, rejected_count, mapped_count from catalog_import.receipts$$, $$values (1,1,1)$$, 'receipt retains counts and rejects');
select public.ok((select count(*) >= 3 from pg_indexes where schemaname = 'catalog_import'), 'lookup and foreign-key indexes exist');

select * from finish();
rollback;
