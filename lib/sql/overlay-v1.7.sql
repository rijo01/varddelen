-- Kontrakt 1.7: profilnivån och 1.7-fälten i overlay_profil.
--
-- Körs EN gång för hela klustret (ymqbimerrvycbknstsai), EFTER att koden som
-- tål båda schemana är ute (lib/overlay.ts läser profilniva med reserv):
--
--   supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/overlay-v1.7.sql
--
-- Tabellen och overlay_publicera() delas med hantverkardelen och regionsdelen.
-- Allt här är tillägg: deras mottagare skickar ingen nivå, och null betyder
-- "före 1.7" = betald. Funktionskroppen är den som låg live 9 nov 2026
-- (overlay-v1.1.sql), med profilniva och utokat i båda kolumnlistorna —
-- listorna är explicita, och en ny kolumn som inte står med faller annars
-- tyst bort vid varje publicering. Idempotent.

alter table public.overlay_profil add column if not exists profilniva text;
alter table public.overlay_profil add column if not exists utokat jsonb;

comment on column public.overlay_profil.profilniva is
  'Kontrakt 1.7: kontakt | gratis | betald. null = rad från före 1.7 = betald; okänt värde = kontakt. Läs genom tolkaProfilniva().';
comment on column public.overlay_profil.utokat is
  'Kontrakt 1.7: beskrivning, tjänster, öppettider m.m. (Berika och aktiveringen). Lagras, renderas inte än.';

create or replace function public.overlay_publicera(p_rad jsonb)
 RETURNS TABLE(id uuid, revision integer, status text)
 LANGUAGE plpgsql
AS $$
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
      adress_override_besok, bas, skapa_om_saknas,
      -- 1.7
      profilniva, utokat
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
      coalesce(r.skapa_om_saknas, false),
      r.profilniva, r.utokat
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
      skapa_om_saknas       = coalesce(r.skapa_om_saknas, false),
      -- 1.7. Skrivs alltid, även till null: en rad som publiceras om utan nivå
      -- (en sajt före 1.7, eller hantverkardelen/regionsdelen) är betald.
      profilniva            = r.profilniva,
      utokat                = r.utokat
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

-- create or replace nollställer SET-klausulen (se overlay-v1.1.sql).
alter function public.overlay_publicera(jsonb)
  set search_path = public, pg_temp;
