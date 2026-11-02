-- ============================================================================
-- overlay-radera.sql — mottagarens spärrtabell för "Ta bort företag" (kontrakt 1.6)
-- ============================================================================
-- Körs i SAJTENS databas, en gång. Idempotent. I det delade klustret
-- (vårddelen/hantverkardelen/regionsdelen) körs den en gång; `sajt` skiljer
-- raderna åt, och varje sajt får sin egen rad när CRM:et raderar.
--
-- Källdata rörs inte: `foretag`, `aesamtable` m.fl. är read-only. Ett raderat
-- bolags basrad står kvar där; den här tabellen är det sajten minns om att
-- bolaget är borta. Rendering, listor, sök och sitemap läser den.
--
-- ÅTKOMST: anon och authenticated har ingen rätt i tabellen. Sajten läser med
-- service role på servern, eller genom en av de två funktionerna nedan:
--
--   overlay_sparrade_nycklar(sajt)      alla nycklar — sitemap, listor. Bara service role.
--   overlay_ar_sparrade(sajt, nycklar)  vilka av DE HÄR nycklarna som är spärrade.
--                                       anon får anropa den: den avslöjar bara
--                                       det en 404 på sidan ändå avslöjar.
-- ============================================================================

create table if not exists public.overlay_foretag_sparr (
  sajt         text not null,
  nyckel       text not null,
  radering_id  uuid not null,
  sparrad_at   timestamptz not null default now(),
  primary key (sajt, nyckel),
  -- Samma form som kontraktets provaRaderaNyckel(). Personnummerregeln står i
  -- koden; här räcker formen.
  constraint overlay_foretag_sparr_nyckel_form
    check (nyckel ~ '^([0-9]{10}|cfar-[0-9]{1,8}|ef-[0-9a-f]{24})$')
);

comment on table public.overlay_foretag_sparr is
  'Bolag raderade genom CRM:ets "Ta bort företag" (overlay-kontrakt 1.6). Sajten visar dem inte, även om basraden finns kvar i registret.';

alter table public.overlay_foretag_sparr enable row level security;
revoke all on public.overlay_foretag_sparr from anon, authenticated;
-- Uttryckligen: klustret har inga default-privilegier (OVERLAY.md), och
-- endpointen skriver med service role.
grant select, insert on public.overlay_foretag_sparr to service_role;

create or replace function public.overlay_sparrade_nycklar(p_sajt text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.nyckel from public.overlay_foretag_sparr s where s.sajt = p_sajt;
$$;

revoke all on function public.overlay_sparrade_nycklar(text) from public, anon, authenticated;
grant execute on function public.overlay_sparrade_nycklar(text) to service_role;

create or replace function public.overlay_ar_sparrade(p_sajt text, p_nycklar text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.nyckel from public.overlay_foretag_sparr s
  where s.sajt = p_sajt and s.nyckel = any (p_nycklar);
$$;

revoke all on function public.overlay_ar_sparrade(text, text[]) from public;
grant execute on function public.overlay_ar_sparrade(text, text[]) to anon, authenticated, service_role;
