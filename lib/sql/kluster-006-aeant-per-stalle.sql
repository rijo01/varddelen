-- ============================================================================
-- Klustret (ymqbimerrvycbknstsai) — foretag_publik.aeant_per_stalle
-- ============================================================================
-- KÖRS I KLUSTRET, som postgres, EFTER att koden som tål båda schemana är ute
-- (lib/storlek.ts provar kolumnen och faller tillbaka på aeant):
--   supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/kluster-006-aeant-per-stalle.sql
--
-- aeant är bolagets antal anställda och står likadant på varje arbetsställe:
-- varje Praktikertjänst-mottagning sorterades som 1 198 anställda.
-- aeant_per_stalle = aeant delat på bolagets antal arbetsställen i registret,
-- avrundat. Enskild firma räknas alltid som ett arbetsställe.
--
-- aesamtable rörs inte. Antalet arbetsställen förberäknas i en materialiserad
-- vy nycklad på cfarnr (bara bolag med fler än ett arbetsställe) och joinas in.
-- Den bär INGET organisationsnummer. Delningen görs i vyn, så en ändrad aeant
-- slår igenom direkt; bara nya eller borttagna arbetsställen kräver REFRESH.
--
-- Mätt i klustret 21 okt 2026 (EXPLAIN ANALYZE, median av fem):
--   frågor som inte läser kolumnen: samma plan, joinen tas bort (unikt index)
--   hubb Stockholm 86909, sorterad på kolumnen: 2,7 → 5,1 ms
--   hela nischen, hela landet, sida 1:          66 → 104 ms
-- Kostnaden är godkänd (Rickard, 21 okt): alternativet var att ändra aesamtable.
-- ============================================================================

-- --- 1. Den materialiserade vyn. Rör inte foretag_publik, ingen lås på den. --
begin;

-- orgnr normaliseras som i foretag_publik.orgnr: samma bolag står i registret
-- både med tio siffror och med sekelprefixet 16 (rättat i 006b; körd i
-- klustret som 006 + 006b, en ny miljö kör bara den här filen).
create materialized view public.arbetsstalle_storlek as
  with nyckel as (
    select cfarnr,
      case
        when length(peorgnr::text) = 12 and "left"(peorgnr::text, 2) = '16' then substr(peorgnr::text, 3)
        else peorgnr::text
      end as orgnr
    from public.aesamtable
    where peorgnr is not null and jurform is distinct from 10
  ),
  stallen as (
    select orgnr, count(*)::integer as antal from nyckel group by orgnr having count(*) > 1
  )
  select n.cfarnr, st.antal
  from nyckel n
  join stallen st on st.orgnr = n.orgnr;

-- Unikt: krävs för join-borttagningen och för refresh ... concurrently.
create unique index arbetsstalle_storlek_cfarnr on public.arbetsstalle_storlek (cfarnr);

-- Inga rättigheter för anon eller authenticated. Default privileges i public
-- ger annars anon och authenticated Dxtm på nya objekt. foretag_publik läser
-- vyn med ägarens (postgres) rätt och behöver inget mer.
revoke all on public.arbetsstalle_storlek from anon, authenticated, public;

comment on materialized view public.arbetsstalle_storlek is
  'Antal arbetsställen per bolag (cfarnr → antal, bara > 1). Inget orgnr. REFRESH när aesamtable laddas om. Kluster 006, varddelen-se/lib/sql.';

do $$
begin
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.arbetsstalle_storlek'::regclass
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0)
  ) then
    raise exception 'anon/authenticated/public har rättigheter på arbetsstalle_storlek';
  end if;
end $$;

commit;

-- --- 2. Vyn. Kort transaktion: låset på foretag_publik hålls i millisekunder,
-- och väntar den mer än 3 s på läsare avbryts den hellre än att köa alla sajter.
begin;
set local lock_timeout = '3s';

-- Kolumnen SIST. Inget befintligt byter namn, typ eller plats.
create or replace view public.foretag_publik as
 SELECT s.id,
    s.cfarnr,
    s.firma,
    s.namn,
    s.gatuadress,
    s.postnr,
    s.postort,
    s.ort,
    s.tel,
    s.telefon,
    s.epostadress,
    s.webb,
    s.lank,
    s.ng1,
    s.branschid,
    s.kommun,
    s.lan,
    s.aeant,
        CASE
            WHEN s.peorgnr IS NULL THEN NULL::text
            WHEN s.jurform = 10 THEN NULL::text
            WHEN length(s.peorgnr::text) = 12 AND "left"(s.peorgnr::text, 2) = '16'::text THEN (substr(s.peorgnr::text, 3, 6) || '-'::text) || substr(s.peorgnr::text, 9, 4)
            WHEN length(s.peorgnr::text) = 10 THEN (substr(s.peorgnr::text, 1, 6) || '-'::text) || substr(s.peorgnr::text, 7, 4)
            ELSE NULL::text
        END AS orgnr,
    s.jurform = 10 AS ar_enskild_firma,
    s.jurform,
    s.search_vector,
    s.infotext,
    s.logotyp,
    s.kontaktperson,
    s.poang,
        CASE
            WHEN s.jurform <> 10 OR s.peorgnr IS NULL THEN NULL::text
            WHEN length(s.peorgnr::text) = 12 AND "left"(s.peorgnr::text, 2) = ANY (ARRAY['19'::text, '20'::text])
              THEN "left"(s.peorgnr::text, 2) || 'XXXXXX-XXXX'::text
            WHEN s.peorgnr::text ~ '^[0-9]{10}$'::text
              THEN CASE WHEN (2000 + substr(s.peorgnr::text, 1, 2)::integer) <= (EXTRACT(year FROM CURRENT_DATE)::integer - 15)
                        THEN '20XXXXXX-XXXX'::text ELSE '19XXXXXX-XXXX'::text END
            ELSE NULL::text
        END AS orgnr_maskerat,
    -- 006 (21 okt 2026): bolagets anställda delat på dess arbetsställen. Sist.
        CASE
            WHEN st.antal IS NULL THEN s.aeant
            ELSE round(s.aeant::numeric / st.antal::numeric)::integer
        END AS aeant_per_stalle
   FROM public.aesamtable s
   LEFT JOIN public.arbetsstalle_storlek st ON st.cfarnr = s.cfarnr;

comment on column public.foretag_publik.aeant_per_stalle is
  'aeant delat på bolagets antal arbetsställen i registret, avrundat. Enskild firma = ett arbetsställe. Kluster 006.';

do $$
begin
  if (select relacl from pg_class where oid = 'public.foretag_publik'::regclass)::text
     <> '{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=m/postgres,service_role=Dxtm/postgres}' then
    raise exception 'rättigheterna på foretag_publik ändrades';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- --- Kontroller efter (läser, låser inget) — körs separat, se
--     lib/sql/kluster-006-kontroll.sql.
--
-- --- Underhåll: när aesamtable laddas om (0 inserts sedan statistiken
--     nollställdes; tabellen skrivs nästan aldrig):
--   refresh materialized view concurrently public.arbetsstalle_storlek;
--   npm run build:index avbryter med det kommandot om vyn är inaktuell.
--
-- --- Tillbaka: create or replace kan inte ta bort en kolumn. I en transaktion:
--   drop view public.foretag_publik; återskapa från skiffer-crm
--   supabase/kluster/004_orgnr_maskerat.sql; grant select, maintain on
--   public.foretag_publik to anon; grant maintain to authenticated; grant
--   delete, truncate, references, trigger to service_role; sedan
--   drop materialized view public.arbetsstalle_storlek. Koden tål det.
