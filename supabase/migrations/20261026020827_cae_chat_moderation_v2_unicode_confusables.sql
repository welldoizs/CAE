do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.cae_chat_extended_moderation_check(text)'::regprocedure);

  definition := replace(
    definition,
    '  symbol_variant text;',
    '  symbol_variant text;' || chr(10) || '  confusable_variant text;'
  );

  definition := replace(
    definition,
    '  symbol_variant := translate(normalized, ''!'', ''i'');',
    '  symbol_variant := translate(normalized, ''!'', ''i'');' || chr(10) ||
    '  confusable_variant := translate(symbol_variant, ' ||
    'chr(1072)||chr(1077)||chr(1110)||chr(1086)||chr(1088)||chr(1089)||chr(1093)||chr(1091)||chr(1075)||chr(945)||chr(949)||chr(953)||chr(959)||chr(961)||chr(1010), ' ||
    '''aeiopcxyr''||''aeiopc'');'
  );

  definition := replace(
    definition,
    '                 spaced_runs || '' '' || squeezed || '' '' || symbol_variant;',
    '                 spaced_runs || '' '' || squeezed || '' '' || symbol_variant || '' '' || confusable_variant;'
  );

  if position('confusable_variant' in definition) = 0
     or position('chr(1072)' in definition) = 0 then
    raise exception 'Could not safely add confusable-character normalization.';
  end if;

  execute definition;
end;
$migration$;
