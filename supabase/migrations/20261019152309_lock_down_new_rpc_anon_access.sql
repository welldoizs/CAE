-- Keep the new privileged CAE RPCs unavailable to anonymous clients.
-- Authenticated users can call them; each function validates auth.uid()/staff status.
revoke execute on function public.cae_is_staff() from anon;
revoke execute on function public.cae_submit_content_report(text, uuid, text, text) from anon;
revoke execute on function public.cae_request_account_deletion() from anon;
