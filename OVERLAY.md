# Overlay — betald synlighet på Vårddelen

Mottagaren för **overlay-kontrakt v1.1**. Kontraktets original ligger i
`~/Projects/skiffer-crm/packages/overlay-contract`; `src/lib/overlay-contract.ts`
är en **byte-identisk kopia** och får aldrig ändras lokalt. En avvikelse där är
en signatur som inte stämmer.

## Vad det är

CRM:et (Skiffer CRM) säljer synlighet på sajten. Det POSTar ett HMAC-signerat
paket till `/api/overlay/publish`, sajten validerar det mot samma schema och
skriver en rad i sin **egen** databas.

Tre saker följer av det, och de är hela poängen:

- **Push, inte pull.** Sajten hämtar aldrig något från CRM:et. Ligger CRM:et
  nere renderar sidorna precis som vanligt.
- **CRM:et har inga databasnycklar hit.** Enda vägen in är endpointen.
- **Källdata är read-only.** `foretag_publik`, `aesamtable` och `sokordtable`
  rörs aldrig av det här lagret.

## Identiteten: två nivåer

Företagssidan är nycklad på **cfarnr** (`/foretag/<namn>-<cfarnr>`), alltså på
arbetsstället. Men ett bolag med tolv arbetsställen ska gå att sälja i ett svep.
Därför tar mottagaren emot båda:

| `entity_type` | `external_id` | Träffar |
|---|---|---|
| `arbetsstalle` | cfarnr | en företagssida |
| `bolag` | orgnr (bara siffror) | alla arbetsställen med det orgnumret |

**Finns båda vinner arbetsstället.** Det mest specifika köpet är det som
beskriver just den adressen.

Nivåerna behövs också av ett tråkigare skäl: `foretag_publik` nollar `orgnr` för
enskild firma — där är källkolumnen ett personnummer som vyn maskar bort. En
enskild firma har alltså inget orgnr att sälja på, och hade `bolag` varit enda
nivån gick de inte att sälja alls.

## Databasen

Tabellen `overlay_profil` ligger i det **delade** klustret
(`ymqbimerrvycbknstsai`) tillsammans med hantverkardelen och regionsdelen. Den är
gemensam; `sajt`-kolumnen skiljer raderna åt, och varje query i
`src/lib/overlay.ts` filtrerar på den.

Filerna körs i ordning, **en gång för hela klustret**:

```bash
supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/overlay.sql
supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/overlay-hardening-001.sql
supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/overlay-hardening-002-grants.sql
supabase db query --linked --project-ref ymqbimerrvycbknstsai -f lib/sql/overlay-v1.1.sql
```

- `overlay.sql` — kontraktets frysta v1-schema. Ändras aldrig.
- `overlay-hardening-001.sql` — låser `search_path` på funktionerna.
- `overlay-hardening-002-grants.sql` — **tabellrättigheterna.** Utan den här
  fungerar ingenting, och det ena av de två felen är tyst. Se nedan.
- `overlay-v1.1.sql` — 1.1-fälten, och `contract_version` från `integer` till
  `numeric(4,2)`. Utan typbytet avrundas 1.1 tyst till 1 och raden ljuger om
  sitt ursprung. Filen kör om härdningen själv, eftersom
  `create or replace function` nollställer `SET`-klausuler.

Alla fyra är idempotenta.

### Varför grants-filen behövs

`overlay.sql` sätter RLS och en policy, men grantar aldrig några
tabellrättigheter — den utgår från Supabases standard, där nya tabeller i
`public` automatiskt får grants via `alter default privileges`. **Det här
klustret är en migrerad legacy-bas och har inte de default-privilegierna.**
Avläst ur `information_schema.role_table_grants` 2026-09-16: `overlay_profil`
hade `REFERENCES, TRIGGER, TRUNCATE` för både `anon` och `service_role`, och
ingenting annat.

Följden är två fel som ser ut som olika saker:

1. Endpointen svarar 500 på varje publicering — `service_role` får
   `permission denied for table`. Det syns direkt.
2. **En RLS-policy utan SELECT-grant släpper igenom ingenting.** Policyn är en
   filtrering av en rättighet man redan har, inte en tilldelning av den. Sajten
   hade renderat varje betald profil som tom, utan felmeddelande — `lib/overlay.ts`
   svarar `null` på ett läsfel och sidan faller tillbaka på registerdatan.
   Sålt, publicerat, osynligt.

Det andra är det farliga. Verifieringssviten fångar båda.

