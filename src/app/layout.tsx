import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Heart } from "lucide-react";
import "./globals.css";
import { SiteNav, MobileBottomNav } from "@/components/site-nav";

function HeartIcon() {
  return (
    <Heart
      className="size-6 text-[var(--brand)]"
      fill="currentColor"
      strokeWidth={0}
    />
  );
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Vårddelen – Hitta vård & omsorg i hela Sverige",
    template: "%s | Vårddelen",
  },
  description:
    "Sveriges katalog för vård och omsorg. Hitta tandläkare, behandlingshem, specialistläkare, apotek och omsorgsföretag i alla 290 kommuner.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    siteName: "Vårddelen",
    locale: "sv_SE",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vårddelen",
    url: SITE_URL,
    description:
      "Sveriges katalog för vård och omsorg — tandläkare, behandlingshem, apotek, specialistläkare och omsorgsföretag i alla 290 kommuner.",
  };

  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-[var(--text-body)]">
        <SiteNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 md:pb-12">
          {children}
        </main>
        <footer className="border-t border-[var(--rule)] bg-[var(--surface-soft)]">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr] sm:gap-10">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="inline-flex size-7 items-center justify-center">
                  <HeartIcon />
                </span>
                <span className="text-sm font-semibold text-[var(--text-strong)]">
                  Vårddelen<span className="text-[var(--brand)]">.se</span>
                </span>
              </div>
              <p className="max-w-sm text-sm text-[var(--text-muted)]">
                Sveriges katalog för vård och omsorg. Aggregerad data från
                offentliga register, person- och organisationsnummer maskas av
                integritetsskäl.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                Utforska
              </p>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <a
                    href="/"
                    className="text-[var(--text-body)] hover:text-[var(--brand-ink)]"
                  >
                    Startsidan
                  </a>
                </li>
                <li>
                  <a
                    href="/kommuner"
                    className="text-[var(--text-body)] hover:text-[var(--brand-ink)]"
                  >
                    Alla 290 kommuner
                  </a>
                </li>
                <li>
                  <a
                    href="/branscher"
                    className="text-[var(--text-body)] hover:text-[var(--brand-ink)]"
                  >
                    Vårdkategorier
                  </a>
                </li>
                <li>
                  <a
                    href="/sok"
                    className="text-[var(--text-body)] hover:text-[var(--brand-ink)]"
                  >
                    Fritextsök
                  </a>
                </li>
                <li>
                  <a
                    href="/kontakt"
                    className="text-[var(--text-body)] hover:text-[var(--brand-ink)]"
                  >
                    Kontakta oss
                  </a>
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                Integritet
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                Person- och organisationsnummer visas alltid maskat. Vi följer
                GDPR och visar endast publika företagsuppgifter.
              </p>
            </div>
          </div>
          <div className="border-t border-[var(--rule)]">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-[var(--text-dim)] sm:flex-row sm:items-center sm:justify-between">
              <span>
                © {new Date().getFullYear()} Vårddelen · Data från offentliga
                register
              </span>
              <span className="text-[var(--text-faint)]">
                Byggt i Sverige
              </span>
            </div>
          </div>
        </footer>
        <MobileBottomNav />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </body>
    </html>
  );
}
