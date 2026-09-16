-- ============================================================================
-- overlay_profil — betald synlighet på en sajt (overlay-kontrakt v1, FRYST)
-- ============================================================================
-- Körs i VARJE SAJTS Supabase-projekt. I det delade klustret
-- (vårddelen/hantverkardelen/regionsdelen) körs den EN gång — tabellen är
-- gemensam och `sajt`-kolumnen skiljer raderna åt.
--
-- Grundprinciper som den här filen upprätthåller:
--   • Källdata (foretag, aesamtable m.fl.) är READ-ONLY och rörs ALDRIG härifrån.
--   • Sajten äger sina overlay-rader och sina logotyper. CRM:et har inga
--     databasnycklar hit — det skriver bara via /api/overlay/publish.
--   • Publik läsning ser endast `status = 'aktiv'`. Utkast (förhandsvisning)
--     läses av sajtens server med service role efter kontroll av preview_token.
--
-- Idempotent: kan köras om utan att skada befintliga rader.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists overlay_profil (
  id              uuid primary key default gen_random_uuid(),

  -- Vilken sajt raden gäller. Fylls även i enskajts-projekt, så att en
  -- framtida flytt till ett delat kluster inte kräver en migration.
  sajt            text        not null,

  -- Vad external_id pekar på. Avgör vilken källtabell sajten joinar mot.
  entity_type     text        not null
                  check (entity_type in ('bolag','arbetsstalle','forening','verksamhet')),

  -- bolag = orgnr · arbetsstalle = CFAR · forening = orgnr · verksamhet = IVO-tillståndsnr
  external_id     text        not null,

  -- CRM:ets order-id. Ingen FK — CRM:et lever i en annan databas, och sajten
  -- ska kunna säljas utan att CRM:et följer med.
  order_id        uuid        not null,

  -- MONOTON. CRM:et höjer numret vid VARJE action mot identiteten — publish,
  -- unpublish och varje ompublicering. Aldrig två paket med samma nummer.
  --
  -- Endpointen avvisar allt som är lägre än det som redan ligger; det är det
  -- som gör att ett gammalt publish-paket inte kan spelas upp igen efter en
  -- avpublicering. payload_hash är ett skyddsnät för det slarviga fallet, inte
  -- regeln — sajten får aldrig vara beroende av hashen ensam.
  -- Se bedomRevision() i overlay.types.ts.
  revision        integer     not null default 1 check (revision >= 1),

  -- Innehållsfingeravtryck (SHA-256) av den payload som skrev raden. Skiljer
  -- ett ofarligt återförsök (samma revision, samma hash → gör inget) från en
  -- konflikt (samma revision, annan hash → 409).
  payload_hash    text,

  status          text        not null default 'utkast'
                  check (status in ('utkast','aktiv','inaktiv','utgangen')),

  giltig_from     date,
  giltig_till     date,

  featured        boolean     not null default false,
  list_priority   integer     not null default 0,
  keywords        text[]      not null default '{}',

  -- Pekar ALLTID på sajtens egen storage-bucket (overlay-logos). Originalet
  -- ligger kvar i CRM:et; det här är sajtens kopia.
  --
  -- Livscykel: en publicering utan `logo`-fält behåller filen, remove_logo
  -- raderar den, och `unpublish` rör den ALDRIG — en kund som publiceras igen
  -- ska få tillbaka sin logotyp utan att CRM:et skickar om bilden.
  logo_url        text,

  hemsida         text,
  telefon_override text,
  epost_override  text,
  kontaktperson   text,
  adress_override jsonb,

  -- Saniterad av endpointen innan den landar här. Aldrig rå HTML från CRM:et.
  info_html       text,

  -- Döljer källdatans telefonnummer till förmån för telefon_override.
  dolj_andra_nummer boolean   not null default false,

  -- Signerad token (pv1.<anspråk>.<hmac>) bunden till external_id + revision.
  -- ?preview=<token> visar utkastet, noindex. Se skapaPreviewToken().
  preview_token   text,
  preview_expires_at timestamptz,

  contract_version integer    not null default 1,

  published_at    timestamptz,
  updated_at      timestamptz not null default now(),

  constraint overlay_profil_giltighet check (
    giltig_from is null or giltig_till is null or giltig_till >= giltig_from
  )
);

-- Kolumner som tillkommit efter första utrullningen. Separata satser så att
-- filen går att köra om mot en databas som redan har tabellen.
alter table overlay_profil add column if not exists payload_hash text;
alter table overlay_profil add column if not exists preview_expires_at timestamptz;

-- ── Unikhet ─────────────────────────────────────────────────────────────────
-- EN publicerad rad och EN utkastrad per identitet (sajt, entity_type,
-- external_id).
--
-- Delat upp i två partiella index i stället för ett enda
-- unique(sajt, entity_type, external_id). Med bara ett index skulle en
-- förhandsvisning av en befintlig kund tvinga in utkastet i den rad som ligger
-- live — och därmed ta ner en betald profil mitt i ett säljsamtal. Nu lever
-- utkastet vid sidan av, och overlay_publicera() ersätter den publicerade raden
-- och raderar utkastet i samma transaktion.
create unique index if not exists overlay_profil_unik_publicerad
  on overlay_profil (sajt, entity_type, external_id)
  where status <> 'utkast';

