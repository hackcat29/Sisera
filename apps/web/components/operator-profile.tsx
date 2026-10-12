"use client";

import { usePrivy } from "@privy-io/react-auth";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUpRight, Check, ChevronDown, Copy, LogOut, Settings, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getPrivyDisplayName, getPrivySolanaAddress } from "../lib/privy-identity";

export function OperatorProfile({
  operator,
  localMode = false,
}: { operator: string; localMode?: boolean }) {
  const router = useRouter();
  const { authenticated, user, logout } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = authenticated ? getPrivyDisplayName(user) : operator;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const email = user?.email?.address || user?.google?.email;
  const address = getPrivySolanaAddress(user);
  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;
  const itemClass =
    "flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 text-[13px] text-slate-300 outline-none focus:bg-white/[.06] focus:text-bone";

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
      if (authenticated) await logout();
      localStorage.removeItem("sisera_active_wallet");
      router.replace("/sign-in");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu.Root
      onOpenChange={() => {
        setCopied(false);
        setError(null);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Account: ${name}`}
          className="flex h-9 items-center gap-2 rounded-md px-1.5 text-slate-300 outline-none transition-colors hover:bg-white/[.05] focus-visible:ring-2 focus-visible:ring-bronze-300"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-bronze-300/25 bg-bronze-300/10 text-[10px] font-semibold text-bronze-200">
            {initials || "S"}
          </span>
          <span className="hidden max-w-28 truncate text-xs xl:block">{name}</span>
          <ChevronDown size={12} className="text-slate-500" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={12}
          collisionPadding={12}
          className="z-[100] w-72 rounded-lg border border-line bg-panel p-1.5 shadow-[0_16px_48px_#0008]"
        >
          <div className="px-3 pb-3 pt-2">
            <p className="truncate text-sm font-medium text-bone">{name}</p>
            <p className="mt-1 truncate text-xs text-slate-500">
              {localMode ? "Local workspace" : email || "Sisera account"}
            </p>
          </div>
          <DropdownMenu.Separator className="mb-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href="/portfolio" className={itemClass}>
              <Wallet size={15} />
              Portfolio
              <span className="ml-auto font-mono text-[11px] text-slate-500">{shortAddress}</span>
            </Link>
          </DropdownMenu.Item>
          {address && (
            <DropdownMenu.Item
              onSelect={(event) => {
                event.preventDefault();
                void navigator.clipboard
                  .writeText(address)
                  .then(() => setCopied(true))
                  .catch(() => setError("Unable to copy wallet address."));
              }}
              className={itemClass}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span>{copied ? "Address copied" : "Copy wallet address"}</span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild>
            <Link href="/settings" className={itemClass}>
              <Settings size={15} />
              Account settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/audit" className={itemClass}>
              <ArrowUpRight size={15} />
              Activity
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            disabled={busy}
            onSelect={(event) => {
              event.preventDefault();
              void signOut();
            }}
            className={`${itemClass} text-rose-300 data-[disabled]:opacity-50`}
          >
            <LogOut size={15} />
            {busy ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
