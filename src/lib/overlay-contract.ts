/**
 * Overlay-kontraktet, version 1.1.
 *
 * Den här filen och `overlay.sql` är HELA gränssnittet mellan CRM:et och en
 * sajt. CRM:et bygger en payload som validerar mot `overlayPublishRequest`,
 * signerar den och POSTar den till sajtens `/api/overlay/publish`. Sajten
 * validerar med samma schema. Ingen annan koppling finns: sajten läser aldrig
 * från CRM:et och CRM:et har inga databasnycklar till sajten.
 *
 * KOPIERA IN DEN HÄR FILEN OFÖRÄNDRAD i varje sajt. Ändras något här måste
 * CONTRACT_VERSION höjas och alla sajter uppdateras — en sajt AVVISAR en
 * payload vars contract_version är högre än den själv stödjer.
 *
 * Enda beroende: `zod`. Kryptot använder Web Crypto (finns i Node 18+ och i
 * alla runtimes vi kör på), inte `node:crypto`, så filen kan ligga var som
 * helst i ett Next.js-projekt.
 */

import { z } from "zod";

/**
 * Höjs vid varje förändring av payloadens form. Sajter avvisar högre värden.
 *
 * 1.0 → 1.1: enbart TILLÄGG, alla frivilliga. En 1.1-mottagare validerar en
 * 1.0-payload oförändrat — det är vad "bakåtkompatibelt" betyder här.
 *
 * ÅT ANDRA HÅLLET GÄLLER DET INTE, och det är viktigt att säga rakt ut: en
 * 1.0-sajts schema är `.strict()`, så en okänd nyckel ger ett valideringsfel
 * och därmed 400 — inte 409. Därför är det AVSÄNDAREN som håller reda på
 * versionen: publicera() läser sajtens `contract_version` ur databasen och
 * skickar 1.0-formen till en 1.0-sajt. Fält som inte får plats utelämnas, och
 * behöver paketet ett 1.1-fält för att vara begripligt stoppas publiceringen
 * lokalt med ett tydligt besked i stället för att skickas och avvisas.
 *
 * Talet är därför inte längre ett heltal. `z.number().int()` i 1.0-sajternas
 * kopia är exakt det som gör att de avvisar ett 1.1-paket — vilket är rätt
 * beteende, men det ska aldrig behöva inträffa.
 */
export const CONTRACT_VERSION = 1.1;

/** Versionen som bara har v1.0-formen. Skickas till sajter som inte kan mer. */
export const CONTRACT_VERSION_1_0 = 1;

/** Stödjer en sajt på den här versionen 1.1-fälten? */
export function stodjerV11(sajtensVersion: number): boolean {
  return sajtensVersion >= 1.1;
}

// ── Uppräkningar ────────────────────────────────────────────────────────────

/** Vad `external_id` pekar på. Styr vilken källtabell sajten joinar mot. */
export const ENTITY_TYPES = [
  "bolag", // orgnr
  "arbetsstalle", // CFAR-nummer
  "forening", // orgnr (BRF)
  "verksamhet", // IVO-tillståndsnummer
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Radens livscykel på sajten. Endast `aktiv` är publikt läsbar (RLS). */
export const OVERLAY_STATUSES = ["utkast", "aktiv", "inaktiv", "utgangen"] as const;
export type OverlayStatus = (typeof OVERLAY_STATUSES)[number];

/**
 * `publish`   — gör raden aktiv, städa bort utkastet och revalidera.
 * `unpublish` — sätt raden inaktiv/utgången. Raden och logotypen ligger kvar.
 * `preview`   — spara som utkast och returnera en förhandsvisningslänk.
 */
export const OVERLAY_ACTIONS = ["publish", "unpublish", "preview"] as const;
export type OverlayAction = (typeof OVERLAY_ACTIONS)[number];

// ── Signering ───────────────────────────────────────────────────────────────

/** HMAC-SHA256 över den råa request-bodyn, hex-kodad. */
export const SIGNATURE_HEADER = "x-overlay-signature";

/**
 * Hur långt ifrån nu `sent_at` får ligga, i sekunder.
 *
 * `sent_at` stoppar GAMLA PAKET — en avlyssnad body kan inte skickas om senare.
 * `revision` stoppar OMSPELNING — ett paket som var färskt när det fångades kan
 * ändå inte backa en nyare publicering. De två skyddar olika saker och båda behövs.
 */
export const MAX_KLOCKGLAPP_SEKUNDER = 300;

// ── Delscheman ──────────────────────────────────────────────────────────────

const uuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "måste vara ett uuid"
  );

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "måste vara YYYY-MM-DD");

