import type { MetadataRoute } from "next";
import { ALL_KOMMUNER } from "@/lib/kommuner";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
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
    base.push({
      url: `${SITE_URL}/kommun/${k.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }
  return base;
}
