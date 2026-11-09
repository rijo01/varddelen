import { tolkaProfilniva, type OverlayProfilRow, type Profilniva } from "./overlay-contract";

/**
 * PROFILNIVÅN (kontrakt 1.7) — den ENDA platsen som avgör vad en overlay-rad
 * får göra på sajten.
 *
 * Förut räckte det att en rad fanns: den gav märke, rankning och indexering.
 * Från 1.7 bär raden en nivå, och sajten litar på nivån, inte på vilka fält som
 * råkar vara ifyllda (FORSLAG-1.7 i skiffer-crm):
 *
 *   kontakt — bara telefon, e-post och hemsida. Ersätter registrets värden
 *             tyst. Inget märke, ingen etikett, ingen rankning, oförändrad
 *             indexering och sitemap. Säljvägarna står kvar.
 *   gratis  — "Uppgifter från företaget". Aldrig "Betald profil" eller
 *             "Betald placering". Ingen rankning. Indexering som betald.
 *   betald  — som före 1.7.
 *
 * Utelämnad nivå = betald (en rad från före 1.7). Okänd nivå = kontakt.
 *
 * TVÅ STEG, och båda används överallt:
 *
 *   tillampaNiva(rad)    skär bort det nivån inte får visa, vid LÄSNINGEN
 *                        (lib/overlay.ts). Allt nedströms — listordning,
 *                        logotyp, märkning, telefon — ser då bara det tillåtna.
 *   overlayVisning(rad)  besluten som inte är fält: märke, etikett, rankning,
 *                        indexering, säljväg.
 *
 * Ren logik, inga anrop: provas i test/overlay-visning.test.mjs och används
 * av den signerade torrkörningen /api/overlay/visning (prova:kontraktsform).
 */

export interface OverlayVisning {
  niva: Profilniva;
  /** "Betald profil" / "Betald placering" / logotypens kundram. */
  marke: boolean;
  /** Etiketten om källan, eller null. */
  etikett: string | null;
  /** Lyfter raden i listor (featured, list_priority). */
  rankning: boolean;
  /** Gör sidan indexerbar och tar med den i sitemapen. */
  indexering: boolean;
  /** Sajtens säljvägar står kvar. Vårddelen har ingen sådan knapp i dag. */
  saljvag: boolean;
}

export const ETIKETT_GRATIS = "Uppgifter från företaget";
export const ETIKETT_BETALD = "Betald profil";

export function nivaFor(rad: Pick<OverlayProfilRow, "profilniva"> | null | undefined): Profilniva {
  return tolkaProfilniva(rad?.profilniva);
}

export function overlayVisning(rad: Pick<OverlayProfilRow, "profilniva"> | null | undefined): OverlayVisning | null {
  if (!rad) return null;
  const niva = nivaFor(rad);
  switch (niva) {
    case "kontakt":
      return { niva, marke: false, etikett: null, rankning: false, indexering: false, saljvag: true };
    case "gratis":
      return { niva, marke: false, etikett: ETIKETT_GRATIS, rankning: false, indexering: true, saljvag: true };
    case "betald":
      return { niva, marke: true, etikett: ETIKETT_BETALD, rankning: true, indexering: true, saljvag: true };
  }
}

/**
 * Raden som sajten får visa på sin nivå. Ändrar inte identitet, status,
 * revision eller giltighet — bara innehållet.
 */
export function tillampaNiva<T extends OverlayProfilRow>(rad: T): T {
  const niva = nivaFor(rad);
  if (niva === "betald") return rad;
  if (niva === "gratis") return { ...rad, featured: false, list_priority: 0 };
  // kontakt: de tre fälten, inget annat.
  const telefon = rad.telefon_override?.trim() || null;
  return {
    ...rad,
    featured: false,
    list_priority: 0,
    keywords: [],
    logo_url: null,
    info_html: null,
    kontaktperson: null,
    adress_override: null,
    adress_override_post: null,
    adress_override_besok: null,
    kategorier: [],
    popularnamn: null,
    telefon_typ: null,
    // "Ersätter registrets värden tyst": bolagets eget nummer visas i stället
    // för registrets, när det finns ett.
    dolj_andra_nummer: Boolean(telefon),
    bas: null,
    skapa_om_saknas: false,
    utokat: null,
  } as T;
}