/** Trimmar och gör tom sträng till null, så vi aldrig skriver över med "". */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => {
      const t = v.trim();
      return t.length > 0 ? t : null;
    })
    .nullable();

const url = z
  .string()
  .max(500)
  .refine(
    (v) => v.trim() === "" || /^https?:\/\/[^\s]+$/i.test(v.trim()),
    "måste vara en http(s)-adress"
  )
  .transform((v) => {
    const t = v.trim();
    return t.length > 0 ? t : null;
  })
  .nullable();

/** Frivillig adressöverskrivning. Utelämnade fält faller tillbaka på källdata. */
export const adressOverrideSchema = z
  .object({
    gata: z.string().max(200).optional(),
    postnummer: z.string().max(20).optional(),
    postort: z.string().max(120).optional(),
    land: z.string().max(80).optional(),
  })
  .strict();
export type AdressOverride = z.infer<typeof adressOverrideSchema>;

// ── Logotyp ─────────────────────────────────────────────────────────────────

/**
 * Max 500 kB. En logotyp som är större är inte en logotyp, den är ett misstag —
 * och en sajt ska inte behöva servera den.
 */
export const MAX_LOGO_BYTES = 500 * 1024;

export const LOGO_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMime = (typeof LOGO_MIMES)[number];

/**
 * Logotyp som den skickas över tråden.
 *
 * SEMANTIK (bindande i v1):
 *   fältet utelämnat  → behåll befintlig fil oförändrad
 *   remove_logo: true → ta bort filen och nolla logo_url
 *   objekt            → ersätt filen
 *
 * `unpublish` rör ALDRIG filen. En avpublicerad kund som publiceras igen ska få
 * tillbaka sin logotyp utan att CRM:et behöver skicka om den.
 *
 * SVG är medvetet uteslutet: det är ett skriptbärande format, och en logotyp
 * behöver det inte.
 */
export const logoSchema = z
  .object({
    /** Rå base64 utan `data:`-prefix. */
    data_base64: z.string().min(1).max(1_000_000),
    /** Avsändarens påstående. Avgör INTE ensamt — se avkodaLogo(). */
    mime: z.enum(LOGO_MIMES),
  })
  .strict();
export type OverlayLogo = z.infer<typeof logoSchema>;

/** Filändelse per mime. Sajten namnger filen `<external_id>.<ext>`. */
export const LOGO_FILANDELSER: Record<LogoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Vad bytesen FAKTISKT är, enligt filens egna magic bytes.
 *
 * Content-Type är avsändarens påstående och får aldrig avgöra ensamt: en
 * HTML-fil med `mime: "image/png"` skulle annars landa i bucketen och serveras
 * från sajtens domän. Returnerar null för allt vi inte känner igen.
 */
export function identifieraBildtyp(bytes: Uint8Array): LogoMime | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export type LogoResultat =
  | { ok: true; bytes: Uint8Array; mime: LogoMime; ext: string }
  | { ok: false; error: string };

/**
 * Avkodar och GODKÄNNER en logotyp: base64 → bytes → storlek → magic bytes.
 *
 * Den faktiska typen ur magic bytes vinner över `mime`, och stämmer de inte
 * överens avvisas filen helt. Ett svep som säger "det här är en PNG" ska inte
 * kunna vara något annat på disken.
 */
