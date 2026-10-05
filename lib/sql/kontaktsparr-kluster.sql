-- ============================================================================
-- kontaktsparr_berorda() — var i KLUSTRET en kontaktuppgift står
-- ============================================================================
-- Körs EN gång i klustrets Supabase (ymqbimerrvycbknstsai), efter
-- overlay-kontaktsparr.sql. Filen är identisk i hantverkardelen, vårddelen och
-- regionsdelen — det är samma databas.
--
-- Mottagaren anropar funktionen när en spärr läggs eller hävs, för att veta
-- vilka sidor som ska revalideras. Den LÄSER registret och skriver ingenting:
-- `aesamtable` och `sokordtable` är read-only, undantagslöst.
--
-- Returnerar bara VAR uppgiften står (källa, fält, identitet) — aldrig själva
-- värdet och aldrig `peorgnr`. Den som anropar ska kunna revalidera och
-- räkna, inte läsa av registret.
--
-- Mönstret är kontraktets: kontaktsparr_monster() ur overlay-kontaktsparr.sql,
-- samma sträng som sajten skrubbar med vid rendering. Det som hittas här är
-- alltså exakt det som döljs där.
--
-- Fälten: alla kolumner i aesamtable som kan bära ett nummer eller en adress,
-- också de som INTE är publika (tel2, mobil1 …). De syns inte på sajterna i dag,
-- men en spärr ska kunna redovisa var uppgiften fanns, och en framtida vy som
-- börjar visa dem ska inte kunna föra fram ett spärrat nummer.
--
-- FÖRFILTRET, och varför det är fullständigt. Mönstret med lookbehind tar
-- ~10 s över 846 000 rader — för länge för PostgREST (8 s) och för CRM:ets
-- väntan på mottagaren. Förfiltret är billigt och missar ingenting:
--
--   telefon: mönstrets avgränsare är alltid ICKE-siffror (`&#160;` tas bort
--            först, det enda med siffror i). Varje träff innehåller därför
--            numrets siffror i följd när allt utom siffror strippats. `|` får
--            stå kvar som fältgräns, så slutet av ett fält och början av nästa
--            aldrig bildar ett nummer tillsammans.
--   epost:   nyckeln är gemener och mönstret en bokstavlig adress, så en
--            `like` på gemener är en övermängd.
--
-- Det exakta mönstret körs sedan bara på raderna som släpptes igenom. Det gäller
-- alla fyra källorna: mönstret med lookbehind över sokordtables 45 000 rader
-- tog ensamt över en sekund.
-- ============================================================================

