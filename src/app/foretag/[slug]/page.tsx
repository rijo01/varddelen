import ForetagSida from "./ForetagSida";

/**
 * Den publika företagssidan. ISR, precis som förut.
 *
 * Allt innehåll ligger i ForetagSida så att förhandsvisningsrouten kan
 * återanvända det. Den här filen finns kvar för routesegmentets konfiguration
 * och för `generateMetadata` — båda gäller bara i en page-fil.
 *
 * Sidan läser MEDVETET inte searchParams. Katalogen har tiotusentals
 * företagssidor; hade den gjort det vore varje sidvisning en serverrendering,
 * och ISR hade varit borta för hela sajten. Förhandsvisningen har därför en
 * egen adress som betalar det priset ensam.
 */
export const revalidate = 86400;

export { generateMetadata } from "./ForetagSida";

/**
 * Inga företagssidor byggs i förväg — de renderas vid första anropet och
 * cachas ett dygn. Next kräver att generateStaticParams finns för att en
 * dynamisk route ska cachas alls; utan den var varje anrop `private, no-store`
 * (1,30–1,32 s, mätt 2026-11-01).
 */
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

export default async function ForetagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ForetagSida slug={slug} />;
}
