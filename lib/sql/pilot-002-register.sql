-- ============================================================================
-- pilot-002-register — varddelens eget register (PILOT, DATAKALLA=pilot)
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-001-grund.sql.
-- Idempotent. Matas ENVÄGS av infofinder-enrichment/scripts/mata_varddelen.py
-- från mtoz.arbetsstalle + arbetsstalle_firmanamn + foretag. Ingen annan skriver.
--
-- KONTRAKT: vyn `foretag_publik` har samma kolumner och typer som klustrets vy
-- (ymqb), så att sajten byter datakälla med en miljövariabel. Skillnader:
--   tel, telefon, epostadress  alltid NULL — registertelefon publiceras inte
--                              under piloten (B-P3). Telefon kommer bara från
--                              kundens overlay.
--   orgnr_maskerat             alltid NULL — pilotdatan har inget personnummer,
--                              inte ens seklet.
--   ng1/branschid              SNI 2025 (heltal av den femsiffriga koden).
--   kommun                     kommunkoden utan inledande nolla, som i dag
--                              ("180", "1480").
--   id                         = cfarnr (klustrets id var inte unikt).
--
-- PERSONUPPGIFTER: inga personnummer (CHECK på varje fritextkolumn, samma
-- mönster som mtoz), inga personnamn för enskilda firmor (bara registrerade
-- firmanamn, B-P2), inga registertelefonnummer eller e-postadresser.
-- ============================================================================

-- Supabase lägger tillägg i schemat extensions (finns i search_path för alla roller).
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

do $$ begin
  if not exists (select 1 from pg_ts_config where cfgname = 'swedish_unaccent') then
    create text search configuration public.swedish_unaccent (copy = pg_catalog.swedish);
    alter text search configuration public.swedish_unaccent
      alter mapping for hword, hword_part, word with extensions.unaccent, swedish_stem;
  end if;
end $$;

-- ── Registret ───────────────────────────────────────────────────────────────
create table if not exists public.vd_foretag (
  cfarnr                       bigint   primary key check (cfarnr between 1 and 99999999),
  -- Visningsnamn: bolagets namn (foretag.namn) / arbetsställets benämning för
  -- offentlig huvudman / registrerat firmanamn för enskild firma.
  firma                        text     not null check (length(firma) between 1 and 300),
  -- Juridiskt namn (foretag.namn). Enskild firma: firmanamnet igen — ALDRIG personnamnet.
  juridiskt_namn               text     check (length(juridiskt_namn) between 1 and 300),
  -- Huvudmannen när firma är arbetsställets eget namn (kommun, region, stat).
  huvudman                     text,
  ar_enskild_firma             boolean  not null,
  -- Bara juridiska personer, formaterat "556xxx-xxxx". Tredje siffran >= 2 = aldrig ett personnummer.
  orgnr                        text     check (orgnr ~ '^[0-9]{2}[2-9][0-9]{3}-[0-9]{4}$'),
  constraint vd_foretag_orgnr_ef check ((ar_enskild_firma and orgnr is null) or (not ar_enskild_firma and orgnr is not null)),
  jurform                      smallint,
  innehaller_fullt_personnamn  boolean  not null default false,  -- firmanamnet innehåller innehavarens för- och efternamn
  gatuadress                   text,
  postnr                       integer  check (postnr between 10000 and 99999),
  postort                      text,
  kommun                       text     check (kommun ~ '^[1-9][0-9]{2,3}$'),
  lan                          text     check (lan ~ '^[0-9]{2}$'),
  sni                          text     not null check (sni ~ '^[0-9]{5}$'),
  ng1                          integer  generated always as (sni::integer) stored,
  anstkl                       text,
  aeant                        integer,  -- bolagets antal VERKSAMMA arbetsställen (alla branscher), inte anställda
  publicerad                   boolean  not null,
  avpublicerad_orsak           text     check (avpublicerad_orsak in ('upphord', 'utanfor_urval', 'ej_firmanamn', 'offentlig_huvudman', 'saknas_i_afr')),
  constraint vd_foretag_orsak check (publicerad = (avpublicerad_orsak is null)),
  kalla_andrad                 date     not null,   -- mtoz.arbetsstalle.andrad
  matad_at                     timestamptz not null default now(),
  search_vector                tsvector generated always as (
    to_tsvector('public.swedish_unaccent'::regconfig,
      coalesce(firma, '') || ' ' || coalesce(juridiskt_namn, '') || ' ' || coalesce(huvudman, '') || ' ' || coalesce(postort, ''))
  ) stored,
  -- Personnummer får aldrig lagras (samma mönster som mtoz, 2026-11-05).
  constraint vd_foretag_inga_nummer check (
        firma !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(juridiskt_namn, '') !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(huvudman, '')       !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(gatuadress, '')     !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(postort, '')        !~ '\d{6}[-+ ]?\d{4}')
);

