-- Improve Portuguese target and modifier coverage in contextual chat moderation.
CREATE OR REPLACE FUNCTION public.cae_chat_context_moderation_check(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  normalized text;
  pattern text;
  patterns text[] := ARRAY[
    '(^|[^[:alnum:]_])(?:you|u|youre|he|hes|she|shes|they|theyre|that person|that guy|that girl|this person|this guy|this girl)[[:space:]]+(?:(?:are|is|r|be|being)[[:space:]]+)?(?:(?:a|an|really|very|so|such|fucking|fuckin|freaking|frigging|damn|goddamn|total|complete|absolute|stupid|dumb|bloody)[[:space:]]+){0,7}(?:idiot|idiots|stupid|dumb|moron|morons|asshole|assholes|bitch|bitches|jerk|jerks|loser|losers|imbecile|imbeciles|piece[[:space:]]+of[[:space:]]+shit)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:vc|voce|voces|tu|ele|ela|aquele[[:space:]]+cara|aquela[[:space:]]+garota|aquela[[:space:]]+pessoa|esse[[:space:]]+cara|essa[[:space:]]+garota|essa[[:space:]]+pessoa)[[:space:]]+(?:(?:e|eh|es|are|is|r)[[:space:]]+)?(?:(?:um|uma|a|an|muito|muita|bem|super|extremamente|completamente|fucking|really|very|so|such|freaking|totalmente)[[:space:]]+){0,7}(?:idiota|imbecil|burro|burra|estupido|estupida|babaca|otario|otaria|cretino|cretina|ridiculo|ridicula|patetico|patetica|incompetente|fracassado|fracassada|inutil|nojento|nojenta|dumb|stupid|idiot|moron|asshole|bitch|jerk)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:seu|sua|teu|tua|your)[[:space:]]+(?:(?:fucking|freaking|damn|total|complete)[[:space:]]+){0,3}(?:idiota|imbecil|burro|burra|estupido|estupida|babaca|otario|otaria|dumb|stupid|idiot|moron|asshole|bitch|jerk)([^[:alnum:]_]|$)',
    '(^|[^[:alnum:]_])(?:fuck[[:space:]]+you|fuck[[:space:]]+off|go[[:space:]]+fuck[[:space:]]+yourself|you[[:space:]]+can[[:space:]]+go[[:space:]]+to[[:space:]]+hell|vai[[:space:]]+se[[:space:]]+foder|vai[[:space:]]+tomar[[:space:]]+no[[:space:]]+cu)([^[:alnum:]_]|$)'
  ];
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' OR char_length(p_text) > 1500 THEN
    RETURN 'blocked';
  END IF;
  normalized := public.cae_normalize_chat_text(p_text);
  FOREACH pattern IN ARRAY patterns LOOP
    IF normalized ~* pattern THEN
      RETURN 'blocked';
    END IF;
  END LOOP;
  RETURN 'allow';
END;
$function$;

REVOKE ALL ON FUNCTION public.cae_chat_context_moderation_check(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cae_chat_context_moderation_check(text) TO authenticated;
