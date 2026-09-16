-- ============================================================================
-- overlay-v1.1 — kontraktets tillägg, i databasen
-- ============================================================================
-- Körs EFTER lib/sql/overlay.sql. Separat fil därför att overlay.sql är fryst
-- (overlay-kontrakt v1) och inte får ändras — en avvikelse där är en signatur
-- som inte stämmer.
--
-- I det DELADE klustret (hantverkardelen/vårddelen/regionsdelen, projekt
-- ymqbimerrvycbknstsai) körs den här filen EN gång. Tabellen är gemensam och
-- `sajt`-kolumnen skiljer raderna åt.
--
-- Vad 1.1 tillför, allt FRIVILLIGT: en 1.0-payload validerar och lagras
-- oförändrat. Se `// ── Tillägg i 1.1` i overlay.types.ts.
--
--   popularnamn            namnet bolaget går under, när det inte är det
--                          registrerade
--   telefon_typ            vad numret i telefon_override är: kontakt/växel/mobil
--   kategorier             sajtens egna kategorier, max fyra, som STRÄNGAR
--   adress_override_post   post- och besöksadress var för sig
--   adress_override_besok
--   bas                    grunduppgifter om ett bolag sajtens EGET register
--                          inte känner
--   skapa_om_saknas        får sajten skapa bolaget om det saknas?
--
-- VARFÖR contract_version BYTER TYP, och varför det är hela poängen:
--
--   `CONTRACT_VERSION = 1.1` är inte ett heltal. Kolumnen var
--   `integer not null default 1`, och en 1.1:a som landar där blir tyst en 1:a
--   — raden skulle påstå att den skrevs av ett 1.0-paket. Kolumnen blir därför
--   numeric(4,2). Det är den enda ÄNDRINGEN i den här filen; allt annat är
--   tillägg.
--
--   Motsvarande kolumn i CRM:et (`sajter.contract_version`) är fortfarande
--   integer. Så länge den är det kan CRM:et inte lagra 1.1 och kommer att
--   skicka 1.0-formen hit. Det är ofarligt — 1.1-schemat validerar en
--   1.0-payload oförändrat — men 1.1-fälten kommer inte att användas förrän
--   CRM-sidan är rättad. Se OVERLAY.md, avsnitt "Vad som återstår på CRM-sidan".
--
-- `bas` och `skapa_om_saknas` LAGRAS men skriver ALDRIG i källdata.
-- `foretag_publik`, `aesamtable` och `sokordtable` är read-only härifrån,
-- undantagslöst. Sajten renderar en `bas`-profil fristående i stället för att
-- lägga en rad i registret — CRM:et skickar uppgifterna, mottagaren bestämmer.
--
-- Idempotent: kan köras om utan att skada befintliga rader.
-- ============================================================================

-- ── Tilläggskolumner ────────────────────────────────────────────────────────

alter table overlay_profil add column if not exists popularnamn text;
alter table overlay_profil add column if not exists telefon_typ text;
alter table overlay_profil add column if not exists kategorier text[] not null default '{}';
alter table overlay_profil add column if not exists adress_override_post jsonb;
alter table overlay_profil add column if not exists adress_override_besok jsonb;
alter table overlay_profil add column if not exists bas jsonb;
alter table overlay_profil add column if not exists skapa_om_saknas boolean not null default false;

-- Värdedomänen speglar TELEFONTYPER i overlay.types.ts. Egen sats därför att
-- `add constraint if not exists` inte finns i Postgres.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'overlay_profil'::regclass
       and conname = 'overlay_profil_telefon_typ'
  ) then
    alter table overlay_profil
      add constraint overlay_profil_telefon_typ
      check (telefon_typ is null or telefon_typ in ('kontakt','vaxel','mobil'));
  end if;
end;
$$;

