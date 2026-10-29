create or replace function public.cae_chat_context_moderation_check(p_text text)
returns text language plpgsql immutable security invoker set search_path = ''
as $function$
declare normalized text; pattern text;
patterns text[] := array[
'(^|[^[:alnum:]_])(?:you|u|youre|he|hes|she|shes|they|theyre|that person|that guy|that girl|this person|this guy|this girl)[[:space:]]+(?:(?:are|is|r|be|being)[[:space:]]+)?(?:(?:a|an)[[:space:]]+)?(?:(?:really|very|so|such|fucking|fuckin|freaking|frigging|damn|goddamn|total|complete|absolute|stupid|dumb|bloody)[[:space:]]+){0,5}(?:idiot|idiots|stupid|dumb|moron|morons|asshole|assholes|bitch|bitches|jerk|jerks|loser|losers|imbecile|imbeciles|piece[[:space:]]+of[[:space:]]+shit)([^[:alnum:]_]|$)',
'(^|[^[:alnum:]_])(?:vc|voce|voces|tu|ele|ela|aquele[[:space:]]+cara|aquela[[:space:]]+garota|aquela[[:space:]]+pessoa|esse[[:space:]]+cara|essa[[:space:]]+garota|essa[[:space:]]+pessoa)[[:space:]]+(?:(?:e|eh|es|are|is|r)[[:space:]]+)?(?:(?:um|uma|a|an)[[:space:]]+)?(?:(?:muito|muita|bem|super|extremamente|completamente|um[[:space:]]+verdadeiro|uma[[:space:]]+verdadeira|fucking|really|very|so|such|freaking|totalmente)[[:space:]]+){0,5}(?:idiota|imbecil|burro|burra|estupido|estupida|babaca|otario|otaria|cretino|cretina|ridiculo|ridicula|patetico|patetica|incompetente|fracassado|fracassada|inutil|nojento|nojenta|dumb|stupid|idiot|moron|asshole|bitch|jerk)([^[:alnum:]_]|$)',
'(^|[^[:alnum:]_])(?:seu|sua|teu|tua|your)[[:space:]]+(?:(?:fucking|freaking|damn|total|complete)[[:space:]]+){0,3}(?:idiota|imbecil|burro|burra|estupido|estupida|babaca|otario|otaria|dumb|stupid|idiot|moron|asshole|bitch|jerk)([^[:alnum:]_]|$)',
'(^|[^[:alnum:]_])(?:fuck[[:space:]]+you|fuck[[:space:]]+off|go[[:space:]]+fuck[[:space:]]+yourself|you[[:space:]]+can[[:space:]]+go[[:space:]]+to[[:space:]]+hell|vai[[:space:]]+se[[:space:]]+foder|vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu)([^[:alnum:]_]|$)'
];
begin
if p_text is null or btrim(p_text)='' or char_length(p_text)>1500 then return 'blocked'; end if;
normalized:=public.cae_normalize_chat_text(p_text);
foreach pattern in array patterns loop if normalized ~* pattern then return 'blocked'; end if; end loop;
return 'allow';
end;
$function$;

revoke all on function public.cae_chat_context_moderation_check(text) from public, anon;
grant execute on function public.cae_chat_context_moderation_check(text) to authenticated;

create or replace function public.cae_guard_context_chat_insults()
returns trigger language plpgsql security invoker set search_path = ''
as $function$
begin
  if public.cae_chat_context_moderation_check(new.body) <> 'allow' then
    raise exception 'CAE_CHAT_OFFENSIVE';
  end if;
  return new;
end;
$function$;

drop trigger if exists cae_auto_chat_context_moderation on public.cae_chat_messages;
create trigger cae_auto_chat_context_moderation
before insert on public.cae_chat_messages
for each row execute function public.cae_guard_context_chat_insults();

revoke all on function public.cae_guard_context_chat_insults() from public, anon, authenticated;
