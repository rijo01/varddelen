import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  Globe,
  Hash,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { kommunByCode } from "@/lib/kommuner";
import {
  branschPageSlug,
  getForetagByCfarnr,
  listRelatedForetag,
  listSokordForCfarnr,
  parseCfarnrFromSlug,
  type Foretag,
} from "@/lib/queries";
import { getBranschName } from "@/lib/branscher";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import {
  displayName,
  employerSize,
  googleMapsUrl,
  initialFor,
  isFeatured,
  legalFormFor,
  monogramGradient,
  normalizeWebb,
  orgnrDisplay,
  shortWebb,
} from "@/lib/foretag-format";
import { isPersonalOrgnr } from "@/lib/jurform";
import { sanitizeInfotext, safeLogotypUrl } from "@/lib/sanitize-html";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const cfarnr = parseCfarnrFromSlug(slug);
  if (!cfarnr) return { title: "Företag hittades inte" };
  const f = await getForetagByCfarnr(cfarnr);
  if (!f) return { title: "Företag hittades inte" };
  const name = displayName(f);
  const kommun = f.kommun ? kommunByCode(f.kommun) : null;
  const title = kommun ? `${name} – ${kommun.name}` : name;
  const description = `${name}${
    kommun ? ` i ${kommun.name} kommun` : ""
  }${f.gatuadress ? `, ${f.gatuadress}` : ""}. Kontaktuppgifter, bransch och företagsinformation från offentliga register.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/foretag/${slug}` },
    openGraph: { title, description, type: "website", locale: "sv_SE" },
  };
}

