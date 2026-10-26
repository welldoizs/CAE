
create or replace function public.cae_normalize_chat_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select btrim(
    regexp_replace(
      regexp_replace(
        translate(
          lower(
            translate(
              translate(
                coalesce(p_text, ''),
                chr(8203) || chr(8204) || chr(8205) || chr(65279) ||
                chr(173) || chr(8206) || chr(8207) ||
                chr(8234) || chr(8235) || chr(8236) || chr(8237) ||
                chr(8238) || chr(8288),
                ''
              ),
              'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
              'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
            )
          ),
          '@4301!5$78|9',
          'aaeoiisstbig'
        ),
        '([[:alpha:]])\1{2,}',
        '\1',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$function$;

create or replace function public.cae_chat_moderation_check(p_text text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  normalized text;
  squeezed text;
  punctuation_clean text;
  punctuation_squeezed text;
  spaced_runs text := '';
  current_run text := '';
  token text;
  search_text text;
  pattern text;
  direct_insult_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:idiota|imbecil|babaca|otario|otaria|arrombado|arrombada|canalha|escroto|escrota|desgracado|desgracada|fdp|filho[[:space:]]+da[[:space:]]+puta)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:lixo humano|verme humano|ser desprezivel|pessoa desprezivel)([^[:alnum:]_]|$)'
  ];
  targeted_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|seu|sua|teu|tua)[[:space:]]+(?:(?:e|eh|um|uma|parece|vira|fica|ta|esta)[[:space:]]+)?(?:burro|burra|lixo|verme|inutil|fracassado|fracassada|vagabundo|vagabunda|vadia|piranha|puta|puto|viado|viada|viadinho|bicha|traveco|sapatao|retardado|retardada|mongol|favelado|macaco|crioulo|cadela|corno|vaca|nojento|nojenta)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces)[[:space:]]+(?:e|eh|um|uma)[[:space:]]+(?:um[[:space:]]+)?(?:animal|monstro|aberração|aberacao|lixo)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu|vai[[:space:]]+se[[:space:]]+foder|vai[[:space:]]+pra?[[:space:]]+merda|vai[[:space:]]+se[[:space:]]+lascar|vai[[:space:]]+se[[:space:]]+ferrar|vai[[:space:]]+pro[[:space:]]+inferno|foda-se[[:space:]]+(?:vc|voce)|te[[:space:]]+odeio|quero[[:space:]]+que[[:space:]]+(?:vc|voce)[[:space:]]+morra|cala[[:space:]]+a[[:space:]]+boca|vsf|vtnc|tnc)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:manda|envia|me[[:space:]]+passa|me[[:space:]]+mostra)[[:space:]]+(?:uma?[[:space:]]+)?(?:nudes?|packs?|fotos?[[:space:]]+(?:intimas?|pelad[oa]s?))([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:nudes?|packs?)[[:space:]]+(?:gratis|pra[[:space:]]+mim|para[[:space:]]+mim)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:pornhub|xvideos|xhamster|onlyfans)([^[:alnum:]_]|$)'
  ];
  threat_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vou|quero|posso|pretendo)[[:space:]]+(?:te|lhe)[[:space:]]+(?:matar|bater|espancar|agredir|machucar|quebrar|arrebentar)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vou|quero)[[:space:]]+acabar[[:space:]]+com[[:space:]]+(?:vc|voce|tu)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:te[[:space:]]+pego[[:space:]]+na[[:space:]]+saida|vou[[:space:]]+te[[:space:]]+achar|sei[[:space:]]+onde[[:space:]]+voce[[:space:]]+mora)([^[:alnum:]_]|$)'
  ];
  targeted_slur_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|seu|sua|teu|tua)[[:space:]]+(?:e|eh|um|uma)?[[:space:]]*(?:viad[oa]s?|viadinh[oa]s?|bich[oa]s?|traveco|sapat[aã]o|retardad[oa]s?|mongol|macaco|crioulo|favelad[oa]s?|vadia|piranha|vagabund[oa]s?|cadela)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:seu|sua|teu|tua)[[:space:]]+(?:macaco|crioulo|viad[oa]|bicha|traveco|sapat[aã]o|retardado|mongol|favelado|vadia|piranha|vagabunda)([^[:alnum:]_]|$)'
  ];
  group_attack_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:negros?|pretos?|pessoas[[:space:]]+negras?|indigenas?|quilombolas?|judeus?|muculmanos?|islamicos?|mulheres?|gays?|lesbicas?|bissexuais?|trans|travestis?|pessoas[[:space:]]+com[[:space:]]+deficiencia|pcds?|imigrantes?|estrangeiros?|nordestinos?|asiaticos?|ciganos?)[[:space:]]+(?:sao|e|eh|merecem|deveriam|devem|tem[[:space:]]+que|precisam)[[:space:]]+(?:inferiores?|imundos?|nojentos?|nojentas?|lixo|sumir|morrer|ser[[:space:]]+mortos?|ser[[:space:]]+eliminados?|desaparecer|nao[[:space:]]+deviam[[:space:]]+existir)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:todos|todas|esse[[:space:]]+povo|essa[[:space:]]+gente)[[:space:]]+(?:deveriam|deviam|tem[[:space:]]+que|precisam)[[:space:]]+(?:morrer|sumir|ser[[:space:]]+eliminados?|desaparecer)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:volta|voltem)[[:space:]]+(?:pro|para[[:space:]]+o|pra)[[:space:]]+seu[[:space:]]+pais([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:judeus?|muculmanos?|imigrantes?|estrangeiros?|gays?|lesbicas?|trans|mulheres?|negros?|pretos?|indigenas?)[[:space:]]+(?:sao|e|eh)[[:space:]]+(?:doentes?|inferiores?|nojentos?|imundos?|parasitas|uma[[:space:]]+praga)([^[:alnum:]_]|$)'
  ];
