import BranschSida from "./BranschSida";

/**
 * Kommun × bransch, sida 1. ISR: renderas vid första anropet och serveras
 * sedan från cachen i ett dygn.
 *
 * Sidan läser MEDVETET inte searchParams — då blir varje anrop en
 * serverrendering. ?page=N skrivs om i next.config.ts till sida/[sida].
 */
export const revalidate = 86400;

export { generateMetadata } from "./BranschSida";
export { generateStaticParams } from "./statiska";

export default async function BranschPage({
  params,
}: {
  params: Promise<{ slug: string; bransch: string }>;
}) {
  const { slug, bransch } = await params;
  return <BranschSida slug={slug} bransch={bransch} sida={1} />;
}
