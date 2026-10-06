-- ============================================================================
-- kontaktsparr — spärr på en kontaktuppgift (overlay-kontrakt v1.2)
-- ============================================================================
-- Körs i VARJE SAJTS Supabase-projekt, efter overlay.sql. I det delade
-- klustret (vårddelen/hantverkardelen/regionsdelen) körs den EN gång.
--
-- VAD DEN ÄR TILL FÖR: ett GDPR-ärende där en privatperson begärt att en
-- kontaktuppgift (ett mobilnummer, en e-postadress) inte ska visas. Uppgiften
-- kan stå på flera bolag och i fritext — spärren följer UPPGIFTEN, inte bolaget.
--
-- Grundprinciperna, och hur filen håller dem:
--   • Källdata (aesamtable, foretag) är READ-ONLY. Spärren tillämpas av sajten
--     vid LÄSNING. Ingen trigger, ingen update, ingen vy som skriver om källan.
--   • Push, inte pull. Raderna skrivs bara av /api/overlay/publish, med samma
--     signatur och revisionsregel som overlay_profil.
--   • Tabellen är INTE publikt läsbar. En lista över nummer som personer bett
--     om att få raderade är själv en personuppgift, och den läses därför bara
--     av sajtens server med service role.
--
-- Idempotent: kan köras om. Varje funktion DROPPAS FÖRST — en
-- `create or replace` med ändrad parameterlista skapar annars en överlagring
-- bredvid den gamla, och varje anrop blir tvetydigt (foretagskolls incident
-- 0042, 8 september 2026). Där ett CHECK-villkor eller en trigger beror på
-- funktionen används CASCADE, och filen återskapar sedan beroendet själv:
-- triggrarna längre ned, villkoret med en uttrycklig `add constraint`.
-- ============================================================================

create extension if not exists pgcrypto;

drop function if exists kontakt_normalisera_telefon(text) cascade;
drop function if exists kontakt_normalisera_epost(text) cascade;
drop function if exists kontaktsparr_monster(text, text);
drop function if exists kontaktsparr_satt_updated_at() cascade;
drop function if exists kontaktsparr_handelse_las() cascade;

-- ── Normaliseringen, i SQL ──────────────────────────────────────────────────
-- SAMMA regel som normaliseraTelefon() i overlay.types.ts. Ändras den ena ska
-- den andra ändras, och do-blocket längst ner bevisar att de är överens.

create or replace function kontakt_normalisera_telefon(p_raw text)
returns text
language plpgsql
immutable
as $$
declare
  s text;
  d text;
begin
  if p_raw is null then return null; end if;
  s := btrim(regexp_replace(normalize(p_raw, NFKC), '\(\s*0\s*\)', '', 'g'));
  if s !~ '^\+?[0-9\s./()\u00a0-]+$' then return null; end if;
  d := regexp_replace(s, '[^0-9]', '', 'g');
  if left(s, 1) = '+' then
    null;
  elsif left(d, 2) = '00' then
    d := substr(d, 3);
  elsif left(d, 1) = '0' then
    d := '46' || substr(d, 2);
  elsif left(d, 2) = '46' and length(d) >= 10 then
    null;
  elsif length(d) between 7 and 9 then
    d := '46' || d;
  else
    return null;
  end if;
  if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  if left(d, 2) = '46' and (length(d) < 9 or length(d) > 11) then return null; end if;
  return d;
end;
$$;

