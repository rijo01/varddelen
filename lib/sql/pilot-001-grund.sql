-- ============================================================================
-- pilot-001-grund — overlay och kontaktspärr i varddelen-projektet (PILOT)
-- ============================================================================
-- KÖRS I VARDDELEN-PROJEKTET (babenztvwzaiesducpja), FÖRST.
-- Overlay och kontaktspärr är sajtens egna objekt och finns redan som filer.
-- De körs OFÖRÄNDRADE, i den här ordningen, med psql från repots rot:
--
--   \i lib/sql/overlay.sql
--   \i lib/sql/overlay-v1.1.sql
--   \i lib/sql/overlay-hardening-001.sql
--   \i lib/sql/overlay-hardening-002-grants.sql
--   \i lib/sql/overlay-kontaktsparr.sql
--
-- Därefter den här filens egna tillägg (nedan), sedan pilot-002 och pilot-003.
-- kontaktsparr-kluster.sql körs INTE: den läser aesamtable. Pilotens version
-- av kontaktsparr_berorda() ligger i pilot-003.
-- ============================================================================

\ir overlay.sql
\ir overlay-v1.1.sql
\ir overlay-hardening-001.sql
\ir overlay-hardening-002-grants.sql
\ir overlay-kontaktsparr.sql

-- Klustrets kontaktsparr_handelse har fått kolumnen cfarnr (bigint[]) utanför
-- repots filer. Samma kolumn här, så att CRM:ets läsning fungerar likadant.
alter table public.kontaktsparr_handelse add column if not exists cfarnr bigint[];

-- Logotyper: bucketen overlay-logos skapas i Storage (publik läsning), som i
-- klustret. Görs i pilotsteget "kopiera overlay", inte här.
