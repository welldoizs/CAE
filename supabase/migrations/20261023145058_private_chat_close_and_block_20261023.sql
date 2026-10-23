-- Close private conversations and block private-chat invitations.
-- A close affects both participants; messages remain stored for permitted safety review.
CREATE TABLE IF NOT EXISTS public.cae_private_chat_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cae_private_chat_blocks_no_self CHECK (blocker_id <> blocked_user_id),
  CONSTRAINT cae_private_chat_blocks_pkey PRIMARY KEY (blocker_id, blocked_user_id)
);

ALTER TABLE public.cae_private_chat_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cae_private_chat_blocks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cae_get_my_private_chat_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,
        'created_at',c.created_at,
        'source_type',c.source_type,
        'source_id',c.source_id,
        'participants',COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id',p.user_id,'public_code',pr.public_code,'role',p.role))
          FROM public.cae_private_conversation_participants p
          JOIN public.cae_profiles pr ON pr.id=p.user_id
          WHERE p.conversation_id=c.id
        ),'[]'::jsonb),
        'messages',COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id',m.id,'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at) ORDER BY m.created_at ASC)
          FROM public.cae_private_messages m
          WHERE m.conversation_id=c.id AND m.deleted_at IS NULL
        ),'[]'::jsonb)
      ) ORDER BY c.created_at DESC)
      FROM public.cae_private_conversations c
      WHERE c.active=true
        AND EXISTS (
          SELECT 1 FROM public.cae_private_conversation_participants p
          WHERE p.conversation_id=c.id AND p.user_id=uid
        )
    ),'[]'::jsonb),
    'incoming_requests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'requester_id',r.requester_id,'requester_code',p.public_code,'created_at',r.created_at) ORDER BY r.created_at DESC)
      FROM public.cae_private_chat_requests r
      JOIN public.cae_profiles p ON p.id=r.requester_id
      WHERE r.target_user_id=uid AND r.status='pending'
    ),'[]'::jsonb),
    'outgoing_requests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'target_user_id',r.target_user_id,'target_code',p.public_code,'created_at',r.created_at,'status',r.status) ORDER BY r.created_at DESC)
      FROM public.cae_private_chat_requests r
      JOIN public.cae_profiles p ON p.id=r.target_user_id
      WHERE r.requester_id=uid AND r.status='pending'
    ),'[]'::jsonb),
    'blocked_users',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id',b.blocked_user_id,'public_code',p.public_code,'blocked_at',b.created_at) ORDER BY b.created_at DESC)
      FROM public.cae_private_chat_blocks b
      JOIN public.cae_profiles p ON p.id=b.blocked_user_id
      WHERE b.blocker_id=uid
    ),'[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$


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


CREATE OR REPLACE FUNCTION public.cae_send_private_message(p_conversation_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  clean_body text := btrim(coalesce(p_body,''));
  msg public.cae_private_messages;
  recipient uuid;
  sender_code text;
  conversation_active boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;
  IF char_length(clean_body)<1 OR char_length(clean_body)>3000 THEN
    RAISE EXCEPTION 'A mensagem precisa ter entre 1 e 3000 caracteres.';
  END IF;

  SELECT c.active INTO conversation_active
  FROM public.cae_private_conversations c
  JOIN public.cae_private_conversation_participants p
    ON p.conversation_id=c.id AND p.user_id=uid
  WHERE c.id=p_conversation_id
  FOR UPDATE OF c;

  IF NOT FOUND OR conversation_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Esta conversa foi encerrada e não aceita novas mensagens.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cae_private_chat_blocks b
    WHERE EXISTS (SELECT 1 FROM public.cae_private_conversation_participants p WHERE p.conversation_id=p_conversation_id AND p.user_id=b.blocker_id)
      AND EXISTS (SELECT 1 FROM public.cae_private_conversation_participants p WHERE p.conversation_id=p_conversation_id AND p.user_id=b.blocked_user_id)
  ) THEN
    RAISE EXCEPTION 'Esta conversa não está mais disponível.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cae_profiles p
    WHERE p.id=uid
      AND ((p.banned_until IS NOT NULL AND p.banned_until>now()) OR (p.timeout_until IS NOT NULL AND p.timeout_until>now()))
  ) THEN
    RAISE EXCEPTION 'Sua conta está temporariamente impedida de enviar mensagens.';
  END IF;

  INSERT INTO public.cae_private_messages(conversation_id,sender_id,body)
  VALUES(p_conversation_id,uid,clean_body)
  RETURNING * INTO msg;

  SELECT public_code INTO sender_code FROM public.cae_profiles WHERE id=uid;

  FOR recipient IN
    SELECT user_id
    FROM public.cae_private_conversation_participants
    WHERE conversation_id=p_conversation_id AND user_id<>uid
  LOOP
    PERFORM public.cae_notify_user(
      recipient,
      'private_message',
      'Nova mensagem privada',
      format('#%s enviou uma nova mensagem.',coalesce(sender_code,'conta')),
      'private-conversations-view',
      p_conversation_id
    );
  END LOOP;

  RETURN jsonb_build_object('id',msg.id,'conversation_id',msg.conversation_id,'sender_id',msg.sender_id,'body',msg.body,'created_at',msg.created_at);
END;
$function$


CREATE OR REPLACE FUNCTION public.cae_close_private_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  was_active boolean;
  other_user_id uuid;
  sender_code text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;

  SELECT c.active INTO was_active
  FROM public.cae_private_conversations c
  JOIN public.cae_private_conversation_participants p
    ON p.conversation_id=c.id AND p.user_id=uid
  WHERE c.id=p_conversation_id
  FOR UPDATE OF c;

  IF NOT FOUND THEN RAISE EXCEPTION 'Você não participa desta conversa.'; END IF;

  SELECT user_id INTO other_user_id
  FROM public.cae_private_conversation_participants
  WHERE conversation_id=p_conversation_id AND user_id<>uid
  LIMIT 1;

  IF was_active THEN
    UPDATE public.cae_private_conversations SET active=false WHERE id=p_conversation_id;
    SELECT public_code INTO sender_code FROM public.cae_profiles WHERE id=uid;
    IF other_user_id IS NOT NULL THEN
      PERFORM public.cae_notify_user(
        other_user_id,
        'private_conversation_closed',
        'Conversa privada encerrada',
        format('#%s encerrou esta conversa privada.',coalesce(sender_code,'uma pessoa')),
        'private-conversations-view',
        NULL
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('status','closed','conversation_id',p_conversation_id);
END;
$function$


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

  RETURN jsonb_build_object('status','blocked','user_id',p_blocked_user_id,'closed_conversations',closed_count);
END;
$function$


CREATE OR REPLACE FUNCTION public.cae_unblock_private_chat_user(p_blocked_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  uid uuid := auth.uid();
  removed_count integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'CAE_LOGIN_REQUIRED'; END IF;
  DELETE FROM public.cae_private_chat_blocks
  WHERE blocker_id=uid AND blocked_user_id=p_blocked_user_id;
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RETURN jsonb_build_object('status','unblocked','removed',removed_count);
END;
$function$


REVOKE ALL ON FUNCTION public.cae_get_my_private_chat_data() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_request_private_chat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_send_private_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_close_private_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_block_private_chat_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cae_unblock_private_chat_user(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.cae_get_my_private_chat_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_request_private_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_respond_private_chat_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_send_private_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_close_private_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_block_private_chat_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cae_unblock_private_chat_user(uuid) TO authenticated;
