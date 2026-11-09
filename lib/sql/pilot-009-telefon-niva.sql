-- ============================================================================
-- pilot-009-telefon-niva — "kund" avgörs av profilnivån (kontrakt 1.7)
-- ============================================================================
-- Körs i varddelen-projektet (babenztvwzaiesducpja), efter pilot-007/008 och
-- EFTER koden som tar emot kalla = 'kontakt' (src/lib/telefon.ts):
--   supabase db query --linked --project-ref babenztvwzaiesducpja -f lib/sql/pilot-009-telefon-niva.sql
-- Idempotent. Ändrar bara vd_telefon_valj() (create or replace behåller
-- rättigheterna; vd_telefon_visa och vd_har_telefon läser genom den).
--
-- VARFÖR: pilot-007 räknade VARJE aktiv overlay-rad som kund. Från 1.7 kan en
-- rad vara en kontaktorder (profilnivå "kontakt": bolagets egna publika
-- uppgifter, inte en kund). Då hade en enskild firma med bara en kontaktrad
-- och utan eget nummer fått sitt SCB-mobilnummer visat — det får bara en kund.
--
-- Regler (beslut 2026-11-10):
--   Kund = aktiv rad med profilnivå 'betald' eller 'gratis'. Saknad nivå (rad
--   från före 1.7, eller kolumnen finns inte än) = betald = kund. Okänt värde
--   = kontakt (som tolkaProfilniva i lib/overlay-contract.ts).
--   1. Kund: kundens eget nummer, annars SCB AFR (också mobil för en EF).
--   2. Bara en kontaktrad: BARA numret i kontaktpaketet. Aldrig registrets
--      nummer, aldrig ett SCB-mobilnummer. Inget nummer i paketet = inget.
--   3. Ingen rad: SCB AFR; enskild firma bara fast nummer.
--   Kontaktspärren gäller alltid.
--
-- Nivån läses via to_jsonb(o)->>'profilniva', så funktionen fungerar både före
-- och efter overlay-v1.7.sql i det här projektet.
-- ============================================================================
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vd_telefon_valj(p_cfarnr bigint)
 RETURNS TABLE(telefon_norm text, kalla text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ef       boolean;
  har_rad  boolean;
  niva     text;
  kund     boolean;
  eget     text;
  afr      record;
begin
  select v.ar_enskild_firma into ef from vd_foretag v where v.cfarnr = p_cfarnr and v.publicerad;
  if not found then return; end if;
  select kontakt_normalisera_telefon(nullif(btrim(o.telefon_override), '')), true, to_jsonb(o)->>'profilniva'
    into eget, har_rad, niva
    from overlay_profil o
   where o.sajt = 'varddelen' and o.status = 'aktiv' and o.external_id = p_cfarnr::text
   order by o.revision desc limit 1;
  har_rad := coalesce(har_rad, false);
  -- Kundfrågan går via profilnivån, aldrig via "det finns en rad".
  kund := har_rad and (niva is null or niva in ('betald', 'gratis'));

  -- 2. Bara en kontaktrad: numret i kontaktpaketet, eller inget.
  if har_rad and not kund then
    if eget is not null and not vd_telefon_sparrad(eget) then
      telefon_norm := eget; kalla := 'kontakt'; return next;
    end if;
    return;
  end if;

  -- 1. Kundens eget nummer (valfri typ, också för enskild firma).
  if kund and eget is not null and not vd_telefon_sparrad(eget) then
    telefon_norm := eget; kalla := 'kund'; return next; return;
  end if;

  -- 1/3. SCB AFR. Enskild firma som inte är kund: bara fast nummer.
  select t.telefon_norm, t.typ into afr from vd_telefon t where t.cfarnr = p_cfarnr;
  if found and not vd_telefon_sparrad(afr.telefon_norm)
     and not (ef and not kund and afr.typ = 'mobil') then
    telefon_norm := afr.telefon_norm; kalla := 'scb-afr'; return next;
  end if;
end $function$;
