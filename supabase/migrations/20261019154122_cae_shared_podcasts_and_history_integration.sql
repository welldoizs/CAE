-- Community podcast recommendations, report support and saved podcast support.
create table if not exists public.cae_shared_podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Geral',
  url text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  constraint cae_shared_podcasts_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint cae_shared_podcasts_description_check check (char_length(description) <= 500),
  constraint cae_shared_podcasts_category_check check (category = any (array['Geral','Cultura','Ciência','Educação','Entretenimento','Saúde e bem-estar']::text[])),
  constraint cae_shared_podcasts_url_check check (url ~* '^https?://[^[:space:]]+$'),
  constraint cae_shared_podcasts_status_check check (status = any (array['pending','approved','rejected']::text[]))
);

create index if not exists cae_shared_podcasts_status_created_idx
  on public.cae_shared_podcasts(status, created_at desc);
create index if not exists cae_shared_podcasts_user_created_idx
  on public.cae_shared_podcasts(user_id, created_at desc);

alter table public.cae_shared_podcasts enable row level security;
drop policy if exists cae_shared_podcasts_select_visible on public.cae_shared_podcasts;
create policy cae_shared_podcasts_select_visible on public.cae_shared_podcasts
  for select to authenticated
  using (public.cae_is_active_user() and (status = 'approved' or user_id = (select auth.uid()) or public.cae_is_staff()));
drop policy if exists cae_shared_podcasts_insert_own_pending on public.cae_shared_podcasts;
create policy cae_shared_podcasts_insert_own_pending on public.cae_shared_podcasts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and public.cae_is_active_user());
drop policy if exists cae_shared_podcasts_update_staff on public.cae_shared_podcasts;
create policy cae_shared_podcasts_update_staff on public.cae_shared_podcasts
  for update to authenticated
  using (public.cae_is_staff()) with check (public.cae_is_staff());
drop policy if exists cae_shared_podcasts_delete_own_pending_or_staff on public.cae_shared_podcasts;
create policy cae_shared_podcasts_delete_own_pending_or_staff on public.cae_shared_podcasts
  for delete to authenticated
  using (public.cae_is_staff() or (user_id = (select auth.uid()) and status = 'pending'));

revoke all on table public.cae_shared_podcasts from anon, public;
grant select, insert, update, delete on table public.cae_shared_podcasts to authenticated;

alter table public.cae_content_reports drop constraint if exists cae_content_reports_target_type_check;
alter table public.cae_content_reports add constraint cae_content_reports_target_type_check
  check (target_type = any (array['post','vent','private_message','podcast']::text[]));
alter table public.cae_bookmarks drop constraint if exists cae_bookmarks_content_type_check;
alter table public.cae_bookmarks add constraint cae_bookmarks_content_type_check
  check (content_type = any (array['post','announcement','event','poll','podcast']::text[]));

create or replace function public.cae_submit_content_report(
  p_target_type text, p_target_id uuid, p_reason text, p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_reporter uuid := auth.uid();
  v_target_owner uuid;
  v_report_id uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 120);
  v_details text := left(trim(coalesce(p_details, '')), 2000);
begin
  if v_reporter is null then raise exception 'Você precisa entrar para denunciar conteúdo.'; end if;
  if p_target_id is null or char_length(v_reason) < 3 then raise exception 'Informe o conteúdo e um motivo válido para a denúncia.'; end if;

  if p_target_type = 'post' then
    select p.user_id into v_target_owner from public.cae_posts p
      where p.id = p_target_id and coalesce(p.status, 'approved') = 'approved';
  elsif p_target_type = 'vent' then
    select v.user_id into v_target_owner from public.cae_vents v
      where v.id = p_target_id and v.visibility = 'public' and v.status = 'approved';
  elsif p_target_type = 'private_message' then
    select m.sender_id into v_target_owner from public.cae_private_messages m
      join public.cae_private_conversation_participants cp on cp.conversation_id = m.conversation_id
      where m.id = p_target_id and cp.user_id = v_reporter;
  elsif p_target_type = 'podcast' then
    select p.user_id into v_target_owner from public.cae_shared_podcasts p
      where p.id = p_target_id and p.status = 'approved';
  else
    raise exception 'Tipo de conteúdo não permitido para denúncia.';
  end if;

  if v_target_owner is null then raise exception 'Este conteúdo não está disponível para denúncia.'; end if;
  if v_target_owner = v_reporter then raise exception 'Você não pode denunciar seu próprio conteúdo.'; end if;

  insert into public.cae_content_reports(reporter_id, target_type, target_id, reason, details)
  values (v_reporter, p_target_type, p_target_id, v_reason, v_details)
  on conflict (reporter_id, target_type, target_id) do update
    set reason = excluded.reason, details = excluded.details, status = 'pending',
        created_at = now(), reviewed_at = null, reviewed_by = null
  returning id into v_report_id;
  return v_report_id;
end;
$function$;

revoke all on function public.cae_submit_content_report(text, uuid, text, text) from public, anon;
grant execute on function public.cae_submit_content_report(text, uuid, text, text) to authenticated;
