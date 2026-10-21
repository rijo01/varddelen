import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

const PHONE_DISPLAY = "031-130 970";
const PHONE_TEL = "+4631130970";
const EMAIL = "kundservice@varddelen.se";
const ORG_NUMBER = "556948-3141";
const POSTAL_LINES = ["c/o QS Group AB", `Kivra: ${ORG_NUMBER}`, "106 31 Stockholm"];

export const metadata: Metadata = {
  title: "Kontakta oss – Vårddelen",
  description: `Kontakta Vårddelens kundservice. Telefon ${PHONE_DISPLAY}, e-post ${EMAIL}. Postadress c/o QS Group AB, Kivra: ${ORG_NUMBER}, 106 31 Stockholm.`,
  alternates: { canonical: `${SITE_URL}/kontakt` },
};

export default function KontaktPage() {
  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: "Kontakta oss" },
  ];
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: "Kontakta oss", url: `${SITE_URL}/kontakt` },
  ]);

  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vårddelen",
    url: SITE_URL,
    identifier: ORG_NUMBER,
    telephone: PHONE_TEL,
    email: EMAIL,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: PHONE_TEL,
        email: EMAIL,
        areaServed: "SE",
        availableLanguage: ["Swedish", "English"],
      },
    ],
    address: {
      "@type": "PostalAddress",
      streetAddress: `c/o QS Group AB, Kivra: ${ORG_NUMBER}`,
      postalCode: "106 31",
      addressLocality: "Stockholm",
      addressCountry: "SE",
    },
  };

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={orgJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <header className="max-w-3xl space-y-3">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">
          Kontakta Vårddelen
        </h1>
        <p className="text-[18px] leading-relaxed text-[var(--text-body)]">
          Frågor om sajten, en uppgift som behöver rättas, eller vill du
          komplettera din verksamhets profil? Hör av dig till vår kundtjänst.
        </p>
      </header>

      {/* Numret stod tidigare i ett rött fält överst på varje sida. Här står
          det en gång, med en rad som gör klart att det inte är en vårdlinje. */}
      <p
        role="note"
        className="max-w-3xl rounded-lg border-2 border-[var(--brand)] bg-[var(--tint-1)] px-5 py-4 text-[17px] leading-relaxed text-[var(--text-strong)]"
      >
        <strong className="font-semibold">Kundtjänst för företag – inte vårdrådgivning.</strong>{" "}
        Akut? Ring{" "}
        <a href="tel:112" className="font-semibold underline">112</a>. Rådgivning:{" "}
        <a href="tel:1177" className="font-semibold underline">1177</a>.
      </p>

      <dl className="grid max-w-3xl gap-6 sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-dim)]">
            <Phone aria-hidden className="size-4" />
            Telefon, kundtjänst
          </dt>
          <dd>
            <a href={`tel:${PHONE_TEL}`} className="text-[19px] font-semibold text-[var(--text-strong)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline">
              {PHONE_DISPLAY}
            </a>
            <p className="text-[15px] text-[var(--text-muted)]">Vardagar 09:00–17:00</p>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-dim)]">
            <Mail aria-hidden className="size-4" />
            E-post
          </dt>
          <dd>
            <a href={`mailto:${EMAIL}`} className="break-all text-[17px] font-semibold text-[var(--text-strong)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline">
              {EMAIL}
            </a>
            <p className="text-[15px] text-[var(--text-muted)]">Svar inom 1–2 arbetsdagar</p>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-dim)]">
            <MapPin aria-hidden className="size-4" />
            Postadress
          </dt>
          <dd>
            <address className="not-italic text-[16px] leading-relaxed text-[var(--text-strong)]">
              {POSTAL_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </dd>
        </div>
      </dl>

      <section className="max-w-3xl space-y-2 border-t border-[var(--rule)] pt-8">
        <h2 className="text-[1.25rem] font-semibold">Om Vårddelen</h2>
        <p className="text-[16px] leading-relaxed text-[var(--text-muted)]">
          Vårddelen drivs av QS Group AB, organisationsnummer{" "}
          <span className="text-[var(--text-strong)]">{ORG_NUMBER}</span>. Vi visar
          bara publika företagsuppgifter, och organisationsnummer som är
          personnummer (enskilda firmor) visas aldrig.
        </p>
      </section>
    </div>
  );
}
