create or replace function public.cae_chat_moderation_check(p_text text)
returns text
language plpgsql
immutable
security invoker
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
    '^[[:space:]]*(?:idiota|imbecil|babaca|otario|otaria|arrombado|arrombada|canalha|escroto|escrota|desgracado|desgracada|fdp|retardado|retardada|mongol|vagabundo|vagabunda|vadia|piranha|viado|viada|viadinho|bicha|traveco|sapatao|cadela|corno|nojento|nojenta)[.!?,;:[:space:]]*$'
  ];
  targeted_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|seu|sua|teu|tua)[[:space:]]+(?:(?:e|eh|um|uma|parece|vira|fica|ta|esta)[[:space:]]+)?(?:idiota|imbecil|babaca|otario|otaria|arrombado|arrombada|canalha|escroto|escrota|desgracado|desgracada|burro|burra|lixo|verme|inutil|fracassado|fracassada|vagabundo|vagabunda|vadia|piranha|puta|puto|bosta|merda|viado|viada|viadinho|bicha|traveco|sapatao|retardado|retardada|mongol|favelado|macaco|crioulo|cadela|corno|vaca|nojento|nojenta)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces)[[:space:]]+(?:e|eh|um|uma)[[:space:]]+(?:um[[:space:]]+)?(?:animal|monstro|aberacao|lixo)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu|vai[[:space:]]+se[[:space:]]+foder|vai[[:space:]]+pra?[[:space:]]+merda|vai[[:space:]]+se[[:space:]]+lascar|vai[[:space:]]+se[[:space:]]+ferrar|vai[[:space:]]+pro[[:space:]]+inferno|foda-se[[:space:]]+(?:vc|voce)|te[[:space:]]+odeio|quero[[:space:]]+que[[:space:]]+(?:vc|voce)[[:space:]]+morra|tomara[[:space:]]+que[[:space:]]+(?:vc|voce)[[:space:]]+morra|cala[[:space:]]+a[[:space:]]+boca|some[[:space:]]+daqui|se[[:space:]]+mata|vsf|vtnc|tnc)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:manda|envia|me[[:space:]]+passa|me[[:space:]]+mostra)[[:space:]]+(?:uma?[[:space:]]+)?(?:nudes?|packs?|fotos?[[:space:]]+(?:intimas?|pelad[oa]s?))([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:nudes?|packs?)[[:space:]]+(?:gratis|pra[[:space:]]+mim|para[[:space:]]+mim)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:pornhub|xvideos|xhamster|onlyfans)([^[:alnum:]_]|$)'
  ];
  threat_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vou|quero|posso|pretendo)[[:space:]]+(?:te|lhe)[[:space:]]+(?:matar|bater|espancar|agredir|machucar|quebrar|arrebentar)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vou|quero)[[:space:]]+acabar[[:space:]]+com[[:space:]]+(?:vc|voce|tu)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:te[[:space:]]+pego[[:space:]]+na[[:space:]]+saida|vou[[:space:]]+te[[:space:]]+achar|sei[[:space:]]+onde[[:space:]]+voce[[:space:]]+mora|vou[[:space:]]+te[[:space:]]+pegar)([^[:alnum:]_]|$)'
  ];
  targeted_slur_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|seu|sua|teu|tua)[[:space:]]+(?:e|eh|um|uma)?[[:space:]]*(?:viad[oa]s?|viadinh[oa]s?|bich[oa]s?|traveco|sapat[aã]o|retardad[oa]s?|mongol|macaco|crioulo|favelad[oa]s?|vadia|piranha|vagabund[oa]s?|cadela)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:seu|sua|teu|tua)[[:space:]]+(?:macaco|crioulo|viad[oa]|bicha|traveco|sapat[aã]o|retardado|mongol|favelado|vadia|piranha|vagabunda)([^[:alnum:]_]|$)'
  ];
  group_attack_patterns text[] := array[
    '(^|[^[:alnum:]_])(?:negros?|pretos?|pessoas[[:space:]]+negras?|brancos?|indigenas?|quilombolas?|judeus?|muculmanos?|islamicos?|cristaos?|ateus?|mulheres?|homens?|gays?|lesbicas?|bissexuais?|pessoas[[:space:]]+lgbtq?ia?\\+?|trans|travestis?|pessoas[[:space:]]+trans|autistas?|pessoas[[:space:]]+com[[:space:]]+deficiencia|pcds?|imigrantes?|estrangeiros?|nordestinos?|asiaticos?|ciganos?)[[:space:]]+(?:sao|e|eh)[[:space:]]+(?:burros?|burras?|idiotas?|inferiores?|incapazes|imundos?|nojentos?|nojentas?|sujos?|sujas?|vagabundos?|vagabundas?|vadias?|preguicosos?|preguicosas?|criminosos?|criminosas?|parasitas|lixo|uma[[:space:]]+praga|doentes?|degenerados?|degeneradas?|aberra[cç][aã]o)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:negros?|pretos?|pessoas[[:space:]]+negras?|indigenas?|quilombolas?|judeus?|muculmanos?|islamicos?|mulheres?|homens?|gays?|lesbicas?|bissexuais?|trans|travestis?|imigrantes?|estrangeiros?|nordestinos?|asiaticos?|ciganos?)[[:space:]]+(?:merecem|deveriam|devem|tem[[:space:]]+que|precisam)[[:space:]]+(?:sumir|morrer|ser[[:space:]]+mortos?|ser[[:space:]]+eliminad[oa]s?|desaparecer|nao[[:space:]]+deviam[[:space:]]+existir)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:todos|todas|esse[[:space:]]+povo|essa[[:space:]]+gente)[[:space:]]+(?:deveriam|deviam|tem[[:space:]]+que|precisam)[[:space:]]+(?:morrer|sumir|ser[[:space:]]+eliminad[oa]s?|desaparecer)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:volta|voltem)[[:space:]]+(?:pro|para[[:space:]]+o|pra)[[:space:]]+seu[[:space:]]+pais([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:judeus?|muculmanos?|imigrantes?|estrangeiros?|gays?|lesbicas?|trans|mulheres?|negros?|pretos?|indigenas?)[[:space:]]+(?:sao|e|eh)[[:space:]]+(?:doentes?|inferiores?|nojentos?|imundos?|parasitas|uma[[:space:]]+praga)([^[:alnum:]_]|$)'
  ];
