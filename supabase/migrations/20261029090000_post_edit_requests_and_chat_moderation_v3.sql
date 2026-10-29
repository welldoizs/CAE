-- CAE: admin post editing, student edit requests, and chat moderation v3.
-- The table is exposed only to authenticated sessions and protected by RLS.

CREATE TABLE IF NOT EXISTS public.cae_post_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.cae_posts(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_text text NOT NULL CHECK (char_length(btrim(request_text)) BETWEEN 3 AND 1000),
  suggested_body text CHECK (suggested_body IS NULL OR char_length(suggested_body) <= 6000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 700),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cae_post_edit_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.cae_post_edit_requests TO authenticated;
REVOKE ALL ON public.cae_post_edit_requests FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS cae_post_edit_requests_one_pending_per_user
  ON public.cae_post_edit_requests(post_id, requester_id)
  WHERE status = 'pending';

DROP POLICY IF EXISTS cae_post_edit_requests_read_own_or_admin ON public.cae_post_edit_requests;
CREATE POLICY cae_post_edit_requests_read_own_or_admin
  ON public.cae_post_edit_requests FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR public.cae_is_admin());

DROP POLICY IF EXISTS cae_post_edit_requests_insert_own ON public.cae_post_edit_requests;
CREATE POLICY cae_post_edit_requests_insert_own
  ON public.cae_post_edit_requests FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = (SELECT auth.uid())
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.cae_posts p
      WHERE p.id = cae_post_edit_requests.post_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS cae_post_edit_requests_update_admin ON public.cae_post_edit_requests;
CREATE POLICY cae_post_edit_requests_update_admin
  ON public.cae_post_edit_requests FOR UPDATE TO authenticated
  USING (public.cae_is_admin())
  WITH CHECK (public.cae_is_admin());

-- Moderators can approve/reject posts, but only admin/owner can change post content.
CREATE OR REPLACE FUNCTION public.cae_guard_post_content_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.cae_is_admin()
     AND (to_jsonb(NEW) - 'status' - 'moderation_reason' - 'moderated_at' - 'moderated_by')
         IS DISTINCT FROM
         (to_jsonb(OLD) - 'status' - 'moderation_reason' - 'moderated_at' - 'moderated_by')
  THEN
    RAISE EXCEPTION 'CAE_ADMIN_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cae_posts_admin_content_edit_guard ON public.cae_posts;
CREATE TRIGGER cae_posts_admin_content_edit_guard
BEFORE UPDATE ON public.cae_posts
FOR EACH ROW EXECUTE FUNCTION public.cae_guard_post_content_edits();

CREATE OR REPLACE FUNCTION public.cae_guard_post_edit_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.admin_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.created_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'CAE_EDIT_REQUEST_ALREADY_REVIEWED';
    END IF;
    IF NEW.status = 'rejected' AND length(btrim(coalesce(NEW.admin_note, ''))) < 3 THEN
      RAISE EXCEPTION 'CAE_EDIT_REQUEST_REASON_REQUIRED';
    END IF;
    IF NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
       OR NEW.request_text IS DISTINCT FROM OLD.request_text
       OR NEW.suggested_body IS DISTINCT FROM OLD.suggested_body
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'CAE_EDIT_REQUEST_IMMUTABLE_FIELDS';
    END IF;
    NEW.reviewed_at := now();
    NEW.reviewed_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cae_post_edit_request_guard ON public.cae_post_edit_requests;
CREATE TRIGGER cae_post_edit_request_guard
BEFORE INSERT OR UPDATE ON public.cae_post_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.cae_guard_post_edit_request();

