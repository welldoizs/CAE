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
          '@43015$78|9',
          'aaeoiistbig'
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