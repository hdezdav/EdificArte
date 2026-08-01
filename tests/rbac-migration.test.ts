import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory).filter((name) =>
  name.endsWith('.sql')
);
const rbacMigrations = migrationNames.filter((name) =>
  name.endsWith('_identity_rbac_audit_foundation.sql')
);
const correctionMigrations = migrationNames.filter((name) =>
  name.endsWith('_preserve_audit_actor_history.sql')
);
const sql =
  rbacMigrations.length === 1
    ? readFileSync(
        new URL(rbacMigrations[0], migrationDirectory),
        'utf8'
      ).toLowerCase()
    : '';
const correctionSql =
  correctionMigrations.length === 1
    ? readFileSync(
        new URL(correctionMigrations[0], migrationDirectory),
        'utf8'
      ).toLowerCase()
    : '';

describe('identity/RBAC/audit migration', () => {
  it('is one ordered imperative migration', () => {
    expect(rbacMigrations).toHaveLength(1);
    expect(rbacMigrations[0]).toBe(
      '20260723063120_identity_rbac_audit_foundation.sql'
    );
  });

  it('creates and protects every public foundation table', () => {
    for (const table of [
      'profiles',
      'roles',
      'permissions',
      'user_roles',
      'role_permissions',
      'audit_events',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(
        `alter table public.${table} enable row level security`
      );
    }
    expect(sql).not.toMatch(
      /create policy .* on public\.(roles|permissions|user_roles|role_permissions|audit_events)/
    );
  });

  it('limits profile access to safe own columns', () => {
    expect(sql).toContain('create policy profiles_read_own');
    expect(sql).toContain('create policy profiles_update_own');
    expect(sql).toContain(
      'grant update (display_name, avatar_url, locale) on public.profiles to authenticated'
    );
    expect(sql).toContain(
      'grant select (id, email, display_name, avatar_url, locale, created_at, updated_at)'
    );
    expect(sql).not.toMatch(/grant update[^;]*(status|role)/);
  });

  it('backfills existing auth users without broad public-schema revokes', () => {
    expect(sql).toMatch(
      /insert into public\.profiles\(id, email, display_name\)[\s\S]*?from auth\.users[\s\S]*?on conflict \(id\) do nothing/
    );
    expect(sql).not.toMatch(/revoke all on all (tables|functions)/);
    expect(sql).toContain(
      'revoke all on function public.has_permission(text) from public, anon, authenticated'
    );
  });

  it('keeps privileged helpers private and denies implicit execution', () => {
    expect(sql).toContain('create schema if not exists private');
    expect(sql).toMatch(
      /create function private\.has_permission[\s\S]*?security definer[\s\S]*?set search_path = ''/
    );
    expect(sql).toMatch(
      /create function private\.write_audit_event[\s\S]*?security definer[\s\S]*?set search_path = ''/
    );
    expect(sql).toContain(
      'private.write_audit_event(text, text, text, text, uuid, jsonb, jsonb)'
    );
    expect(sql).not.toContain(
      'grant execute on function private.write_audit_event'
    );
    expect(sql).not.toContain(
      'grant execute on function private.audit_payload_is_safe'
    );
  });

  it('denies anonymous, unverified, disabled, and unassigned identities', () => {
    expect(sql).toContain('not u.is_anonymous');
    expect(sql).toContain(
      'u.email_confirmed_at is not null or u.phone_confirmed_at is not null'
    );
    expect(sql).toContain("p.status = 'active'");
    expect(sql).toContain(
      'where ur.user_id = u.id and pe.key = permission_key'
    );
    expect(sql).toContain(
      'grant execute on function public.has_permission(text) to authenticated'
    );
    expect(sql).not.toContain(
      'grant execute on function public.has_permission(text) to anon'
    );
  });

  it('seeds the complete catalog without assigning users', () => {
    for (const role of [
      'super_admin',
      'content_editor',
      'commerce_operator',
      'support_moderator',
      'viewer',
    ]) {
      expect(sql).toContain(`('${role}'`);
    }
    for (const permission of [
      'admin.access',
      'roles.manage',
      'places.manage',
      'places.publish',
      'tours.manage',
      'tours.publish',
      'media.manage',
      'reservations.manage',
      'products.manage',
      'inventory.manage',
      'orders.manage',
      'users.manage',
      'reviews.moderate',
      'rewards.manage',
      'audit.read',
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).not.toMatch(/insert into public\.user_roles/);
  });

  it('makes audit append-only and derives its actor from auth.uid()', () => {
    expect(correctionMigrations).toHaveLength(1);
    expect(sql).toContain('insert into public.audit_events');
    expect(sql).toContain('(select auth.uid()), event_action');
    expect(sql).toContain('not private.audit_payload_is_safe(redacted_before)');
    expect(sql).toContain(
      "'password', 'secret', 'token', 'authorization', 'credit_card', 'payment_method'"
    );
    expect(sql).toContain(
      'grant select, insert on table public.audit_events to service_role'
    );
    expect(sql).toContain(
      'revoke update, delete, truncate on table public.audit_events from service_role'
    );
    expect(sql).not.toMatch(/grant all[^;]*audit_events/);
    expect(correctionSql).toContain(
      'grant select, insert on table public.audit_events to service_role'
    );
    expect(correctionSql).toContain(
      'revoke update, delete, truncate on table public.audit_events from service_role'
    );
    expect(sql).not.toMatch(/create policy .*audit_events/);
    expect(sql).toMatch(/actor_id uuid not null,/);
    expect(sql).not.toMatch(/actor_id[^,]*references/);
    expect(correctionSql).toContain(
      'drop constraint if exists audit_events_actor_id_fkey'
    );
    expect(correctionSql).toContain('immutable historical auth user uuid');
  });

  it('indexes every foreign key and common audit lookup', () => {
    for (const index of [
      'user_roles_user_id_idx',
      'user_roles_role_id_idx',
      'user_roles_granted_by_idx',
      'role_permissions_role_id_idx',
      'role_permissions_permission_id_idx',
      'audit_events_actor_created_idx',
      'audit_events_entity_created_idx',
      'audit_events_action_created_idx',
      'audit_events_request_id_idx',
    ]) {
      expect(sql).toContain(`create index ${index}`);
    }
  });
});