export function avkodaLogo(logo: OverlayLogo): LogoResultat {
  let bytes: Uint8Array;
  try {
    const bin = atob(logo.data_base64.replace(/\s+/g, ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { ok: false, error: "Logotypen är inte giltig base64" };
  }

  if (bytes.length === 0) return { ok: false, error: "Logotypen är tom" };
  if (bytes.length > MAX_LOGO_BYTES) {
    return {
      ok: false,
      error: `Logotypen är ${Math.round(bytes.length / 1024)} kB, max är ${
        MAX_LOGO_BYTES / 1024
      } kB`,
    };
  }

  const faktisk = identifieraBildtyp(bytes);
  if (!faktisk) {
    return { ok: false, error: "Filen är varken PNG, JPEG eller WebP" };
  }
  if (faktisk !== logo.mime) {
    return {
      ok: false,
      error: `Filen är ${faktisk} men skickades som ${logo.mime}`,
    };
  }

  return { ok: true, bytes, mime: faktisk, ext: LOGO_FILANDELSER[faktisk] };
}

/** Vad ett telefonnummer är för sorts nummer. */
export const TELEFONTYPER = ["kontakt", "vaxel", "mobil"] as const;
export type Telefontyp = (typeof TELEFONTYPER)[number];

/**
 * Grunduppgifter om ett bolag, för sajter som inte har det i sitt register.
 *
 * Bara det som behövs för att rendera en profil: vem bolaget är och var det
 * finns. Ingen ekonomi, inga styrelseuppgifter — sådant ägs av registret och
 * har inget i ett overlay-paket att göra.
 */
export const basuppgifterSchema = z
  .object({
    namn: z.string().min(1).max(200),
    gatuadress: text(200).default(null),
    postnr: text(20).default(null),
    ort: text(120).default(null),
    telefon: text(60).default(null),
    sni: text(20).default(null),
  })
  .strict();
export type Basuppgifter = z.infer<typeof basuppgifterSchema>;

// ── Payload ─────────────────────────────────────────────────────────────────

/**
 * Fälten CRM:et äger och skickar. `logo_url` finns MEDVETET inte med: den ägs
 * av sajten och sätts när sajten sparat logotypen i sin egen bucket. CRM:et
 * skickar bilden, aldrig adressen till den.
 */
export const overlayProfilSchema = z
  .object({
    sajt: z.string().min(1).max(60),
    entity_type: z.enum(ENTITY_TYPES),
    external_id: z.string().min(1).max(60),

    order_id: uuid,

    /**
     * MONOTON. CRM:ETS ANSVAR: höj revisionen vid VARJE action mot en
     * identitet — publish, unpublish OCH varje ompublicering. Aldrig två paket
     * med samma nummer.
     *
     * Sajten avvisar allt som är lägre än det som redan ligger. Det är det som
     * gör att ett gammalt paket inte kan återuppliva en kund som avpublicerats.
     *
     * `payload_hash` är ett SKYDDSNÄT, inte regeln. Den fångar ett ofarligt
     * återförsök och avslöjar två versioner som delar nummer — men den kan
     * aldrig ersätta ett höjt nummer, och sajten får aldrig vara beroende av
     * den ensam. Höjer CRM:et inte revisionen blir svaret 409, och det är rätt
     * svar: publiceringen ska stanna, inte gissa.
     */
    revision: z.number().int().min(1),

    giltig_from: datum.nullable().default(null),
    giltig_till: datum.nullable().default(null),

    featured: z.boolean().default(false),
    list_priority: z.number().int().min(0).max(1000).default(0),
    keywords: z.array(z.string().min(1).max(60)).max(30).default([]),

    hemsida: url.default(null),
    telefon_override: text(60).default(null),
    epost_override: text(200).default(null),
    kontaktperson: text(120).default(null),
    adress_override: adressOverrideSchema.nullable().default(null),

    /** Rå HTML från CRM:ets editor. SANITERAS av sajten innan den sparas. */
    info_html: text(20_000).default(null),
    dolj_andra_nummer: z.boolean().default(false),

    /**
     * Krävs för `preview`. Skapas med skapaPreviewToken() och är därmed bunden
     * till external_id + revision och giltig i 24 timmar.
     */
    preview_token: text(400).default(null),

    contract_version: z.number().min(1),

    // ── Tillägg i 1.1 ────────────────────────────────────────────────────────
    // ALLA FRIVILLIGA. En 1.0-payload validerar oförändrat mot det här schemat.

    /**
     * Namnet bolaget går under, när det inte är detsamma som det registrerade.
     * "Börje Jönssons Åkeri" i stället för "BÖRJE JÖNSSON ÅKERI AKTIEBOLAG".
     */
    popularnamn: text(160).optional(),

    /** Vad numret i telefon_override ÄR. Sajten kan märka ut det i gränssnittet. */
    telefon_typ: z.enum(TELEFONTYPER).optional(),

    /**
     * Sajtens egna kategorier, max fyra.
     *
     * Strängar och inte id:n: kategoriträdet ägs av sajten och ser olika ut på
     * var och en. Ett id från en sajt betyder ingenting på en annan, och CRM:et
     * ska inte behöva känna sju kategorisystem för att kunna sälja en profil.
     */
    kategorier: z.array(z.string().min(1).max(120)).max(4).optional(),

    /** Post- respektive besöksadress, var för sig. Utelämnad = registrets gäller. */
    adress_override_post: adressOverrideSchema.nullable().optional(),
    adress_override_besok: adressOverrideSchema.nullable().optional(),

    /**
     * Grunduppgifter för ett bolag sajtens EGET register inte känner.
     *
     * Skickas bara tillsammans med `skapa_om_saknas`. Sajten avgör själv vad
     * den gör: lägga raden i sin egen tabell, eller rendera profilen fristående.
     * CRM:et skriver fortfarande aldrig i någon sajtdatabas — det skickar
     * uppgifterna och låter mottagaren bestämma.
     */
    bas: basuppgifterSchema.optional(),

    /** Får sajten skapa bolaget om det saknas i dess register? */
    skapa_om_saknas: z.boolean().optional(),
  })
  .strict();
export type OverlayProfil = z.infer<typeof overlayProfilSchema>;

/** Hela bodyn i POST /api/overlay/publish. */
export const overlayPublishRequestSchema = overlayProfilSchema
  .extend({
    action: z.enum(OVERLAY_ACTIONS),

    /** Utelämnat = behåll befintlig fil. Se logoSchema för hela semantiken. */
    logo: logoSchema.optional(),

    /** true = ta bort befintlig logotyp. Kan inte kombineras med `logo`. */
    remove_logo: z.boolean().default(false),

    /** ISO-8601. Ingår i signaturen och stoppar gamla paket. */
    sent_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((d) => !(d.logo && d.remove_logo), {
    message: "logo och remove_logo kan inte skickas samtidigt",
    path: ["remove_logo"],
  })
  // `bas` utan `skapa_om_saknas` är en halv mening: uppgifter om ett bolag
  // sajten inte har, utan lov att göra något med dem.
  .refine((d) => !(d.bas && d.skapa_om_saknas !== true), {
    message: "bas kräver skapa_om_saknas: true",
    path: ["skapa_om_saknas"],
  });
export type OverlayPublishRequest = z.infer<typeof overlayPublishRequestSchema>;

/** Sajtens svar. `preview_url` sätts bara för action `preview`. */
export const overlayPublishResponseSchema = z.object({
  ok: z.boolean(),
  revision: z.number().int(),
  revalidated: z.array(z.string()),
  preview_url: z.string().optional(),
  /** Satt när ok = false. Aldrig stacktrace, aldrig interna id:n. */
  error: z.string().optional(),
});
export type OverlayPublishResponse = z.infer<typeof overlayPublishResponseSchema>;

/** Raden som den ligger i sajtens `overlay_profil` — inklusive sajtägda fält. */
export interface OverlayProfilRow extends Omit<OverlayProfil, "contract_version"> {
  id: string;
  status: OverlayStatus;
  logo_url: string | null;
  payload_hash: string | null;
  preview_expires_at: string | null;
  contract_version: number;
  published_at: string | null;
  updated_at: string;
}

// ── HMAC och hash ───────────────────────────────────────────────────────────

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Signerar den råa bodyn. BÅDA sidor måste signera exakt samma byte-sträng —
 * signera alltid den sträng du faktiskt skickar, aldrig ett omserialiserat
 * objekt (nyckelordning och whitespace ändrar signaturen).
 */
export async function signOverlayBody(rawBody: string, secret: string): Promise<string> {
  return hex(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(rawBody))
  );
}

/** Jämförelse i konstant tid — läcker inte hur många tecken som stämde. */
function likaITid(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyOverlaySignature(
  rawBody: string,
  secret: string,
  signature: string | null | undefined
): Promise<boolean> {
  if (!signature) return false;
  return likaITid(await signOverlayBody(rawBody, secret), signature);
}

/** True om `sent_at` ligger inom det tillåtna fönstret kring nu. */
export function sentAtArFarsk(
  sentAt: string,
  maxGlappSekunder = MAX_KLOCKGLAPP_SEKUNDER
): boolean {
  const t = Date.parse(sentAt);
  if (Number.isNaN(t)) return false;
  return Math.abs(Date.now() - t) <= maxGlappSekunder * 1000;
}

/** Nycklar sorterade rekursivt, så samma innehåll alltid ger samma sträng. */
function kanoniskt(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(kanoniskt);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const ut: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) ut[k] = kanoniskt(o[k]);
    }
    return ut;
  }
  return v;
}

async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}

