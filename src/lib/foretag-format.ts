import type { Foretag } from "./queries";
import { jurformLabel } from "./jurform";

/**
 * Föredragna juridisk form-namn — använd jurform-koden från databasen om den
 * finns, fallback på heuristisk namn-tolkning (för rader där jurform saknas).
 */
export function legalFormFor(
  f: Pick<Foretag, "jurform" | "firma" | "namn">,
): string | null {
  const fromJurform = jurformLabel(f.jurform);
  if (fromJurform) return fromJurform;
  return detectLegalForm(f.firma || f.namn);
}

/**
 * Härled juridisk form från företagets namn-suffix. Bara fallback för
 * rader där jurform är null. Föredra `legalFormFor(f)` istället.
 */
export function detectLegalForm(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  const name = rawName.trim().toUpperCase();
  if (!name) return null;

  if (/\bBOSTADSR(Ä|A)TTSF(Ö|O)RENING(EN)?\b/.test(name) || /^BRF\b/.test(name)) {
    return "Bostadsrättsförening";
  }
  if (/\bSTIFTELSE\b/.test(name)) return "Stiftelse";
  if (/\bSAMF(Ä|A)LLIGHET(SF(Ö|O)RENING)?\b/.test(name)) return "Samfällighet";
  if (/\bEKONOMISK\s+F(Ö|O)RENING\b/.test(name) || /\bEK\.?\s*F(Ö|O)R\.?\b/.test(name)) {
    return "Ekonomisk förening";
  }
  if (/\bIDEELL\s+F(Ö|O)RENING\b/.test(name)) return "Ideell förening";
  if (/\bAB\b/.test(name)) return "Aktiebolag";
  if (/\bHB\b/.test(name)) return "Handelsbolag";
  if (/\bKB\b/.test(name)) return "Kommanditbolag";
  if (/\bF(Ö|O)RENING(EN)?\b/.test(name)) return "Förening";
  if (/\bKOMMUN(EN)?\b/.test(name) || /KOMMUN$/.test(name)) return "Kommunal verksamhet";
  if (/\bMENIGHET\b/.test(name) || /\bF(Ö|O)RSAMLING\b/.test(name)) return "Församling";
  return null;
}

/** Storleksklass baserat på aeant. Returnerar null om aeant saknas eller är 0. */
export function employerSize(aeant: number | null | undefined):
  | { label: string; tier: "solo" | "small" | "mid" | "large" | "xlarge" }
  | null {
  if (!aeant || aeant <= 0) return null;
  if (aeant === 1) return { label: "1 anställd", tier: "solo" };
  if (aeant < 10) return { label: `${aeant} anställda`, tier: "small" };
  if (aeant < 50) return { label: `${aeant} anställda`, tier: "mid" };
  if (aeant < 250) return { label: `${aeant} anställda`, tier: "large" };
  return { label: `${aeant.toLocaleString("sv-SE")} anställda`, tier: "xlarge" };
}

/** Initial-bokstav för monogram. */
export function initialFor(rawName: string | null | undefined): string {
  if (!rawName) return "·";
  const stripped = rawName
    .trim()
    .replace(/^(AKTIEBOLAGET|BOSTADSRÄTTSFÖRENINGEN|BRF)\s+/i, "");
  const first = stripped.charAt(0).toUpperCase();
  return first || "·";
}

/** Stabil gradient-färg per företag baserat på cfarnr (deterministisk). */
export function monogramGradient(cfarnr: number): string {
  // 4 fördefinierade gradienter i röd-skalan — alla matchar Vårddelens brand
  const palettes = [
    "linear-gradient(135deg, #F87171 0%, #E11D27 65%, #8B0F1A 100%)",
    "linear-gradient(135deg, #E11D27 0%, #C8102E 100%)",
    "linear-gradient(135deg, #FCA5A5 0%, #DC2626 100%)",
    "linear-gradient(135deg, #FECACA 0%, #B91C1C 100%)",
  ];
  return palettes[cfarnr % palettes.length] ?? palettes[0];
}

/** Visningsnamn — föredra firma, annars namn, annars fallback. */
export function displayName(f: Pick<Foretag, "firma" | "namn">): string {
  return f.firma || f.namn || "Okänt företag";
}

