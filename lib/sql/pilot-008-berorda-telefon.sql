-- ============================================================================
-- pilot-008-berorda-telefon — kontaktsparr_berorda() hittar även vd_telefon
-- KÖRD i varddelen 2026-11-09. Körs i varddelen-projektet (babenztvwzaiesducpja):
--   psql -X -v ON_ERROR_STOP=1 -1 -f lib/sql/pilot-008-berorda-telefon.sql
-- Idempotent. Ändrar bara funktionen (create or replace behåller rättigheterna).
--
-- VARFÖR: pilot-007 införde vd_telefon (AFR-nummer bakom "Visa nummer"). En
-- kontaktspärr stoppar numret direkt i /api/telefon (kontrollen görs vid varje
-- läsning), men företagssidan är ISR (24 h) och revalideras bara för de
-- cfarnr som kontaktsparr_berorda() returnerar. Utan grenen nedan ligger
-- "Visa nummer"-knappen kvar på en spärrad firmas sida i upp till ett dygn.
-- Grenen jämför den normaliserade nyckeln exakt (telefon_norm är normaliserad
-- av samma funktion), så den behöver inget förfilter.
-- ============================================================================
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.kontaktsparr_berorda(p_typ text, p_nyckel text)
 RETURNS TABLE(kalla text, falt text, cfarnr bigint, sajt text, entity_type text, external_id text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  k   text := kontaktsparr_kontrollerad_nyckel(p_typ, p_nyckel);
  m   text := kontaktsparr_monster(p_typ, k);
  nal text := '%' || kontaktsparr_nal(p_typ, k) || '%';
begin
  return query execute format($q$
  select 'vd_kundinnehall'::text, f.falt, c.cfarnr, null::text, null::text, null::text
    from vd_kundinnehall c
    cross join lateral (values ('infotext', c.infotext), ('kontaktperson', c.kontaktperson), ('webb', c.webb)) f(falt, v)
   where kontaktsparr_forfilter(%1$L, f.v) like %2$L and f.v ~* %3$L
  $q$, p_typ, nal, m);

  return query execute format($q$
  select 'vd_foretag'::text, f.falt, a.cfarnr, null::text, null::text, null::text
    from vd_foretag a
    cross join lateral (values ('firma', a.firma), ('gatuadress', a.gatuadress)) f(falt, v)
   where kontaktsparr_forfilter(%1$L, f.v) like %2$L and f.v ~* %3$L
  $q$, p_typ, nal, m);

  return query execute format($q$
  select 'sokordtable'::text, 'sokord'::text, s.cfarnr, null::text, null::text, null::text
    from sokordtable s
   where kontaktsparr_forfilter(%1$L, coalesce(s.sokord, '') || '|' || coalesce(s.sokordsbanner, '')) like %2$L
     and (s.sokord ~* %3$L or s.sokordsbanner ~* %3$L)
  $q$, p_typ, nal, m);

  return query execute format($q$
  select 'overlay_profil'::text, f.falt,
         case when o.entity_type = 'arbetsstalle' then nullif(regexp_replace(o.external_id, '\D', '', 'g'), '')::bigint end,
         o.sajt, o.entity_type, o.external_id
    from overlay_profil o
    cross join lateral (values
      ('telefon_override', o.telefon_override), ('epost_override', o.epost_override),
      ('kontaktperson', o.kontaktperson), ('info_html', o.info_html),
      ('keywords', o.keywords::text), ('bas', o.bas::text)
    ) f(falt, v)
   where o.status in ('aktiv','utkast')
     and kontaktsparr_forfilter(%1$L, f.v) like %2$L and f.v ~* %3$L
  $q$, p_typ, nal, m);

  -- pilot-008: AFR-numret bakom "Visa nummer" (exakt, normaliserad nyckel).
  if p_typ = 'telefon' then
    return query
    select 'vd_telefon'::text, 'telefon'::text, t.cfarnr, null::text, null::text, null::text
      from vd_telefon t
     where t.telefon_norm = k;
  end if;
end;
$function$;

do $$
declare n int;
begin
  -- Bevis: en spärr på ett nummer i vd_telefon ger företaget som berört.
  select count(*) into n from (select t.telefon_norm, t.cfarnr from vd_telefon t limit 1) x
   where exists (select 1 from kontaktsparr_berorda('telefon', x.telefon_norm) b
                  where b.kalla = 'vd_telefon' and b.cfarnr = x.cfarnr);
  if (select count(*) from vd_telefon) > 0 and n <> 1 then
    raise exception 'pilot-008: kontaktsparr_berorda hittar inte vd_telefon';
  end if;
  raise notice 'pilot-008: kontaktsparr_berorda täcker vd_telefon';
end $$;
