-- The CAE is an authenticated school community.
-- Keep the directory, public profile lookup and poll tallies available to signed-in users,
-- but do not expose these SECURITY DEFINER readers to anonymous API clients.
revoke execute on function public.cae_public_directory()
  from public, anon;
grant execute on function public.cae_public_directory()
  to authenticated, service_role;

revoke execute on function public.cae_get_public_profiles(uuid[])
  from public, anon;
grant execute on function public.cae_get_public_profiles(uuid[])
  to authenticated, service_role;

revoke execute on function public.cae_get_poll_results(uuid[])
  from public, anon;
grant execute on function public.cae_get_poll_results(uuid[])
  to authenticated, service_role;