/**
 * Innehållsfingeravtryck för en payload.
 *
 * Används tillsammans med `revision` för att skilja ett OFARLIGT ÅTERFÖRSÖK
 * (samma revision, samma innehåll → svara ok, skriv inget) från en KONFLIKT
 * (samma revision, annat innehåll → 409).
 *
 * `sent_at` ingår inte — den ändras vid varje återförsök och skulle göra varje
 * retry till en konflikt. Logotypen ingår som en hash av sina bytes, så ett
 * bytt bildinnehåll ändrar fingeravtrycket utan att bilden behöver serialiseras.
 */
export async function overlayPayloadHash(req: OverlayPublishRequest): Promise<string> {
  const { sent_at: _sentAt, logo, ...resten } = req;
  const logoDel = logo
    ? { logo: await sha256(logo.mime + ":" + logo.data_base64.replace(/\s+/g, "")) }
    : {};
  return sha256(JSON.stringify(kanoniskt({ ...resten, ...logoDel })));
}

// ── Revisionsregeln ─────────────────────────────────────────────────────────

export type RevisionsBeslut =
  /** Skriv raden. Inkommande revision är högre än den som ligger. */
  | { typ: "skriv" }
  /** Samma revision OCH samma innehåll — ett återförsök. Svara 200, skriv inget. */
  | { typ: "oforandrad" }
  /** Lägre revision, eller samma revision med annat innehåll. Svara 409. */
  | { typ: "konflikt"; aktuell: number; orsak: string };