-- Kontraktet säger max fyra kategorier. Schemat i endpointen stoppar en femte,
-- men tabellen är den sista grinden: en rad som skrivs förbi endpointen (en
-- handpåläggning i SQL-editorn) ska inte kunna bryta mot kontraktet heller.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'overlay_profil'::regclass
       and conname = 'overlay_profil_kategorier_max'
  ) then
    alter table overlay_profil
      add constraint overlay_profil_kategorier_max
      check (array_length(kategorier, 1) is null or array_length(kategorier, 1) <= 4);
  end if;
end;
$$;

-- ── contract_version: integer → numeric ─────────────────────────────────────
-- Enda ändringen av en befintlig kolumn. Utan den avrundas 1.1 till 1.
alter table overlay_profil
  alter column contract_version drop default;

alter table overlay_profil
  alter column contract_version type numeric(4,2)
  using contract_version::numeric(4,2);

alter table overlay_profil
  alter column contract_version set default 1.0;

-- ── overlay_publicera: samma transaktion, nu med 1.1-fälten ─────────────────
--
-- Funktionskroppen ägs egentligen av overlay.sql. Den ersätts här i sin helhet
-- därför att INSERT/UPDATE räknar upp sina kolumner explicit — en ny kolumn som
-- inte står med skulle tyst falla bort vid varje publicering, och det är precis
-- den sortens fel som inte syns förrän en kund undrar var deras populärnamn tog
-- vägen. `jsonb_populate_record` plockar upp nya kolumner av sig själv; listorna
-- nedan gör det inte.
--
-- Semantiken är oförändrad i övrigt: FOR UPDATE serialiserar två samtidiga
-- publiceringar, utkastet raderas i samma transaktion, och `logo_url` /
-- `published_at` COALESCE:as mot befintlig rad när nyckeln saknas i p_rad.
--
-- OBS: `create or replace function` NOLLSTÄLLER SET-klausuler. Därför körs
-- overlay-hardening-001.sql om längst ned i den här filen — inte som en
-- påminnelse i en kommentar, utan som en sats.
create or replace function overlay_publicera(p_rad jsonb)
returns table (id uuid, revision integer, status text)
language plpgsql
as $$
declare
  v_sajt text := p_rad->>'sajt';
  v_typ  text := p_rad->>'entity_type';
  v_ext  text := p_rad->>'external_id';
  v_id   uuid;
  r      overlay_profil%rowtype;
