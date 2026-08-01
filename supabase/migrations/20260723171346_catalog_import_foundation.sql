-- Durable control plane for deterministic catalog imports. This migration runs no import.
create schema if not exists catalog_import;

revoke all on schema catalog_import from public, anon, authenticated;
revoke all on all functions in schema catalog_import from public;
alter default privileges in schema catalog_import revoke execute on functions from public;
grant usage on schema catalog_import to service_role;

create table catalog_import.import_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null check (source_name ~ '^[a-z][a-z0-9_-]*$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  expected_rows integer not null check (expected_rows >= 0),
  created_at timestamptz not null default now(),
  unique (source_name, source_sha256),
  unique (id, canonical_sha256)
);

create table catalog_import.staged_rows (
  run_id uuid not null references catalog_import.import_runs(id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  entity_type text not null check (entity_type in ('precinct', 'place', 'tour')),
  legacy_key text not null check (length(btrim(legacy_key)) between 1 and 255),
  canonical_row jsonb not null check (jsonb_typeof(canonical_row) = 'object'),
  row_sha256 text not null check (row_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (run_id, ordinal),
  unique (run_id, entity_type, legacy_key),
  unique (run_id, row_sha256)
);

create table catalog_import.stable_id_maps (
  source_name text not null,
  entity_type text not null check (entity_type in ('precinct', 'place', 'tour')),
  legacy_key text not null,
  catalog_id uuid not null,
  target_table text not null check (target_table in ('precincts', 'places', 'tours')),
  first_run_id uuid not null references catalog_import.import_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_name, entity_type, legacy_key),
  unique (entity_type, catalog_id),
  check ((entity_type, target_table) in (
    ('precinct', 'precincts'), ('place', 'places'), ('tour', 'tours')
  ))
);

create table catalog_import.import_rejects (
  run_id uuid not null references catalog_import.import_runs(id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  entity_type text not null,
  legacy_key text,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  row_sha256 text not null check (row_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (run_id, ordinal)
);

create table catalog_import.receipts (
  run_id uuid primary key references catalog_import.import_runs(id) on delete restrict,
  canonical_sha256 text not null,
  accepted_count integer not null check (accepted_count >= 0),
  rejected_count integer not null check (rejected_count >= 0),
  mapped_count integer not null check (mapped_count >= 0),
  finalized_at timestamptz not null default now(),
  foreign key (run_id, canonical_sha256)
    references catalog_import.import_runs(id, canonical_sha256) on delete restrict
);

create index staged_rows_entity_idx
  on catalog_import.staged_rows(run_id, entity_type, legacy_key);
create index stable_id_maps_run_idx on catalog_import.stable_id_maps(first_run_id);
create index import_rejects_code_idx on catalog_import.import_rejects(run_id, code);

alter table catalog_import.import_runs enable row level security;
alter table catalog_import.staged_rows enable row level security;
alter table catalog_import.stable_id_maps enable row level security;
alter table catalog_import.import_rejects enable row level security;
alter table catalog_import.receipts enable row level security;

create function catalog_import.finalize_run(
  p_run_id uuid,
  p_canonical_sha256 text,
  p_accepted_count integer,
  p_rejected_count integer,
  p_mapped_count integer
) returns catalog_import.receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected catalog_import.import_runs%rowtype;
  existing catalog_import.receipts%rowtype;
  actual_accepted integer;
  actual_rejected integer;
  actual_mapped integer;
begin
  select * into expected from catalog_import.import_runs
    where id = p_run_id for update;
  if not found then
    raise exception 'unknown catalog import run' using errcode = 'P0002';
  end if;

  select * into existing from catalog_import.receipts where run_id = p_run_id;
  if found then
    if (existing.canonical_sha256, existing.accepted_count, existing.rejected_count,
        existing.mapped_count) is distinct from
       (p_canonical_sha256, p_accepted_count, p_rejected_count, p_mapped_count) then
      raise exception 'catalog import run already finalized with different evidence'
        using errcode = '23505';
    end if;
    return existing;
  end if;

  select count(*) into actual_accepted from catalog_import.staged_rows where run_id = p_run_id;
  select count(*) into actual_rejected from catalog_import.import_rejects where run_id = p_run_id;
  select count(*) into actual_mapped from catalog_import.stable_id_maps where first_run_id = p_run_id;
  if p_canonical_sha256 <> expected.canonical_sha256
     or p_accepted_count <> actual_accepted
     or p_rejected_count <> actual_rejected
     or p_mapped_count <> actual_mapped
     or expected.expected_rows <> actual_accepted + actual_rejected then
    raise exception 'catalog import receipt evidence does not match durable rows'
      using errcode = '23514';
  end if;

  insert into catalog_import.receipts(
    run_id, canonical_sha256, accepted_count, rejected_count, mapped_count
  ) values (
    p_run_id, p_canonical_sha256, p_accepted_count, p_rejected_count, p_mapped_count
  ) returning * into existing;
  return existing;
end;
$$;

revoke all on all tables in schema catalog_import from public, anon, authenticated;
revoke all on function catalog_import.finalize_run(uuid, text, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant select, insert on catalog_import.import_runs, catalog_import.stable_id_maps,
  catalog_import.import_rejects to service_role;
grant select, insert, update, delete on catalog_import.staged_rows to service_role;
grant select on catalog_import.receipts to service_role;
grant execute on function catalog_import.finalize_run(uuid, text, integer, integer, integer)
  to service_role;
