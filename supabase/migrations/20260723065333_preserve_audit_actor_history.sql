alter table public.audit_events drop constraint if exists audit_events_actor_id_fkey;
revoke update, delete, truncate on table public.audit_events from service_role;
grant select, insert on table public.audit_events to service_role;
comment on column public.audit_events.actor_id is 'Immutable historical Auth user UUID retained after account deletion.';
