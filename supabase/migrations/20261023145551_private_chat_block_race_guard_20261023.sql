-- Serialize invitation, acceptance, and block changes for each pair.
CREATE INDEX IF NOT EXISTS cae_private_chat_blocks_blocked_user_id_idx
  ON public.cae_private_chat_blocks(blocked_user_id);

CREATE OR REPLACE FUNCTION public.cae_request_private_chat(p_target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  target_code text;
  request_row public.cae_private_chat_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;
  IF p_target_user_id IS NULL OR p_target_user_id = uid THEN
    RAISE EXCEPTION 'Você não pode iniciar uma conversa com a própria conta.';
  END IF;
  IF NOT public.cae_is_staff() AND EXISTS (
    SELECT 1 FROM public.cae_profiles p
    WHERE p.id=uid
      AND ((p.banned_until IS NOT NULL AND p.banned_until>now()) OR (p.timeout_until IS NOT NULL AND p.timeout_until>now()))
  ) THEN
    RAISE EXCEPTION 'Sua conta está temporariamente impedida de iniciar conversas.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cae_profiles WHERE id=p_target_user_id) THEN
    RAISE EXCEPTION 'Conta não encontrada.';
  END IF;

  -- Serialize invite creation against a concurrent block in either direction.
  PERFORM u.id FROM auth.users u
  WHERE u.id IN (uid,p_target_user_id)
  ORDER BY u.id
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.cae_private_chat_blocks b
    WHERE (b.blocker_id=uid AND b.blocked_user_id=p_target_user_id)
       OR (b.blocker_id=p_target_user_id AND b.blocked_user_id=uid)
  ) THEN
    RAISE EXCEPTION 'Não é possível enviar um convite de conversa para esta conta.';
  END IF;

  SELECT public_code INTO target_code
  FROM public.cae_profiles
  WHERE id=p_target_user_id;

  SELECT * INTO request_row
  FROM public.cae_private_chat_requests
  WHERE requester_id=uid
    AND target_user_id=p_target_user_id
    AND status='pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF request_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('request_id',request_row.id,'status',request_row.status,'target_code',target_code);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cae_private_chat_requests r
    WHERE r.requester_id=p_target_user_id
      AND r.target_user_id=uid
      AND r.status='pending'
  ) THEN
    RAISE EXCEPTION 'Essa pessoa já enviou uma solicitação para você. Veja as solicitações recebidas.';
  END IF;

  INSERT INTO public.cae_private_chat_requests(requester_id,target_user_id)
  VALUES(uid,p_target_user_id)
  RETURNING * INTO request_row;

  PERFORM public.cae_notify_user(
    p_target_user_id,
    'private_request',
    'Novo convite para conversa',
    format('#%s quer conversar com você.',coalesce((SELECT public_code FROM public.cae_profiles WHERE id=uid),'conta')),
    'private-conversations-view',
    request_row.id
  );

  RETURN jsonb_build_object('request_id',request_row.id,'status',request_row.status,'target_code',target_code);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cae_respond_private_chat_request(p_request_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  req public.cae_private_chat_requests;
  conv_id uuid;
  target_code text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;

  SELECT * INTO req
  FROM public.cae_private_chat_requests
  WHERE id=p_request_id
  FOR UPDATE;

  IF req.id IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF req.target_user_id <> uid THEN RAISE EXCEPTION 'Somente a pessoa convidada pode responder esta solicitação.'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'Esta solicitação já foi respondida.'; END IF;

  -- Serialize accepting a pending invite against a concurrent block.
  PERFORM u.id FROM auth.users u
  WHERE u.id IN (uid,req.requester_id)
  ORDER BY u.id
  FOR UPDATE;

  IF p_accept AND EXISTS (
    SELECT 1 FROM public.cae_private_chat_blocks b
    WHERE (b.blocker_id=uid AND b.blocked_user_id=req.requester_id)
       OR (b.blocker_id=req.requester_id AND b.blocked_user_id=uid)
  ) THEN
    UPDATE public.cae_private_chat_requests SET status='rejected',responded_at=now() WHERE id=req.id;
    RETURN jsonb_build_object('status','rejected');
  END IF;

  IF NOT p_accept THEN
    UPDATE public.cae_private_chat_requests
       SET status='rejected',responded_at=now()
     WHERE id=req.id;

    PERFORM public.cae_notify_user(
      req.requester_id,
      'private_request_rejected',
      'Solicitação de conversa recusada',
      format('#%s recusou sua solicitação.',coalesce((SELECT public_code FROM public.cae_profiles WHERE id=uid),'conta')),
      'private-conversations-view',
      req.id
    );
    RETURN jsonb_build_object('status','rejected');
  END IF;

  INSERT INTO public.cae_private_conversations(created_by,source_type,source_id)
  VALUES(uid,'request',req.id)
  RETURNING id INTO conv_id;

  INSERT INTO public.cae_private_conversation_participants(conversation_id,user_id,role)
  VALUES
    (conv_id,req.requester_id,'participant'),
    (conv_id,req.target_user_id,'participant');

  UPDATE public.cae_private_chat_requests
     SET status='accepted',responded_at=now(),conversation_id=conv_id
   WHERE id=req.id;

  SELECT public_code INTO target_code
  FROM public.cae_profiles
  WHERE id=uid;

  PERFORM public.cae_notify_user(
    req.requester_id,
    'private_request_accepted',
    'Conversa aceita',
    format('#%s aceitou seu convite. A conversa já está disponível.',coalesce(target_code,'conta')),
    'private-conversations-view',
    conv_id
  );

  RETURN jsonb_build_object('status','accepted','conversation_id',conv_id);
END;
$function$
;

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

  -- Serialize block creation against concurrent private invite/accept operations.
  PERFORM u.id FROM auth.users u
  WHERE u.id IN (uid,p_blocked_user_id)
  ORDER BY u.id
  FOR UPDATE;

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
;

REVOKE ALL ON FUNCTION public.cae_request_private_chat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_block_private_chat_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_request_private_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_block_private_chat_user(uuid) TO authenticated;