export default async function ForetagPage({ params }: { params: Params }) {
  const { slug } = await params;
  const cfarnr = parseCfarnrFromSlug(slug);
  if (!cfarnr) notFound();
  const f = await getForetagByCfarnr(cfarnr);
  if (!f) notFound();

  const kommun = f.kommun ? kommunByCode(f.kommun) : null;
  const branschName = f.ng1 ? await getBranschName(f.ng1) : null;
  const name = displayName(f);
  const legalForm = legalFormFor(f);
  const size = employerSize(f.aeant);
  const mapsUrl = googleMapsUrl(f);
  const webb = normalizeWebb(f.webb);
  const featured = isFeatured(f);
  const orgnrInfo = orgnrDisplay(f);
  const sanitizedInfotext = sanitizeInfotext(f.infotext);
  const logoUrl = safeLogotypUrl(f.logotyp);
  const personalOrgnr = isPersonalOrgnr(f.jurform);

  // Hämta liknande företag + sökord parallellt — sokord-queryn är liten
  // (en cfarnr) men ska inte serialiseras efter related-queryn.
  const [related, sokord] = await Promise.all([
    kommun && f.ng1
      ? listRelatedForetag(kommun.code, f.ng1, f.cfarnr, 6)
      : Promise.resolve([] as Foretag[]),
    listSokordForCfarnr(f.cfarnr),
  ]);

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    ...(kommun ? [{ name: kommun.name, href: `/kommun/${kommun.slug}` }] : []),
    ...(kommun && branschName && f.ng1
      ? [
          {
            name: branschName,
            href: `/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`,
          },
        ]
      : []),
    { name },
  ];

  const breadcrumbJsonLd = buildBreadcrumb(
    breadcrumbItems
      .filter((b) => b.href)
      .map((b) => ({ name: b.name, url: `${SITE_URL}${b.href!}` }))
      .concat([{ name, url: `${SITE_URL}/foretag/${slug}` }]),
  );

  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    ...(f.gatuadress || f.postort
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: f.gatuadress ?? undefined,
            postalCode: f.postnr ? String(f.postnr) : undefined,
            addressLocality: f.postort ?? kommun?.name,
            addressCountry: "SE",
          },
        }
      : {}),
    ...(f.tel ? { telephone: f.tel } : {}),
    ...(webb ? { url: webb } : {}),
    ...(f.epostadress ? { email: f.epostadress } : {}),
    ...(f.aeant ? { numberOfEmployees: f.aeant } : {}),
    ...(sokord.length > 0
      ? {
          keywords: sokord.join(", "),
          knowsAbout: sokord.slice(0, 30),
        }
      : {}),
  };

  // FAQ — kontextuell, dynamisk
  const faqItems = buildFaq({ name, branschName, kommun: kommun?.name ?? null, f });
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };

  // Genererad beskrivning — neutral mening om vi saknar infotext
  const description = buildDescription({
    name,
    branschName,
    kommun: kommun?.name ?? null,
    f,
    legalForm,
  });

  return (
    <div className="space-y-8">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={localBusinessJsonLd} />
      <JsonLd data={faqJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      {/* ========= HEADER ========= */}
      <header
        className={`rd-fade-up overflow-hidden rounded-3xl border bg-white rd-shadow-md ${
          featured ? "border-[var(--brand-2)]/35" : "border-[var(--rule)]"
        }`}
      >
        <div className="relative p-6 sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-0"
            style={{
              background: featured
                ? "radial-gradient(ellipse 70% 50% at 0% 0%, rgba(91,194,167,0.22), transparent 65%),"
                  + "radial-gradient(ellipse 50% 40% at 100% 0%, rgba(30,142,132,0.12), transparent 70%),"
                  + "linear-gradient(180deg, #effaf5 0%, #ffffff 60%)"
                : "radial-gradient(ellipse 70% 50% at 0% 0%, rgba(91,194,167,0.15), transparent 65%),"
                  + "linear-gradient(180deg, #f6fcf9 0%, #ffffff 60%)",
            }}
          />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${name} logotyp`}
                loading="lazy"
                className="size-20 shrink-0 rounded-2xl border border-[var(--rule)] bg-white object-contain p-2 shadow-[0_4px_12px_-4px_rgba(17,24,28,0.08)] sm:size-24"
              />
            ) : (
              <div
                aria-hidden
                className="inline-flex size-20 shrink-0 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-[0_8px_24px_-8px_rgba(30,142,132,0.55)] ring-1 ring-white/40 sm:size-24 sm:text-[2.25rem]"
                style={{ backgroundImage: monogramGradient(f.cfarnr) }}
              >
                {initialFor(name)}
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {featured && (
                  <span className="inline-flex items-center gap-1.5 rounded-full rd-brand-gradient px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_4px_10px_-4px_rgba(30,142,132,0.5)]">
                    <Sparkles className="size-3.5" aria-hidden />
                    Utvald
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Officiell registerdata
                </span>
                {legalForm && (
                  <span className="inline-flex items-center rounded-full border border-[var(--rule)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]">
                    {legalForm}
                  </span>
                )}
              </div>
              <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.25rem]">
                {name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-[var(--text-muted)]">
                {branschName && f.ng1 && kommun ? (
                  <Link
                    href={`/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`}
                    className="font-medium text-[var(--brand-ink)] hover:underline"
                  >
                    {branschName}
                  </Link>
                ) : branschName ? (
                  <span className="font-medium text-[var(--text-body)]">
                    {branschName}
                  </span>
                ) : null}
                {branschName && kommun && (
                  <span aria-hidden className="text-[var(--text-faint)]">·</span>
                )}
                {kommun && (
                  <Link
                    href={`/kommun/${kommun.slug}`}
                    className="hover:text-[var(--brand-ink)] hover:underline"
                  >
                    {kommun.name} kommun
                  </Link>
                )}
              </div>
              {size && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-3)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-ink)]">
                    <Users className="size-3.5" aria-hidden />
                    {size.label}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action-rad */}
          <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--rule-soft)] pt-5 sm:gap-2.5">
            {f.tel && (
              <ActionButton
                href={`tel:${f.tel}`}
                icon={<Phone className="size-4" aria-hidden />}
                label="Ring"
                hint={f.tel}
                variant="primary"
              />
            )}
            {f.epostadress && (
              <ActionButton
                href={`mailto:${f.epostadress}`}
                icon={<Mail className="size-4" aria-hidden />}
                label="E-post"
                variant="secondary"
              />
            )}
            {webb && (
              <ActionButton
                href={webb}
                external
                icon={<Globe className="size-4" aria-hidden />}
                label="Hemsida"
                hint={shortWebb(webb) ?? undefined}
                variant="secondary"
              />
            )}
            {mapsUrl && (
              <ActionButton
                href={mapsUrl}
                external
                icon={<MapPin className="size-4" aria-hidden />}
                label="Visa på karta"
                variant="ghost"
              />
            )}
          </div>
        </div>
      </header>

      {/* ========= BESKRIVNING + BRANSCH-CHIPS ========= */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rd-fade-up rd-fade-up-delay-1 rd-card p-6 sm:p-7">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-strong)]">
            Om {name}
          </h2>
          {sanitizedInfotext ? (
            <div
              className="rd-rich-text text-[15px] leading-relaxed text-[var(--text-body)]"
              dangerouslySetInnerHTML={{ __html: sanitizedInfotext }}
            />
          ) : (
            <p className="text-[15px] leading-relaxed text-[var(--text-body)]">
              {description}
            </p>
          )}
          {f.kontaktperson && (
            <div className="mt-5 flex items-center gap-3 border-t border-[var(--rule-soft)] pt-4">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--tint-3)] text-[var(--brand-ink)]">
                <User className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-dim)]">
                  Kontaktperson
                </p>
                <p className="text-sm font-medium text-[var(--text-strong)]">
                  {f.kontaktperson}
                </p>
              </div>
            </div>
          )}
          {branschName && (
            <>
              <h3 className="mt-7 mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                Bransch
              </h3>
              <div className="flex flex-wrap gap-2">
                {kommun && f.ng1 ? (
                  <Link
                    href={`/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand)]/30 bg-[var(--tint-3)] px-3 py-1.5 text-sm font-medium text-[var(--brand-ink)] transition hover:bg-white"
                  >
                    {branschName}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-[var(--rule)] bg-[var(--surface-soft)] px-3 py-1.5 text-sm font-medium text-[var(--text-body)]">
                    {branschName}
                  </span>
                )}
                <Link
                  href={`/sok?q=${encodeURIComponent(branschName)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--brand-2)]/40 hover:text-[var(--brand-ink)]"
                >
                  {branschName} i hela Sverige
                </Link>
              </div>
            </>
          )}
          {sokord.length > 0 && (
            <>
              <h3 className="mt-7 mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                Tjänster &amp; sökord
                <span className="font-mono text-[10px] font-normal normal-case tracking-normal text-[var(--text-faint)]">
                  {sokord.length}
                </span>
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {sokord.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/sok?q=${encodeURIComponent(s)}`}
                      className="inline-flex items-center rounded-full border border-[var(--rule)] bg-white px-2.5 py-1 text-[13px] font-medium text-[var(--text-body)] transition hover:border-[var(--brand-2)]/45 hover:bg-[var(--tint-2)] hover:text-[var(--brand-ink)]"
                      title={`Sök ${s}`}
                    >
                      {s}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Adressblock */}
        <div className="rd-fade-up rd-fade-up-delay-1 rd-card p-6 sm:p-7">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-strong)]">
            Besöksadress
          </h2>
          {f.gatuadress || f.postort ? (
            <>
              <address className="not-italic">
                <p className="text-[15px] font-semibold text-[var(--text-strong)]">
                  {f.gatuadress ?? "—"}
                </p>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                  {[f.postnr, f.postort].filter(Boolean).join(" ") || ""}
                </p>
                {kommun && (
                  <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                    {kommun.name} kommun, Sverige
                  </p>
                )}
              </address>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="nofollow noopener"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-ink)] hover:underline"
                >
                  Öppna i Google Maps
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Ingen adress registrerad.
            </p>
          )}
        </div>
      </section>

      {/* ========= KONTAKT + FÖRETAGSINFO ========= */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rd-fade-up rd-fade-up-delay-2 rd-card p-6 sm:p-7">
          <h2 className="mb-5 text-lg font-semibold text-[var(--text-strong)]">
            Kontaktuppgifter
          </h2>
          <dl className="divide-y divide-[var(--rule-soft)]">
            <ContactRow
              icon={<Phone className="size-4" aria-hidden />}
              label="Telefon"
              value={f.tel}
              href={f.tel ? `tel:${f.tel}` : null}
            />
            <ContactRow
              icon={<Mail className="size-4" aria-hidden />}
              label="E-post"
              value={f.epostadress}
              href={f.epostadress ? `mailto:${f.epostadress}` : null}
            />
            <ContactRow
              icon={<Globe className="size-4" aria-hidden />}
              label="Hemsida"
              value={shortWebb(webb)}
              href={webb}
              external
            />
            <ContactRow
              icon={<MapPin className="size-4" aria-hidden />}
              label="Adress"
              value={
                [
                  f.gatuadress,
                  [f.postnr, f.postort].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .join(", ") || null
              }
            />
          </dl>
        </div>

        <div className="rd-fade-up rd-fade-up-delay-2 rd-card p-6 sm:p-7">
          <h2 className="mb-5 text-lg font-semibold text-[var(--text-strong)]">
            Företagsinformation
          </h2>
          <dl className="divide-y divide-[var(--rule-soft)]">
            <InfoRow
              icon={<Hash className="size-3.5" aria-hidden />}
              label="Organisationsnummer"
              value={
                orgnrInfo?.kind === "orgnr" ? (
                  <span className="font-mono tabular-nums">{orgnrInfo.value}</span>
                ) : orgnrInfo?.kind === "hidden" ? (
                  <span className="text-xs italic text-[var(--text-muted)]">
                    {orgnrInfo.value}
                  </span>
                ) : null
              }
            />
            <InfoRow
              icon={<Building2 className="size-3.5" aria-hidden />}
              label="Juridisk form"
              value={legalForm}
            />
            <InfoRow
              icon={<Users className="size-3.5" aria-hidden />}
              label="Antal anställda"
              value={
                f.aeant ? (
                  <span className="font-mono tabular-nums">
                    ca {f.aeant.toLocaleString("sv-SE")}
                  </span>
                ) : null
              }
            />
            <InfoRow
              icon={<MapPin className="size-3.5" aria-hidden />}
              label="Kommun"
              value={
                kommun ? (
                  <Link
                    href={`/kommun/${kommun.slug}`}
                    className="text-[var(--brand-ink)] hover:underline"
                  >
                    {kommun.name}
                  </Link>
                ) : null
              }
            />
            <InfoRow
              icon={<MapPin className="size-3.5" aria-hidden />}
              label="Postort"
              value={
                f.postort ? (
                  <span className="text-[var(--text-strong)]">{f.postort}</span>
                ) : null
              }
            />
          </dl>
          <p className="mt-5 border-t border-[var(--rule-soft)] pt-4 text-xs text-[var(--text-dim)]">
            {personalOrgnr
              ? "Organisationsnummer döljs eftersom det är ett personnummer (enskild firma). Företagsdata kommer från offentliga register."
              : "Företagsdata kommer från offentliga register och SCB."}
          </p>
        </div>
      </section>

      {/* ========= LIKNANDE FÖRETAG ========= */}
      {related.length > 0 && kommun && (
        <section className="rd-fade-up rd-fade-up-delay-3 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
                Liknande företag
              </p>
              <h2 className="text-xl font-semibold text-[var(--text-strong)] sm:text-2xl">
                {branschName ? `${branschName} i ${kommun.name}` : `Företag i ${kommun.name}`}
              </h2>
            </div>
            <Link
              href={
                branschName && f.ng1
                  ? `/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`
                  : `/kommun/${kommun.slug}`
              }
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--brand-ink)] hover:underline"
            >
              Visa alla <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
          <CompanyCardList>
            {related.map((rf) => (
              <li key={rf.id}>
                <CompanyCard
                  foretag={rf}
                  branschName={branschName}
                  kommunName={kommun.name}
                />
              </li>
            ))}
          </CompanyCardList>
        </section>
      )}

      {/* ========= FAQ ========= */}
      <section className="rd-fade-up rd-fade-up-delay-4 space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
            Vanliga frågor
          </p>
          <h2 className="text-xl font-semibold text-[var(--text-strong)] sm:text-2xl">
            Frågor och svar om {name}
          </h2>
        </div>
        <div className="rd-card divide-y divide-[var(--rule-soft)]">
          {faqItems.map((it, i) => (
            <details
              key={i}
              className="group px-5 py-4 sm:px-6"
              {...(i === 0 ? { open: true } : {})}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-[var(--text-strong)]">
                {it.q}
                <span
                  aria-hidden
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-soft)] text-[var(--text-muted)] transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-muted)]">
                {it.a}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