Bucketen `overlay-logos` är publik, har 500 kB-tak och tillåter bara
`image/png`, `image/jpeg` och `image/webp` — samma gränser som kontraktet, men
satta i bucketen så att de gäller även om koden skulle svikta. Filnamnet är
`<sajt>/<entity_type>/<external_id>.<ext>`; prefixet behövs därför att tre
sajter delar bucket och ett orgnr annars kunde kollidera med ett cfarnr.

## Miljövariabler

| Namn | Var | Varför |
|---|---|---|
| `OVERLAY_PUBLISH_SECRET` | Vercel, alla miljöer | HMAC-nyckeln. Samma värde som `OVERLAY_SECRET_VARDDELEN` i CRM:et. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, alla miljöer | Endpointen skriver i `overlay_profil` och läser utkast. RLS har med flit ingen skrivpolicy. |
| `NEXT_PUBLIC_SUPABASE_URL` | finns redan | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | finns redan | |
| `NEXT_PUBLIC_SITE_URL` | finns redan | Bygger `preview_url`. |

`SUPABASE_SERVICE_ROLE_KEY` är ett medvetet undantag från regeln i
`src/lib/supabase.ts` om att sajten aldrig rör service-role-nyckeln. Gränsen
upprätthålls i stället av `src/lib/supabase-admin.ts`: den är märkt
`server-only`, så en import från en klientkomponent blir ett byggfel, och den
rör bara `overlay_profil` och bucketen — aldrig `foretag_publik`.

## Ytorna

| Yta | Hur den påverkas |
|---|---|
| `/foretag/<slug>` | Profilkortet under huvudet. `dolj_andra_nummer`, `popularnamn`. Indexerbarheten rörs inte — se nedan. |
| `/foretag/<slug>/forhandsvisning` | Utkastet bakom `?preview=<token>`. Alltid noindex, aldrig cachad. |
| `/kommun/<slug>` | Listordning + logotyp och "Utvald" i kortet. |
| `/kommun/<slug>/<bransch>` | Samma. |
| `/sok` | Samma. Force-dynamic, så en publicering syns direkt. |

Företagssidan är delad i `page.tsx` (tunn, ISR) och `ForetagSida.tsx` (allt
innehåll). Delningen finns för att förhandsvisningen ska kunna återanvända
sidan: hade den publika sidan läst `searchParams` för att hitta `?preview=`
hade varenda sidvisning blivit en serverrendering, och ISR varit borta för hela
katalogen.

### Vad lyftet inte gör

`ordnaBoostade()` sorterar **den hämtade sidan**, inte hela träffmängden.
Raderna kommer redan paginerade från PostgREST, så en featured kund som
databasordningen lagt på sidan 3 lyfts till toppen av sidan 3 — inte till sidan
1. Samma begränsning som åkeriguidens motsvarighet.

Det är rätt avvägning så länge kunder också har `poang` i registret, för `poang`
sorteras i databasen och avgör alltså vilken sida de hamnar på. Ska en
overlay-kund **utan** `poang` garanterat nå sidan 1 måste lyftet ske i frågan,
inte i JS.

### Indexerbarheten rörs INTE här

På Vårddelen avgörs `robots` av ett **förberäknat urval**
(`src/data/indexable.json`, byggt av `scripts/build-index-set.mjs`), och
`scripts/check-sitemap-noindex.mjs` körs som `prebuild` och avbryter bygget om
en URL ligger i sitemapen och samtidigt svarar noindex.

Overlay kopplas därför **inte** in i den grinden. En overlay-kund vars cfarnr
inte finns i urvalet får alltså en publicerad, betald profil på en sida som är
`noindex, follow`.

Det är ett medvetet val, inte ett förbiseende: att låta ett runtime-uppslag mot
databasen styra robots hade brutit invarianten som hela modulen vilar på —
samma två arrayer ska driva både robots-uppslaget och sitemapen. Att lösa det
kräver ett beslut om vilket, och båda vägarna finns:

- lägg kunden i `PROVEN_DEMAND_FORETAG` i `src/lib/indexability.ts` (bär både
  cfarnr och slug, så invarianten håller), eller
- kör om `npm run build:index` så att kundens sida kommer med i urvalet.

Byggspärren följer sedan utrullningen återexporten `export { generateMetadata }
from "./ForetagSida"` ett steg, så att den granskar filen som faktiskt äger
metadatan. Kontrollen är lika hård som förut — den pekar bara på rätt fil.

### `bas` och `skapa_om_saknas`

