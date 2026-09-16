import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ForetagSida from "../ForetagSida";

/**
 * Förhandsvisning av ett overlay-UTKAST.
 *
 * Säljaren får länken i svaret från /api/overlay/publish när action är
 * `preview`. Utkastet ligger vid sidan av den publicerade raden och syns
 * ingen annanstans — RLS visar aldrig status 'utkast' publikt, så sidan läser
 * det med service role efter att token verifierats.
 *
 * Token är HELA skyddet: den är HMAC-signerad med sajtens hemlighet, bunden
 * till identitet och revision, och lever 24 timmar. Därför är sidan alltid
 * noindex och cachas aldrig.
 *
 * Ingen giltig token = 404. Vi faller MEDVETET inte tillbaka på den publika
 * sidan: en andra adress som visar samma innehåll är en dubblett i indexet den
 * dagen noindex-taggen råkar tappas bort.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Förhandsvisning",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ForhandsvisningPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const [{ slug }, { preview }] = await Promise.all([params, searchParams]);
  const token = preview?.trim();
  if (!token) notFound();

  return <ForetagSida slug={slug} previewToken={token} />;
}
