-- CAE chat filter v3 hardening: preserve repeated letters and recognize more Unicode lookalikes.
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
    'burro','burra','burros','burras',
    'estupido','estupida','estupidos','estupidas',
    'idiota','idiotas','imbecil','imbecis',
    'babaca','babacas','otario','otaria','otarios','otarias',
    'cretino','cretina','cretinos','cretinas',
    'ridiculo','ridicula','ridiculos','ridiculas',
    'patetico','patetica','ignorante','incompetente',
    'fracassado','fracassada','inutil','nojento','nojenta',
    'vagabundo','vagabunda','vadia','piranha','arrombado','arrombada',
    'canalha','escroto','escrota','desgracado','desgracada',
    'retardado','retardada','mongol','mongoloide',
    'lixo','verme','besta','asqueroso','asquerosa','escoria',
    'desprezivel','palhaco','paspalho',
    'dumb','stupid','idiot','moron','loser','asshole','bitch','jerk',
    'creep','scum','freak','worthless','pathetic'
  ];
  insult_pattern text;
  fuzzy_insult_pattern text;
  targeted_patterns text[];
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' OR char_length(p_text) > 1500 THEN
    RETURN 'blocked';
  END IF;

  -- Normalize accents and common evasion symbols while preserving doubled letters.
  normalized := btrim(
    regexp_replace(
      regexp_replace(
        translate(
          lower(
            translate(
              translate(
                coalesce(p_text, ''),
                chr(8203)||chr(8204)||chr(8205)||chr(65279)||chr(173)||
                chr(8206)||chr(8207)||chr(8234)||chr(8235)||chr(8236)||
                chr(8237)||chr(8238)||chr(8288),
                ''
              ),
              'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
              'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
            )
          ),
          '@43015$78|9',
          'aaeoiistbig'
        ),
        '([[:alpha:]])\1{2,}',
        '\1\1',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );

  squeezed := regexp_replace(normalized, '([[:alpha:]])\1+', '\1', 'g');
  punctuation_clean := regexp_replace(normalized, '[[:punct:]_]+', '', 'g');
  punctuation_squeezed := regexp_replace(squeezed, '[[:punct:]_]+', '', 'g');
  symbol_variant := translate(normalized, '@$!|01345789', 'asiioieastbg');
  confusable_variant := translate(
    symbol_variant,
    chr(1072)||chr(1077)||chr(1110)||chr(1086)||chr(1088)||chr(1089)||chr(1093)||chr(1091)||chr(1075)||
    chr(945)||chr(949)||chr(953)||chr(959)||chr(961)||chr(1010)||
    chr(1109)||chr(963)||chr(962),
    'aeiopcxyr'||'aeiopc'||'sss'
  );
  compacted_message := regexp_replace(normalized, '[^[:alnum:]]+', '', 'g');
  compacted_squeezed := regexp_replace(squeezed, '[^[:alnum:]]+', '', 'g');

  FOR token IN
    SELECT value FROM regexp_split_to_table(punctuation_clean, '[[:space:]]+') AS parts(value)
  LOOP
    IF char_length(token) = 1 AND token ~ '^[[:alnum:]]$' THEN
      current_run := current_run || token;
    ELSE
      IF char_length(current_run) >= 3 THEN
        spaced_runs := spaced_runs || ' ' || current_run;
      END IF;
      current_run := '';
      spaced_runs := spaced_runs || ' ' || token;
    END IF;
  END LOOP;
  IF char_length(current_run) >= 3 THEN
    spaced_runs := spaced_runs || ' ' || current_run;
  END IF;

  search_text := normalized || ' ' || punctuation_clean || ' ' ||
                 punctuation_squeezed || ' ' || squeezed || ' ' ||
                 symbol_variant || ' ' || confusable_variant || ' ' || spaced_runs;
  insult_pattern := array_to_string(insult_words, '|');
  fuzzy_insult_pattern := regexp_replace(insult_pattern, '([[:alpha:]])', '\1+', 'g');

  -- Explicitly negated reassurance is not treated as an insult.
  IF normalized ~* (
    '^(?:vc|voce|tu|you|u|ele|ela)[[:space:]]+' ||
    '(?:(?:e|eh|es|are|is|r)[[:space:]]+)?' ||
    '(?:nao|not|never)[[:space:]]+' ||
    '(?:(?:e|eh|es|are|is)[[:space:]]+)?' ||
    '(?:(?:um|uma|a|an)[[:space:]]+)?(?:' || insult_pattern || ')[[:space:][:punct:]]*$'
  ) THEN
    RETURN 'allow';
  END IF;

  IF compacted_message ~* ('^(' || fuzzy_insult_pattern || ')$')
     OR compacted_squeezed ~* ('^(' || insult_pattern || ')$')
     OR regexp_replace(symbol_variant, '[^[:alnum:]]+', '', 'g') ~* ('^(' || fuzzy_insult_pattern || ')$')
     OR regexp_replace(confusable_variant, '[^[:alnum:]]+', '', 'g') ~* ('^(' || fuzzy_insult_pattern || ')$')
  THEN
    RETURN 'blocked';
  END IF;

  targeted_patterns := ARRAY[
    '(^|[^[:alnum:]_])(?:vc|voce|tu|vcs|voces|you|u|he|she|they|ele|ela|esse[[:space:]]+cara|essa[[:space:]]+pessoa|aquele[[:space:]]+cara|aquela[[:space:]]+pessoa)[[:space:]]+(?:(?:e|eh|es|are|is|r|um|uma|a|an|muito|muita|bem|really|very|so|such|esta|ta|parece)[[:space:]]+){0,4}(?:' || fuzzy_insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:seu|sua|teu|tua|your)[[:space:]]+(?:' || fuzzy_insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:para[[:space:]]+de[[:space:]]+ser|pare[[:space:]]+de[[:space:]]+ser|stop[[:space:]]+being)[[:space:]]+(?:an?[[:space:]]+)?(?:' || fuzzy_insult_pattern || ')([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vai[[:space:]]+se[[:space:]]+(?:foder|ferrar|lascar)|vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu|vai[[:space:]]+pra?[[:space:]]+merda|fuck[[:space:]]+you|fuck[[:space:]]+off|shut[[:space:]]+up|go[[:space:]]+to[[:space:]]+hell|drop[[:space:]]+dead)([^[:alnum:]_]|$)'
  ];

  FOREACH pattern IN ARRAY targeted_patterns LOOP
    IF search_text ~* pattern THEN
      RETURN 'blocked';
    END IF;
  END LOOP;

  RETURN 'allow';
END;
$function$;