/**
 * Monoton revision, en gång och på ett ställe.
 *
 *   revision <  befintlig                     → 409 (gammalt paket, eller omspelning)
 *   revision == befintlig, samma payload_hash → 200 ok, ingen skrivning
 *   revision == befintlig, annan payload_hash → 409 (två versioner delar nummer)
 *   revision >  befintlig                     → skriv
 *
 * Gäller ALLA actions, `unpublish` inräknat: en avpublicering är en ändring av
 * identiteten och måste bära ett högre nummer än publiceringen den tar ner.
 * Annars kan ett gammalt publish-paket spelas upp efter avpubliceringen och
 * återuppliva kunden.
 *
 * VILKEN RAD SOM SKICKAS IN SOM `befintlig`:
 *
 *   publish / unpublish → den PUBLICERADE raden (status <> 'utkast').
 *   preview             → UTKASTRADEN, för idempotensen. Dessutom ska
 *                         anroparen separat avvisa en preview vars revision är
 *                         lägre än den publicerade radens — ett utkast äldre än
 *                         det som ligger live är meningslöst.
 *
 * Uppdelningen är nödvändig: `action` ingår i payload_hash, så en preview och
 * en publish av samma revision har olika fingeravtryck. Jämfördes båda mot
 * samma rad skulle den normala ordningen (förhandsvisa, sedan godkänn) alltid
 * sluta i 409.
 *
 * VAD SOM STÄNGER OMSPELNINGEN — två lås, och de behövs båda:
 *
 *   Höjd revision är det bärande låset. Publiceras rev 5 och avpubliceras rev 6
 *   är en uppspelad publish-rev-5-body lägre än det som ligger → 409. Kunden
 *   kommer aldrig tillbaka.
 *
 *   `action` i payload_hash är låset för det slarviga fallet. Skickar CRM:et
 *   unpublish med SAMMA nummer som publiceringen skiljer sig
 *   fingeravtrycken — och svaret blir 409 i stället för "oforandrad". Utan
 *   action i hashen vore de två paketen identiska, avpubliceringen skulle
 *   svälja sig själv som ett återförsök, och CRM:et skulle tro att kunden var
 *   nertagen medan profilen låg kvar live. Ett tydligt fel slår en tyst lögn.
 *   Se test/overlay.test.ts: "replay: samma revision på unpublish avvisas".
 */
