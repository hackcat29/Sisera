import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The web app runs from apps/web during builds and from the repository root under PM2.
async function asset(name: string) {
  const candidates = [
    join(process.cwd(), "assets/og", name),
    join(process.cwd(), "apps/web/assets/og", name),
  ];
  for (const path of candidates) {
    const file = await readFile(path).catch(() => null);
    if (file) return file;
  }
  throw new Error(`OG asset ${name} not found`);
}

export async function ogFonts() {
  const [medium, semibold, bold, mono] = await Promise.all([
    asset("mona-sans-500-normal.woff"),
    asset("mona-sans-600-normal.woff"),
    asset("mona-sans-700-normal.woff"),
    asset("commit-mono-400-normal.woff"),
  ]);
  return [
    { name: "Mona Sans", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Mona Sans", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "Mona Sans", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Commit Mono", data: mono, weight: 400 as const, style: "normal" as const },
  ];
}

/** A Sisera mascot sticker as a data URL, for generated share cards. */
export async function stickerDataUrl(name: string) {
  return `data:image/png;base64,${(await asset(`stickers/${name}.png`)).toString("base64")}`;
}

export async function ribbonDataUrl() {
  return `data:image/jpeg;base64,${(await asset("ribbon.jpg")).toString("base64")}`;
}

export const brandColors = {
  ink: "#0C141B",
  inkDeep: "#080E14",
  line: "#2A3943",
  bone: "#F2F0E9",
  bronze: "#E9BD8C",
  verdigris: "#78B9AD",
  muted: "#A5B1B7",
  /** Backdrop colour along the left edge of the ribbon photo, so it sits seamlessly. */
  ribbonEdge: "#0A141D",
};

export function Mark({
  size,
  stroke = brandColors.bronze,
  accent = brandColors.verdigris,
}: { size: number; stroke?: string; accent?: string }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: rendered into a PNG by Satori, never into the DOM
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M35.5 10.5C31.7 6.9 25.5 6.4 20.9 8.6c-5.2 2.5-7.7 8.4-5.2 12.3 2.3 3.5 7.6 3.9 12.2 5.4 4.6 1.5 7.1 3.4 6.8 7-.4 4.4-5.2 7.3-10.9 7.3-4.5 0-8.3-1.5-11-4.4"
        stroke={stroke}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path d="M8 24h7.3M32.7 24H40" stroke={accent} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="40" cy="24" r="2.2" fill={accent} />
    </svg>
  );
}