/** Bygg Google Maps-URL för en adress (öppnar i ny flik). */
export function googleMapsUrl(parts: {
  gatuadress?: string | null;
  postnr?: number | null;
  postort?: string | null;
}): string | null {
  const segments = [
    parts.gatuadress,
    [parts.postnr, parts.postort].filter(Boolean).join(" "),
    "Sverige",
  ].filter(Boolean);
  if (segments.length < 2) return null;
  const q = encodeURIComponent(segments.join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Slå in webb-URL till protokoll om saknas. */
export function normalizeWebb(webb: string | null | undefined): string | null {
  if (!webb) return null;
  const w = webb.trim();
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  return `https://${w}`;
}

/** Visningsbar webb (utan protokoll, max 40 tecken). */
export function shortWebb(webb: string | null | undefined): string | null {
  if (!webb) return null;
  const w = webb.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return w.length > 40 ? `${w.slice(0, 38)}…` : w;
}

/**
 * Hur orgnr ska visas för ett företag:
 *   - Enskild firma → "Enskild firma – organisationsnummer visas ej av integritetsskäl"
 *     (orgnr är ett personnummer som vi inte exponerar)
 *   - Övriga med orgnr → orgnr rakt av (redan formaterat med bindestreck från vyn)
 *   - Saknas orgnr utan att vara enskild firma → null (visa inget)
 */
export function orgnrDisplay(
  f: Pick<Foretag, "orgnr" | "arEnskildFirma"> & { orgnrMaskerat?: string | null },
): { kind: "orgnr"; value: string } | { kind: "hidden"; value: string } | null {
  // Kontrakt 1.3 (14 okt 2026): samma form på alla sju sajter — seklet och
  // resten X. Vyn lämnar aldrig ut numret; orgnr_maskerat bär bara seklet.
  if (f.arEnskildFirma && f.orgnrMaskerat) {
    return { kind: "hidden", value: `Enskild firma · ${f.orgnrMaskerat}` };
  }
  if (f.arEnskildFirma) {
    return {
      kind: "hidden",
      value: "Enskild firma – organisationsnummer visas ej av integritetsskäl",
    };
  }
  if (f.orgnr && f.orgnr.trim()) {
    return { kind: "orgnr", value: f.orgnr.trim() };
  }
  return null;
}

/**
 * Märkningen en rad eller en profil får — och bara den här funktionen avgör den.
 *
 *   "betald"   — overlay-raden har `featured`, alltså ett aktuellt CRM-köp av
 *                framhävning. Visas som "Betald placering".
 *   "komplett" — registrets `poang > 0` utan aktuellt köp. `poang` speglar hur
 *                komplett registerprofilen är, inte en betalning som pågår nu,
 *                och får därför aldrig se ut som en betald eller utvald plats.
 *                Visas som "Komplett profil".
 *
 * Tidigare hette detta isFeatured() och gav "Utvald" för båda fallen. På en
 * vårdsajt läses "Utvald" som ett omdöme om vården, och etiketten följde
 * registrets poang (poang > 0 på 6 666 rader i foretag_publik, räknat
 * 21 okt 2026), inte ett aktuellt köp. Sorteringen påverkas INTE av den här
 * funktionen: poang och overlay-vikten styr ordningen som förut (queries.ts och
 * overlay-rankning.ts).
 */
export type ProfilMarkning = "betald" | "komplett" | null;

export function profilMarkning(
  f: Pick<Foretag, "poang">,
  overlay?: { featured?: boolean | null } | null,
): ProfilMarkning {
  if (overlay?.featured) return "betald";
  if ((f.poang ?? 0) > 0) return "komplett";
  return null;
}

/**
 * Svenskt telefonnummer för visning: riktnummer, bindestreck och siffrorna i
 * par bakifrån — "035104600" → "035-10 46 00", "0771-450450" → "0771-45 04 50".
 * Ändrar bara visningen; tel:-länken byggs alltid av siffrorna. Nummer som
 * inte ser svenska ut lämnas exakt som de kom.
 */
const TVASIFFRIGA_RIKTNUMMER = new Set([
  "011", "013", "016", "018", "019", "021", "023", "026", "031", "033", "035",
  "036", "040", "042", "044", "046", "054", "060", "063", "090",
]);

export function formatTelefon(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let d = trimmed.replace(/[^\d+]/g, "");
  if (d.startsWith("+46")) d = "0" + d.slice(3);
  else if (d.startsWith("0046")) d = "0" + d.slice(4);
  if (!/^0\d{6,10}$/.test(d)) return trimmed;

  let rikt: string;
  if (d.startsWith("08")) rikt = d.slice(0, 2);
  else if (d.startsWith("07") || TVASIFFRIGA_RIKTNUMMER.has(d.slice(0, 3))) rikt = d.slice(0, 3);
  else rikt = d.slice(0, 4);

  const rest = d.slice(rikt.length);
  const grupper: string[] = [];
  let i = rest.length;
  while (i > 0) {
    // Udda antal siffror: den första gruppen får tre ("123 45 67").
    const len = i === 3 ? 3 : 2;
    grupper.unshift(rest.slice(Math.max(0, i - len), i));
    i -= len;
  }
  return `${rikt}-${grupper.join(" ")}`;
}

/** Siffrorna i ett nummer, för tel:-länken. */
export function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}
