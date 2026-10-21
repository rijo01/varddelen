import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Heart } from "lucide-react";
import "./globals.css";
import { SiteNav, MobileBottomNav } from "@/components/site-nav";
import { SITE_URL, GA_ID } from "@/lib/site";
import { COUNTS_GENERATED_AT } from "@/lib/counts";
import { GoogleAnalytics } from "@next/third-parties/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** "7 september 2026" — när registerurvalet senast sammanställdes. */
const UPPDATERAD = new Date(COUNTS_GENERATED_AT).toLocaleDateString("sv-SE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

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
    <html lang="sv" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-[var(--text-body)]">
        <a
          href="#innehall"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-[var(--text-strong)]"
        >
          Hoppa till innehållet
        </a>
        <SiteNav />
        <main id="innehall" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:pb-16">
          {children}
        </main>
        <footer className="border-t border-[var(--rule)] bg-[var(--surface-soft)] pb-16 md:pb-0">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_0.8fr]">
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-[17px] font-bold text-[var(--text-strong)]">
                <Heart aria-hidden className="size-5 text-[var(--brand)]" fill="currentColor" strokeWidth={0} />
                <span>
                  Vårddelen<span className="text-[var(--brand)]">.se</span>
                </span>
              </p>
              <p className="max-w-xs text-[15px] text-[var(--text-muted)]">
                Söktjänst för vård- och omsorgsverksamheter i Sveriges 290
                kommuner. Uppgifterna kommer från offentliga register.
              </p>
            </div>

            <div className="space-y-2">
              <h2 className="text-[15px] font-semibold text-[var(--text-strong)]">
                Behöver du vård?
              </h2>
              <p className="text-[15px] text-[var(--text-muted)]">
                Vi ger inga medicinska råd. Akut:{" "}
                <a href="tel:112" className="font-semibold text-[var(--text-strong)] underline">ring 112</a>.
                Sjukvårdsrådgivning dygnet runt:{" "}
                <a href="tel:1177" className="font-semibold text-[var(--text-strong)] underline">1177</a>{" "}
                eller{" "}
                <a href="https://www.1177.se" rel="noopener" className="font-semibold text-[var(--text-strong)] underline">1177.se</a>.
              </p>
            </div>

            <div id="om-ordningen" className="scroll-mt-6 space-y-2">
              <h2 className="text-[15px] font-semibold text-[var(--text-strong)]">
                Så sorteras listorna
              </h2>
              <p className="text-[15px] text-[var(--text-muted)]">
                Ordningen påverkas av hur komplett profilen är och av betalda
                profiler. <strong className="font-semibold text-[var(--text-body)]">Betald placering</strong>{" "}
                betyder att verksamheten betalar för att synas högre.{" "}
                <strong className="font-semibold text-[var(--text-body)]">Komplett profil</strong>{" "}
                betyder att profilen har fler uppgifter än registrets grunddata.
                Ingen av dem är en bedömning av vården. Vi visar inga betyg.
              </p>
            </div>

            <nav aria-label="Sidfot" className="space-y-2">
              <h2 className="text-[15px] font-semibold text-[var(--text-strong)]">Utforska</h2>
              <ul className="space-y-1.5 text-[15px]">
                {[
                  ["/sok", "Sök vård"],
                  ["/branscher", "Vårdkategorier"],
                  ["/kommuner", "Alla 290 kommuner"],
                  ["/kontakt", "Kontakt för företag"],
                ].map(([href, label]) => (
                  <li key={href}>
                    <a href={href} className="text-[var(--text-body)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="border-t border-[var(--rule)]">
            <p className="mx-auto max-w-6xl px-4 py-5 text-[14px] text-[var(--text-dim)]">
              © {new Date().getFullYear()} Vårddelen · Uppgifter från offentliga
              register, senast sammanställda {UPPDATERAD} · Person- och
              organisationsnummer för enskilda firmor visas aldrig.
            </p>
          </div>
        </footer>
        <MobileBottomNav />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <GoogleAnalytics gaId={GA_ID} />
      </body>
    </html>
  );
}
