CREATE OR REPLACE FUNCTION public.cae_block_private_chat_user(p_blocked_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  closed_count integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;
  IF p_blocked_user_id IS NULL OR p_blocked_user_id=uid THEN
    RAISE EXCEPTION 'Não é possível bloquear a própria conta.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cae_profiles WHERE id=p_blocked_user_id) THEN
    RAISE EXCEPTION 'Conta não encontrada.';
  END IF;

  INSERT INTO public.cae_private_chat_blocks(blocker_id,blocked_user_id)
  VALUES(uid,p_blocked_user_id)
  ON CONFLICT (blocker_id,blocked_user_id) DO NOTHING;

  UPDATE public.cae_private_chat_requests
     SET status='rejected',responded_at=now()
   WHERE status='pending'
     AND ((requester_id=uid AND target_user_id=p_blocked_user_id)
       OR (requester_id=p_blocked_user_id AND target_user_id=uid));

  UPDATE public.cae_private_conversations c
     SET active=false
   WHERE c.active=true
     AND EXISTS (
       SELECT 1 FROM public.cae_private_conversation_participants p
       WHERE p.conversation_id=c.id AND p.user_id=uid
     )
     AND EXISTS (
       SELECT 1 FROM public.cae_private_conversation_participants p
       WHERE p.conversation_id=c.id AND p.user_id=p_blocked_user_id
     );
  GET DIAGNOSTICS closed_count = ROW_COUNT;

  IF closed_count > 0 THEN
    PERFORM public.cae_notify_user(
      p_blocked_user_id,
      'private_conversation_closed',
      'Conversa privada encerrada',
      'Uma conversa privada foi encerrada e não aceita novas mensagens.',
      'private-conversations-view',
      NULL
    );
  END IF;

  RETURN jsonb_build_object('status','blocked','user_id',p_blocked_user_id,'closed_conversations',closed_count);
END;
$function$


REVOKE ALL ON FUNCTION public.cae_block_private_chat_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_block_private_chat_user(uuid) TO authenticated;
