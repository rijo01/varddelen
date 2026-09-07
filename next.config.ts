import type { NextConfig } from "next";
import path from "node:path";

/**
 * Produktionsaliaset varddelen.vercel.app serverar en identisk kopia av sajten
 * och self-canonicalade tidigare till sig själv — dvs. en fullvärdig dublett som
 * konkurrerade med varddelen.se i indexet. Vercel noindexar bara preview-
 * deployments, inte produktionsaliaset, så det måste vidarebefordras här.
 */
const VERCEL_PROD_ALIAS = "varddelen.vercel.app";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async redirects() {
    return [
      // Hela varddelen.vercel.app -> kanonisk host, sökvägen bevarad.
      {
        source: "/:path*",
        has: [{ type: "host", value: VERCEL_PROD_ALIAS }],
        destination: "https://varddelen.se/:path*",
        permanent: true,
      },

      // ASP-rester från den gamla .NET-sajten. Enligt Wayback-arkivet bestod
      // hela den gamla URL-ytan av startsidan (/default.aspx) plus en
      // AJAX-tjänst (/AutoCompleteService.asmx) som drev sökrutan — inga andra
      // innehållssidor fanns. Google har fortfarande /default.aspx registrerad
      // som sajtens startsida.
      { source: "/default.aspx", destination: "/", permanent: true },
      { source: "/Default.aspx", destination: "/", permanent: true },
      { source: "/AutoCompleteService.asmx", destination: "/sok", permanent: true },
      { source: "/AutoCompleteService.asmx/:path*", destination: "/sok", permanent: true },

      // Skyddsnät för eventuella .aspx/.asp/.ashx-URL:er som Google känner till
      // men som inte finns i arkivet. Ofarligt breda: den gamla sajten hade
      // inga andra ASP-sidor, så detta kan inte massproducera soft-404:or.
      { source: "/:path(.*\\.aspx)", destination: "/", permanent: true },
      { source: "/:path(.*\\.asp)", destination: "/", permanent: true },
      { source: "/:path(.*\\.ashx)", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
