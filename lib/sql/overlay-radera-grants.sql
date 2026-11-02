-- ============================================================================
-- overlay-radera-grants.sql — tabellrättigheten för spärrtabellen (kontrakt 1.6)
-- ============================================================================
-- Körs EFTER overlay-radera.sql, en gång för hela klustret. Idempotent.
--
-- Klustret är en migrerad legacy-bas utan Supabases default-privilegier (se
-- OVERLAY.md, "Varför grants-filen behövs"). overlay-radera.sql återkallar
-- anon och authenticated men grantar inget till service_role, så utan den här
-- filen svarar DELETE /api/overlay/<nyckel> 500: "permission denied".
--
-- Läsningen går genom overlay_sparrade_nycklar() (security definer) och
-- behöver inte detta. Skrivningen är en upsert med ON CONFLICT DO NOTHING:
-- select och insert räcker. Ingen update eller delete — en spärr hävs för
-- hand, med ett beslut bakom.
-- ============================================================================

grant select, insert on table public.overlay_foretag_sparr to service_role;
