"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Download, Share2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export type PnlCardInput = {
  coin: string;
  market: "perp" | "spot";
  side: "long" | "short";
  leverage: number;
  /** Return on margin, in percent. */
  roePct: number;
  pnlUsd: number;
  entryPx: number;
  markPx: number;
};

/** A shareable PnL card for a position, with download, copy and post-to-X. */
export function PnlShareButton({
  card,
  className = "",
}: { card: PnlCardInput; className?: string }) {
  const [open, setOpen] = useState(false);
  const [hideAmount, setHideAmount] = useState(false);
  const src = useMemo(() => {
    const params = new URLSearchParams({
      coin: card.coin,
      market: card.market,
      side: card.side,
      lev: String(card.leverage),
      roe: card.roePct.toFixed(2),
      pnl: card.pnlUsd.toFixed(2),
      entry: String(card.entryPx),
      mark: String(card.markPx),
      ...(hideAmount ? { hide: "1" } : {}),
    });
    return `/api/pnl-card?${params}`;
  }, [card, hideAmount]);
  const roeText = `${card.roePct >= 0 ? "+" : "−"}${Math.abs(card.roePct).toFixed(1)}%`;
  const fileName = `sisera-${card.coin.toLowerCase()}-${card.side}.png`;

  async function copy() {
    try {
      const blob = await (await fetch(src)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Card copied. Paste it anywhere.");
    } catch {
      toast.error("This browser can't copy images. Download it instead.");
    }
  }

  async function share() {
    const text = `${roeText} on my ${card.coin} ${card.side}${card.market === "perp" ? ` (${card.leverage}x)` : ""} with Sisera`;
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      // Phones can attach the image directly; desktops open a post with the text and link.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, url: "https://sisera.xyz" });
        return;
      }
    } catch {
      // Fall back to a prefilled post.
    }
    window.open(
      `https://x.com/intent/post?${new URLSearchParams({ text, url: "https://sisera.xyz" })}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[10px] text-slate-300 hover:border-bronze-400/50 hover:text-bronze-200 ${className}`}
          aria-label={`Share ${card.coin} PnL card`}
        >
          <Share2 size={11} /> Share
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2 border border-line bg-panel p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-slate-100">
              Share your {card.coin} trade
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-100" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[11px] text-slate-500">
            The card shows this position's result. It doesn't reveal your wallet.
          </Dialog.Description>
          <img
            src={src}
            alt={`${card.coin} ${card.side} ${roeText} PnL card`}
            width={1200}
            height={630}
            className="mt-3 h-auto w-full border border-line bg-ink"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <label className="mr-auto flex items-center gap-2 text-slate-400">
              <input
                type="checkbox"
                checked={hideAmount}
                onChange={(event) => setHideAmount(event.target.checked)}
                className="accent-[#e9bd8c]"
              />
              Hide dollar amount
            </label>
            <a
              href={src}
              download={fileName}
              className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-slate-200 hover:border-slate-500"
            >
              <Download size={13} /> Download
            </a>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-slate-200 hover:border-slate-500"
            >
              <Copy size={13} /> Copy
            </button>
            <button
              type="button"
              onClick={() => void share()}
              className="inline-flex items-center gap-1.5 rounded bg-bronze-300 px-3 py-2 font-semibold text-[#0b1b24] hover:bg-bronze-200"
            >
              <Share2 size={13} /> Share
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
