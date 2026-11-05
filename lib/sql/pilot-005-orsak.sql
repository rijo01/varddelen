-- ============================================================================
-- pilot-005-orsak — avpubliceringsorsaker, omdirigeringsorsaker och kundspärren (2026-11-05)
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-004. Idempotent.
--
--   vd_foretag.avpublicerad_orsak  + 'utan_namn' (juridisk person utan namn i mtoz,
--                                    eller namn med personnummermönster)
--   omdirigering.orsak             + 'policy' (verksam i urvalet men publiceras inte, B-P8:
--                                    EF utan publicerbart firmanamn, offentlig i 88101/88102, namnlös)
--   omdirigering.aktiv             proxy.ts läser BARA aktiva rader
--   omdirigering.kund_granskas     KUNDSPÄRREN: en sida för en kund (betalning senaste 24 mån;
--                                    tills Fortnox-exporten finns: alla med vd_kundinnehall.kalla='kund'
--                                    eller poang > 0 i klustret) läggs in som FÖRSLAG, aktiv = false.
--                                    Den kan inte aktiveras förrän kund_granskas sätts till false av
--                                    Rickard (granskad_av/granskad_at). Lanseringen spärras så länge
--                                    det finns ogranskade kundrader (se kontrollfrågan sist).
-- ============================================================================
begin;
set local lock_timeout = '5s';

alter table public.vd_foretag drop constraint if exists vd_foretag_avpublicerad_orsak_check;
alter table public.vd_foretag add constraint vd_foretag_avpublicerad_orsak_check check (avpublicerad_orsak in
  ('upphord', 'utanfor_urval', 'ej_firmanamn', 'offentlig_huvudman', 'saknas_i_afr', 'utan_namn'));

alter table public.omdirigering drop constraint if exists omdirigering_orsak_check;
alter table public.omdirigering add constraint omdirigering_orsak_check check (orsak in
  ('eftertradare', 'ompekning', 'utanfor_urval', 'trafik', 'dod', 'policy'));

alter table public.omdirigering add column if not exists aktiv          boolean not null default true;
alter table public.omdirigering add column if not exists kund_granskas  boolean not null default false;
alter table public.omdirigering add column if not exists granskad_av    text;
alter table public.omdirigering add column if not exists granskad_at    timestamptz;
alter table public.omdirigering drop constraint if exists omdirigering_kund_spärr;
alter table public.omdirigering add constraint omdirigering_kund_spärr check (not (kund_granskas and aktiv));

comment on column public.omdirigering.kund_granskas is
  'Kundspärren: sant = kundsida som väntar på Rickards granskning. Får inte vara aktiv. Lanseringen kräver 0 sådana rader.';

-- Kommun-/branschsidor vars SNI-kod bytt nummer. Branschsidan läser koden ur slugens sista
-- siffror (/kommun/<k>/<namn>-<kod>[/sida/N]), så regeln gäller på kodnivå för alla kommuner:
--   /kommun/<k>/<valfritt>-<fran_ng1>[/sida/N]  →  301  /kommun/<k>/<till_slug>-<till_ng1>[/sida/N]
--   till_ng1 NULL (koden togs bort ur urvalet)   →  301  /kommun/<k>
create table if not exists public.omdirigering_sni (
  fran_ng1     integer primary key,
  till_ng1     integer,
  till_slug    text check (till_slug ~ '^[a-z0-9-]+$'),
  constraint omdirigering_sni_mal check ((till_ng1 is null) = (till_slug is null)),
  orsak        text not null check (orsak in ('sni_bytt', 'sni_delad', 'sni_borttagen')),
  -- sni_delad: SCB delade koden; målet är den nya kod som har flest publicerade arbetsställen
  alla_mal     integer[],
  beslutad_at  timestamptz not null default now()
);
alter table public.omdirigering_sni enable row level security;
revoke all on public.omdirigering_sni from public, anon, authenticated;
grant select, insert, update, delete on public.omdirigering_sni to service_role;
drop table if exists public.omdirigering_sida;
commit;

-- Kontroll före lansering (ska vara 0):
--   select count(*) from public.omdirigering where kund_granskas;