Fälten tas emot, valideras och **lagras** — men sajten renderar ännu ingen
fristående profil för ett bolag som saknas i registret. Kontraktet tillåter
båda hållningarna ("sajten avgör själv vad den gör"), och att skriva en rad i
`foretag_publik` är uteslutet: källdata är read-only.

En fristående profilsida är en ny route med egna SEO- och sitemap-följder, och
den är medvetet inte byggd här. Tills den finns är `bas` lagrad men osynlig.

## Indexerbarhet och sitemap

**En betald profil ligger aldrig på en noindex-sida.** Kunden betalar för
synlighet i Google; en sida som ber Google att inte visa den är inte en
avvägning utan en produkt som inte levereras.

Regeln gäller på två ytor, och de kan glida isär var för sig:

| Yta | Hur | Fördröjning |
|---|---|---|
| `robots`-metan på företagssidan | `robotsForForetagMedOverlay()` — betald profil ⇒ `index, follow` | **omedelbar** |
| `/sitemap.xml` | unionerar urvalet med `overlayIndexerbaraSokvagar()` | **upp till en timme** |

Fördröjningen i sitemapen är mätt, inte antagen. `/api/overlay/publish` anropar
`revalidatePath("/sitemap.xml")`, men mot produktion 2026-09-16 slog det inte
igenom på 300 sekunder: `x-vercel-cache` svarade `HIT` hela vägen och `age`
växte i takt med klockan. Sidrevalideringen fungerar — steg 1 i sviten bevisar
det — men metadata-routens edge-cache rörs inte. Den verkliga gränsen är
`revalidate = 3600` i `sitemap.ts`.

Det är ofarligt: en sitemap är en ledtråd för upptäckt, och Google hämtar den på
sin egen kadens ändå, oftast en gång per dygn. Det som måste gälla omedelbart är
robots-metan, och den gör det.

Byggspärren kräver båda hållen: att sidan frågar den bredare regeln, och att
sitemapen tar med de betalda profilerna. Sviten kontrollerar robots-metan i
varje körning; sitemapen kan väntas ut med `--sitemap`.

## Verifiering

```bash
npm run overlay:verifiera -- --cfarnr <cfarnr> --url https://varddelen.se
```

Skriptet **skriver i produktion**. Det vägrar därför köra mot ett cfarnr som
redan har en overlay-rad — en riktig kund ska inte kunna bli testdata — och
städar alltid efter sig, även när ett steg faller. Städningen släpps inte lös
förrän steg 0 slagit fast att identiteten var ledig; ett nätverksfel mitt i
förutsättningskontrollen ska inte kunna leda till att vi raderar för någon
annan.

Ligger deployen bakom Vercel Authentication: sätt
`VERCEL_AUTOMATION_BYPASS_SECRET` i miljön. Skriptet läser den bara ur miljön,
aldrig som flagga — ett kommandoradsargument hamnar i skalets historik.

## Vad som återstår på CRM-sidan

Mottagaren är på 1.1. **Avsändaren är det inte**, och förrän den är det kommer
1.1-fälten aldrig att användas:

1. `sajter.contract_version` i skiffer-crm är `integer` och kan inte lagra 1.1.
   Kolumnen behöver bli `numeric`.
2. Seeden (`supabase/seed.sql`) sätter `contract_version = 1` för alla sajter.
   Vårddelen, vårddelen och regionsdelen behöver 1.1.
3. Samma seed sätter `aktiv = false` för de tre sajterna. De kan inte publiceras
   till förrän flaggan vänds.

Inget av det är farligt så länge det står kvar: en 1.1-mottagare validerar en
1.0-payload oförändrat. Men 1.1 är då bara nedlagt arbete.

## Regler som inte får tummas på

- **Läs aldrig en identitet utan statusfilter.** Mellan en förhandsvisning och
  en publicering har identiteten två rader. En `SELECT` utan `status`-filter
  får då båda — `.single()` blir ett fel och `.limit(1)` en slumpvis vinnare, i
  värsta fall utkastet, publikt. Använd `publikOverlayMatch()` och
  `arPubliktSynlig()`.
- **Filtrera alltid på `sajt`.** Tabellen är delad med hantverkardelen och
  regionsdelen.
- **`info_html` saneras i mottagaren**, aldrig i CRM:et.
- **`unpublish` rör aldrig logotypfilen.** En kund som publiceras igen ska få
  tillbaka sin logotyp utan att CRM:et skickar om bilden.
- **Revisionen är monoton per identitet**, även för `unpublish`. Det är det som
  gör att ett gammalt publish-paket inte kan återuppliva en avpublicerad kund.
