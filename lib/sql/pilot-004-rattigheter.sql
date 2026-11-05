-- ============================================================================
-- pilot-004-rattigheter — samma rättigheter som klustret, i ett nytt Supabase-projekt
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-003. Idempotent.
--
-- Ett nytt Supabase-projekt har `alter default privileges` som ger anon och
-- authenticated ALLA rättigheter på nya tabeller, sekvenser och funktioner i
-- public. Klustret (ymqb) har det inte — overlay-hardening-002 utgår från det.
-- Utan den här filen får anon INSERT/UPDATE/DELETE/TRUNCATE på overlay_profil
-- (RLS stoppar skrivningen, men rättigheten ska inte finnas) och EXECUTE på
-- funktioner som inte är till för den.
--
-- Efter filen når anon och authenticated BARA:
--   SELECT på foretag_publik, t_bransch, sokordtable, overlay_profil (RLS: status = 'aktiv')
--   EXECUTE på kontaktsparr_forfilter (ren funktion, som i klustret)
-- ============================================================================

-- Framtida objekt: inga automatiska rättigheter för anon/authenticated.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

-- Befintliga objekt.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- Den publika ytan.
grant select on public.foretag_publik, public.t_bransch, public.sokordtable, public.overlay_profil to anon, authenticated;
grant execute on function public.kontaktsparr_forfilter(text, text) to anon, authenticated;

-- service_role: det endpointen och matningen behöver (RLS kringgås av service_role).
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Kontroll: faller om anon når något utöver den publika ytan.
do $$
declare x text;
begin
  select string_agg(c.relname, ', ') into x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S')
     and (has_table_privilege('anon', c.oid, 'insert,update,delete,truncate,references,trigger')
          or (has_table_privilege('anon', c.oid, 'select')
              and c.relname not in ('foretag_publik', 't_bransch', 'sokordtable', 'overlay_profil')));
  if x is not null then raise exception 'anon når för mycket: %', x; end if;
  select string_agg(p.proname, ', ') into x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> 'kontaktsparr_forfilter';
  if x is not null then raise exception 'anon kan köra: %', x; end if;
  raise notice 'pilot-004: anon når bara foretag_publik, t_bransch, sokordtable, overlay_profil (aktiva) och kontaktsparr_forfilter';
end $$;