export function bedomRevision(
  inkommande: { revision: number; payload_hash: string },
  befintlig: { revision: number; payload_hash: string | null } | null
): RevisionsBeslut {
  if (!befintlig) return { typ: "skriv" };

  if (inkommande.revision < befintlig.revision) {
    return {
      typ: "konflikt",
      aktuell: befintlig.revision,
      orsak: `revision ${inkommande.revision} är äldre än den som ligger (${befintlig.revision})`,
    };
  }

  if (inkommande.revision === befintlig.revision) {
    if (befintlig.payload_hash && befintlig.payload_hash === inkommande.payload_hash) {
      return { typ: "oforandrad" };
    }
    return {
      typ: "konflikt",
      aktuell: befintlig.revision,
      orsak: `revision ${inkommande.revision} ligger redan med ett annat innehåll`,
    };
  }

  return { typ: "skriv" };
}

// ── Publika queries ─────────────────────────────────────────────────────────

/**
 * REGEL, undantagslöst: en publik query mot overlay_profil filtrerar ALLTID på
 * `status = 'aktiv'` OCH giltighetstid. Slå ALDRIG upp en identitet
 * (sajt + entity_type + external_id) utan statusfilter.
 *
 * Anledningen är promote-regeln: under en publicering kan en identitet ha både
 * en utkastrad och en publicerad rad. En SELECT utan statusfilter får då två
 * rader, och `.single()` blir ett fel medan `.limit(1)` blir en slumpvis vinnare
 * — i värsta fall utkastet, publikt.
 *
 * Använd `publikOverlayMatch()` i frågan och `arPubliktSynlig()` på raden.
 */
export function publikOverlayMatch(
  sajt: string,
  extra?: { entity_type?: EntityType; external_id?: string }
): Record<string, string> {
  return {
    sajt,
    status: "aktiv",
    ...(extra?.entity_type ? { entity_type: extra.entity_type } : {}),
    ...(extra?.external_id ? { external_id: extra.external_id } : {}),
  };
}

/**
 * Ligger raden inom sitt giltighetsfönster OCH är den aktiv?
 *
 * Statusfältet räcker inte: cronen som sätter `utgangen` kör en gång per dygn,
 * och fram till dess skulle en utgången profil annars ligga kvar synlig.
 */
