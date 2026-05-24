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
  f: Pick<Foretag, "orgnr" | "arEnskildFirma">,
): { kind: "orgnr"; value: string } | { kind: "hidden"; value: string } | null {
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

/** Är detta en "utvald" företagsprofil — dvs en kund med poäng? */
export function isFeatured(
  f: Pick<Foretag, "poang">,
): boolean {
  return (f.poang ?? 0) > 0;
}
