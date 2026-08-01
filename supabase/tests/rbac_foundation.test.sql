begin;
select plan(23);

select has_table('public', 'profiles');
select has_table('public', 'roles');
select has_table('public', 'permissions');
select has_table('public', 'user_roles');
select has_table('public', 'role_permissions');
select has_table('public', 'audit_events');

select public.ok(
  (select bool_and(relrowsecurity)
   from pg_class where oid = any(array[
     'public.profiles'::regclass, 'public.roles'::regclass,
     'public.permissions'::regclass, 'public.user_roles'::regclass,
     'public.role_permissions'::regclass, 'public.audit_events'::regclass
   ])),
  'RLS is enabled on every public foundation table'
);

select public.results_eq(
  $$select count(*)::bigint from public.roles$$,
  array[5::bigint], 'five roles are seeded'
);
select public.results_eq(
  $$select count(*)::bigint from public.permissions$$,
  array[15::bigint], 'fifteen operation permissions are seeded'
);
select public.is_empty(
  $$select 1 from public.user_roles$$,
  'migration does not bootstrap an administrator'
);

select public.function_returns('public', 'has_permission', array['text'], 'boolean');

select public.ok(
  not has_function_privilege('anon', 'public.has_permission(text)', 'execute'),
  'anonymous permission lookup is not executable'
);

select public.ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anonymous profile reads have no grant'
);
select public.ok(
  not has_table_privilege('authenticated', 'public.roles', 'select'),
  'RBAC catalog is not broadly readable'
);
select public.ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'insert'),
  'audit table cannot be inserted directly'
);
select public.ok(
  has_table_privilege('service_role', 'public.audit_events', 'select'),
  'service role can read audit events'
);
select public.ok(
  has_table_privilege('service_role', 'public.audit_events', 'insert'),
  'service role can append audit events'
);
select public.ok(
  not has_table_privilege('service_role', 'public.audit_events', 'update'),
  'service role cannot update audit events'
);
select public.ok(
  not has_table_privilege('service_role', 'public.audit_events', 'delete'),
  'service role cannot delete audit events'
);
select public.ok(
  not has_table_privilege('service_role', 'public.audit_events', 'truncate'),
  'service role cannot truncate audit events'
);
select public.ok(
  not exists (select 1 from pg_constraint
    where conrelid = 'public.audit_events'::regclass and contype = 'f'),
  'audit actor is not constrained by a foreign key'
);

insert into auth.users (id, aud, role, raw_user_meta_data, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
  '{"full_name":"Existing User"}'::jsonb, now(), now()
);
delete from public.profiles where id = '00000000-0000-0000-0000-000000000003';
insert into public.profiles(id, email, display_name)
select id, email, nullif(left(coalesce(
  raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name',
  raw_user_meta_data ->> 'name'
), 120), '') from auth.users
on conflict (id) do nothing;
select public.results_eq(
  $$select display_name from public.profiles
    where id = '00000000-0000-0000-0000-000000000003'$$,
  array['Existing User'::text], 'backfill creates a profile for an existing user'
);
insert into public.audit_events(actor_id, action, entity_type, request_id)
values ('00000000-0000-0000-0000-000000000003', 'user.deleted', 'user', gen_random_uuid());
delete from auth.users where id = '00000000-0000-0000-0000-000000000003';
select public.results_eq(
  $$select actor_id from public.audit_events where action = 'user.deleted'$$,
  array['00000000-0000-0000-0000-000000000003'::uuid],
  'deleting an Auth user preserves its immutable audit actor UUID'
);

select * from finish();
rollback;