begin
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 1500 then return 'blocked'; end if;
  if position(chr(128405) in p_text) > 0 then return 'blocked'; end if;
  normalized := public.cae_normalize_chat_text(p_text);
  squeezed := regexp_replace(normalized, '([[:alpha:]])\1+', '\1', 'g');
  punctuation_clean := regexp_replace(normalized, '[[:punct:]_]+', '', 'g');
  punctuation_squeezed := regexp_replace(squeezed, '[[:punct:]_]+', '', 'g');
  for token in select value from regexp_split_to_table(punctuation_clean, '[[:space:]]+') as parts(value) loop
    if char_length(token) = 1 and token ~ '^[[:alnum:]]$' then
      current_run := current_run || token;
    else
      if char_length(current_run) >= 3 then spaced_runs := spaced_runs || ' ' || current_run; end if;
      current_run := '';
      spaced_runs := spaced_runs || ' ' || token;
    end if;
  end loop;
  if char_length(current_run) >= 3 then spaced_runs := spaced_runs || ' ' || current_run; end if;
  search_text := normalized || ' ' || punctuation_clean || ' ' || spaced_runs || ' ' || squeezed || ' ' || punctuation_squeezed;
  foreach pattern in array direct_insult_patterns loop if search_text ~* pattern then return 'blocked'; end if; end loop;
  foreach pattern in array targeted_patterns loop if search_text ~* pattern then return 'blocked'; end if; end loop;
  foreach pattern in array threat_patterns loop if search_text ~* pattern then return 'blocked'; end if; end loop;
  foreach pattern in array targeted_slur_patterns loop if search_text ~* pattern then return 'blocked'; end if; end loop;
  foreach pattern in array group_attack_patterns loop if search_text ~* pattern then return 'blocked'; end if; end loop;
  return 'allow';
end;
$function$;