CREATE OR REPLACE FUNCTION public.cae_notify_staff_post_edit_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  v_admin record;
BEGIN
  FOR v_admin IN
    SELECT p.id
    FROM public.cae_profiles p
    WHERE p.role IN ('admin','owner')
      AND p.id IS DISTINCT FROM NEW.requester_id
  LOOP
    INSERT INTO public.cae_admin_notifications(user_id,type,title,body,target_view,target_id)
    VALUES (
      v_admin.id, 'post_edit_request', 'Pedido de edição de publicação',
      'Um estudante pediu ajuda para corrigir ou alterar uma publicação.',
      'admin-view', NEW.id
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_notify_staff_post_edit_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cae_notify_staff_post_edit_request ON public.cae_post_edit_requests;
CREATE TRIGGER cae_notify_staff_post_edit_request
AFTER INSERT ON public.cae_post_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.cae_notify_staff_post_edit_request();

CREATE OR REPLACE FUNCTION public.cae_notify_post_edit_requester()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('completed','rejected') THEN
    IF NEW.status = 'completed' THEN
      v_title := 'Sua publicação foi atualizada';
      v_body := 'A equipe editou sua publicação conforme o pedido.';
    ELSE
      v_title := 'Pedido de edição analisado';
      v_body := 'A equipe não realizou a alteração solicitada. Motivo: ' ||
        coalesce(nullif(btrim(NEW.admin_note),''),'não informado');
    END IF;
    INSERT INTO public.cae_notifications(user_id,type,title,body,target_view,target_id)
    VALUES (NEW.requester_id,'post_edit_request',v_title,v_body,'mural-view',NEW.post_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_notify_post_edit_requester() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cae_notify_post_edit_requester ON public.cae_post_edit_requests;
CREATE TRIGGER cae_notify_post_edit_requester
AFTER UPDATE OF status ON public.cae_post_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.cae_notify_post_edit_requester();

CREATE OR REPLACE FUNCTION public.cae_notify_author_on_admin_post_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  IF (OLD.body IS DISTINCT FROM NEW.body OR OLD.category IS DISTINCT FROM NEW.category)
     AND (SELECT auth.uid()) IS DISTINCT FROM NEW.user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.cae_post_edit_requests r
       WHERE r.post_id = NEW.id AND r.status = 'pending'
     )
  THEN
    INSERT INTO public.cae_notifications(user_id,type,title,body,target_view,target_id)
    VALUES (
      NEW.user_id, 'post_edited_by_admin', 'Sua publicação foi editada pela equipe',
      'A equipe atualizou o texto ou a categoria da sua publicação.',
      'mural-view', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_notify_author_on_admin_post_edit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cae_notify_author_on_admin_post_edit ON public.cae_posts;
CREATE TRIGGER cae_notify_author_on_admin_post_edit
AFTER UPDATE OF body, category ON public.cae_posts
FOR EACH ROW EXECUTE FUNCTION public.cae_notify_author_on_admin_post_edit();

CREATE OR REPLACE FUNCTION public.cae_admin_edit_post(
  p_post_id uuid, p_category text, p_body text, p_request_id uuid, p_admin_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_request public.cae_post_edit_requests%ROWTYPE;
BEGIN
  IF NOT public.cae_is_admin() THEN RAISE EXCEPTION 'CAE_ADMIN_REQUIRED'; END IF;
  IF p_post_id IS NULL OR p_body IS NULL OR length(btrim(p_body)) < 1
     OR length(p_body) > 6000 OR length(btrim(coalesce(p_category,''))) < 1
     OR length(p_category) > 80 OR length(coalesce(p_admin_note,'')) > 700
  THEN
    RAISE EXCEPTION 'CAE_INVALID_POST_EDIT';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.cae_post_edit_requests
    WHERE id = p_request_id AND post_id = p_post_id AND status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAE_EDIT_REQUEST_NOT_PENDING'; END IF;
  END IF;

  UPDATE public.cae_posts
  SET category = btrim(p_category), body = btrim(p_body)
  WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAE_POST_NOT_FOUND'; END IF;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.cae_post_edit_requests
    SET status = 'completed', admin_note = nullif(btrim(coalesce(p_admin_note,'')),'')
    WHERE id = p_request_id AND post_id = p_post_id AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'CAE_EDIT_REQUEST_NOT_PENDING'; END IF;
  END IF;
  RETURN p_post_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_admin_edit_post(uuid,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_admin_edit_post(uuid,text,text,uuid,text) TO authenticated;

-- Initial v3 filter body; the next migration tightens stretched letters and homoglyphs.
CREATE OR REPLACE FUNCTION public.cae_chat_attack_moderation_check(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  normalized text;
  squeezed text;
  punctuation_clean text;
  punctuation_squeezed text;
  symbol_variant text;
  confusable_variant text;
  compacted_message text;
  compacted_squeezed text;
  spaced_runs text := '';
  current_run text := '';
  search_text text;
  token text;
  pattern text;
  insult_words text[] := ARRAY[
    'burro','burra','burros','burras','estupido','estupida','estupidos','estupidas',
    'idiota','idiotas','imbecil','imbecis','babaca','babacas','otario','otaria',
    'otarios','otarias','cretino','cretina','cretinos','cretinas','ridiculo','ridicula',
    'ridiculos','ridiculas','patetico','patetica','ignorante','incompetente',
    'fracassado','fracassada','inutil','nojento','nojenta','vagabundo','vagabunda',
    'vadia','piranha','arrombado','arrombada','canalha','escroto','escrota',
    'desgracado','desgracada','retardado','retardada','mongol','mongoloide',
    'lixo','verme','besta','asqueroso','asquerosa','escoria','desprezivel','palhaco','paspalho',
    'dumb','stupid','idiot','moron','loser','asshole','bitch','jerk','creep','scum','freak','worthless','pathetic'
  ];
  insult_pattern text;
  targeted_patterns text[];
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' OR char_length(p_text) > 1500 THEN RETURN 'blocked'; END IF;
  normalized := public.cae_normalize_chat_text(p_text);
  squeezed := regexp_replace(normalized, '([[:alpha:]])\1+', '\1', 'g');
  punctuation_clean := regexp_replace(normalized, '[[:punct:]_]+', '', 'g');
  punctuation_squeezed := regexp_replace(squeezed, '[[:punct:]_]+', '', 'g');
  symbol_variant := translate(normalized, '@$!|01345789', 'asiioieastbg');
  confusable_variant := translate(
    symbol_variant,
    chr(1072)||chr(1077)||chr(1110)||chr(1086)||chr(1088)||chr(1089)||chr(1093)||chr(1091)||chr(1075)||
    chr(945)||chr(949)||chr(953)||chr(959)||chr(961)||chr(1010),
    'aeiopcxyr'||'aeiopc'
  );
  compacted_message := regexp_replace(normalized, '[^[:alnum:]]+', '', 'g');
  compacted_squeezed := regexp_replace(squeezed, '[^[:alnum:]]+', '', 'g');
  FOR token IN SELECT value FROM regexp_split_to_table(punctuation_clean, '[[:space:]]+') AS parts(value)
  LOOP
    IF char_length(token) = 1 AND token ~ '^[[:alnum:]]$' THEN
      current_run := current_run || token;
    ELSE
      IF char_length(current_run) >= 3 THEN spaced_runs := spaced_runs || ' ' || current_run; END IF;
      current_run := '';
      spaced_runs := spaced_runs || ' ' || token;
    END IF;
  END LOOP;
  IF char_length(current_run) >= 3 THEN spaced_runs := spaced_runs || ' ' || current_run; END IF;
  search_text := normalized || ' ' || punctuation_clean || ' ' || punctuation_squeezed || ' ' ||
                 squeezed || ' ' || symbol_variant || ' ' || confusable_variant || ' ' || spaced_runs;
  insult_pattern := array_to_string(insult_words, '|');
  IF normalized ~* (
    '^(?:vc|voce|tu|you|u|ele|ela)[[:space:]]+' ||
    '(?:(?:e|eh|es|are|is|r)[[:space:]]+)?(?:nao|not|never)[[:space:]]+' ||
    '(?:(?:e|eh|es|are|is)[[:space:]]+)?(?:(?:um|uma|a|an)[[:space:]]+)?(?:' ||
    insult_pattern || ')[[:space:][:punct:]]*$'
  ) THEN RETURN 'allow'; END IF;
  IF compacted_message = ANY(insult_words) OR compacted_squeezed = ANY(insult_words)
     OR regexp_replace(symbol_variant, '[^[:alnum:]]+', '', 'g') = ANY(insult_words)
     OR regexp_replace(confusable_variant, '[^[:alnum:]]+', '', 'g') = ANY(insult_words)
  THEN RETURN 'blocked'; END IF;
  targeted_patterns := ARRAY[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|you|u|he|she|they|ele|ela|esse[[:space:]]+cara|essa[[:space:]]+pessoa|aquele[[:space:]]+cara|aquela[[:space:]]+pessoa)[[:space:]]+(?:(?:e|eh|es|are|is|r|um|uma|a|an|muito|muita|bem|really|very|so|such|esta|ta|parece)[[:space:]]+){0,4}(?:' || insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:seu|sua|teu|tua|your)[[:space:]]+(?:' || insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:para[[:space:]]+de[[:space:]]+ser|pare[[:space:]]+de[[:space:]]+ser|stop[[:space:]]+being)[[:space:]]+(?:an?[[:space:]]+)?(?:' || insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vai[[:space:]]+se[[:space:]]+(?:foder|ferrar|lascar)|vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu|vai[[:space:]]+pra?[[:space:]]+merda|fuck[[:space:]]+you|fuck[[:space:]]+off|shut[[:space:]]+up|go[[:space:]]+to[[:space:]]+hell|drop[[:space:]]+dead)([^[:alnum:]_]|$)'
  ];
  FOREACH pattern IN ARRAY targeted_patterns LOOP
    IF search_text ~* pattern THEN RETURN 'blocked'; END IF;
  END LOOP;
  RETURN 'allow';
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_chat_attack_moderation_check(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_chat_attack_moderation_check(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cae_guard_chat_attack_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF public.cae_chat_attack_moderation_check(NEW.body) <> 'allow' THEN
    RAISE EXCEPTION 'CAE_CHAT_OFFENSIVE';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_guard_chat_attack_v3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_guard_chat_attack_v3() TO authenticated;

DROP TRIGGER IF EXISTS cae_auto_chat_attack_moderation_v3 ON public.cae_chat_messages;
CREATE TRIGGER cae_auto_chat_attack_moderation_v3
BEFORE INSERT ON public.cae_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.cae_guard_chat_attack_v3();
