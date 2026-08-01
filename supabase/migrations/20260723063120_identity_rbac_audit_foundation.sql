-- Identity, operation-based RBAC, and append-only audit foundation.
-- Bootstrap deliberately assigns no user role; see docs/admin-bootstrap.sql.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text check (char_length(display_name) between 1 and 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  locale text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role_id, permission_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]*$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]*$'),
  entity_id text,
  request_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  check (before_data is null or jsonb_typeof(before_data) = 'object'),
  check (after_data is null or jsonb_typeof(after_data) = 'object')
);

comment on column public.audit_events.actor_id is
  'Immutable historical Auth user UUID; intentionally not a foreign key.';

create index user_roles_user_id_idx on public.user_roles(user_id);
create index user_roles_role_id_idx on public.user_roles(role_id);
create index user_roles_granted_by_idx on public.user_roles(granted_by);
create index role_permissions_role_id_idx on public.role_permissions(role_id);
create index role_permissions_permission_id_idx on public.role_permissions(permission_id);
create index audit_events_actor_created_idx on public.audit_events(actor_id, created_at desc);
create index audit_events_entity_created_idx on public.audit_events(entity_type, entity_id, created_at desc);
create index audit_events_action_created_idx on public.audit_events(action, created_at desc);
create index audit_events_request_id_idx on public.audit_events(request_id);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
for each row execute function private.set_updated_at();
create trigger permissions_set_updated_at before update on public.permissions
for each row execute function private.set_updated_at();

create function private.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, new.email, nullif(left(coalesce(
    new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  ), 120), ''));
  return new;
end;
$$;

create trigger auth_user_created_profile
after insert on auth.users
for each row execute function private.create_profile_for_user();

insert into public.profiles(id, email, display_name)
select id, email, nullif(left(coalesce(
  raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name',
  raw_user_meta_data ->> 'name'
), 120), '')
from auth.users
on conflict (id) do nothing;

create function private.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select not u.is_anonymous
       and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
       and p.status = 'active'
       and exists (
         select 1
         from public.user_roles ur
         join public.role_permissions rp on rp.role_id = ur.role_id
         join public.permissions pe on pe.id = rp.permission_id
         where ur.user_id = u.id and pe.key = permission_key
       )
     from auth.users u
     join public.profiles p on p.id = u.id
     where u.id = (select auth.uid())),
    false
  );
$$;

comment on function private.has_permission(text) is
  'Checks verified, active auth identity against normalized operation permissions.';

create function private.audit_payload_is_safe(payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare item record;
begin
  if payload is null then return true; end if;
  if jsonb_typeof(payload) = 'object' then
    for item in select * from jsonb_each(payload) loop
      if lower(item.key) = any(array[
        'password', 'secret', 'token', 'authorization', 'credit_card', 'payment_method'
      ]) or not private.audit_payload_is_safe(item.value) then return false; end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for item in select value from jsonb_array_elements(payload) loop
      if not private.audit_payload_is_safe(item.value) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create function public.has_permission(permission_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.has_permission(permission_key); $$;

create function private.write_audit_event(
  required_permission text,
  event_action text,
  event_entity_type text,
  event_entity_id text,
  event_request_id uuid,
  redacted_before jsonb default null,
  redacted_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
begin
  if not private.has_permission(required_permission) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if event_request_id is null then
    raise exception 'request_id is required' using errcode = '22004';
  end if;
  if not private.audit_payload_is_safe(redacted_before)
     or not private.audit_payload_is_safe(redacted_after) then
    raise exception 'audit payload contains a prohibited key' using errcode = '22023';
  end if;
  insert into public.audit_events(
    actor_id, action, entity_type, entity_id, request_id, before_data, after_data
  ) values (
    (select auth.uid()), event_action, event_entity_type, event_entity_id,
    event_request_id, redacted_before, redacted_after
  ) returning id into event_id;
  return event_id;
end;
$$;

insert into public.roles(key, name, description) values
  ('super_admin', 'Super administrator', 'All control-plane operations'),
  ('content_editor', 'Content editor', 'Manage and publish catalog content'),
  ('commerce_operator', 'Commerce operator', 'Manage reservations and commerce'),
  ('support_moderator', 'Support moderator', 'Support users and moderate reviews'),
  ('viewer', 'Viewer', 'Read-only administration access')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.permissions(key, description) values
  ('admin.access', 'Access the administration control plane'),
  ('roles.manage', 'Manage role assignments and permissions'),
  ('places.manage', 'Manage places'), ('places.publish', 'Publish places'),
  ('tours.manage', 'Manage tours'), ('tours.publish', 'Publish tours'),
  ('media.manage', 'Manage media'), ('reservations.manage', 'Manage reservations'),
  ('products.manage', 'Manage products'), ('inventory.manage', 'Manage inventory'),
  ('orders.manage', 'Manage orders'), ('users.manage', 'Manage users'),
  ('reviews.moderate', 'Moderate reviews'), ('rewards.manage', 'Manage rewards'),
  ('audit.read', 'Read audit events')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key = any(case r.key
  when 'content_editor' then array['admin.access','places.manage','places.publish','tours.manage','tours.publish','media.manage']
  when 'commerce_operator' then array['admin.access','reservations.manage','products.manage','inventory.manage','orders.manage']
  when 'support_moderator' then array['admin.access','users.manage','reviews.moderate','rewards.manage']
  when 'viewer' then array['admin.access','audit.read'] else array[]::text[] end)
where r.key <> 'super_admin'
on conflict (role_id, permission_id) do nothing;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on table public.profiles, public.roles, public.permissions,
  public.user_roles, public.role_permissions, public.audit_events
  from public, anon, authenticated;
revoke all on function public.has_permission(text) from public, anon, authenticated;
revoke all on function private.set_updated_at(), private.create_profile_for_user(),
  private.has_permission(text), private.audit_payload_is_safe(jsonb),
  private.write_audit_event(text, text, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;
grant all on table public.profiles, public.roles, public.permissions,
  public.user_roles, public.role_permissions to service_role;
revoke update, delete, truncate on table public.audit_events from service_role;
grant select, insert on table public.audit_events to service_role;
grant usage on schema private to service_role;
grant execute on function private.set_updated_at(), private.create_profile_for_user(),
  private.has_permission(text), private.audit_payload_is_safe(jsonb),
  private.write_audit_event(text, text, text, text, uuid, jsonb, jsonb),
  public.has_permission(text) to service_role;
grant select (id, email, display_name, avatar_url, locale, created_at, updated_at)
  on public.profiles to authenticated;
grant update (display_name, avatar_url, locale) on public.profiles to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function public.has_permission(text) to authenticated;

comment on table public.audit_events is
  'Append-only redacted security audit. Never store credentials, tokens, payment secrets, or unnecessary personal data.';
