create or replace function public.cae_notify_staff_on_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set row_security to off
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_actor_id uuid;
  v_type text;
  v_title text;
  v_body text;
  v_target_id uuid;
  v_staff record;
begin
  if tg_table_name = 'cae_vents' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'user_id', '')::uuid;
    v_type := 'new_vent';
    v_title := 'Novo desabafo para revisar';
    v_body := 'Um estudante enviou um desabafo que aguarda moderação.';
    v_target_id := nullif(v_row->>'id', '')::uuid;
  elsif tg_table_name = 'cae_posts' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'user_id', '')::uuid;
    v_type := 'new_post';
    v_title := 'Nova publicação para revisar';
    v_body := 'Uma publicação foi enviada ao mural e aguarda moderação.';
    v_target_id := nullif(v_row->>'id', '')::uuid;
  elsif tg_table_name = 'cae_shared_podcasts' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'user_id', '')::uuid;
    v_type := 'new_podcast';
    v_title := 'Nova recomendação de podcast';
    v_body := 'Uma recomendação da comunidade aguarda aprovação.';
    v_target_id := nullif(v_row->>'id', '')::uuid;
  elsif tg_table_name = 'cae_content_reports' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'reporter_id', '')::uuid;
    v_type := 'content_report';
    v_title := 'Nova denúncia recebida';
    v_body := 'Uma publicação, desabafo, podcast ou mensagem foi denunciada.';
    v_target_id := nullif(v_row->>'id', '')::uuid;
  elsif tg_table_name = 'cae_chat_reports' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'reporter_id', '')::uuid;
    v_type := 'chat_report';
    v_title := 'Nova denúncia no chat';
    v_body := 'Uma mensagem do chat público foi denunciada.';
    v_target_id := nullif(v_row->>'message_id', '')::uuid;
  elsif tg_table_name = 'cae_account_deletion_requests' then
    if coalesce(v_row->>'status', 'pending') <> 'pending' then return new; end if;
    v_actor_id := nullif(v_row->>'user_id', '')::uuid;
    v_type := 'account_deletion';
    v_title := 'Pedido de exclusão de conta';
    v_body := 'Um estudante solicitou a exclusão da própria conta.';
    v_target_id := nullif(v_row->>'id', '')::uuid;
  elsif tg_table_name = 'cae_support_messages' then
    v_actor_id := nullif(v_row->>'sender_id', '')::uuid;
    if v_actor_id is null or v_actor_id <> nullif(v_row->>'conversation_user_id', '')::uuid then
      return new;
    end if;
    v_type := 'support_message';
    v_title := 'Nova mensagem em Fale conosco';
    v_body := 'Um estudante enviou uma mensagem para a equipe.';
    v_target_id := nullif(v_row->>'conversation_user_id', '')::uuid;
  else
    return new;
  end if;

  for v_staff in
    select p.id
    from public.cae_profiles p
    where p.role in ('admin', 'moderator')
      and (v_type = 'new_post' or p.id is distinct from v_actor_id)
  loop
    insert into public.cae_admin_notifications(user_id, type, title, body, target_view, target_id)
    values (v_staff.id, v_type, v_title, v_body, 'admin-view', v_target_id);
  end loop;

  return new;
end;
$function$;
