import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { site } from "../lib/site";
import { SiseraMark } from "./sisera-mark";

const navLinks = [
  { href: "/#markets", label: "Markets" },
  { href: "/#private", label: "Private markets" },
  { href: "/#agents", label: "Agents" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-deep/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-6 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Sisera home">
          <SiseraMark size={30} />
          <span className="text-[15px] font-semibold tracking-[0.2em] text-bone">SISERA</span>
        </Link>
        <nav
          aria-label="Main"
          className="hidden items-center gap-8 text-[13px] text-slate-300 md:flex"
        >
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-bone">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={site.github}
            target="_blank"
            rel="noreferrer"
            className="hidden p-2 text-slate-300 hover:text-bone sm:inline-flex"
            aria-label="Sisera on GitHub"
            title="GitHub"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            <span className="sr-only">GitHub</span>
          </a>
          <Link
            href="/sign-in"
            className="hidden px-3 py-2 text-[13px] text-slate-300 hover:text-bone sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/stocks"
            className="inline-flex items-center gap-2 bg-bronze-300 px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-bronze-200"
          >
            Open terminal <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

const footerColumns = [
  {
    title: "Product",
    links: [
      { href: "/stocks", label: "Tokenized stocks" },
      { href: "/private-markets", label: "Private markets" },
      { href: "/intelligence", label: "Intelligence" },
      { href: "/agents", label: "Agents" },
      { href: "/portfolio", label: "Portfolio" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/brand", label: "Brand & press kit" },
      { href: site.github, label: "GitHub", external: true },
      { href: "/llms.txt", label: "llms.txt" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/risk-disclosure", label: "Risk disclosure" },
      { href: "/terms", label: "Terms of use" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ink-deep">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:px-8">
        <div>
          <Link href="/" className="flex items-center gap-3" aria-label="Sisera home">
            <SiseraMark size={28} />
            <span className="text-sm font-semibold tracking-[0.2em] text-bone">SISERA</span>
          </Link>
          <p className="mt-5 max-w-xs text-[13px] leading-6 text-slate-400">
            {site.shortDescription}
          </p>
          <p className="mt-5 font-mono text-[11px] leading-5 text-slate-400">
            Market data: {site.dataSources.join(" · ")}
          </p>
        </div>
        {footerColumns.map((column) => (
          <div key={column.title}>
            <p className="data-label">{column.title}</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-slate-300">
              {column.links.map((link) => (
                <li key={link.href}>
                  {"external" in link && link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-bone"
                    >
                      {link.label}
                      <ArrowUpRight size={12} className="text-slate-500" />
                    </a>
                  ) : (
                    <Link href={link.href} className="hover:text-bone">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1320px] px-4 py-6 text-[11px] leading-5 text-slate-400 md:px-8">
          Sisera provides market data and research tools, not investment advice. Tokenized and
          private-market assets can trade away from their underlying value, can be illiquid, and can
          lose value. Prices may be delayed or incomplete. © {new Date().getFullYear()} Sisera.
        </p>
      </div>
    </footer>
  );
}
