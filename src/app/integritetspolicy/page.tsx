import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SITE_URL } from "@/lib/site";
import { REGISTER_AR } from "@/lib/kluster/register";

export const revalidate = 86400;

const EMAIL = "kundservice@varddelen.se";
const ORG_NUMBER = "556948-3141";
const UPPDATERAD = "1 november 2026";

export const metadata: Metadata = {
  title: "Integritetspolicy",
  description:
    "Hur Vårddelen behandlar personuppgifter: vilka uppgifter som visas, vilka som aldrig visas, varifrån de kommer och hur du får en uppgift borttagen.",
  alternates: { canonical: `${SITE_URL}/integritetspolicy` },
};

/**
 * Integritetspolicyn. Varje påstående här ska motsvara vad koden gör:
 *   - lib/kluster/personuppgifter.ts — inga registernummer, ingen privat
 *                                      e-post, kontaktperson eller personnamn
 *                                      för enskild firma (samma i hela klustret)
 *   - lib/kontaktsparr.ts            — spärren som tar bort en uppgift på begäran
 *   - lib/kluster/register.ts        — registrets ålder
 *   - app/layout.tsx                 — Vercel Analytics (cookiefri)
 *   - skiffer-crm, DE.82             — registret används för säljsamtal
 * Ändras koden ska texten ändras med den. Texten är densamma som på
 * hantverkardelen.se och regionsdelen.se, utom sajtnamn och adress.
 */
export default function IntegritetspolicyPage() {
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: "Integritetspolicy", url: `${SITE_URL}/integritetspolicy` },
  ]);

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={[{ name: "Vårddelen", href: "/" }, { name: "Integritetspolicy" }]} />

      <article className="max-w-3xl space-y-8 text-[17px] leading-relaxed text-[var(--text-body)]">
        <header className="space-y-3 border-b border-[var(--rule)] pb-6">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[var(--text-strong)] sm:text-[2.5rem]">
            Integritetspolicy
          </h1>
          <p className="text-[15px] text-[var(--text-dim)]">Senast uppdaterad {UPPDATERAD}</p>
        </header>

        <Avsnitt rubrik="Vem som ansvarar">
          <p>
            Personuppgiftsansvarig för varddelen.se är QS Group AB, organisationsnummer{" "}
            <span className="tabular-nums">{ORG_NUMBER}</span>. Frågor om personuppgifter skickar du till{" "}
            <a href={`mailto:${EMAIL}`} className="text-[var(--brand-ink)] underline">
              {EMAIL}
            </a>{" "}
            eller via{" "}
            <Link href="/kontakt" className="text-[var(--brand-ink)] underline">
              kontaktsidan
            </Link>
            .
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Uppgifterna i katalogen">
          <p>
            Katalogen bygger på ett näringslivsregister som samlades in omkring 2008–{REGISTER_AR}. Det
            innehåller verksamhetens namn, adress, bransch, juridisk form och i många fall ett
            telefonnummer. Registret har inte uppdaterats sedan dess, så uppgifter kan vara inaktuella och
            verksamheter kan ha upphört.
          </p>
          <p>
            De flesta uppgifterna gäller aktiebolag och andra juridiska personer och är inte personuppgifter.
            För en enskild firma är däremot firmans uppgifter också ägarens. Därför visar vi aldrig:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>telefonnummer ur registret — ett nummer visas bara när verksamheten själv har lämnat det</li>
            <li>personnummer — för en enskild firma visas aldrig organisationsnumret</li>
            <li>ägarens namn när firman saknar ett eget firmanamn — den visas som ”Enskild firma i” orten</li>
            <li>e-postadresser hos privata e-posttjänster, till exempel Hotmail, Gmail och Telia</li>
            <li>namngivna kontaktpersoner ur registret</li>
          </ul>
          <p>
            Undantaget är verksamheter som själva har lämnat uppgifter för att synas här. Då visas det
            verksamheten lämnat.
          </p>
          <p>
            Vi behandlar katalogens uppgifter med stöd av intresseavvägning (artikel 6.1 f i
            dataskyddsförordningen): intresset av att privatpersoner och företag ska kunna hitta och kontakta
            vård- och omsorgsverksamheter. Uppgifterna finns kvar så länge katalogen visar verksamheten.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Säljkontakt per telefon">
          <p>
            QS Group AB använder registrets telefonnummer för att ringa företag och erbjuda annonsering i
            katalogen och i våra systerkataloger. Numren publiceras inte. Den lagliga grunden är berättigat
            intresse (artikel 6.1 f i dataskyddsförordningen): vårt intresse av att erbjuda företag en tjänst
            som rör deras verksamhet.
          </p>
          <p>
            Du har rätt att när som helst invända mot att bli kontaktad. Säg det i samtalet eller skriv till{" "}
            <a href={`mailto:${EMAIL}`} className="text-[var(--brand-ink)] underline">
              {EMAIL}
            </a>
            , så spärrar vi numret. Spärren gäller också för säljsamtal och för våra systerkataloger.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Få en uppgift rättad eller borttagen">
          <p>
            Står ett nummer eller en annan uppgift om dig på en verksamhet den inte hör till, eller vill du
            inte att din firma visas? Kontakta oss så tar vi bort uppgiften. En borttagen uppgift spärras: den
            visas inte på sidan, i listorna, i sökningen eller i sidans strukturerade data, och den kommer inte
            tillbaka om registret läses in på nytt. Spärren gäller också våra systerkataloger.
          </p>
          <p>
            Du har rätt att få veta vilka uppgifter vi har om dig, att få fel rättade, att invända mot
            behandlingen och att få uppgifter raderade. Är du inte nöjd med hur vi hanterar en begäran kan du
            vända dig till Integritetsskyddsmyndigheten (IMY).
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Verksamheter som köper en profil">
          <p>
            En verksamhet som köper en profil lämnar själv uppgifterna som visas: logotyp, beskrivning,
            tjänster, telefonnummer, e-post och kontaktperson. De behandlas för att fullgöra avtalet och visas
            så länge avtalet gäller.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Besöksstatistik">
          <p>
            Vi mäter hur sajten används, till exempel vilka sidor som besöks, med Vercel Web Analytics. Mätningen
            sätter inga kakor och sparar ingenting i din webbläsare. Besök räknas utan att du kan identifieras:
            ingen IP-adress sparas, och samma besökare känns inte igen från en dag till nästa. Uppgifterna
            används inte för annonsering.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="När du kontaktar oss">
          <p>
            Skriver eller ringer du till oss sparar vi det du skickar så länge ärendet pågår och därefter så
            länge bokföringsregler eller ett kundförhållande kräver det.
          </p>
        </Avsnitt>
      </article>
    </div>
  );
}

function Avsnitt({ rubrik, children }: { rubrik: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[1.375rem] font-semibold text-[var(--text-strong)]">{rubrik}</h2>
      {children}
    </section>
  );
}
