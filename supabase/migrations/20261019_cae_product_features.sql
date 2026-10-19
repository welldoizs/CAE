-- CAE product features and privacy safeguards
-- Apply once in the Supabase SQL Editor before deploying the matching frontend.
-- This migration does not delete existing records or alter existing application tables.

create table if not exists public.cae_mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mood text not null check (mood in ('great', 'good', 'neutral', 'difficult', 'very_difficult')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists cae_mood_entries_user_created_idx
  on public.cae_mood_entries(user_id, created_at desc);
alter table public.cae_mood_entries enable row level security;
drop policy if exists "Users manage their own mood entries" on public.cae_mood_entries;
create policy "Users manage their own mood entries" on public.cae_mood_entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.cae_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('post', 'announcement', 'event', 'poll')),
  content_id text not null,
  created_at timestamptz not null default now(),
  unique(user_id, content_type, content_id)
);
create index if not exists cae_bookmarks_user_created_idx
  on public.cae_bookmarks(user_id, created_at desc);
alter table public.cae_bookmarks enable row level security;
drop policy if exists "Users manage their own bookmarks" on public.cae_bookmarks;
create policy "Users manage their own bookmarks" on public.cae_bookmarks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.cae_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  reduced_motion boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.cae_user_preferences enable row level security;
drop policy if exists "Users manage their own preferences" on public.cae_user_preferences;
create policy "Users manage their own preferences" on public.cae_user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.cae_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists cae_account_deletion_requests_status_idx
  on public.cae_account_deletion_requests(status, requested_at);
alter table public.cae_account_deletion_requests enable row level security;
drop policy if exists "Users view their own deletion requests" on public.cae_account_deletion_requests;
create policy "Users view their own deletion requests" on public.cae_account_deletion_requests
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "Staff manage deletion requests" on public.cae_account_deletion_requests;
create policy "Staff manage deletion requests" on public.cae_account_deletion_requests
  for all to authenticated
  using (
    exists (
      select 1 from public.cae_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'moderator')
    )
  )
  with check (
    exists (
      select 1 from public.cae_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'moderator')
    )
  );

create table if not exists public.cae_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'vent', 'private_message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 120),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique(reporter_id, target_type, target_id)
);
create index if not exists cae_content_reports_status_created_idx
  on public.cae_content_reports(status, created_at asc);
alter table public.cae_content_reports enable row level security;

create or replace function public.cae_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.cae_profiles p
    where p.id = auth.uid() and p.role in ('admin', 'moderator')
  );
$$;
revoke all on function public.cae_is_staff() from public;
grant execute on function public.cae_is_staff() to authenticated;

drop policy if exists "Staff read content reports" on public.cae_content_reports;
create policy "Staff read content reports" on public.cae_content_reports
  for select to authenticated using (public.cae_is_staff());
drop policy if exists "Staff update content reports" on public.cae_content_reports;
create policy "Staff update content reports" on public.cae_content_reports
  for update to authenticated
  using (public.cae_is_staff())
  with check (public.cae_is_staff());

create or replace function public.cae_submit_content_report(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reporter uuid := auth.uid();
  v_target_owner uuid;
  v_report_id uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 120);
  v_details text := left(trim(coalesce(p_details, '')), 2000);
begin
  if v_reporter is null then
    raise exception 'Você precisa entrar para denunciar conteúdo.';
  end if;
  if p_target_id is null or v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Informe o conteúdo e um motivo válido para a denúncia.';
  end if;

  if p_target_type = 'post' then
    select p.user_id into v_target_owner
    from public.cae_posts p
    where p.id = p_target_id and coalesce(p.status, 'approved') = 'approved';
  elsif p_target_type = 'vent' then
    select v.user_id into v_target_owner
    from public.cae_vents v
    where v.id = p_target_id
      and v.visibility = 'public'
      and v.status = 'approved';
  elsif p_target_type = 'private_message' then
    select m.sender_id into v_target_owner
    from public.cae_private_messages m
    join public.cae_private_conversation_participants cp
      on cp.conversation_id = m.conversation_id
    where m.id = p_target_id and cp.user_id = v_reporter;
  else
    raise exception 'Tipo de conteúdo não permitido para denúncia.';
  end if;

  if v_target_owner is null then
    raise exception 'Este conteúdo não está disponível para denúncia.';
  end if;
  if v_target_owner = v_reporter then
    raise exception 'Você não pode denunciar seu próprio conteúdo.';
  end if;

  insert into public.cae_content_reports
    (reporter_id, target_type, target_id, reason, details)
  values
    (v_reporter, p_target_type, p_target_id, v_reason, v_details)
  on conflict (reporter_id, target_type, target_id) do update
    set reason = excluded.reason,
        details = excluded.details,
        status = 'pending',
        created_at = now(),
        reviewed_at = null,
        reviewed_by = null
  returning id into v_report_id;

  return v_report_id;
end;
$$;
revoke all on function public.cae_submit_content_report(text, uuid, text, text) from public;
grant execute on function public.cae_submit_content_report(text, uuid, text, text) to authenticated;

create or replace function public.cae_request_account_deletion()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_request uuid;
begin
  if v_user is null then
    raise exception 'Entre na sua conta antes de solicitar a exclusão.';
  end if;

  select id into v_request
  from public.cae_account_deletion_requests
  where user_id = v_user and status in ('pending', 'processing')
  order by requested_at desc
  limit 1;

  if v_request is null then
    insert into public.cae_account_deletion_requests(user_id)
    values (v_user)
    returning id into v_request;
  end if;

  return v_request;
end;
$$;
revoke all on function public.cae_request_account_deletion() from public;
grant execute on function public.cae_request_account_deletion() to authenticated;

-- The client must not write reports directly. Submissions go through the
-- SECURITY DEFINER function above, which verifies ownership/participation.
revoke insert, delete on public.cae_content_reports from anon, authenticated;
grant select, update on public.cae_content_reports to authenticated;

grant select, insert, update, delete on public.cae_mood_entries to authenticated;
grant select, insert, update, delete on public.cae_bookmarks to authenticated;
grant select, insert, update on public.cae_user_preferences to authenticated;
grant select, insert, update on public.cae_account_deletion_requests to authenticated;
