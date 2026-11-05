-- ============================================================================
-- pilot-006-radera — företagsspärren (kontrakt 1.6) i pilotprojektet (2026-11-05)
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-005. Idempotent.
-- Körs med psql (för \ir), från lib/sql/:
--
--   psql -X -v ON_ERROR_STOP=1 -f pilot-006-radera.sql
--
-- Klustrets tre filer, oförändrade och i den här ordningen:
--
--   1. overlay-radera.sql             overlay_foretag_sparr (RLS på, anon/authenticated
--                                     utan rättigheter), overlay_sparrade_nycklar()
--                                     (service role) och overlay_ar_sparrade() (anon får köra)
--   2. overlay-radera-grants.sql      select, insert för service role (DELETE skriver med den)
--   3. overlay-kontaktsparr-pts.sql   PTS-numret i kolumnkommentaren + självprovet av
--                                     normaliseringen (pilotens kontaktsparr från pilot-003)
--
-- Sist samma vakt som pilot-004, med overlay_ar_sparrade() tillagd bland det anon får köra
-- (kontrakt 1.6: sajtens anon-klient frågar om nycklar är spärrade). Tabellen står INTE på
-- listan över det anon får läsa, så vakten fäller transaktionen om anon når den.
-- ============================================================================
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

\ir overlay-radera.sql
\ir overlay-radera-grants.sql
\ir overlay-kontaktsparr-pts.sql

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
  if has_table_privilege('anon', 'public.overlay_foretag_sparr', 'select')
     or has_table_privilege('authenticated', 'public.overlay_foretag_sparr', 'select') then
    raise exception 'anon/authenticated kan läsa overlay_foretag_sparr';
  end if;
  if not has_table_privilege('service_role', 'public.overlay_foretag_sparr', 'select,insert') then
    raise exception 'service role saknar select/insert på overlay_foretag_sparr';
  end if;
  if not has_table_privilege('service_role', 'public.overlay_profil', 'select,delete') then
    raise exception 'service role saknar select/delete på overlay_profil (DELETE raderar overlay-raderna)';
  end if;
  select string_agg(p.proname, ', ') into x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('kontaktsparr_forfilter', 'overlay_ar_sparrade');
  if x is not null then raise exception 'anon kan köra: %', x; end if;
  if has_function_privilege('anon', 'public.overlay_sparrade_nycklar(text)', 'execute') then
    raise exception 'anon kan lista spärrade nycklar';
  end if;
  raise notice 'pilot-006: spärren på plats; anon når bara foretag_publik, t_bransch, sokordtable, overlay_profil, kontaktsparr_forfilter och overlay_ar_sparrade';
end $$;

commit;