-- Telefon: bara siffror och fältgränser kvar. E-post: gemener.
create or replace function kontaktsparr_forfilter(p_typ text, p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select case when p_typ = 'telefon'
              then regexp_replace(replace(p_text, '&#160;', ''), '[^0-9|]', '', 'g')
              else lower(p_text) end
$$;

-- ── Indexet ─────────────────────────────────────────────────────────────────
-- Siffrorna i alla kontaktbärande kolumner, med `|` som fältgräns — samma
-- uttryck som förfiltret. Ett trigramindex på det gör `like '%705096502%'` till
-- ett indexuppslag i stället för en skanning av 846 000 rader.
--
-- Varför det behövs: CRM:et når klustret med ANON-nyckeln (grundprincip 4 — inga
-- databasnycklar till sajterna), och anon har statement_timeout 3 s. Skanningen
-- tar 2,5–4 s. Utan indexet hade crm_sok_kontakt() avbrutits i hälften av fallen.
--
-- Ett index är inte en ändring av källdata: inga rader skrivs, och regionsdelen
-- har sedan tidigare ett uttrycksindex på aesamtable (sok-orgnr-prefix-index.sql).
-- Funktionen tar kolumnerna som argument, inte raden, och är immutable —
-- concat_ws är det inte, därav den uttryckliga sammanfogningen. Anropen är
-- schemakvalificerade: ett indexbygge kör med search_path = pg_catalog.
create or replace function kontaktsparr_siffror(
  p1 text, p2 text, p3 text, p4 text, p5 text, p6 text,
  p7 text, p8 text, p9 text, p10 text, p11 text, p12 text)
returns text
language sql
immutable
parallel safe
as $$
  select public.kontaktsparr_forfilter('telefon',
    coalesce(p1,'') || '|' || coalesce(p2,'') || '|' || coalesce(p3,'') || '|' ||
    coalesce(p4,'') || '|' || coalesce(p5,'') || '|' || coalesce(p6,'') || '|' ||
    coalesce(p7,'') || '|' || coalesce(p8,'') || '|' || coalesce(p9,'') || '|' ||
    coalesce(p10,'') || '|' || coalesce(p11,'') || '|' || coalesce(p12,''))
$$;

-- CREATE INDEX CONCURRENTLY i en egen sats, utanför transaktion: tabellen läses
-- av tre sajter och ska inte låsas för skrivning medan indexet byggs.
-- (Kör filen med psql eller satsvis; i en transaktion faller just den här raden.)

-- Kastar om nyckeln inte är normaliserad enligt kontraktet. Ett tyst noll
-- träffar på en felskriven nyckel hade sett ut som "numret finns ingenstans".
create or replace function kontaktsparr_kontrollerad_nyckel(p_typ text, p_nyckel text)
returns text
language plpgsql
immutable
parallel safe
as $$
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

-- Det förfiltret letar efter: siffrorna efter landskoden, eller adressen.
create or replace function kontaktsparr_nal(p_typ text, p_nyckel text)
returns text
language sql
immutable
parallel safe
as $$
  select case when p_typ = 'telefon' and left(p_nyckel, 2) = '46' then substr(p_nyckel, 3) else p_nyckel end
$$;

-- HUR FRÅGAN KÖRS, och varför det spelar roll. Mätt i klustret 2026-10-05:
--
--   samma fråga med mönstret som KONSTANT, parallell skanning   ~2,5–3,8 s
--   som sql-funktion anropad via PostgREST (argumenten blir
--   parametrar, mönstret räknas om per rad, ingen parallellism)  > 8 s → 57014
--
-- PostgREST avbryter efter 8 s (authenticator-rollens statement_timeout). Därför
-- räknar funktionen ut mönstret EN gång och kör sedan frågan med EXECUTE, med
-- mönster och nål inklistrade som literaler (%L). Planeraren ser då konstanter
-- och kan skanna aesamtable med parallella workers.
--
-- Inget av det som klistras in kommer från anroparen i rå form: nyckeln har
-- passerat kontaktsparr_kontrollerad_nyckel(), och %L citerar.
create or replace function kontaktsparr_berorda(p_typ text, p_nyckel text)
returns table (kalla text, falt text, cfarnr bigint, sajt text, entity_type text, external_id text)
language plpgsql
stable
set search_path = public
-- Mätt 2026-10-05: anropad via PostgREST valde planeraren en sekventiell
-- skanning av aesamtable framför trigramindexet — 5 s mot 0,5 s. Gäller bara
-- den här funktionen; telefongrenen har alltid indexet att gå till, och
-- e-postgrenen (inget index) skannar ändå, eftersom det inte finns något annat.
set enable_seqscan = off
as $fn$
declare
  k   text := kontaktsparr_kontrollerad_nyckel(p_typ, p_nyckel);
  m   text := kontaktsparr_monster(p_typ, k);
  nal text := kontaktsparr_nal(p_typ, k);
begin
  -- Fyra satser, inte en UNION. Mätt 2026-10-05: var för sig tar delarna
  -- 8 + 157 + 1 + 2 ms; som EN union-fråga valde planeraren en plan som tog
  -- 1 450 ms — och via PostgREST, med anons 3 s-gräns, föll den.
  return query execute format($q$
  select 'aesamtable'::text, f.falt, a.cfarnr::bigint, null::text, null::text, null::text
    from aesamtable a
    cross join lateral (values
      ('tel', a.tel::text), ('tel2', a.tel2::text), ('extratel', a.extratel::text),
      ('telefon', a.telefon::text), ('extratelefon', a.extratelefon),
      ('mobil1', a.mobil1), ('mobil2', a.mobil2),
      ('epostadress', a.epostadress), ('e-post', a."e-post"::text),
      ('kontaktperson', a.kontaktperson::text),
      ('infotext', a.infotext), ('justnu', a.justnu)
    ) f(falt, v)
   where %4$s
     and f.v ~* %3$L
  $q$, p_typ, '%' || nal || '%', m,
    -- Telefon går via indexet (kontaktsparr_siffror), e-post via en skanning.
    case when p_typ = 'telefon'
      then format('kontaktsparr_siffror(a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu) like %L', '%' || nal || '%')
      else format($e$lower(concat_ws('|', a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu)) like %L$e$, '%' || nal || '%')
    end);

  return query execute format($q$
  select 'sokordtable', 'sokord', s.cfarnr::bigint, null, null, null
    from sokordtable s
   where kontaktsparr_forfilter(%1$L, coalesce(s.sokord, '') || '|' || coalesce(s.sokordsbanner, '')) like %2$L
     and (s.sokord ~* %3$L or s.sokordsbanner ~* %3$L)
  $q$, p_typ, '%' || nal || '%', m,
    -- Telefon går via indexet (kontaktsparr_siffror), e-post via en skanning.
    case when p_typ = 'telefon'
      then format('kontaktsparr_siffror(a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu) like %L', '%' || nal || '%')
      else format($e$lower(concat_ws('|', a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu)) like %L$e$, '%' || nal || '%')
    end);

  return query execute format($q$
  select 'crm_profiles', f.falt, nullif(regexp_replace(c.cfarnr, '\D', '', 'g'), '')::bigint,
         c.site, null, null
    from crm_profiles c
    cross join lateral (values
      ('phone', c.phone), ('infotext', c.infotext), ('keywords', c.keywords::text)
    ) f(falt, v)
   where kontaktsparr_forfilter(%1$L, f.v) like %2$L and f.v ~* %3$L
  $q$, p_typ, '%' || nal || '%', m,
    -- Telefon går via indexet (kontaktsparr_siffror), e-post via en skanning.
    case when p_typ = 'telefon'
      then format('kontaktsparr_siffror(a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu) like %L', '%' || nal || '%')
      else format($e$lower(concat_ws('|', a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu)) like %L$e$, '%' || nal || '%')
    end);

  return query execute format($q$
  select 'overlay_profil', f.falt,
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
  $q$, p_typ, '%' || nal || '%', m,
    -- Telefon går via indexet (kontaktsparr_siffror), e-post via en skanning.
    case when p_typ = 'telefon'
      then format('kontaktsparr_siffror(a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu) like %L', '%' || nal || '%')
      else format($e$lower(concat_ws('|', a.tel::text, a.tel2::text, a.extratel::text, a.telefon::text, a.extratelefon, a.mobil1, a.mobil2, a.epostadress, a."e-post"::text, a.kontaktperson::text, a.infotext, a.justnu)) like %L$e$, '%' || nal || '%')
    end);

end;
$fn$;

revoke all on function kontaktsparr_kontrollerad_nyckel(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_kontrollerad_nyckel(text, text) to service_role;
-- kontaktsparr_siffror och kontaktsparr_forfilter är ÖPPNA för alla roller, med
-- flit. De är rena funktioner (siffrorna ur en sträng) och avslöjar ingenting.
--
-- Skälet är indexet, och det kostade en timme att hitta: PostgreSQL inlinar en
-- SQL-funktion bara om AKTUELL ANVÄNDARE har EXECUTE på den, och indexuttrycket
-- förbehandlas och cachas per backend (relcache) åt den användare som först rör
-- tabellen. I PostgREST:s poolade backends är det oftast anon — sajternas
-- besökare. Utan EXECUTE för anon cachades indexuttrycket OINLINAT medan frågan
-- (som service role) inlinades, uttrycken matchade inte, och planeraren skannade
-- 846 000 rader: 8 s och 57014 i stället för 8 ms. I en färsk SQL-session syntes
-- felet aldrig. Mätt och bevisat 2026-10-05.
grant execute on function kontaktsparr_siffror(text,text,text,text,text,text,text,text,text,text,text,text) to public;
revoke all on function kontaktsparr_nal(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_nal(text, text) to service_role;
grant execute on function kontaktsparr_forfilter(text, text) to public;  -- se ovan
revoke all on function kontaktsparr_berorda(text, text) from public, anon, authenticated;
grant execute on function kontaktsparr_berorda(text, text) to service_role;

comment on function kontaktsparr_berorda(text, text) is
  'Var i klustret en kontaktuppgift står (källa, fält, identitet — aldrig värdet). Läser, skriver aldrig. Endast service role.';

-- ── Indexet, sist och i egen sats (CONCURRENTLY) ─────────────────────────────
create index concurrently if not exists idx_aesamtable_kontakt_siffror_trgm
  on aesamtable using gin (kontaktsparr_siffror(tel::text, tel2::text, extratel::text, telefon::text, extratelefon, mobil1, mobil2, epostadress, "e-post"::text, kontaktperson::text, infotext, justnu) gin_trgm_ops);
