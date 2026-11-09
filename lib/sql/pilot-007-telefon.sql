-- ============================================================================
-- pilot-007-telefon — "Visa nummer" och visningsstatistik (KÖRD i varddelen 2026-11-09)
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), efter pilot-006. Idempotent.
--
--   vd_telefon        AFR-numret per arbetsställe, matat av mata_varddelen.py. Bara
--                     service role. Aldrig i foretag_publik (där är tel/telefon NULL).
--   telefon_visning   antal visningar per (cfarnr, dag). Inga IP, cookies eller UA.
--   vd_telefon_visa() routens ENDA väg till ett nummer: kund (overlay) före AFR,
--                     kontaktspärren och EF-regeln tillämpas vid VARJE läsning,
--                     och visningen räknas i samma anrop.
--   vd_har_telefon()  sidans fråga "finns ett nummer?" — svarar bara ja/nej.
--   telefon_visningar() statistiken per företag och period (för CRM-förslaget).
--
-- Regler (beslut 2026-11-09):
--   1. kundens nummer (overlay_profil.telefon_override)  2. SCB AFR  — aesamtable aldrig.
--   Enskild firma: bara fast nummer, utom när firman är kund (aktiv overlay).
--   Kontaktspärren gäller alltid, även för kundens eget nummer.
-- ============================================================================
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ── vd_telefon ──────────────────────────────────────────────────────────────
create table if not exists public.vd_telefon (
  cfarnr        bigint primary key references public.vd_foretag (cfarnr) on delete cascade,
  telefon_norm  text not null check (telefon_norm ~ '^46[1-9][0-9]{6,10}$'),
  typ           text not null check (typ in ('fast', 'mobil')),
  kalla         text not null default 'scb-afr' check (kalla = 'scb-afr'),
  hamtad_at     timestamptz not null default now(),
  constraint vd_telefon_typ check ((typ = 'mobil') = (telefon_norm ~ '^467[02369]'))
);
comment on table public.vd_telefon is
  'pilot-007: SCB AFR-telefon per arbetsställe (källa scb-afr). Bara service role. Visas bara via vd_telefon_visa().';
alter table public.vd_telefon enable row level security;
revoke all on public.vd_telefon from anon, authenticated;
grant select, insert, update, delete on public.vd_telefon to service_role;

-- Lager 1: ett kontaktspärrat nummer skrivs aldrig in (raden hoppas över).
create or replace function public.vd_telefon_fore_skrivning()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from kontaktsparr k
              where k.status = 'aktiv' and k.typ = 'telefon'
                and (k.sajt is null or k.sajt = 'varddelen') and k.nyckel = new.telefon_norm) then
    return null;
  end if;
  new.hamtad_at := now();
  return new;
end $$;
drop trigger if exists vd_telefon_fore_skrivning on public.vd_telefon;
create trigger vd_telefon_fore_skrivning before insert or update on public.vd_telefon
  for each row execute function public.vd_telefon_fore_skrivning();

-- ── telefon_visning ─────────────────────────────────────────────────────────
create table if not exists public.telefon_visning (
  cfarnr  bigint not null check (cfarnr between 1 and 99999999),
  datum   date   not null,
  antal   integer not null default 0 check (antal >= 0),
  primary key (cfarnr, datum)
);
comment on table public.telefon_visning is
  'pilot-007: "Visa nummer"-klick per arbetsställe och dag. Inga IP-adresser, cookies eller user agents.';
alter table public.telefon_visning enable row level security;
revoke all on public.telefon_visning from anon, authenticated;
grant select, insert, update on public.telefon_visning to service_role;

-- ── Läsningen ───────────────────────────────────────────────────────────────
-- Är numret spärrat just nu? (Lager 2: spärrar som kommit EFTER matningen.)
create or replace function public.vd_telefon_sparrad(p_norm text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from kontaktsparr k
                  where k.status = 'aktiv' and k.typ = 'telefon'
                    and (k.sajt is null or k.sajt = 'varddelen') and k.nyckel = p_norm)
$$;

-- Numret som får visas för ett arbetsställe, eller ingen rad.
create or replace function public.vd_telefon_valj(p_cfarnr bigint)
returns table (telefon_norm text, kalla text)
language plpgsql stable security definer set search_path = public as $$
declare
  ef    boolean;
  kund  boolean;
  eget  text;
  afr   record;
