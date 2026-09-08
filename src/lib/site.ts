/**
 * Kanonisk host för Vårddelen.
 *
 * Hårdkodad med flit: allt SEO-kritiskt (rel=canonical, sitemap, robots,
 * JSON-LD, OG-URL:er) måste peka hit och ingen annanstans. Tidigare lästes
 * detta ur NEXT_PUBLIC_SITE_URL, som i produktion stod på
 * https://varddelen.vercel.app — då pekade varje sidas canonical på
 * vercel.app-domänen och Google avindexerade varddelen.se som dubblett.
 * Sajten har en enda publik host, så det finns inget läge där värdet ska
 * variera per miljö.
 */
export const SITE_URL = "https://varddelen.se";

/** GA4 mät-id (property "Alla Sajter", 533207956). */
export const GA_ID = "G-QQZWEGD9KL";