begin
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 1500 then
    return 'blocked';
  end if;

  if position(chr(128405) in p_text) > 0 then
    return 'blocked';
  end if;

  normalized := public.cae_normalize_chat_text(p_text);
  squeezed := regexp_replace(normalized, '([[:alpha:]])\1+', '\1', 'g');
  punctuation_clean := regexp_replace(normalized, '[[:punct:]_]+', '', 'g');
  punctuation_squeezed := regexp_replace(squeezed, '[[:punct:]_]+', '', 'g');

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
                 spaced_runs || ' ' || squeezed || ' ' || punctuation_squeezed;

  foreach pattern in array direct_insult_patterns loop
    if search_text ~* pattern then return 'blocked'; end if;
  end loop;
  foreach pattern in array targeted_patterns loop
    if search_text ~* pattern then return 'blocked'; end if;
  end loop;
  foreach pattern in array threat_patterns loop
    if search_text ~* pattern then return 'blocked'; end if;
  end loop;
  foreach pattern in array targeted_slur_patterns loop
    if search_text ~* pattern then return 'blocked'; end if;
  end loop;
  foreach pattern in array group_attack_patterns loop
    if search_text ~* pattern then return 'blocked'; end if;
  end loop;

  return 'allow';
end;
$function$;

revoke all on function public.cae_chat_moderation_check(text) from public, anon;
grant execute on function public.cae_chat_moderation_check(text) to authenticated;

create or replace function public.cae_auto_moderate_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = 'off'
as $function$
declare
  normalized text;
  ai_phrases text[] := array[
    'como uma inteligencia artificial',
    'como modelo de linguagem',
    'sou uma ia',
    'texto gerado por ia',
    'aqui esta uma resposta',
    'e importante ressaltar',
    'em suma',
    'em conclusao',
    'neste contexto',
    'espero que isso ajude',
    'espero que esta resposta ajude',
    'caros leitores',
    'conclusao:'
  ];
  pattern text;
  ai_score integer := 0;
  personal_cue boolean;
begin
  if new.body is null then
    raise exception 'CAE_CHAT_BLOCKED';
  end if;

  new.body := btrim(new.body);
  if new.body = '' then
    raise exception 'CAE_CHAT_BLOCKED';
  end if;

  if char_length(new.body) > 1500 then
    raise exception 'CAE_CHAT_TOO_LONG';
  end if;

  if public.cae_chat_moderation_check(new.body) <> 'allow' then
    raise exception 'CAE_CHAT_OFFENSIVE';
  end if;

  normalized := public.cae_normalize_chat_text(new.body);

  foreach pattern in array ai_phrases loop
    if normalized like '%' || pattern || '%' then
      ai_score := ai_score + 1;
    end if;
  end loop;

  personal_cue := normalized ~ '(^|[^[:alnum:]_])(?:eu|meu|minha|meus|minhas|sinto|senti|estou|to|hoje|aconteceu|comigo|pra mim|para mim|acho|penso)([^[:alnum:]_]|$)';

  if char_length(normalized) >= 180 and ai_score >= 3 and not personal_cue then
    raise exception 'CAE_CHAT_LOW_VALUE';
  end if;

  if exists (
    select 1
    from public.cae_chat_messages cm
    where cm.user_id = new.user_id
      and cm.body = new.body
      and cm.created_at >= now() - interval '60 seconds'
  ) then
    raise exception 'CAE_CHAT_SPAM';
  end if;

  if (
    select count(*)
    from public.cae_chat_messages cm
    where cm.user_id = new.user_id
      and cm.created_at >= now() - interval '30 seconds'
  ) >= 7 then
    raise exception 'CAE_CHAT_SPAM';
  end if;

  return new;
end;
$function$;
