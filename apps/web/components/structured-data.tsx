import { faqs, site } from "../lib/site";

/** Renders one or more schema.org objects as JSON-LD. */
export function StructuredData({
  data,
}: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be inlined; content is static and escaped below.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${site.url}/#organization`,
  name: site.name,
  url: site.url,
  logo: `${site.url}/icons/icon-512.png`,
  description: site.description,
  email: site.contactEmail,
  contactPoint: {
    "@type": "ContactPoint",
    email: site.contactEmail,
    contactType: "customer support",
  },
  ...(site.sameAs.length ? { sameAs: site.sameAs } : {}),
};

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${site.url}/#website`,
  name: site.name,
  url: site.url,
  description: site.shortDescription,
  publisher: { "@id": `${site.url}/#organization` },
  inLanguage: "en-US",
};

export const applicationSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${site.url}/#app`,
  name: "Sisera Terminal",
  url: `${site.url}/stocks`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires a modern browser with JavaScript enabled.",
  description: site.description,
  publisher: { "@id": `${site.url}/#organization` },
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
  featureList: [
    "Tokenized stock prices compared with underlying share reference prices",
    "Pre-IPO token prices compared with issuer marks and implied valuations",
    "Crypto spot and Hyperliquid perpetuals with order book depth",
    "Prediction markets with paper trading",
    "Company news and price-move intelligence",
    "Portfolio and risk views across Solana and Hyperliquid",
    "Rule-bound research agents with capital caps and kill switches",
  ],
};

export const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export function breadcrumbSchema(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${site.url}${item.path}`,
    })),
  };
}
