-- ============================================================================
-- overlay-kontaktsparr-pts.sql — exempelnumret blir PTS fiktiva (2 nov 2026)
-- ============================================================================
--
-- overlay-kontaktsparr.sql använde ett riktigt mobilnummer som exempel: i
-- kolumnkommentaren på kontaktsparr.nyckel (lagras i databasen) och i
-- beviset nedan (körs, lagras inte). Nu PTS-serien för fiktiva nummer,
-- 070-174 06 05–99. Kör en gång på varje databas där overlay-kontaktsparr.sql
-- har körts. Idempotent; rör inga rader.
-- ============================================================================

comment on column kontaktsparr.nyckel is
  'telefon: E.164-siffror utan plus (46701740623). epost: gemener. Se normaliseraKontakt().';

do $$
declare
  m text := kontaktsparr_monster('telefon', '46701740623');
  f text;
begin
  foreach f in array array['070-174 06 23','0701740623','+46701740623','0046701740623',
                           '46701740623','+46 (0)70 174 06 23','70-174 06 23','070-1740623'] loop
    if kontakt_normalisera_telefon(f) is distinct from '46701740623' then
      raise exception 'normaliseringen: % gav %', f, kontakt_normalisera_telefon(f);
    end if;
  end loop;

  if kontakt_normalisera_telefon('Ring 070-174 06 23') is not null then
    raise exception 'normaliseringen: text med ett nummer i är inte ett nummer';
  end if;

  -- Hittas i fritext, i alla skrivsätt.
  foreach f in array array['Ring 070-174 06 23 idag','tel:+46701740623','<a href="tel:0046701740623">',
                           'mobil 46 70 174 06 23.','070&nbsp;174&nbsp;06&nbsp;23','(070) 174 06 23',
                           'nr 070.174.06.23'] loop
    if f !~ m then raise exception 'mönstret missade: %', f; end if;
  end loop;

  -- Men inte inuti ett längre nummer, och inte ett grannummer.
  foreach f in array array['10701740623','07017406231','070-174 06 24','orgnr 5570174062'] loop
    if f ~ m then raise exception 'mönstret träffade fel: %', f; end if;
  end loop;

  if regexp_replace('Ring 070-174 06 23 eller 08-12 34 56', m, '', 'g') <> 'Ring  eller 08-12 34 56' then
    raise exception 'skrubbningen tog fel: %', regexp_replace('Ring 070-174 06 23 eller 08-12 34 56', m, '', 'g');
  end if;

  if 'Skriv till Anna.Svensson@Exempel.se!' !~* kontaktsparr_monster('epost', 'anna.svensson@exempel.se') then
    raise exception 'e-postmönstret missade';
  end if;

  raise notice 'kontaktsparr: normalisering och mönster bevisade';
end;
$$;
