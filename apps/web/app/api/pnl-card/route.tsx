import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { Mark, brandColors as c, ogFonts, stickerDataUrl } from "../../../lib/og";

export const runtime = "nodejs";

const GREEN = "#5FD4A6";
const RED = "#F2687A";

/** The mascot and headline for a result, after the Telegram sticker pack. */
function tier(roe: number) {
  if (roe >= 100) return { sticker: "07-moon", headline: "TO THE MOON" };
  if (roe >= 25) return { sticker: "03-lfg", headline: "LFG" };
  if (roe >= 0) return { sticker: "04-bullish", headline: "BULLISH" };
  if (roe > -50) return { sticker: "09-buy-the-dip", headline: "BUY THE DIP" };
  return { sticker: "15-rekt", headline: "REKT" };
}

const number = (value: string | null, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const price = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: value >= 1000 ? 1 : value >= 1 ? 4 : 6 });

/**
 * A shareable PnL card for a position, styled after Sisera's Telegram stickers. All values come
 * from the query string, as on other exchanges' share cards; it reveals nothing about the account.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const coin = (params.get("coin") ?? "BTC").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "BTC";
  const market = params.get("market") === "spot" ? "spot" : "perp";
  const side = params.get("side") === "short" ? "short" : "long";
  const leverage = Math.min(100, Math.max(1, Math.round(number(params.get("lev"), 1))));
  const roe = Math.max(-100_000, Math.min(100_000, number(params.get("roe"))));
  const pnl = number(params.get("pnl"));
  const entry = number(params.get("entry"));
  const mark = number(params.get("mark"));
  const hideAmounts = params.get("hide") === "1";
  const positive = roe >= 0;
  const accent = positive ? GREEN : RED;
  const { sticker, headline } = tier(roe);
  const [fonts, art] = await Promise.all([ogFonts(), stickerDataUrl(sticker)]);
  const roeText = `${positive ? "+" : "−"}${Math.abs(roe).toLocaleString("en-US", { maximumFractionDigits: Math.abs(roe) >= 100 ? 0 : 1 })}%`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: `radial-gradient(circle at 78% 48%, #23343c 0%, ${c.inkDeep} 62%)`,
        color: c.bone,
        fontFamily: "Mona Sans",
        padding: "56px 64px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 680, height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={40} />
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: 8 }}>SISERA</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 44 }}>
          <span style={{ fontSize: 34, fontWeight: 700 }}>
            {coin}
            {market === "perp" ? "-PERP" : "/USDC"}
          </span>
          <span
            style={{
              display: "flex",
              fontSize: 20,
              fontWeight: 700,
              color: c.inkDeep,
              background: side === "long" ? GREEN : RED,
              borderRadius: 8,
              padding: "6px 14px",
            }}
          >
            {side === "long" ? "LONG" : "SHORT"}
            {market === "perp" ? ` ${leverage}x` : ""}
          </span>
        </div>
        <span
          style={{ fontSize: 26, fontWeight: 700, color: accent, marginTop: 30, letterSpacing: 4 }}
        >
          {headline}
        </span>
        <span
          style={{
            fontSize: 132,
            fontWeight: 700,
            lineHeight: 1,
            color: accent,
            letterSpacing: -4,
            marginTop: 6,
          }}
        >
          {roeText}
        </span>
        {!hideAmounts && (
          <span style={{ fontSize: 30, fontWeight: 600, color: c.bone, marginTop: 14 }}>
            {pnl >= 0 ? "+" : "−"}$
            {Math.abs(pnl).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            PnL
          </span>
        )}
        <div style={{ display: "flex", gap: 48, marginTop: "auto", fontFamily: "Commit Mono" }}>
          {[
            ["ENTRY", entry],
            ["MARK", mark],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 16, color: c.muted, letterSpacing: 3 }}>{label}</span>
              <span style={{ fontSize: 28, color: c.bone }}>${price(Number(value))}</span>
            </div>
          ))}
        </div>
        <span
          style={{
            fontSize: 18,
            color: c.muted,
            marginTop: 26,
            fontFamily: "Commit Mono",
            letterSpacing: 2,
          }}
        >
          sisera.xyz · Trade on Hyperliquid
        </span>
      </div>
      {/* biome-ignore lint/a11y/useAltText: decorative mascot in a generated image */}
      <img
        src={art}
        width={430}
        height={430}
        style={{ position: "absolute", right: 48, top: 100, transform: "rotate(-6deg)" }}
      />
    </div>,
    {
      width: 1200,
      height: 630,
      fonts,
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    },
  );
}