type FaqItem = { q: string; a: string };

function buildDescription({
  name,
  branschName,
  kommun,
  f,
  legalForm,
}: {
  name: string;
  branschName: string | null;
  kommun: string | null;
  f: Foretag;
  legalForm: string | null;
}): string {
  const segs: string[] = [];
  segs.push(
    `${name} är ${legalForm ? `ett ${legalForm.toLowerCase()}` : "registrerat"}${
      branschName
        ? ` verksamt inom ${branschName.toLowerCase()}`
        : ""
    }${kommun ? ` i ${kommun} kommun` : ""}.`,
  );
  if (f.aeant && f.aeant > 0) {
    segs.push(
      `Företaget har ca ${f.aeant.toLocaleString("sv-SE")} anställda enligt senast tillgängliga uppgifter.`,
    );
  }
  if (f.gatuadress) {
    segs.push(
      `Besöksadress: ${f.gatuadress}${f.postort ? `, ${f.postort}` : ""}.`,
    );
  }
  return segs.join(" ");
}

function buildFaq({
  name,
  branschName,
  kommun,
  f,
}: {
  name: string;
  branschName: string | null;
  kommun: string | null;
  f: Foretag;
}): FaqItem[] {
  const items: FaqItem[] = [];

  if (f.gatuadress || f.postort || kommun) {
    const addr =
      [f.gatuadress, [f.postnr, f.postort].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || kommun || "Sverige";
    items.push({
      q: `Var ligger ${name}?`,
      a: `${name} finns på ${addr}${
        kommun && !f.postort ? ` i ${kommun} kommun` : ""
      }.`,
    });
  }

  if (branschName) {
    items.push({
      q: `Vad gör ${name}?`,
      a: `${name} är verksamt inom ${branschName.toLowerCase()}${
        kommun ? ` i ${kommun}` : ""
      }. För att se andra företag i samma bransch kan du klicka på branschlänken ovan.`,
    });
  }

  if (f.tel || f.epostadress || f.webb) {
    const ch: string[] = [];
    if (f.tel) ch.push(`telefon ${f.tel}`);
    if (f.epostadress) ch.push(`e-post ${f.epostadress}`);
    if (f.webb) ch.push(`hemsida ${f.webb}`);
    items.push({
      q: `Hur kontaktar jag ${name}?`,
      a: `Du når ${name} via ${ch.join(", ")}.`,
    });
  } else {
    items.push({
      q: `Hur kontaktar jag ${name}?`,
      a: `Vi har inga publika kontaktuppgifter för ${name} just nu. Företagsuppgifter kan ändras — kontrollera officiella register vid behov.`,
    });
  }

  if (f.aeant) {
    items.push({
      q: `Hur många anställda har ${name}?`,
      a: `${name} har cirka ${f.aeant.toLocaleString("sv-SE")} anställda enligt senast tillgängliga data.`,
    });
  }

  if (f.arEnskildFirma) {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `${name} är en enskild firma. Organisationsnumret är detsamma som ägarens personnummer och visas inte av integritetsskäl enligt GDPR.`,
    });
  } else if (f.orgnr) {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `Organisationsnumret för ${name} är ${f.orgnr}. Uppgiften kommer från officiella register.`,
    });
  } else {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `Organisationsnumret för ${name} är inte tillgängligt i vår källa just nu. Du kan kontrollera det via Bolagsverket eller Skatteverket.`,
    });
  }

  return items;
}

