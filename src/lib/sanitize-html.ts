/**
 * Liten allowlist-baserad HTML-sanerare för `infotext`-fält från databasen.
 *
 * Datan kommer från Supabase och är skriven av administratörer (inte
 * användargenererad), men vi sanerar ändå defensivt mot XSS innan vi
 * skickar genom React `dangerouslySetInnerHTML`.
 *
 * Tillåtna taggar: b, strong, i, em, br, p, ul, ol, li, a, h2..h4
 * Tillåtna attribut: bara `href` på <a> (måste vara http/https/mailto/tel)
 *
 * Allt annat (script, iframe, style, on*-handlers, javascript:-URL:er,
 * okända taggar) strippas.
 */

const ALLOWED_TAGS = /^(b|strong|i|em|br|p|ul|ol|li|a|h[234])$/;
const VOID_TAGS = new Set(["br"]);
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripDangerousBlocks(s: string): string {
  // Ta bort hela script/style/iframe-block inkl. innehåll
  return s.replace(
    /<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi,
    "",
  );
}

export function sanitizeInfotext(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = stripDangerousBlocks(raw);

  // Strippa även dangling öppna taggar för förbjudna element
  s = s.replace(
    /<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>/gi,
    "",
  );

  // Sanera varje tag
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (m, rawTag, rawAttrs) => {
    const tag = (rawTag as string).toLowerCase();
    const closing = m.startsWith("</");
    const attrs = (rawAttrs as string) || "";

    if (!ALLOWED_TAGS.test(tag)) {
      // Helt okänd/förbjuden tag — strippa
      return "";
    }

    // Self-closing variant av void-tag (t.ex. <br/>) → normaliseras
    if (VOID_TAGS.has(tag)) {
      if (closing) return ""; // </br> är ogiltigt
      return `<${tag}>`;
    }

    if (closing) {
      return `</${tag}>`;
    }

    if (tag === "a") {
      // Plocka href, sanera URL
      const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
      const url = hrefMatch ? hrefMatch[2] ?? hrefMatch[3] ?? "" : "";
      if (!SAFE_URL.test(url)) {
        return "<a>";
      }
      return `<a href="${escapeAttr(url)}" rel="nofollow noopener" target="_blank">`;
    }

    // Allt annat — strippa alla attribut för säkerhet
    return `<${tag}>`;
  });

  return s;
}

/**
 * Är en logotyp-URL säker och visningsbar i `<img src>`?
 * Vi accepterar bara absoluta http(s)-URL:er — gamla relativa paths som
 * `/images/c/foo.jpg` är trasiga eftersom de pekar på gamla servern.
 */
export function safeLogotypUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}
