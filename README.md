This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Piloten och företagsspärren (kontrakt 1.6)

**Piloten får inte slås på förrän overlay_foretag_sparr, grants och spärrraderna finns i pilotprojektet, och DELETE är provad mot det.**

- Pilotprojektet (`babenztvwzaiesducpja`) ägs av varddelen-pilotens session. Där körs `lib/sql/overlay-radera.sql` och `lib/sql/overlay-radera-grants.sql`, och klustrets rader i `overlay_foretag_sparr` för `sajt = 'varddelen'` förs över.
- `scripts/pilot-sparrkontroll.mjs` körs i `prebuild` och fäller bygget när `NEXT_PUBLIC_DATAKALLA=pilot` pekar på ett projekt utan spärrtabellen och funktionerna, eller där service role inte kan läsa tabellen. Prov: `npm test` (`test/pilot-sparrkontroll.test.mjs`).
- Att raderna är överförda och att en signerad DELETE fungerar mot projektet kan bygget inte se — det provas för hand innan piloten slås på.
- I klusterläget (dagens produktion) gör steget ingenting; spärren ligger i klustret (ymqb), körd 5 nov.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
