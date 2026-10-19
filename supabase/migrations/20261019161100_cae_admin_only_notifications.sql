create table if not exists public.cae_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  target_view text not null default 'admin-view',
  target_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists cae_admin_notifications_user_created_idx
  on public.cae_admin_notifications(user_id, created_at desc);
create index if not exists cae_admin_notifications_unread_idx
  on public.cae_admin_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.cae_admin_notifications enable row level security;

drop policy if exists cae_admin_notifications_staff_read on public.cae_admin_notifications;
create policy cae_admin_notifications_staff_read
  on public.cae_admin_notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and public.cae_is_staff());

drop policy if exists cae_admin_notifications_staff_mark_read on public.cae_admin_notifications;
create policy cae_admin_notifications_staff_mark_read
  on public.cae_admin_notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and public.cae_is_staff())
  with check (user_id = (select auth.uid()) and public.cae_is_staff());

revoke all on table public.cae_admin_notifications from public, anon, authenticated;
grant select on table public.cae_admin_notifications to authenticated;
grant update (read_at) on table public.cae_admin_notifications to authenticated;

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
    select p.id from public.cae_profiles p
    where p.role in ('admin', 'moderator') and p.id is distinct from v_actor_id
  loop
    insert into public.cae_admin_notifications(user_id, type, title, body, target_view, target_id)
    values (v_staff.id, v_type, v_title, v_body, 'admin-view', v_target_id);
  end loop;
  return new;
end;
$function$;

revoke all on function public.cae_notify_staff_on_activity() from public, anon, authenticated;

drop trigger if exists cae_admin_notify_new_vent on public.cae_vents;
create trigger cae_admin_notify_new_vent after insert on public.cae_vents
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_new_post on public.cae_posts;
create trigger cae_admin_notify_new_post after insert on public.cae_posts
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_new_podcast on public.cae_shared_podcasts;
create trigger cae_admin_notify_new_podcast after insert on public.cae_shared_podcasts
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_content_report on public.cae_content_reports;
create trigger cae_admin_notify_content_report after insert or update of status on public.cae_content_reports
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_chat_report on public.cae_chat_reports;
create trigger cae_admin_notify_chat_report after insert on public.cae_chat_reports
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_account_deletion on public.cae_account_deletion_requests;
create trigger cae_admin_notify_account_deletion after insert on public.cae_account_deletion_requests
for each row execute function public.cae_notify_staff_on_activity();

drop trigger if exists cae_admin_notify_support_message on public.cae_support_messages;
create trigger cae_admin_notify_support_message after insert on public.cae_support_messages
for each row execute function public.cae_notify_staff_on_activity();

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'cae_admin_notifications') then
    execute 'alter publication supabase_realtime add table public.cae_admin_notifications';
  end if;
end;
$publication$;