begin
  select v.ar_enskild_firma into ef from vd_foretag v where v.cfarnr = p_cfarnr and v.publicerad;
  if not found then return; end if;
  select kontakt_normalisera_telefon(nullif(btrim(o.telefon_override), '')), true
    into eget, kund
    from overlay_profil o
   where o.sajt = 'varddelen' and o.status = 'aktiv' and o.external_id = p_cfarnr::text
   order by o.revision desc limit 1;
  kund := coalesce(kund, false);
  -- 1. Kundens eget nummer (valfri typ, också för enskild firma).
  if eget is not null and not vd_telefon_sparrad(eget) then
    telefon_norm := eget; kalla := 'kund'; return next; return;
  end if;
  -- 2. SCB AFR. Enskild firma som inte är kund: bara fast nummer.
  select t.telefon_norm, t.typ into afr from vd_telefon t where t.cfarnr = p_cfarnr;
  if found and not vd_telefon_sparrad(afr.telefon_norm)
     and not (ef and not kund and afr.typ = 'mobil') then
    telefon_norm := afr.telefon_norm; kalla := 'scb-afr'; return next;
  end if;
end $$;

-- Routens anrop: väljer numret och räknar visningen (om p_rakna) i samma transaktion.
create or replace function public.vd_telefon_visa(p_cfarnr bigint, p_rakna boolean)
returns table (telefon_norm text, kalla text)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query select v.telefon_norm, v.kalla from vd_telefon_valj(p_cfarnr) v;
  if found and p_rakna then
    insert into telefon_visning as t (cfarnr, datum, antal)
    values (p_cfarnr, (now() at time zone 'Europe/Stockholm')::date, 1)
    on conflict (cfarnr, datum) do update set antal = t.antal + 1;
  end if;
end $$;

-- Sidans fråga: finns ett nummer att visa? Bara ja/nej, aldrig numret.
create or replace function public.vd_har_telefon(p_cfarnr bigint[])
returns setof bigint language sql stable security definer set search_path = public as $$
  select c from unnest(p_cfarnr) c where exists (select 1 from vd_telefon_valj(c))
$$;

-- Statistiken: visningar per arbetsställe i en period (för CRM:et, via sajten).
create or replace function public.telefon_visningar(p_cfarnr bigint[], p_fran date, p_till date)
returns table (cfarnr bigint, antal bigint)
language sql stable security definer set search_path = public as $$
  select t.cfarnr, sum(t.antal)::bigint from telefon_visning t
   where t.cfarnr = any (p_cfarnr) and t.datum between p_fran and p_till
   group by t.cfarnr
$$;

do $$
declare f text;
begin
  foreach f in array array['vd_telefon_sparrad(text)', 'vd_telefon_valj(bigint)', 'vd_telefon_visa(bigint,boolean)',
                           'vd_har_telefon(bigint[])', 'telefon_visningar(bigint[],date,date)',
                           'vd_telefon_fore_skrivning()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── Vakten (samma som pilot-006, med de nya objekten) ──────────────────────
do $$
declare x text;
begin
  select string_agg(c.relname, ', ') into x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S')
     and (has_table_privilege('anon', c.oid, 'insert,update,delete,truncate,references,trigger')
          or (has_table_privilege('anon', c.oid, 'select')
              and c.relname not in ('foretag_publik', 't_bransch', 'sokordtable', 'overlay_profil')));
  if x is not null then raise exception 'anon når för mycket: %', x; end if;
  if has_table_privilege('anon', 'public.vd_telefon', 'select')
     or has_table_privilege('anon', 'public.telefon_visning', 'select')
     or has_table_privilege('authenticated', 'public.vd_telefon', 'select')
     or has_table_privilege('authenticated', 'public.telefon_visning', 'select') then
    raise exception 'anon/authenticated når telefontabellerna';
  end if;
  select string_agg(p.proname, ', ') into x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('kontaktsparr_forfilter', 'overlay_ar_sparrade');
  if x is not null then raise exception 'anon kan köra: %', x; end if;
  -- foretag_publik får aldrig börja bära ett nummer.
  if exists (select 1 from foretag_publik where tel is not null or telefon is not null limit 1) then
    raise exception 'foretag_publik bär telefonnummer';
  end if;
  raise notice 'pilot-007: telefontabellerna bara för service role; anon oförändrat';
end $$;

commit;