create index if not exists vd_foretag_kommun_ng1 on public.vd_foretag (kommun, ng1) where publicerad;
create index if not exists vd_foretag_ng1        on public.vd_foretag (ng1) where publicerad;
create index if not exists vd_foretag_postort    on public.vd_foretag (postort) where publicerad;
create index if not exists vd_foretag_sok        on public.vd_foretag using gin (search_vector);
create index if not exists vd_foretag_firma_trgm on public.vd_foretag using gin (firma extensions.gin_trgm_ops);

comment on table public.vd_foretag is
  'Varddelens register (pilot). Matas envägs från mtoz av infofinder-enrichment/scripts/mata_varddelen.py. Rader raderas inte: de avpubliceras (publicerad=false + orsak). Inga personnummer, inga personnamn, inga registertelefoner.';

-- ── Kundinnehåll (engångskopia, beslut B-P7) ────────────────────────────────
-- Infotext, logotyp, webb, kontaktperson och poäng som kunder har i dag i
-- klustret. Fylls EN gång av ett separat skript (visas innan körning); därefter
-- underhålls kundinnehåll via overlay_profil. Telefon och e-post kopieras ALDRIG.
create table if not exists public.vd_kundinnehall (
  cfarnr         bigint primary key references public.vd_foretag (cfarnr),
  poang          integer,
  infotext       text,
  logotyp        text,
  webb           text,
  kontaktperson  text,
  -- 'kund' = poang > 0 vid kopieringen; 'historik' = publicerat innehåll utan kund, kan rensas senare (B-P7).
  kalla          text not null check (kalla in ('kund', 'historik')),
  kopierad_fran  text not null,          -- t.ex. 'ymqb.aesamtable 2026-11-05'
  kopierad_at    timestamptz not null default now(),
  constraint vd_kundinnehall_inga_nummer check (
        coalesce(infotext, '')      !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(kontaktperson, '') !~ '\d{6}[-+ ]?\d{4}'
    and coalesce(webb, '')          !~ '\d{6}[-+ ]?\d{4}')
);

-- ── Dolda (manuella avpubliceringar, kopia av klustrets foretag_dold) ───────
create table if not exists public.foretag_dold (
  cfarnr      bigint primary key,
  nyckel      text,
  arende      text not null,
  created_at  timestamptz not null default now()
);

-- ── Branscher (SNI 2025, SCB:s benämningar) ─────────────────────────────────
create table if not exists public.t_bransch (
  branschid    bigint primary key,           -- SNI 2025 som heltal (86230)
  beskrivning  varchar(200) not null
);

-- ── Sökord (engångskopia från klustret, sedan underhålls här) ───────────────
-- Rader med ogiltigt cfarnr (inte 8 siffror / finns inte i vd_foretag) kopieras inte.
create table if not exists public.sokordtable (
  id             bigint generated always as identity primary key,
  cfarnr         bigint not null references public.vd_foretag (cfarnr),
  sokord         varchar(100),
  sokordsbanner  varchar(100),
  constraint sokordtable_inga_nummer check (
    coalesce(sokord, '') !~ '\d{6}[-+ ]?\d{4}' and coalesce(sokordsbanner, '') !~ '\d{6}[-+ ]?\d{4}')
);
create index if not exists sokordtable_cfarnr on public.sokordtable (cfarnr);
create index if not exists sokordtable_sokord_trgm on public.sokordtable using gin (sokord extensions.gin_trgm_ops);