export function arPubliktSynlig(
  rad: Pick<OverlayProfilRow, "status" | "giltig_from" | "giltig_till">,
  idag: string
): boolean {
  if (rad.status !== "aktiv") return false;
  if (rad.giltig_from && rad.giltig_from > idag) return false;
  if (rad.giltig_till && rad.giltig_till < idag) return false;
  return true;
}

// ── Promote ─────────────────────────────────────────────────────────────────

/**
 * Namnet på databasfunktionen som gör publiceringen ATOMÄR.
 *
 * `publish` av en identitet som har ett utkast måste i EN transaktion skriva
 * live-raden och radera utkastet. Görs det i två anrop finns ett fönster där
 * båda raderna existerar — och en publik query utan statusfilter skulle kunna
 * få utkastet. Funktionen ligger i overlay.sql; en plpgsql-funktion körs som en
 * transaktion, så antingen sker båda eller ingen.
 */
export const OVERLAY_PROMOTE_RPC = "overlay_publicera";

/** Argumentnamnet funktionen tar. Raden skickas som jsonb. */
export const OVERLAY_PROMOTE_ARG = "p_rad";

// ── Förhandsvisningstoken ───────────────────────────────────────────────────

/** 24 timmar. En länk som skickats till en kund ska inte leva längre än så. */
export const PREVIEW_TOKEN_TTL_SEKUNDER = 24 * 60 * 60;

const PREVIEW_PREFIX = "pv1";

