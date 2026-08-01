-- CONTROLLED SQL TEMPLATE — run manually only after the target Auth user exists.
-- Replace the UUID placeholder; never identify administrators by email.
-- This intentionally performs no audit insert because it is the one-time trust bootstrap.
begin;

insert into public.user_roles (user_id, role_id, granted_by)
select '<AUTH_USER_UUID>'::uuid, r.id, null
from public.roles r
where r.key = 'super_admin'
on conflict (user_id, role_id) do nothing;

-- Must return exactly one row before commit.
select ur.user_id, r.key
from public.user_roles ur
join public.roles r on r.id = ur.role_id
where ur.user_id = '<AUTH_USER_UUID>'::uuid and r.key = 'super_admin';

commit;
