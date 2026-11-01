/**
 * Vilka kommun × bransch-sidor som byggs i förväg.
 *
 * Tom lista = ingen förrendering i bygget, men sidorna är ändå ISR: de
 * renderas vid första anropet och cachas sedan i ett dygn (revalidate).
 * Next kräver att generateStaticParams finns för att en dynamisk route ska
 * cachas alls — utan den var varje anrop `private, no-store`.
 */
export function generateStaticParams(): Array<{ slug: string; bransch: string }> {
  return [];
}
