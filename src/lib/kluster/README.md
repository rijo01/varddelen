# Klustrets delade moduler

Filerna i den här katalogen ska vara **byte för byte identiska** på
hantverkardelen.se, regionsdelen.se och vårddelen.se. Sajterna delar databas
(`ymqbimerrvycbknstsai`), kontaktspärr och overlay-profiler. En regel som skiljer
sig mellan sajterna gör att en spärrad eller dold uppgift syns på en av dem, eller
att en sajt revaliderar fel adress när en kund publicerar.

| Fil | Regel |
|---|---|
| `personuppgifter.ts` | DE.82: inga telefonnummer ur registret för andra än kunder (`poang > 0`). Ingen privat e-post, kontaktperson eller "EFTERNAMN, FÖRNAMN". |
| `foretag-slug.ts` | Företagssidans slug, efter namnregeln. |
| `klassning.ts` | Rättade branschnamn och yrke per företag. `aesamtable` rörs aldrig. |
| `anstallda.ts` | Storleksklass (`anstkl`) som intervall. `aeant` är antal arbetsställen. |
| `register.ts` | Registrets ålder. |

**Källan är hantverkardelen-se.** Ändra bara här och kör sedan:

```sh
node scripts/kluster-synk.mjs            # kopierar till ../regionsdelen-ny och ../varddelen-se
node scripts/kluster-synk.mjs --kontroll # avslutar med fel om någon kopia skiljer sig
```

Sajtspecifikt, utanför katalogen: ögonblicksbilden `storleksklass-snapshot.ts`
(per sajts branscher) och var reglerna kopplas in (`queries.ts` → `mapRow`).
