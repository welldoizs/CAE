CREATE OR REPLACE FUNCTION public.cae_chat_extended_moderation_check(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  normalized text;
  squeezed text;
  punctuation_clean text;
  symbol_variant text;
  spaced_runs text := '';
  current_run text := '';
  compacted_message text;
  search_text text;
  token text;
  word text;
  pattern text;
  direct_insult_words text[] := array[
    'burro','burra','burros','burras',
    'estupido','estupida','estupidos','estupidas',
    'idiota','idiotas','imbecil','imbecis',
    'babaca','babacas','otario','otaria','otarios','otarias',
    'cretino','cretina','cretinos','cretinas',
    'ridiculo','ridicula','ridiculos','ridiculas',
    'patetico','patetica','pateticos','pateticas',
    'ignorante','ignorantes','incompetente','incompetentes',
    'fracassado','fracassada','fracassados','fracassadas',
    'inutil','inuteis','nojento','nojenta','nojentos','nojentas',
    'vagabundo','vagabunda','vagabundos','vagabundas',
    'vadia','vadias','piranha','piranhas','puta','puto','putas','putos',
    'arrombado','arrombada','canalha','escroto','escrota',
    'desgracado','desgracada','retardado','retardada',
    'mongol','mongoloide','lixo','verme','vermes',
    'dumb','stupid','idiot','moron','loser','asshole','bitch','jerk'
  ];
  direct_slurs text[] := array[
    chr(110)||chr(105)||chr(103)||chr(103)||chr(101)||chr(114),
    chr(110)||chr(105)||chr(103)||chr(103)||chr(97)
  ];
  targeted_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|seu|sua|teu|tua)[[:space:]]+(?:(?:e|eh|um|uma|parece|vira|fica|ta|esta)[[:space:]]+)?(?:muito[[:space:]]+|muita[[:space:]]+|bem[[:space:]]+|um[[:space:]]+grande[[:space:]]+|uma[[:space:]]+grande[[:space:]]+)?(?:burro|burra|estupido|estupida|estupidos|estupidas|idiota|imbecil|babaca|otario|otaria|cretino|cretina|ridiculo|ridicula|patetico|patetica|ignorante|incompetente|fracassado|fracassada|inutil|nojento|nojenta|vagabundo|vagabunda|vadia|piranha|puta|puto|arrombado|arrombada|canalha|escroto|escrota|desgracado|desgracada|viado|viada|bicha|traveco|retardado|retardada|mongol|macaco|crioulo|lixo|verme)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:ele|ela|esse[[:space:]]+cara|essa[[:space:]]+garota|esse[[:space:]]+menino|essa[[:space:]]+menina|aquele[[:space:]]+cara|aquela[[:space:]]+pessoa|essa[[:space:]]+pessoa|esse[[:space:]]+sujeito|aquela[[:space:]]+garota|fulano|fulana|ciclano|o[[:space:]]+cara|a[[:space:]]+garota|o[[:space:]]+menino|a[[:space:]]+menina|meu[[:space:]]+amigo|minha[[:space:]]+amiga|meu[[:space:]]+colega|minha[[:space:]]+colega)[[:space:]]+(?:e|eh|um|uma|parece|vira|fica|ta|esta)[[:space:]]+(?:um[[:space:]]+|uma[[:space:]]+)?(?:muito[[:space:]]+|muita[[:space:]]+|bem[[:space:]]+)?(?:burro|burra|estupido|estupida|idiota|imbecil|babaca|otario|otaria|cretino|cretina|ridiculo|ridicula|patetico|patetica|ignorante|incompetente|fracassado|fracassada|inutil|nojento|nojenta|vagabundo|vagabunda|vadia|piranha|viado|viada|bicha|traveco|retardado|retardada|mongol|macaco|crioulo|lixo|verme)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:you|u|he|she|they|that[[:space:]]+person|that[[:space:]]+guy|that[[:space:]]+girl)[[:space:]]+(?:are|is|r)[[:space:]]+(?:an?[[:space:]]+)?(?:idiot|stupid|dumb|moron|loser|asshole|bitch|jerk)([^[:alnum:]_]|$)'
  ];
begin
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 1500 then
    return 'blocked';
  end if;

  normalized := public.cae_normalize_chat_text(p_text);
  squeezed := regexp_replace(normalized, '([[:alpha:]])\1+', '\1', 'g');
  punctuation_clean := regexp_replace(normalized, '[[:punct:]_]+', '', 'g');
  symbol_variant := translate(normalized, '!', 'i');
  compacted_message := regexp_replace(normalized, '[^[:alnum:]]+', '', 'g');

  for token in
    select value from regexp_split_to_table(punctuation_clean, '[[:space:]]+') as parts(value)
  loop
    if char_length(token) = 1 and token ~ '^[[:alnum:]]$' then
      current_run := current_run || token;
    else
      if char_length(current_run) >= 3 then
        spaced_runs := spaced_runs || ' ' || current_run;
      end if;
      current_run := '';
      spaced_runs := spaced_runs || ' ' || token;
    end if;
  end loop;

  if char_length(current_run) >= 3 then
    spaced_runs := spaced_runs || ' ' || current_run;
  end if;

  search_text := normalized || ' ' || punctuation_clean || ' ' ||
                 spaced_runs || ' ' || squeezed || ' ' || symbol_variant;

  -- Slurs raciais explícitos são bloqueados mesmo sem alvo nominal.
  foreach word in array direct_slurs loop
    pattern := '(^|[^[:alnum:]_])' || word || 's?([^[:alnum:]_]|$)';
    if search_text ~* pattern then
      return 'blocked';
    end if;
  end loop;

  -- Um insulto isolado, enviado como mensagem, também é tratado como ataque.
  if compacted_message = any(direct_insult_words) then
    return 'blocked';
  end if;

  foreach pattern in array targeted_patterns loop
    if search_text ~* pattern then
      return 'blocked';
    end if;
  end loop;

  return 'allow';
end;
$function$


CREATE OR REPLACE FUNCTION public.cae_guard_extended_chat_insults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if public.cae_chat_extended_moderation_check(new.body) <> 'allow' then
    raise exception 'CAE_CHAT_OFFENSIVE';
  end if;
  return new;
end;
$function$


drop trigger if exists cae_auto_chat_moderation_extended on public.cae_chat_messages;
create trigger cae_auto_chat_moderation_extended
before insert on public.cae_chat_messages
for each row execute function public.cae_guard_extended_chat_insults();

revoke all on function public.cae_chat_extended_moderation_check(text) from public, anon;
grant execute on function public.cae_chat_extended_moderation_check(text) to authenticated;
revoke all on function public.cae_guard_extended_chat_insults() from public, anon, authenticated;
