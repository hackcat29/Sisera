"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@sisera/ui";
import { Command } from "cmdk";
import {
  Bell,
  Bot,
  Boxes,
  BrainCircuit,
  BriefcaseBusiness,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Compass,
  Globe2,
  Landmark,
  ListFilter,
  Menu,
  Network,
  Rss,
  Search,
  Settings,
  ShieldCheck,
  Target,
  Trophy,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { OperatorProfile } from "./operator-profile";
import { PortfolioConnect } from "./portfolio-connect";
import { SiseraMark } from "./sisera-mark";

export { SiseraMark } from "./sisera-mark";

type SearchAsset = {
  href: string;
  name: string;
  symbol: string;
  category: "Public stock" | "Private market";
};

const navigation = [
  {
    label: "Stock markets",
    items: [
      { href: "/stocks", label: "Stocks", hint: "⌥1", icon: CandlestickChart },
      { href: "/private-markets", label: "Private markets", hint: "⌥2", icon: Landmark },
      { href: "/clawpump", label: "Agent markets", hint: "", icon: Boxes },
    ],
  },
  {
    label: "Broader markets",
    items: [
      { href: "/markets?venue=binance", label: "Crypto spot", hint: "", icon: ListFilter },
      {
        href: "/terminal?venue=hyperliquid",
        label: "Perpetuals",
        hint: "",
        icon: CandlestickChart,
      },
      { href: "/predictions", label: "Predictions", hint: "", icon: Target },
      { href: "/macro", label: "Macro & chains", hint: "⌥4", icon: Globe2 },
      { href: "/social", label: "Social feeds", hint: "", icon: Rss },
    ],
  },
  {
    label: "Research",
    items: [{ href: "/intelligence", label: "Intelligence", hint: "", icon: BrainCircuit }],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/portfolio", label: "Portfolio", hint: "", icon: BriefcaseBusiness },
      { href: "/risk", label: "Risk", hint: "", icon: ShieldCheck },
      { href: "/leaderboard", label: "Leaderboard", hint: "", icon: Trophy },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/agents", label: "Agents", hint: "", icon: Bot },
      { href: "/audit", label: "Activity", hint: "", icon: Network },
    ],
  },
];

