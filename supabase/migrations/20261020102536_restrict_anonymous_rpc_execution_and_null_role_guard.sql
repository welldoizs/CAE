CREATE OR REPLACE FUNCTION public.cae_set_role_by_public_id(p_public_id text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
SET row_security TO 'off'
AS $function$
declare
  caller_role text;
  target_user_id uuid;
  target_name text;
  target_public_id text;
  normalized_public_id text;
  normalized_role text;
begin
  caller_role := public.cae_current_role();

  -- NULL must also be rejected: an unauthenticated caller has no role.
  if caller_role is distinct from 'admin' then
    raise exception 'ONLY_ADMIN';
  end if;

  normalized_role := lower(trim(coalesce(p_role, '')));

  if normalized_role not in ('student', 'moderator', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;

  normalized_public_id := regexp_replace(
    upper(trim(coalesce(p_public_id, ''))),
    '[^A-Z0-9]',
    '',
    'g'
  );

  if normalized_public_id = '' then
    raise exception 'INVALID_PUBLIC_ID';
  end if;

  select cp.id, cp.display_name, cp.public_id
    into target_user_id, target_name, target_public_id
  from public.cae_profiles cp
  where regexp_replace(upper(coalesce(cp.public_id, '')), '[^A-Z0-9]', '', 'g') = normalized_public_id
  limit 1;

  if target_user_id is null then
    raise exception 'TARGET_USER_NOT_FOUND';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'SELF_ROLE_CHANGE_NOT_ALLOWED';
  end if;

  update public.cae_profiles cp
     set role = normalized_role
   where cp.id = target_user_id;

  select cp.role::text, cp.display_name, cp.public_id
    into normalized_role, target_name, target_public_id
  from public.cae_profiles cp
  where cp.id = target_user_id
  limit 1;

  return jsonb_build_object(
    'id', target_user_id,
    'public_id', target_public_id,
    'display_name', target_name,
    'role', normalized_role
  );
end;
$function$;

-- Client-facing CAE RPCs are called only after authentication.
REVOKE EXECUTE ON FUNCTION public.cae_set_role_by_public_id(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_admin_private_chat_feed() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_admin_set_role(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_get_my_private_chat_data() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_request_private_chat(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_send_private_message(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_set_post_reaction(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_staff_delete_content(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_staff_moderate_account_with_reason(uuid, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_staff_reply_to_vent(uuid, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.cae_set_role_by_public_id(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_admin_private_chat_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_admin_set_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_get_my_private_chat_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_request_private_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_send_private_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_set_post_reaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_staff_delete_content(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_staff_moderate_account_with_reason(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_staff_reply_to_vent(uuid, text) TO authenticated;
