import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";

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

      {/* ======= HERO ======= */}
      <header className="rd-fade-up relative overflow-hidden rounded-3xl border border-[var(--rule)] bg-white rd-shadow-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(225,29,39,0.10), transparent 65%),"
              + "linear-gradient(180deg, #FFF5F5 0%, #ffffff 70%)",
          }}
        />
        <div className="relative space-y-4 p-6 sm:p-9">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-2)]">
            <Phone aria-hidden className="size-3.5" />
            Kundservice
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.75rem]">
            Kontakta{" "}
            <span className="rd-display rd-text-brand text-[1.15em]">oss</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Har du frågor om sajten, en uppgift som behöver rättas eller vill du
            ansluta din verksamhet? Hör av dig till vår kundservice — vi svarar
            så fort vi kan på vardagar.
          </p>
        </div>
      </header>

      {/* ======= KONTAKTKORT ======= */}
      <section className="space-y-5">
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
            Tre sätt att nå oss
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-3xl">
            Välj det som passar dig
          </h2>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Telefon */}
          <li>
            <a
              href={`tel:${PHONE_TEL}`}
              className="rd-card rd-card-hover group flex h-full flex-col gap-3 p-5"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--tint-2)] text-[var(--brand-2)]">
                <Phone aria-hidden className="size-5" />
              </span>
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">
                  Telefon
                </p>
                <p className="text-lg font-semibold tracking-tight text-[var(--text-strong)] group-hover:text-[var(--brand-ink)]">
                  {PHONE_DISPLAY}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  Vardagar 09:00–17:00
                </p>
              </div>
            </a>
          </li>

          {/* E-post */}
          <li>
            <a
              href={`mailto:${EMAIL}`}
              className="rd-card rd-card-hover group flex h-full flex-col gap-3 p-5"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--tint-2)] text-[var(--brand-2)]">
                <Mail aria-hidden className="size-5" />
              </span>
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">
                  E-post
                </p>
                <p className="break-all text-lg font-semibold tracking-tight text-[var(--text-strong)] group-hover:text-[var(--brand-ink)]">
                  {EMAIL}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  Svar inom 1–2 arbetsdagar
                </p>
              </div>
            </a>
          </li>

          {/* Postadress */}
          <li>
            <div className="rd-card flex h-full flex-col gap-3 p-5">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--tint-2)] text-[var(--brand-2)]">
                <MapPin aria-hidden className="size-5" />
              </span>
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">
                  Postadress
                </p>
                <address className="not-italic text-[15px] leading-relaxed text-[var(--text-strong)]">
                  {POSTAL_LINES.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              </div>
            </div>
          </li>
        </ul>
      </section>

      {/* ======= ORG-INFO ======= */}
      <section className="rd-fade-up grid grid-cols-1 gap-5 rounded-3xl border border-[var(--brand)]/25 bg-[var(--tint-2)] p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-ink)]">
            Organisationsinformation
          </p>
          <h3 className="text-lg font-semibold text-[var(--text-strong)] sm:text-xl">
            Vårddelen drivs av QS Group AB
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-body)]">
            Organisationsnummer{" "}
            <span className="font-mono tabular-nums text-[var(--text-strong)]">
              {ORG_NUMBER}
            </span>
            . Vi följer GDPR och visar endast publika företagsuppgifter — person-
            och organisationsnummer på listade verksamheter visas alltid maskat.
          </p>
        </div>
      </section>
    </div>
  );
}