const utilityNavigation = [
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function OperatorShell({
  children,
  operator,
  localMode = false,
}: { children: ReactNode; operator: string; localMode?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchAssets, setSearchAssets] = useState<SearchAsset[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const allCommands = useMemo(
    () => [...navigation.flatMap((group) => group.items), ...utilityNavigation],
    [],
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      }
      const editing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (!editing && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        const shortcut: Record<string, string> = {
          "1": "/stocks",
          "2": "/private-markets",
          "4": "/macro",
        };
        const href = shortcut[event.key];
        if (href) {
          event.preventDefault();
          router.push(href);
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [router]);

  useEffect(() => {
    if (!commandsOpen || searchState !== "idle") return;
    setSearchState("loading");
    fetch("/api/search-index")
      .then((response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return response.json() as Promise<{ data: SearchAsset[] }>;
      })
      .then((payload) => {
        setSearchAssets(payload.data);
        setSearchState("ready");
      })
      .catch(() => setSearchState("error"));
  }, [commandsOpen, searchState]);

  const navigate = (href: string) => {
    setCommandsOpen(false);
    setMobileOpen(false);
    router.push(href);
  };
  const sidebarWidth = collapsed ? "lg:ml-[72px]" : "lg:ml-[232px]";

  return (
    <div className="min-h-screen bg-ink text-slate-100 lg:h-screen lg:overflow-hidden">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 hidden border-r border-line bg-[#101b23] transition-[width] duration-200 lg:flex lg:flex-col",
          collapsed ? "w-[72px]" : "w-[232px]",
        )}
      >
        <div className="flex h-16 items-center border-b border-line px-4">
          <Link
            href="/stocks"
            className="flex min-w-0 items-center gap-3"
            aria-label="Sisera terminal"
          >
            <SiseraMark />
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-[0.16em] text-slate-100">SISERA</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
                  Markets / workspace
                </p>
              </div>
            )}
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          {navigation.map((group) => (
            <div key={group.label} className="mb-5 px-2">
              {!collapsed && (
                <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  {group.label}
                </p>
              )}
              <nav className="space-y-0.5">
                {group.items.map((item) => {
                  const route = item.href.split("?")[0] ?? item.href;
                  const active = pathname === route || pathname.startsWith(`${route}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex h-10 items-center gap-3 rounded-md border border-transparent px-2 text-[13px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100",
                        active && "border-cyan-400/20 bg-cyan-400/[0.1] font-medium text-cyan-200",
                        collapsed && "justify-center",
                      )}
                    >
                      <item.icon size={15} strokeWidth={1.7} className="shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="truncate">{item.label}</span>
                          {item.hint && (
                            <span className="ml-auto font-mono text-[8px] text-slate-700">
                              {item.hint}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-2">
          {utilityNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex h-9 items-center gap-3 px-2 text-[12px] text-slate-600 hover:bg-slate-900 hover:text-slate-200",
                collapsed && "justify-center",
              )}
            >
              <item.icon size={15} />
              {!collapsed && item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              "mt-1 flex h-9 w-full items-center gap-3 border-t border-line px-2 pt-1 text-[11px] text-slate-700 hover:text-slate-300",
              collapsed && "justify-center",
            )}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && <span>Collapse navigation</span>}
          </button>
        </div>
      </aside>

      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 flex h-16 items-center border-b border-line bg-[#101b23]/95 backdrop-blur transition-[left] duration-200",
          sidebarWidth,
        )}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="grid h-full w-12 place-items-center border-r border-line text-slate-400 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 lg:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[13px] font-medium text-slate-300">Markets</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandsOpen(true)}
              className="flex h-9 min-w-8 items-center gap-2 rounded-md border border-line bg-panel px-3 text-[12px] text-slate-400 hover:border-slate-500 sm:min-w-52"
            >
              <Search size={13} />
              <span className="hidden sm:inline">Search markets</span>
              <span className="ml-auto hidden font-mono text-[9px] text-slate-700 sm:inline">
                ⌘K
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCommandsOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-[12px] text-slate-300 hover:border-cyan-500/40 md:flex"
            >
              <Compass size={13} className="text-cyan-300" /> Explore
            </button>
            <PortfolioConnect compact />
            <OperatorProfile operator={operator} localMode={localMode} />
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[90] bg-black/75 lg:hidden">
          <div className="h-full w-72 border-r border-line bg-[#070b10] p-4 shadow-2xl">
            <div className="mb-7 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SiseraMark />
                <span className="font-semibold tracking-[.2em]">SISERA</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            {allCommands.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => navigate(item.href)}
                className="flex h-11 w-full items-center gap-3 border-b border-line text-sm text-slate-300"
              >
                <item.icon size={16} /> {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <main
        className={cn(
          "min-h-screen pt-16 transition-[margin] duration-200 lg:h-screen lg:min-h-0 lg:overflow-auto",
          sidebarWidth,
        )}
      >
        {children}
      </main>

      <Dialog.Root open={commandsOpen} onOpenChange={setCommandsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-[#020407]/80 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-[13%] z-[110] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden border border-line-strong bg-[#0a1017] shadow-2xl shadow-black/60">
            <Dialog.Title className="sr-only">Global command menu</Dialog.Title>
            <Command className="w-full">
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={16} className="text-cyan-300" />
                <Command.Input
                  autoFocus
                  placeholder="Search pages, companies, or symbols…"
                  className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                />
                <span className="border border-line px-1.5 py-1 font-mono text-[9px] text-slate-600">
                  ESC
                </span>
              </div>
              <Command.List className="max-h-[430px] overflow-auto p-2">
                <Command.Empty className="p-10 text-center text-xs text-slate-500">
                  No result found.
                </Command.Empty>
                <Command.Group
                  heading="Navigate"
                  className="text-[9px] uppercase tracking-widest text-slate-600"
                >
                  {allCommands.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => navigate(item.href)}
                      className="mt-1 flex cursor-pointer items-center gap-3 px-3 py-3 text-sm normal-case tracking-normal text-slate-300 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white"
                    >
                      <item.icon size={15} /> {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group
                  heading="Markets"
                  className="text-[9px] uppercase tracking-widest text-slate-600"
                >
                  {searchAssets.map((asset) => (
                    <Command.Item
                      key={asset.href}
                      value={`${asset.name} ${asset.symbol} ${asset.category}`}
                      onSelect={() => navigate(asset.href)}
                      className="mt-1 flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm normal-case tracking-normal text-slate-300 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white"
                    >
                      <span className="truncate">
                        {asset.name}{" "}
                        <span className="font-mono text-slate-500">{asset.symbol}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-500">
                        {asset.category}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
                {searchState === "loading" && (
                  <p className="px-3 py-2 text-xs text-slate-500">Loading markets…</p>
                )}
                {searchState === "error" && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-amber-300">
                    <span>Market search is unavailable; page navigation still works.</span>
                    <button
                      type="button"
                      onClick={() => setSearchState("idle")}
                      className="text-cyan-300 hover:text-white"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </Command.List>
              <div className="flex items-center justify-between border-t border-line px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-slate-700">
                <span>↑↓ Navigate · ↵ Open</span>
                <span>Press Esc to close</span>
              </div>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