create or replace function kontakt_normalisera_epost(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when s ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and length(s) <= 254 then s
  end
  from (select lower(btrim(normalize(p_raw, NFKC))) as s) x
$$;

-- ── Mönstret ────────────────────────────────────────────────────────────────
-- SAMMA sträng som kontaktsparrMonster() i overlay.types.ts bygger. Uttrycket är
-- skrivet i den delmängd JavaScript och PostgreSQL har gemensam, så att sajtens
-- rendering och registrets sökning hittar exakt samma sak.
-- E-post matchas skiftlägesokänsligt: använd `~*`.

create or replace function kontaktsparr_monster(p_typ text, p_nyckel text)
returns text
language plpgsql
immutable
as $$
declare
  sep    constant text := '(?:[\s./()\u00a0-]|&nbsp;|&#160;){0,3}';
  prefix text;
  rest   text;
begin
  if p_typ = 'epost' then
    return '(?<![A-Za-z0-9._%+-])'
        || regexp_replace(p_nyckel, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
        || '(?![A-Za-z0-9-])';
  end if;
  if left(p_nyckel, 2) = '46' then
    rest   := substr(p_nyckel, 3);
    prefix := '(?:(?:\+|00)' || sep || '46' || sep || '(?:\(0\)' || sep || ')?|46' || sep || '|0' || sep || ')?';
  else
    rest   := p_nyckel;
    prefix := '(?:\+|00)?' || sep;
  end if;
  return '(?<![0-9])' || prefix
      || array_to_string(regexp_split_to_array(rest, ''), sep)
      || '(?![0-9])';
end;
$$;

-- ── Tabellen ────────────────────────────────────────────────────────────────

create table if not exists kontaktsparr (
  id              uuid primary key default gen_random_uuid(),

  -- 'register' = gäller varje sajt som läser den här databasen (sajt is null).
  -- 'sajt'     = gäller bara sajten i `sajt`.
  scope           text not null check (scope in ('register','sajt')),
  sajt            text,

  typ             text not null check (typ in ('telefon','epost')),
  -- Normaliserad enligt kontraktet: E.164-siffror utan plus, eller gemen e-post.
  nyckel          text not null,

  status          text not null check (status in ('aktiv','havd')),

  -- Ärendenumret i CRM:et. ALDRIG den registrerades namn.
  arende          text not null,

  -- Monoton per (sajt, typ, nyckel). Se bedomRevision() och kontaktsparrHash().
  revision        integer not null check (revision >= 1),
  payload_hash    text not null,
  contract_version numeric not null,

  -- Vilken mottagare som senast skrev raden. Med scope 'register' kan det vara
  -- vilken som helst av sajterna i klustret — den första som fick paketet.
  skriven_av      text not null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint kontaktsparr_scope_sajt check ((scope = 'register') = (sajt is null))
);

-- Normaliseringsvillkoret läggs UTANFÖR create table: en omkörning droppar
-- normaliseringsfunktionerna med CASCADE, och då försvinner villkoret med dem.
-- Det ska komma tillbaka varje gång, inte bara första.
alter table kontaktsparr drop constraint if exists kontaktsparr_nyckel_normaliserad;
alter table kontaktsparr add constraint kontaktsparr_nyckel_normaliserad check (
  nyckel = case typ when 'telefon' then kontakt_normalisera_telefon(nyckel)
                    else kontakt_normalisera_epost(nyckel) end
);

-- EN rad per (omfång, uppgift). NULLS NOT DISTINCT: två register-rader för
-- samma nummer (sajt is null) är en dubblett, inte två olika rader.
create unique index if not exists kontaktsparr_unik
  on kontaktsparr (sajt, typ, nyckel) nulls not distinct;

-- Det sajten läser vid varje rendering: de aktiva spärrarna.
create index if not exists kontaktsparr_aktiva
  on kontaktsparr (sajt) where status = 'aktiv';

create or replace function kontaktsparr_satt_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kontaktsparr_updated_at on kontaktsparr;
create trigger kontaktsparr_updated_at
  before update on kontaktsparr
  for each row execute function kontaktsparr_satt_updated_at();

-- ── Händelseloggen ──────────────────────────────────────────────────────────
-- Allt loggas, också på mottagarsidan: varje paket som SKREV något, med vad
-- sajten gjorde. Bara tillägg — ingen update, ingen delete.

create table if not exists kontaktsparr_handelse (
  id              bigint generated always as identity primary key,
  mottagen_av     text not null,
  op              text not null check (op in ('sparra','hav')),
  scope           text not null,
  sajt            text,
  typ             text not null,
  nyckel          text not null,
  arende          text not null,
  revision        integer not null,
  berorda         integer not null default 0,
  revalidated     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create or replace function kontaktsparr_handelse_las()
returns trigger language plpgsql as $$
begin
  raise exception 'kontaktsparr_handelse är en logg: rader läggs till, aldrig ändras eller tas bort';
end;
$$;

drop trigger if exists kontaktsparr_handelse_append_only on kontaktsparr_handelse;
create trigger kontaktsparr_handelse_append_only
  before update or delete on kontaktsparr_handelse
  for each row execute function kontaktsparr_handelse_las();

-- ── Behörighet ──────────────────────────────────────────────────────────────
-- RLS PÅ och INGA policyer: anon och inloggade besökare ser ingenting. Sajtens
-- server läser med service role, som kringgår RLS.

alter table kontaktsparr enable row level security;
alter table kontaktsparr_handelse enable row level security;
revoke all on kontaktsparr, kontaktsparr_handelse from anon, authenticated;
-- Identitetskolumnens sekvens får default-rättigheterna (anon: rwU) precis som
-- tabellen. setval() kräver UPDATE — en publik nyckel ska inte kunna vrida
-- loggens id-serie. Glömdes i första versionen; hittades i hvb-hem 6 okt 2026.
revoke all on sequence kontaktsparr_handelse_id_seq from anon, authenticated;
grant select, insert, update on kontaktsparr to service_role;
grant select, insert on kontaktsparr_handelse to service_role;

comment on table kontaktsparr is
  'Overlay-kontrakt 1.2. Spärr på en kontaktuppgift, tillämpad av sajten vid läsning. Skrivs endast av /api/overlay/publish. INTE publikt läsbar.';
comment on column kontaktsparr.nyckel is
  'telefon: E.164-siffror utan plus (46705096502). epost: gemener. Se normaliseraKontakt().';
comment on column kontaktsparr.arende is
  'Ärendenummer i CRM:et. Aldrig den registrerades namn.';

-- PostgREST cachar schemat. Utan omladdning anropar den den gamla formen.
notify pgrst, 'reload schema';

-- ── Beviset ─────────────────────────────────────────────────────────────────
-- Normaliseringen och mönstret ska ge SAMMA svar som kontraktets JS. Proverna
-- är desamma som i test/overlay.test.ts.

do $$
declare
  m text := kontaktsparr_monster('telefon', '46705096502');
  f text;
begin
  foreach f in array array['070-509 65 02','0705096502','+46705096502','0046705096502',
                           '46705096502','+46 (0)70 509 65 02','70-509 65 02','070-5096502'] loop
    if kontakt_normalisera_telefon(f) is distinct from '46705096502' then
      raise exception 'normaliseringen: % gav %', f, kontakt_normalisera_telefon(f);
    end if;
  end loop;

  if kontakt_normalisera_telefon('Ring 070-509 65 02') is not null then
    raise exception 'normaliseringen: text med ett nummer i är inte ett nummer';
  end if;

  -- Hittas i fritext, i alla skrivsätt.
  foreach f in array array['Ring 070-509 65 02 idag','tel:+46705096502','<a href="tel:0046705096502">',
                           'mobil 46 70 509 65 02.','070&nbsp;509&nbsp;65&nbsp;02','(070) 509 65 02',
                           'nr 070.509.65.02'] loop
    if f !~ m then raise exception 'mönstret missade: %', f; end if;
  end loop;

  -- Men inte inuti ett längre nummer, och inte ett grannummer.
  foreach f in array array['10705096502','07050965021','070-509 65 03','orgnr 5570509650'] loop
    if f ~ m then raise exception 'mönstret träffade fel: %', f; end if;
  end loop;

  if regexp_replace('Ring 070-509 65 02 eller 08-12 34 56', m, '', 'g') <> 'Ring  eller 08-12 34 56' then
    raise exception 'skrubbningen tog fel: %', regexp_replace('Ring 070-509 65 02 eller 08-12 34 56', m, '', 'g');
  end if;

  if 'Skriv till Anna.Svensson@Exempel.se!' !~* kontaktsparr_monster('epost', 'anna.svensson@exempel.se') then
    raise exception 'e-postmönstret missade';
  end if;

  raise notice 'kontaktsparr: normalisering och mönster bevisade';
end;
$$;