-- ── 301 och 404/410 ─────────────────────────────────────────────────────────
-- Läses av proxy.ts. En rad per gammal företagssida som inte längre visas.
create table if not exists public.omdirigering (
  fran_cfarnr  bigint primary key,
  status       smallint not null check (status in (301, 404, 410)),
  -- 301: exakt ett mål. Antingen en annan företagssida här, eller en absolut
  -- sökväg/URL (kommun/bransch-sida, regionsdelen.se).
  till_cfarnr  bigint references public.vd_foretag (cfarnr),
  till_url     text check (till_url ~ '^(/|https://(www\.)?(varddelen|regionsdelen)\.se/)'),
  constraint omdirigering_mal check (
    (status = 301 and (till_cfarnr is null) <> (till_url is null)) or
    (status in (404, 410) and till_cfarnr is null and till_url is null)),
  orsak        text not null check (orsak in ('eftertradare', 'ompekning', 'utanfor_urval', 'trafik', 'dod')),
  niva         text,                -- efterträdarnivå (1_samma_je_samma_adress …)
  -- 404 i två veckor, sedan 410 (B-P6). Datumet då 404 blir 410.
  gone_fran    date,
  beslutad_av  text not null,
  beslutad_at  timestamptz not null default now()
);

-- ── Matningslogg ────────────────────────────────────────────────────────────
create table if not exists public.vd_matning (
  id            bigint generated always as identity primary key,
  start_at      timestamptz not null default now(),
  klar_at       timestamptz,
  status        text not null default 'pagar' check (status in ('pagar', 'klar', 'avbruten', 'torr')),
  mtoz_andrad_fran date,              -- läste arbetsstalle.andrad > detta (null = full)
  lasta         integer,
  publicerade   integer,
  nya           integer,
  andrade       integer,
  avpublicerade integer,
  per_orsak     jsonb,
  sek           integer,
  fel           text
);

-- ── Den publika vyn (kontraktet) ────────────────────────────────────────────
create or replace view public.foretag_publik as
select
  f.cfarnr::integer                         as id,
  f.cfarnr,
  f.firma::varchar                          as firma,
  coalesce(f.juridiskt_namn, f.firma)::varchar as namn,
  f.gatuadress::varchar                     as gatuadress,
  f.postnr,
  f.postort::varchar                        as postort,
  f.postort::varchar                        as ort,
  null::varchar                             as tel,
  null::varchar                             as telefon,
  null::varchar                             as epostadress,
  k.webb::varchar                           as webb,
  null::varchar                             as lank,
  f.ng1,
  f.ng1::bigint                             as branschid,
  f.kommun::varchar                         as kommun,
  f.lan::varchar                            as lan,
  f.aeant,
  f.orgnr,
  f.ar_enskild_firma,
  f.jurform::integer                        as jurform,
  f.search_vector,
  k.infotext,
  k.logotyp::varchar                        as logotyp,
  k.kontaktperson::varchar                  as kontaktperson,
  k.poang,
  null::text                                as orgnr_maskerat,
  1                                         as aeant_per_stalle,
  f.huvudman,
  f.innehaller_fullt_personnamn
from public.vd_foretag f
left join public.vd_kundinnehall k using (cfarnr)
where f.publicerad
  and not exists (select 1 from public.foretag_dold d where d.cfarnr = f.cfarnr);

comment on view public.foretag_publik is
  'Pilotens publika yta, samma kolumner som klustrets foretag_publik (+ huvudman, innehaller_fullt_personnamn). tel/epost/orgnr_maskerat alltid NULL.';

-- ── Rättigheter ─────────────────────────────────────────────────────────────
-- Samma princip som klustret: anon läser bara den publika ytan, aldrig råtabeller.
alter table public.vd_foretag      enable row level security;
alter table public.vd_kundinnehall enable row level security;
alter table public.foretag_dold    enable row level security;
alter table public.t_bransch       enable row level security;
alter table public.sokordtable     enable row level security;
alter table public.omdirigering    enable row level security;
alter table public.vd_matning      enable row level security;

revoke all on public.vd_foretag, public.vd_kundinnehall, public.foretag_dold, public.omdirigering, public.vd_matning
  from public, anon, authenticated;
revoke all on public.t_bransch, public.sokordtable from public, anon, authenticated;
revoke all on public.foretag_publik from public, anon, authenticated;

grant select on public.foretag_publik to anon, authenticated;
grant select on public.t_bransch, public.sokordtable to anon, authenticated;
drop policy if exists t_bransch_publik on public.t_bransch;
create policy t_bransch_publik on public.t_bransch for select to anon, authenticated using (true);
drop policy if exists sokordtable_publik on public.sokordtable;
create policy sokordtable_publik on public.sokordtable for select to anon, authenticated using (true);
-- omdirigering läses av proxy.ts med service role (kringgår RLS); ingen publik läsning.
grant select, insert, update, delete on public.vd_foretag, public.vd_kundinnehall, public.foretag_dold,
  public.t_bransch, public.sokordtable, public.omdirigering, public.vd_matning to service_role;
