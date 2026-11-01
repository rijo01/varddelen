import { notFound, permanentRedirect } from "next/navigation";
import BranschSida from "../../BranschSida";

/**
 * Kommun × bransch, sida 2 och framåt — INTERN väg. Besökare och Google ser
 * /kommun/x/y?page=N; next.config.ts skriver om den hit så att sidan kan vara
 * ISR utan att läsa searchParams.
 *
 * Metadata kommer från BranschSida: samma robots som sida 1, men canonical är
 * sidans egen publika adress (?page=N) och titeln säger vilken sida det är.
 */
export const revalidate = 86400;

export { generateMetadata } from "../../BranschSida";

/** Inga sidor byggs i förväg; de renderas vid första anropet och cachas. */
export function generateStaticParams() {
  return [];
}

export default async function BranschSidaN({
  params,
}: {
  params: Promise<{ slug: string; bransch: string; sida: string }>;
}) {
  const { slug, bransch, sida } = await params;
  if (!/^\d{1,4}$/.test(sida)) notFound();
  const n = Number(sida);
  if (n < 1) notFound();
  // Sida 1 har bara en adress.
  if (n === 1) permanentRedirect(`/kommun/${slug}/${bransch}`);
  return <BranschSida slug={slug} bransch={bransch} sida={n} />;
}
