-- ============================================================================
-- Klustret — rättelse av kluster-006: arbetsställen räknas per NORMALISERAT orgnr
-- ============================================================================
-- 006 grupperade på peorgnr som det står i aesamtable. Samma bolag står där i
-- två former: tio siffror ("2120000142") och tolv med sekelprefixet 16
-- ("162120000142"). foretag_publik.orgnr normaliserar redan bort prefixet, men
-- arbetsstalle_storlek gjorde det inte — ett bolags arbetsställen delades i två
-- grupper och fick för lågt antal, eller inget alls. build:index upptäckte det
-- (52 arbetsställen i nischen) direkt efter 006.
--
-- Bytet: ny materialiserad vy under tillfälligt namn → foretag_publik pekas om
-- (kolumnerna oförändrade, låset i millisekunder) → den gamla droppas → den nya
-- tar namnet. Vyn refererar på OID, så namnbytet rör den inte.
-- ============================================================================

begin;

create materialized view public.arbetsstalle_storlek_ny as
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

create unique index arbetsstalle_storlek_ny_cfarnr on public.arbetsstalle_storlek_ny (cfarnr);
revoke all on public.arbetsstalle_storlek_ny from anon, authenticated, public;

commit;

begin;
set local lock_timeout = '3s';

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
   LEFT JOIN public.arbetsstalle_storlek_ny st ON st.cfarnr = s.cfarnr;

drop materialized view public.arbetsstalle_storlek;
alter materialized view public.arbetsstalle_storlek_ny rename to arbetsstalle_storlek;
alter index public.arbetsstalle_storlek_ny_cfarnr rename to arbetsstalle_storlek_cfarnr;

comment on materialized view public.arbetsstalle_storlek is
  'Antal arbetsställen per bolag (cfarnr → antal, bara > 1), orgnr normaliserat (16-prefixet bort). Inget orgnr. REFRESH när aesamtable laddas om. Kluster 006/006b, varddelen-se/lib/sql.';

do $$
begin
  if (select relacl from pg_class where oid = 'public.foretag_publik'::regclass)::text
     <> '{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=m/postgres,service_role=Dxtm/postgres}' then
    raise exception 'rättigheterna på foretag_publik ändrades';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
