import type { MetadataRoute } from "next";
import { ALL_KOMMUNER } from "@/lib/kommuner";
import { SITE_URL } from "@/lib/site";
import { foretagSitemapPaths, hubSitemapPaths } from "@/lib/indexability";

/**
 * Sitemapen listar ENBART sidor som svarar index,follow.
 *
 * Hubbarna (/kommun/[slug]/[bransch]) och företagssidorna (/foretag/[slug])
 * kommer ur src/lib/indexability.ts — samma två arrayer som avgör robots-metan
 * på sidorna. Invarianten kontrolleras av scripts/check-sitemap-noindex.mjs,
 * som körs före varje build och avbryter om en sitemap-URL är noindex.
 *
 * Storleken (~2 300 URL:er) ligger långt under sitemap-gränsen på 50 000, så
 * det behövs ingen uppdelning i flera filer.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    {
      url: `${SITE_URL}/kommuner`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/branscher`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
  ];

  for (const k of ALL_KOMMUNER) {
    entries.push({
      url: `${SITE_URL}/kommun/${k.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const path of hubSitemapPaths()) {
    entries.push({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const path of foretagSitemapPaths()) {
    entries.push({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}
