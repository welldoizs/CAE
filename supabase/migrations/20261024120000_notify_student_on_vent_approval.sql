create or replace function public.cae_notify_user_vent_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
begin
  if new.status is distinct from 'approved'
     or old.status is not distinct from 'approved' then
    return new;
  end if;

  v_kind := case when new.type = 'audio' then 'áudio' else 'desabafo' end;
  v_title := 'Seu ' || v_kind || ' foi aprovado';
  v_body := case
    when new.visibility = 'private' then
      'A equipe analisou e aprovou seu ' || v_kind ||
      '. Ele continua privado, de acordo com a opção de privacidade escolhida no envio.'
    else
      'Seu ' || v_kind ||
      ' foi aprovado e já está disponível no espaço público do CAE.'
  end;

  insert into public.cae_notifications (
    user_id, type, title, body, target_view, target_id
  )
  values (
    new.user_id, 'content_approved', v_title, left(v_body, 2000),
    'history-view', new.id
  );
  return new;
end;
$$;

drop trigger if exists cae_notify_user_vent_approval on public.cae_vents;
create trigger cae_notify_user_vent_approval
after update of status on public.cae_vents
for each row
execute function public.cae_notify_user_vent_approval();

revoke all on function public.cae_notify_user_vent_approval() from public, anon;
grant execute on function public.cae_notify_user_vent_approval() to authenticated;
