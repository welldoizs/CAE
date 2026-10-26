alter function public.cae_chat_moderation_check(text) security invoker;
revoke all on function public.cae_normalize_chat_text(text) from public, anon;
grant execute on function public.cae_normalize_chat_text(text) to authenticated;
revoke all on function public.cae_chat_moderation_check(text) from public, anon;
grant execute on function public.cae_chat_moderation_check(text) to authenticated;