create unique index if not exists overlay_profil_unik_utkast
  on overlay_profil (sajt, entity_type, external_id)
  where status = 'utkast';

-- ── LÄSREGEL (gäller all kod som frågar den här tabellen) ───────────────────
--
-- En publik query filtrerar ALLTID på status = 'aktiv' OCH giltighetstid.
-- Slå ALDRIG upp en identitet utan statusfilter.
--
-- Anledningen är promote-regeln ovan: mellan en förhandsvisning och en
-- publicering har identiteten TVÅ rader. En SELECT utan statusfilter får då
-- båda — `.single()` blir ett fel och `.limit(1)` blir en slumpvis vinnare, i
-- värsta fall utkastet, publikt. Använd publikOverlayMatch() och
-- arPubliktSynlig() ur overlay.types.ts.

-- Uppslag vid rendering av en enskild profilsida.
create index if not exists overlay_profil_uppslag
  on overlay_profil (sajt, entity_type, external_id, status);

-- Listsortering: featured/list_priority för alla aktiva rader på en sajt.
create index if not exists overlay_profil_aktiva
  on overlay_profil (sajt, featured desc, list_priority desc)
  where status = 'aktiv';

-- Cron/underhåll: hitta aktiva rader som passerat giltig_till.
create index if not exists overlay_profil_utgang
  on overlay_profil (giltig_till)
  where status = 'aktiv';

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function overlay_profil_satt_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists overlay_profil_updated_at on overlay_profil;
create trigger overlay_profil_updated_at
  before update on overlay_profil
  for each row execute function overlay_profil_satt_updated_at();

-- ── Promote: publicering i EN transaktion ───────────────────────────────────
--
-- `publish` av en identitet som har ett utkast måste göra två saker som inte
-- får glida isär: skriva den publicerade raden och radera utkastet. Görs det i
-- två anrop från appen finns ett fönster där båda raderna finns samtidigt.
--
-- En plpgsql-funktion körs som en transaktion — antingen sker båda eller ingen.
-- FOR UPDATE-låset serialiserar dessutom två samtidiga publiceringar av samma
-- identitet i stället för att låta dem skriva över varandra.
--
-- `logo_url` och `published_at` COALESCE:as mot befintlig rad när nyckeln
-- saknas i p_rad. Det är logotypssemantiken i databasen: utelämnat = behåll.
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
      contract_version, published_at
    ) values (
      v_sajt, v_typ, v_ext, r.order_id, r.revision, r.payload_hash,
      coalesce(r.status, 'aktiv'),
      r.giltig_from, r.giltig_till, coalesce(r.featured, false),
      coalesce(r.list_priority, 0), coalesce(r.keywords, '{}'), r.logo_url,
      r.hemsida, r.telefon_override, r.epost_override, r.kontaktperson,
      r.adress_override, r.info_html, coalesce(r.dolj_andra_nummer, false),
      r.preview_token, r.preview_expires_at,
      coalesce(r.contract_version, 1), r.published_at
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
      published_at      = case when p_rad ? 'published_at' then r.published_at else o.published_at end
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

-- Endast service role (endpointen) får publicera. Anon och inloggade besökare
-- ska inte ens kunna nå funktionen.
revoke all on function overlay_publicera(jsonb) from public;
revoke all on function overlay_publicera(jsonb) from anon, authenticated;
grant execute on function overlay_publicera(jsonb) to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Publik läsning endast av aktiva rader. Skrivning enbart via service role
-- (endpointen), som kringgår RLS helt och därför inte behöver någon policy.
alter table overlay_profil enable row level security;

drop policy if exists overlay_profil_publik_lasning on overlay_profil;
create policy overlay_profil_publik_lasning
  on overlay_profil
  for select
  to anon, authenticated
  using (status = 'aktiv');

comment on table overlay_profil is
  'Betald synlighet ovanpå read-only källdata. Skrivs endast av /api/overlay/publish (service role). Publikt läsbar när status = aktiv. Läs ALDRIG en identitet utan statusfilter.';
comment on column overlay_profil.external_id is
  'bolag=orgnr, arbetsstalle=CFAR, forening=orgnr, verksamhet=IVO-tillståndsnummer.';
comment on column overlay_profil.revision is
  'Monoton per identitet. Lägre revision avvisas med 409. Ökas även vid unpublish.';
comment on column overlay_profil.payload_hash is
  'SHA-256 av payloaden (utan sent_at). Samma revision + samma hash = återförsök, inte konflikt.';
comment on column overlay_profil.logo_url is
  'Sajtens egen kopia i bucket overlay-logos. Originalet ligger i CRM:ets crm-logos. unpublish raderar aldrig filen.';
