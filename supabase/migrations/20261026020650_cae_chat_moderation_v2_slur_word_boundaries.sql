do $migration$
declare
  definition text;
  start_pos integer;
  end_pos integer;
  loop_end constant text := '  end loop;';
begin
  definition := pg_get_functiondef('public.cae_chat_moderation_check(text)'::regprocedure);
  start_pos := strpos(definition, '  foreach pattern in array slur_words loop');
  if start_pos = 0 then
    raise exception 'Expected legacy slur loop was not found; refusing to alter the function.';
  end if;

  end_pos := strpos(substring(definition from start_pos), loop_end) + start_pos - 1;
  if end_pos < start_pos then
    raise exception 'Could not find end of legacy slur loop; refusing to alter the function.';
  end if;

  definition :=
    substring(definition from 1 for start_pos - 1) ||
    substring(definition from end_pos + char_length(loop_end));

  execute definition;
end;
$migration$;
