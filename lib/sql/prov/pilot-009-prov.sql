-- Prov för pilot-009 (kundfrågan via profilnivån). Rullas ALLTID tillbaka:
-- funktionen, kolumnen och provraderna finns bara i transaktionen, och den
-- avslutas med ett avsiktligt fel. Skriver bara ut kalla per fall, aldrig nummer.
--   ( echo 'begin;'; cat lib/sql/pilot-009-telefon-niva.sql lib/sql/prov/pilot-009-prov.sql ) > /tmp/p.sql
--   supabase db query --linked --project-ref babenztvwzaiesducpja -f /tmp/p.sql
set local lock_timeout = '5s';
alter table public.overlay_profil add column if not exists profilniva text;
do $$
declare
  e bigint; f bigint; ut text := ''; fel text := '';
  function_kalla text;
begin
  select v.cfarnr into e from vd_foretag v join vd_telefon t using (cfarnr)
   where v.publicerad and v.ar_enskild_firma and t.typ = 'mobil' and not vd_telefon_sparrad(t.telefon_norm)
     and not exists (select 1 from overlay_profil o where o.sajt = 'varddelen' and o.external_id = v.cfarnr::text)
   order by v.cfarnr limit 1;
  select v.cfarnr into f from vd_foretag v join vd_telefon t using (cfarnr)
   where v.publicerad and not v.ar_enskild_firma and not vd_telefon_sparrad(t.telefon_norm)
     and not exists (select 1 from overlay_profil o where o.sajt = 'varddelen' and o.external_id = v.cfarnr::text)
   order by v.cfarnr limit 1;

  create temp table fall (namn text, cfarnr bigint, niva text, rad boolean, tel text, vantat text) on commit drop;
  insert into fall values
    ('EF utan rad: inget SCB-mobilnummer',              e, null,       false, null,          null),
    ('EF bara kontaktrad, inget nummer i paketet',      e, 'kontakt',  true,  null,          null),
    ('EF bara kontaktrad, nummer i paketet',            e, 'kontakt',  true,  '070-1740605', 'kontakt'),
    ('AB bara kontaktrad, inget nummer: aldrig AFR',    f, 'kontakt',  true,  null,          null),
    ('AB bara kontaktrad, nummer i paketet',            f, 'kontakt',  true,  '070-1740605', 'kontakt'),
    ('EF okänd nivå = kontakt',                         e, 'framtida', true,  null,          null),
    ('EF betald, inget eget nummer: AFR även mobil',    e, 'betald',   true,  null,          'scb-afr'),
    ('EF gratis, inget eget nummer: AFR även mobil',    e, 'gratis',   true,  null,          'scb-afr'),
    ('EF rad före 1.7 (ingen nivå) = betald',           e, null,       true,  null,          'scb-afr'),
    ('EF betald med eget nummer',                       e, 'betald',   true,  '070-1740605', 'kund'),
    ('AB utan rad: AFR',                                f, null,       false, null,          'scb-afr');

  declare r record;
  begin
    for r in select * from fall loop
      delete from overlay_profil o where o.sajt = 'varddelen' and o.external_id = r.cfarnr::text;
      if r.rad then
        insert into overlay_profil (sajt, entity_type, external_id, order_id, revision, status, telefon_override, profilniva)
        values ('varddelen', 'arbetsstalle', r.cfarnr::text, gen_random_uuid(), 1, 'aktiv', r.tel, r.niva);
      end if;
      select v.kalla into function_kalla from vd_telefon_valj(r.cfarnr) v;
      if not found then function_kalla := null; end if;
      ut := ut || format('%s %s → %s; ', case when function_kalla is not distinct from r.vantat then '✓' else '✗' end,
                         r.namn, coalesce(function_kalla, 'inget nummer'));
      if function_kalla is distinct from r.vantat then fel := fel || r.namn || '; '; end if;
    end loop;
  end;
  raise exception 'PROV pilot-009 (rullas tillbaka) % | %', case when fel = '' then 'GRÖNT' else 'RÖTT: ' || fel end, ut;
end $$;