begin
  if v_sajt is null or v_typ is null or v_ext is null then
    raise exception 'overlay_publicera: sajt, entity_type och external_id krävs';
  end if;

  r := jsonb_populate_record(null::overlay_profil, p_rad);

  select o.id into v_id
    from overlay_profil o
   where o.sajt = v_sajt
     and o.entity_type = v_typ
     and o.external_id = v_ext
     and o.status <> 'utkast'
     for update;

  if v_id is null then
    insert into overlay_profil (
      sajt, entity_type, external_id, order_id, revision, payload_hash, status,
      giltig_from, giltig_till, featured, list_priority, keywords, logo_url,
      hemsida, telefon_override, epost_override, kontaktperson, adress_override,
      info_html, dolj_andra_nummer, preview_token, preview_expires_at,
      contract_version, published_at,
      -- 1.1
      popularnamn, telefon_typ, kategorier, adress_override_post,
      adress_override_besok, bas, skapa_om_saknas
    ) values (
      v_sajt, v_typ, v_ext, r.order_id, r.revision, r.payload_hash,
      coalesce(r.status, 'aktiv'),
      r.giltig_from, r.giltig_till, coalesce(r.featured, false),
      coalesce(r.list_priority, 0), coalesce(r.keywords, '{}'), r.logo_url,
      r.hemsida, r.telefon_override, r.epost_override, r.kontaktperson,
      r.adress_override, r.info_html, coalesce(r.dolj_andra_nummer, false),
      r.preview_token, r.preview_expires_at,
      coalesce(r.contract_version, 1.0), r.published_at,
      r.popularnamn, r.telefon_typ, coalesce(r.kategorier, '{}'),
      r.adress_override_post, r.adress_override_besok, r.bas,
      coalesce(r.skapa_om_saknas, false)
    )
    returning overlay_profil.id into v_id;
  else
    update overlay_profil o set
      order_id          = r.order_id,
      revision          = r.revision,
      payload_hash      = r.payload_hash,
      status            = coalesce(r.status, 'aktiv'),
      giltig_from       = r.giltig_from,
      giltig_till       = r.giltig_till,
      featured          = coalesce(r.featured, false),
      list_priority     = coalesce(r.list_priority, 0),
      keywords          = coalesce(r.keywords, '{}'),
      -- Utelämnad nyckel = behåll filen. remove_logo skickar logo_url = null.
      logo_url          = case when p_rad ? 'logo_url' then r.logo_url else o.logo_url end,
      hemsida           = r.hemsida,
      telefon_override  = r.telefon_override,
      epost_override    = r.epost_override,
      kontaktperson     = r.kontaktperson,
      adress_override   = r.adress_override,
      info_html         = r.info_html,
      dolj_andra_nummer = coalesce(r.dolj_andra_nummer, false),
      preview_token     = r.preview_token,
      preview_expires_at = r.preview_expires_at,
      contract_version  = coalesce(r.contract_version, o.contract_version),
      published_at      = case when p_rad ? 'published_at' then r.published_at else o.published_at end,
      -- 1.1. Skrivs ALLTID, även till null: endpointen skickar hela raden, och
      -- ett fält kunden tagit bort ska försvinna — inte ligga kvar för att
      -- nyckeln råkade utelämnas. Logotypen är det enda undantaget, och den är
      -- undantagen för att filen lever utanför raden.
      popularnamn           = r.popularnamn,
      telefon_typ           = r.telefon_typ,
      kategorier            = coalesce(r.kategorier, '{}'),
      adress_override_post  = r.adress_override_post,
      adress_override_besok = r.adress_override_besok,
      bas                   = r.bas,
      skapa_om_saknas       = coalesce(r.skapa_om_saknas, false)
     where o.id = v_id;
  end if;

  -- Utkastet har blivit verklighet och ska inte ligga kvar.
  delete from overlay_profil o
   where o.sajt = v_sajt
     and o.entity_type = v_typ
     and o.external_id = v_ext
     and o.status = 'utkast';

  return query
    select o.id, o.revision, o.status from overlay_profil o where o.id = v_id;
end;
$$;

-- Grants sätts om: `create or replace` behåller dem, men filen ska gå att köra
-- mot en databas där funktionen skapats på annat sätt.
revoke all on function overlay_publicera(jsonb) from public;
revoke all on function overlay_publicera(jsonb) from anon, authenticated;
grant execute on function overlay_publicera(jsonb) to service_role;

-- ── Härdning om ─────────────────────────────────────────────────────────────
-- `create or replace function` ovan nollställde search_path på
-- overlay_publicera. Sätt tillbaka den här, i samma fil, så att en körning av
-- den här migrationen aldrig lämnar funktionen omärkt.
alter function public.overlay_publicera(jsonb)
  set search_path = public, pg_temp;

-- ── Kommentarer ─────────────────────────────────────────────────────────────
comment on column overlay_profil.contract_version is
  'numeric: 1.0 respektive 1.1. Heltalskolumnen avrundade 1.1 till 1 och fick raden att ljuga om sitt ursprung.';
comment on column overlay_profil.popularnamn is
  'Namnet bolaget går under, när det inte är det registrerade. Ersätter aldrig firma i registret.';
comment on column overlay_profil.telefon_typ is
  'kontakt | vaxel | mobil. Vad numret i telefon_override är.';
comment on column overlay_profil.kategorier is
  'Sajtens EGNA kategorier som strängar, max fyra. Aldrig id:n — kategoriträdet ser olika ut på varje sajt.';
comment on column overlay_profil.bas is
  'Grunduppgifter om ett bolag sajtens eget register inte känner. Renderas fristående. Skrivs ALDRIG till foretag_publik/aesamtable.';
comment on column overlay_profil.skapa_om_saknas is
  'Kundens lov att rendera en bas-profil för ett bolag som saknas i registret. Ger aldrig rätt att skriva i källdata.';
