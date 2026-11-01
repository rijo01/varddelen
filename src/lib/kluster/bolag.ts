/**
 * Vilket bolag som står bakom varje sajt — i integritetspolicy, sidfot och
 * strukturerade data (schema.org Organization).
 *
 * Uppgifterna är Bolagsverkets (fk_companies, kontrollerat 2026-11-01). Båda
 * bolagens registrerade postadress är Kivras inskanningsadress ("Kivra:
 * <orgnr>, 106 31 Stockholm"). Den står på kontaktsidan som POSTADRESS, men är
 * ingen gatuadress och hör inte hemma i `address` i strukturerade data. Där
 * anges bolagets säte, som är Göteborg för båda.
 */
export type Bolag = {
  /** Registrerat namn. */
  namn: string;
  /** Organisationsnummer, "556948-3141". */
  orgnr: string;
  /** Kommunen där bolaget har sitt säte. */
  sate: string;
};

export const QS_GROUP: Bolag = { namn: "QS Group AB", orgnr: "556948-3141", sate: "Göteborg" };
export const REGIONSDELEN_SVERIGE: Bolag = {
  namn: "Regionsdelen Sverige AB",
  orgnr: "556830-7325",
  sate: "Göteborg",
};

/** Sajt → bolaget som driver den och är personuppgiftsansvarigt. */
export const SAJTENS_BOLAG: Readonly<Record<string, Bolag>> = {
  "hantverkardelen.se": QS_GROUP,
  "varddelen.se": QS_GROUP,
  "regionsdelen.se": REGIONSDELEN_SVERIGE,
};

/** Svenskt momsregistreringsnummer: SE + organisationsnumrets tio siffror + 01. */
export function momsnummer(orgnr: string): string {
  return `SE${orgnr.replace(/\D/g, "")}01`;
}

/**
 * Bolagsfälten i en schema.org Organization för sajten. Sajtens varumärke,
 * kontaktuppgifter och beskrivning läggs till av sajten; det här är det som
 * ska vara lika överallt.
 */
export function bolagJsonLd(sajt: string): Record<string, unknown> {
  const b = SAJTENS_BOLAG[sajt];
  if (!b) throw new Error(`Okänd sajt för bolagsuppgifter: ${sajt}`);
  return {
    legalName: b.namn,
    identifier: {
      "@type": "PropertyValue",
      propertyID: "Organisationsnummer",
      value: b.orgnr,
    },
    taxID: b.orgnr,
    vatID: momsnummer(b.orgnr),
    address: {
      "@type": "PostalAddress",
      addressLocality: b.sate,
      addressCountry: "SE",
    },
  };
}
