CREATE OR REPLACE FUNCTION public.cae_moderate_user_by_public_id(
  p_public_id text,
  p_action text,
  p_minutes integer DEFAULT NULL::integer
)
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
  normalized_action text;
  next_timeout timestamptz;
  current_banned boolean;
  current_timeout timestamptz;
  current_role text;
begin
  caller_role := public.cae_current_role();

  -- Reject NULL explicitly; SQL's NOT IN returns NULL for an unauthenticated caller.
  if caller_role is distinct from 'admin'
     and caller_role is distinct from 'moderator' then
    raise exception 'NOT_STAFF';
  end if;

  normalized_action := lower(trim(coalesce(p_action, '')));

  if normalized_action not in (
    'ban',
    'unban',
    'timeout',
    'clear_timeout'
  ) then
    raise exception 'INVALID_MODERATION_ACTION';
  end if;

  if normalized_action = 'timeout'
     and (
       p_minutes is null
       or p_minutes < 1
       or p_minutes > 10080
     ) then
    raise exception 'INVALID_TIMEOUT';
  end if;

  normalized_public_id := regexp_replace(
    upper(trim(coalesce(p_public_id, ''))),
    '[^A-Z0-9]', '',
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
    raise exception 'SELF_MODERATION_NOT_ALLOWED';
  end if;

  if normalized_action = 'ban' then
    update public.cae_profiles cp
    set is_banned = true, timeout_until = null
    where cp.id = target_user_id;
  elsif normalized_action = 'unban' then
    update public.cae_profiles cp
    set is_banned = false
    where cp.id = target_user_id;
  elsif normalized_action = 'timeout' then
    next_timeout := now() + make_interval(mins => p_minutes);
    update public.cae_profiles cp
    set timeout_until = next_timeout
    where cp.id = target_user_id;
  else
    update public.cae_profiles cp
    set timeout_until = null
    where cp.id = target_user_id;
  end if;

  select
    cp.role::text,
    cp.display_name,
    cp.public_id,
    coalesce(cp.is_banned, false),
    cp.timeout_until
  into current_role, target_name, target_public_id, current_banned, current_timeout
  from public.cae_profiles cp
  where cp.id = target_user_id
  limit 1;

  return jsonb_build_object(
    'id', target_user_id,
    'public_id', target_public_id,
    'display_name', target_name,
    'role', current_role,
    'is_banned', current_banned,
    'timeout_until', current_timeout,
    'action', normalized_action
  );
end;
$function$;

-- Legacy helpers are not used by the current client UI; retain signed-in
-- execution for compatibility, but prevent anonymous invocation.
REVOKE EXECUTE ON FUNCTION public.cae_moderate_user_by_public_id(text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_make_public_code(bigint, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_staff_delete_vent(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cae_staff_moderate_account(uuid, text, integer) FROM anon;

GRANT EXECUTE ON FUNCTION public.cae_moderate_user_by_public_id(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_make_public_code(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_staff_delete_vent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_staff_moderate_account(uuid, text, integer) TO authenticated;
