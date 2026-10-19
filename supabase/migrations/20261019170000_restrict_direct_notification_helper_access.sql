-- Keep notification creation behind trusted server-side routines.
-- Frontend clients never call this helper directly.
revoke execute on function public.cae_notify_user(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.cae_notify_user(uuid, text, text, text, text, uuid)
  to service_role;

comment on function public.cae_notify_user(uuid, text, text, text, text, uuid)
  is 'Internal notification helper; direct client execution is restricted. Called by trusted SECURITY DEFINER routines.';