function b64urlKoda(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlAvkoda(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
}

/**
 * Skapar en förhandsvisningstoken som är BUNDEN till identitet och revision och
 * som går ut efter 24 timmar.
 *
 * Formen är `pv1.<payload>.<hmac>`. Sajten behöver inte lita på databasen för
 * att avgöra om token duger: den räknar om signaturen med sin egen hemlighet
 * och läser anspråken direkt ur token. En token för orgnr A kan alltså inte
 * användas för orgnr B, och en token för revision 3 slutar gälla när revision 4
 * publiceras — även om någon sparat länken.
 */
export async function skapaPreviewToken(
  secret: string,
  anspråk: { external_id: string; revision: number; expires_at?: string }
): Promise<string> {
  const exp =
    anspråk.expires_at ??
    new Date(Date.now() + PREVIEW_TOKEN_TTL_SEKUNDER * 1000).toISOString();
  const kropp = b64urlKoda(
    JSON.stringify({ e: anspråk.external_id, r: anspråk.revision, x: exp })
  );
  const bas = `${PREVIEW_PREFIX}.${kropp}`;
  return `${bas}.${await signOverlayBody(bas, secret)}`;
}

export type PreviewTokenResultat =
  | { ok: true; external_id: string; revision: number; expires_at: string }
  | { ok: false; orsak: string };

/**
 * Verifierar en token mot hemligheten och kontrollerar utgångstiden.
 *
 * Anropa ALLTID med de förväntade anspråken och jämför — en giltig signatur
 * säger bara att VI skapade token, inte att den gäller just den här raden.
 */
export async function verifieraPreviewToken(
  secret: string,
  token: string | null | undefined
): Promise<PreviewTokenResultat> {
  if (!token) return { ok: false, orsak: "token saknas" };

  const delar = token.split(".");
  if (delar.length !== 3 || delar[0] !== PREVIEW_PREFIX) {
    return { ok: false, orsak: "token har fel form" };
  }

  const bas = `${delar[0]}.${delar[1]}`;
  if (!likaITid(await signOverlayBody(bas, secret), delar[2])) {
    return { ok: false, orsak: "token har ogiltig signatur" };
  }

  let anspråk: { e?: unknown; r?: unknown; x?: unknown };
  try {
    anspråk = JSON.parse(b64urlAvkoda(delar[1]));
  } catch {
    return { ok: false, orsak: "token går inte att läsa" };
  }

  const { e, r, x } = anspråk;
  if (typeof e !== "string" || typeof r !== "number" || typeof x !== "string") {
    return { ok: false, orsak: "token saknar anspråk" };
  }

  const utgang = Date.parse(x);
  if (Number.isNaN(utgang)) return { ok: false, orsak: "token har ogiltig utgångstid" };
  if (utgang <= Date.now()) return { ok: false, orsak: "token har gått ut" };

  return { ok: true, external_id: e, revision: r, expires_at: x };
}

// ── Sanering av info_html ──────────────────────────────────────────────────

/** Allowlist enligt kontraktet. Allt annat plockas bort. */
export const TILLATNA_TAGGAR = ["p", "br", "strong", "em", "ul", "li", "a"] as const;

const TOMMA_TAGGAR = new Set(["br"]);
const TILLATNA = new Set<string>(TILLATNA_TAGGAR);

/** Taggar vars INNEHÅLL också ska bort, inte bara taggen. */
const FARLIGT_INNEHALL = /<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi;

function escapeText(s: string): string {
  return s
    .replace(/&(?!#?\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sakerHref(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, "");
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) {
    return v.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return null;
}

/**
 * Sanerar CRM:ets rich text till kontraktets allowlist:
 * `p, br, strong, em, ul, li, a[href]`.
 *
 * Allt annat försvinner — taggen tas bort men texten behålls, utom för
 * script/style/iframe/object/embed/template där även innehållet går. Alla
 * attribut utom `href` på `<a>` strippas, och `href` måste vara
 * http(s)/mailto/tel. Utgående länkar får `rel="nofollow noopener"`.
 *
 * Sanitering sker i sajtens endpoint, inte i CRM:et — sajten litar aldrig på
 * att avsändaren redan har städat.
 */
export function sanitizeInfoHtml(input: string | null | undefined): string | null {
  if (!input) return null;

  let html = input.replace(/<!--[\s\S]*?-->/g, "");
  // Kör tills inget mer matchar: <scr<script>ipt> ska inte kunna smygas förbi.
  let forra: string;
  do {
    forra = html;
    html = html.replace(FARLIGT_INNEHALL, "");
  } while (html !== forra);

  // `<` är förbjudet i attributdelen: annars slukar en trasig tagg (`<scr<p>`)
  // nästa riktiga tagg. Matchar den inte escapas texten i stället, som sig bör.
  const taggRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'<])*)\/?>/g;
  const oppna: string[] = [];
  let ut = "";
  let pos = 0;
  let m: RegExpExecArray | null;

  while ((m = taggRe.exec(html)) !== null) {
    ut += escapeText(html.slice(pos, m.index));
    pos = m.index + m[0].length;

    const namn = m[1].toLowerCase();
    const arSlut = m[0].startsWith("</");
    if (!TILLATNA.has(namn)) continue;

    if (arSlut) {
      // Stäng bara taggar vi faktiskt öppnat, i rätt ordning.
      const i = oppna.lastIndexOf(namn);
      if (i === -1) continue;
      while (oppna.length > i) ut += `</${oppna.pop()}>`;
      continue;
    }

    if (TOMMA_TAGGAR.has(namn)) {
      ut += "<br />";
      continue;
    }

    if (namn === "a") {
      const href = /(?:^|\s)href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2]);
      const safe = href ? sakerHref(href[2] ?? href[3] ?? href[4] ?? "") : null;
      if (!safe) continue; // länk utan användbar href är bara text
      ut += `<a href="${safe}" rel="nofollow noopener">`;
      oppna.push("a");
      continue;
    }

    ut += `<${namn}>`;
    oppna.push(namn);
  }

  ut += escapeText(html.slice(pos));
  while (oppna.length) ut += `</${oppna.pop()}>`;

  const trimmad = ut.replace(/(?:\s|<br \/>|<p><\/p>)+$/g, "").trim();
  return trimmad.length > 0 ? trimmad : null;
}
