-- ============================================================================
-- pilot-003-kontaktsparr — kontaktsparr_berorda() mot pilotens register
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-002.
-- Samma kontrakt som klustrets kontaktsparr-kluster.sql (samma signatur, samma
-- retur, samma mönster ur kontaktsparr_monster), men källorna är pilotens:
--   vd_kundinnehall  infotext, kontaktperson, webb (de enda fritextfälten som
--                    kan bära ett nummer eller en adress — registret har inga
--                    telefonnummer eller e-postadresser)
--   vd_foretag       firma, gatuadress (registret bär inga kontaktuppgifter, men
--                    en spärrad uppgift ska inte kunna stå i ett namn eller en adress
--                    utan att synas här)
--   sokordtable      sokord, sokordsbanner
--   overlay_profil   samma fält som i klustret
-- Registret är ~50 000 rader: ingen trigramindex behövs, förfiltret räcker.
-- ============================================================================

create or replace function kontaktsparr_forfilter(p_typ text, p_text text)
returns text language sql immutable parallel safe as $$
  select case when p_typ = 'telefon'
              then regexp_replace(replace(p_text, '&#160;', ''), '[^0-9|]', '', 'g')
              else lower(p_text) end
$$;

create or replace function kontaktsparr_kontrollerad_nyckel(p_typ text, p_nyckel text)
returns text language plpgsql immutable parallel safe as $$
begin
  if p_typ not in ('telefon','epost') then
    raise exception 'kontaktsparr: okänd typ %', p_typ;
  end if;
  if p_nyckel is distinct from (case p_typ when 'telefon' then kontakt_normalisera_telefon(p_nyckel)
                                           else kontakt_normalisera_epost(p_nyckel) end) then
    raise exception 'kontaktsparr: nyckeln är inte normaliserad';
  end if;
  return p_nyckel;
end;
$$;

create or replace function kontaktsparr_nal(p_typ text, p_nyckel text)
returns text language sql immutable parallel safe as $$
  select case when p_typ = 'telefon' and left(p_nyckel, 2) = '46' then substr(p_nyckel, 3) else p_nyckel end
$$;

create or replace function kontaktsparr_berorda(p_typ text, p_nyckel text)
returns table (kalla text, falt text, cfarnr bigint, sajt text, entity_type text, external_id text)
language plpgsql stable set search_path = public
as $fn$
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
end;
$fn$;

revoke all on function kontaktsparr_kontrollerad_nyckel(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_kontrollerad_nyckel(text, text) to service_role;
revoke all on function kontaktsparr_nal(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_nal(text, text) to service_role;
grant execute on function kontaktsparr_forfilter(text, text) to public;
revoke all on function kontaktsparr_berorda(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_berorda(text, text) to service_role;

comment on function kontaktsparr_berorda(text, text) is
  'Var i varddelens pilotregister en kontaktuppgift står (källa, fält, identitet — aldrig värdet). Läser, skriver aldrig. Endast service role.';