function ActionButton({
  href,
  icon,
  label,
  hint,
  external = false,
  variant,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  external?: boolean;
  variant: "primary" | "secondary" | "ghost";
}) {
  const base =
    "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-[0.99]";
  const styles =
    variant === "primary"
      ? "bg-[#0c8a3d] text-white shadow-[0_6px_18px_-6px_rgba(12,138,61,0.55)] hover:bg-[#076b2f]"
      : variant === "secondary"
        ? "border border-[var(--rule)] bg-white text-[var(--text-strong)] hover:border-[var(--brand-2)]/45 hover:bg-[var(--tint-2)] hover:text-[var(--brand-ink)]"
        : "text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--brand-ink)]";
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "nofollow noopener" } : {})}
      className={`${base} ${styles}`}
    >
      {icon}
      <span>{label}</span>
      {hint && (
        <span
          className={`hidden font-mono text-xs font-normal tabular-nums sm:inline ${
            variant === "primary" ? "text-white/85" : "text-[var(--text-dim)]"
          }`}
        >
          {hint}
        </span>
      )}
    </a>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
  external = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string | null;
  external?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-3)] text-[var(--brand-ink)] ring-1 ring-[var(--brand)]/15">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-dim)]">
          {label}
        </dt>
        <dd className="truncate text-sm text-[var(--text-body)]">
          {value && href ? (
            <a
              href={href}
              {...(external
                ? { target: "_blank", rel: "nofollow noopener" }
                : {})}
              className="font-medium text-[var(--text-strong)] hover:text-[var(--brand-ink)] hover:underline"
            >
              {value}
            </a>
          ) : value ? (
            <span className="font-medium text-[var(--text-strong)]">{value}</span>
          ) : (
            <span className="text-[var(--text-faint)]">Ej tillgängligt</span>
          )}
        </dd>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <dt className="inline-flex items-center gap-2 text-[var(--text-muted)]">
        {icon && <span className="text-[var(--text-dim)]">{icon}</span>}
        {label}
      </dt>
      <dd className="text-right">
        {value ?? <span className="text-[var(--text-faint)]">–</span>}
      </dd>
    </div>
  );
}
