-- ============================================================================
-- overlay-hardening-001 — låst search_path på overlay-funktionerna
-- ============================================================================
-- Körs EFTER lib/sql/overlay.sql. Separat fil därför att overlay.sql är fryst
-- (overlay-kontrakt v1) och inte får ändras.
--
-- Bakgrund: Supabase säkerhetslinter flaggar båda funktionerna med
-- "function_search_path_mutable" (WARN). En funktion utan egen search_path
-- ärver anroparens, och en anropare som lagt till ett eget schema först i
-- sökvägen kan då styra vilken `overlay_profil` eller vilken operator som
-- funktionen faktiskt träffar.
--
-- Exponeringen är begränsad redan innan den här filen: ingen av funktionerna
-- är security definer, och overlay_publicera() får bara köras av service_role.
-- Men båda skriver mot tabeller utan schemakvalificering, så att binda
-- sökvägen är rätt sak att göra och kostar ingenting.
--
-- pg_temp ligger SIST med flit. Ligger det först kan en anropare skapa ett
-- temporärt objekt som skuggar det riktiga.
--
-- ALTER FUNCTION används i stället för CREATE OR REPLACE: funktionskropparna
-- ägs av overlay.sql och ska inte dupliceras här. ALTER rör heller inte
-- befintliga grants.
--
-- VARNING: `create or replace function` nollställer SET-klausuler. Körs
-- overlay.sql om måste den här filen köras om direkt efteråt.
--
-- Idempotent: kan köras om utan att skada något.
-- ============================================================================

alter function public.overlay_profil_satt_updated_at()
  set search_path = public, pg_temp;

alter function public.overlay_publicera(jsonb)
  set search_path = public, pg_temp;
