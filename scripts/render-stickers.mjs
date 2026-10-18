#!/usr/bin/env node
// Renders the Sisera Telegram sticker pack and the buy-bot alert cards from vector sources.
//
//   node scripts/render-stickers.mjs            -> stickers/pack/*.png (512x512, transparent)
//                                                 stickers/alerts/*.png (1280x640, buy-bot media)
//
// Everything is drawn here as SVG in the Sisera palette and typeset in Mona Sans / Commit Mono,
// then rasterised with headless Chrome (override the binary with CHROME_PATH).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (file) => readFileSync(join(root, "apps/web/public/fonts", file)).toString("base64");

// ------------------------------------------------------------------ palette
const ink = "#0C141B";
const gold = "#E9BD8C";
const goldDeep = "#B67C43";
const goldLight = "#F8E2C4";
const teal = "#78B9AD";
const tealDeep = "#4F9488";
const tealLight = "#C4E6DF";
const bone = "#F4EEE4";
const green = "#3FCF8E";
const red = "#EF5B5B";
const cheek = "#E8957A";
const flameOrange = "#FF8A3D";
const flameYellow = "#FFD25E";

const S_MARK =
  "M35.5 10.5C31.7 6.9 25.5 6.4 20.9 8.6c-5.2 2.5-7.7 8.4-5.2 12.3 2.3 3.5 7.6 3.9 12.2 5.4 4.6 1.5 7.1 3.4 6.8 7-.4 4.4-5.2 7.3-10.9 7.3-4.5 0-8.3-1.5-11-4.4";

// ------------------------------------------------------------------ primitives
const line = (d, color = ink, width = 8) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const shape = (d, fill, width = 8) =>
  `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${width}" stroke-linejoin="round"/>`;
// A stroke with an ink outline, like a rubber-hose limb.
const tube = (d, color, width) => line(d, ink, width + 12) + line(d, color, width);

function sparkle(x, y, r, color = goldLight) {
  const k = r * 0.28;
  return shape(
    `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`,
    color,
    5,
  );
}

function candle(x, y, h, color, w = 34) {
  return `${line(`M${x} ${y - 16}V${y + h + 16}`, ink, 7)}<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}" stroke="${ink}" stroke-width="7"/>`;
}

function hand(x, y, r = 17) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${gold}" stroke="${ink}" stroke-width="7"/>`;
}

function arm(d, hx, hy) {
  return tube(d, gold, 10) + hand(hx, hy);
}

// ------------------------------------------------------------------ the mascot
// A $SISERA coin wearing the logo's teal bar as a headband, with the S on a forehead plate.
// Drawn around (0,0) with a radius of 120; place it with coin({ x, y, s, ... }).

function eyes(kind, look = [0, 0]) {
  const [lx, ly] = look;
  const at = (x) => [x + lx, -6 + ly];
  const each = (draw) => draw(...at(-40), -1) + draw(...at(40), 1);
  const open = (cx, cy, rx = 15, ry = 20) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${ink}"/>` +
    `<circle cx="${cx - 5}" cy="${cy - 8}" r="5.5" fill="#fff"/>`;
  const happy = (cx, cy) => line(`M${cx - 16} ${cy + 6}Q${cx} ${cy - 18} ${cx + 16} ${cy + 6}`);
  switch (kind) {
    case "open":
      return each((cx, cy) => open(cx, cy));
    case "shiny":
      return each(
        (cx, cy) =>
          `<ellipse cx="${cx}" cy="${cy}" rx="17" ry="22" fill="${ink}"/>` +
          `<circle cx="${cx - 5}" cy="${cy - 8}" r="7" fill="#fff"/>` +
          `<circle cx="${cx + 6}" cy="${cy + 9}" r="3.5" fill="#fff"/>`,
      );
    case "happy":
      return each(happy);
    case "sleep":
      return each((cx, cy) => line(`M${cx - 15} ${cy}Q${cx} ${cy + 13} ${cx + 15} ${cy}`));
    case "sleepy":
      return each(
        (cx, cy) =>
          `<path d="M${cx - 15} ${cy}A15 17 0 0 0 ${cx + 15} ${cy}Z" fill="${ink}"/>${line(`M${cx - 18} ${cy}H${cx + 18}`)}`,
      );
    case "wink":
      return open(...at(-40)) + happy(...at(40));
    case "x":
      return each((cx, cy) =>
        line(
          `M${cx - 13} ${cy - 13}L${cx + 13} ${cy + 13}M${cx + 13} ${cy - 13}L${cx - 13} ${cy + 13}`,
          ink,
          9,
        ),
      );
    case "wide":
      return each(
        (cx, cy) =>
          `<circle cx="${cx}" cy="${cy}" r="21" fill="#fff" stroke="${ink}" stroke-width="7"/>` +
          `<circle cx="${cx + 3}" cy="${cy + 2}" r="8" fill="${ink}"/>`,
      );
    case "shades":
      return `<path d="M-74 -26H74V-14H66V8H58V16H22V8H14V-14H-14V8H-22V16H-58V8H-66V-14H-74Z" fill="${ink}"/><rect x="-56" y="-10" width="9" height="9" fill="#fff"/><rect x="-47" y="-1" width="9" height="9" fill="#fff"/><rect x="24" y="-10" width="9" height="9" fill="#fff"/><rect x="33" y="-1" width="9" height="9" fill="#fff"/>`;
    default:
      throw new Error(`unknown eyes: ${kind}`);
  }
}

function brows(kind) {
  if (!kind) return "";
  const pairs = {
    determined: ["M-60 -42L-24 -32", "M24 -32L60 -42"],
    worried: ["M-60 -32L-26 -44", "M26 -44L60 -32"],
    raised: ["M-58 -44Q-40 -54 -22 -44", "M22 -44Q40 -54 58 -44"],
  }[kind];
  return pairs.map((d) => line(d, ink, 8)).join("");
}

function mouth(kind) {
  switch (kind) {
    case "smile":
      return line("M-20 28Q0 46 20 28");
    case "small":
      return line("M-11 32Q0 40 11 32");
    case "smirk":
      return line("M-18 36Q6 44 24 24");
    case "flat":
      return line("M-16 36Q-8 30 0 36T16 36");
    case "o":
      return `<ellipse cx="0" cy="38" rx="11" ry="13" fill="${ink}"/>`;
    case "open":
    case "tongue": {
      const d = "M-28 22H28Q28 66 0 66Q-28 66 -28 22Z";
      return (
        `<path d="${d}" fill="${ink}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>` +
        `<clipPath id="m${uid}"><path d="${d}"/></clipPath>` +
        `<ellipse clip-path="url(#m${uid++})" cx="${kind === "tongue" ? 8 : 0}" cy="62" rx="17" ry="12" fill="${red}"/>`
      );
    }
    case "grin": {
      const d = "M-32 22H32Q30 62 0 62Q-30 62 -32 22Z";
      return (
        `<path d="${d}" fill="${ink}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>` +
        `<clipPath id="m${uid}"><path d="${d}"/></clipPath>` +
        `<rect clip-path="url(#m${uid++})" x="-32" y="22" width="64" height="12" fill="#fff"/>`
      );
    }
    default:
      throw new Error(`unknown mouth: ${kind}`);
  }
}

let uid = 0;

function coin({
  x = 256,
  y = 230,
  s = 1,
  rotate = 0,
  eyes: eyeKind = "open",
  look,
  brow,
  mouth: mouthKind = "smile",
  cheeks = true,
  sweat = false,
  tails = "right",
  under = "",
  front = "",
}) {
  const id = `c${uid++}`;
  const place = `translate(${x} ${y}) rotate(${rotate}) scale(${s})`;
  // Headband tails sit behind the coin and end in the logo's round terminal.
  const tailArt = `${
    tube("M104 -74C136 -84 156 -104 182 -102", teal, 15) +
    tube("M104 -66C138 -62 152 -46 172 -32", teal, 15)
  }<circle cx="184" cy="-102" r="11" fill="${teal}" stroke="${ink}" stroke-width="6"/>`;
  const face = [
    // Coin edge, face, rim and shine.
    `<circle cy="13" r="120" fill="${goldDeep}" stroke="${ink}" stroke-width="10"/>`,
    `<circle r="120" fill="${gold}"/>`,
    `<circle r="101" fill="none" stroke="${goldLight}" stroke-width="6" opacity=".85"/>`,
    `<circle r="108" fill="none" stroke="${goldDeep}" stroke-width="3" opacity=".45"/>`,
    line("M-92 30A96 96 0 0 1 -94 -24", "#fff", 10).replace("/>", ' opacity=".6"/>'),
    // Headband across the brow, clipped to the face.
    `<clipPath id="${id}"><circle r="116"/></clipPath>`,
    `<g clip-path="url(#${id})"><rect x="-130" y="-88" width="260" height="30" fill="${teal}"/><rect x="-130" y="-66" width="260" height="8" fill="${tealDeep}" opacity=".55"/>${line("M-130 -88H130M-130 -58H130", ink, 7)}</g>`,
    `<circle r="120" fill="none" stroke="${ink}" stroke-width="10"/>`,
    `<rect x="-25" y="-93" width="50" height="40" rx="9" fill="${ink}"/>`,
    `<path d="${S_MARK}" transform="translate(0 -73) scale(.72) translate(-24.6 -23.8)" fill="none" stroke="${gold}" stroke-width="5.5" stroke-linecap="round"/>`,
    // Expression.
    cheeks
      ? `<ellipse cx="-74" cy="24" rx="15" ry="9" fill="${cheek}" opacity=".6"/><ellipse cx="74" cy="24" rx="15" ry="9" fill="${cheek}" opacity=".6"/>`
      : "",
    eyes(eyeKind, look),
    brows(brow),
    mouth(mouthKind),
    sweat
      ? shape(
          "M96 -46C104 -32 110 -22 110 -14A14 14 0 0 1 82 -14C82 -22 88 -32 96 -46Z",
          tealLight,
          6,
        )
      : "",
    front,
  ].join("");
  const mirror = tails === "left" ? " scale(-1 1)" : "";
  return `${
    (tails ? `<g transform="${place}${mirror}">${tailArt}</g>` : "") + under
  }<g transform="${place}">${face}</g>`;
}

// ------------------------------------------------------------------ type
function caption(
  text,
  { y = 470, size = 92, fill = gold, rotate = -4, x = 256, spacing = 1.5 } = {},
) {
  return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" text-anchor="middle" font-family="Mona" font-weight="800" font-size="${size}" letter-spacing="${spacing}" word-spacing="${size * 0.12}" fill="${fill}" stroke="${ink}" stroke-width="${Math.round(size * 0.15)}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
}

const zzz = (x, y, color = teal) =>
  [
    [0, 0, 40],
    [30, -34, 30],
    [52, -62, 22],
  ]
    .map(
      ([dx, dy, size]) =>
        `<text x="${x + dx}" y="${y + dy}" font-family="Mona" font-weight="800" font-size="${size}" fill="${color}" stroke="${ink}" stroke-width="7" paint-order="stroke" stroke-linejoin="round">z</text>`,
    )
    .join("");

function sun(x, y) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r) => `${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
    return `M${p(40)}L${p(56)}`;
  }).join("");
  return `${line(rays, ink, 9)}<circle cx="${x}" cy="${y}" r="28" fill="${flameYellow}" stroke="${ink}" stroke-width="8"/>`;
}

// ------------------------------------------------------------------ scenes
// Each scene is artwork in a 512x512 box; stickers add a caption, alert cards reuse the art.

const scenes = {
  gm: () =>
    `${
      sun(92, 92) +
      coin({ x: 226, y: 222, eyes: "sleepy", mouth: "small", brow: "raised" }) +
      // coffee
      line("M372 214c-9-9 9-15 0-24s9-15 0-24", teal, 7) +
      line("M398 214c-9-9 9-15 0-24s9-15 0-24", teal, 7) +
      shape("M408 250h10a20 20 0 0 1 0 40h-10", "none", 9)
    }<rect x="342" y="226" width="72" height="84" rx="12" fill="${bone}" stroke="${ink}" stroke-width="8"/><rect x="346" y="262" width="64" height="16" fill="${teal}"/><ellipse cx="378" cy="230" rx="32" ry="8" fill="#6B4126" stroke="${ink}" stroke-width="6"/>${hand(346, 284)}`,

  gn: () =>
    shape("M92 40a64 64 0 1 0 64 86a52 52 0 1 1 -64 -86Z", goldLight, 8) +
    sparkle(206, 56, 14) +
    sparkle(456, 236, 14, tealLight) +
    zzz(370, 268, tealLight) +
    coin({ x: 236, y: 236, eyes: "sleep", mouth: "small", rotate: -8 }),

  lfg: () =>
    sparkle(70, 230, 22) +
    sparkle(446, 236, 22, tealLight) +
    sparkle(132, 360, 14, tealLight) +
    sparkle(384, 366, 14) +
    line("M76 92l-22 -20M102 70l-8 -28M448 92l22 -20M422 70l8 -28", ink, 8) +
    coin({
      x: 256,
      y: 232,
      s: 0.92,
      eyes: "happy",
      mouth: "tongue",
      under:
        arm("M150 214C110 200 100 160 100 116", 100, 106) +
        arm("M362 214C402 200 412 160 412 116", 412, 106),
    }),

  bullish: () =>
    candle(120, 230, 90, green) +
    candle(190, 180, 120, green) +
    candle(260, 126, 150, green) +
    candle(330, 64, 190, green) +
    sparkle(410, 66, 20) +
    sparkle(448, 136, 12, tealLight) +
    coin({
      x: 330,
      y: 272,
      s: 0.78,
      eyes: "shiny",
      mouth: "grin",
      front: hand(-128, -18),
    }) +
    tube("M222 256C204 220 196 190 200 162", gold, 10) +
    hand(200, 160),

  wagmi: () =>
    `${
      sparkle(84, 104, 18) +
      sparkle(438, 92, 14, tealLight) +
      coin({ x: 236, y: 232, eyes: "wink", mouth: "grin" })
    }<rect x="342" y="236" width="70" height="62" rx="20" fill="${gold}" stroke="${ink}" stroke-width="8"/><rect x="356" y="178" width="28" height="74" rx="14" fill="${gold}" stroke="${ink}" stroke-width="8"/>${line("M356 256H396M356 276H396", ink, 6)}`,

  hodl: () =>
    `${
      sparkle(80, 130, 20) +
      sparkle(440, 120, 16, tealLight) +
      coin({ x: 256, y: 180, s: 0.92, eyes: "open", brow: "determined", mouth: "flat" }) +
      // diamond
      shape("M196 248H316L364 296L256 404L148 296Z", tealLight, 9)
    }<path d="M148 296H364L256 404Z" fill="${teal}"/><path d="M256 296L256 404L364 296Z" fill="${tealDeep}" opacity=".55"/>${line("M148 296H364M196 248L222 296L256 248L290 296L316 248M222 296L256 404L290 296", ink, 6)}${shape("M196 248H316L364 296L256 404L148 296Z", "none", 9)}${line("M210 268l10 -8", "#fff", 7)}${hand(152, 300)}${hand(360, 300)}`,

  moon: () =>
    `${
      shape("M444 34a52 52 0 1 0 40 78a42 42 0 1 1 -40 -78Z", goldLight, 7) +
      sparkle(60, 80, 16) +
      sparkle(470, 220, 12, tealLight) +
      sparkle(120, 320, 12, tealLight)
    }<g transform="translate(304 262) rotate(40)">${shape("M-24 72Q-34 124 0 168Q34 124 24 72Z", flameOrange, 7)}<path d="M-13 74Q-18 108 0 136Q18 108 13 74Z" fill="${flameYellow}"/>${shape("M-40 18L-76 76L-40 64Z", red, 7)}${shape("M40 18L76 76L40 64Z", red, 7)}${shape("M0 -116C42 -84 50 -22 40 64H-40C-50 -22 -42 -84 0 -116Z", bone, 8)}${shape("M0 -116C24 -98 36 -74 40 -52H-40C-36 -74 -24 -98 0 -116Z", red, 8)}<circle cy="2" r="20" fill="${tealLight}" stroke="${ink}" stroke-width="7"/><rect x="-28" y="62" width="56" height="14" rx="4" fill="#3A4650" stroke="${ink}" stroke-width="6"/></g>${coin({ x: 206, y: 196, s: 0.64, eyes: "shiny", mouth: "tongue" })}${hand(276, 252)}${hand(250, 296)}`,

  whale: () =>
    // spout
    `${tube(
      "M196 236V168M196 170C190 146 174 136 156 140M196 170C202 146 218 136 236 140",
      tealLight,
      12,
    )}<circle cx="146" cy="160" r="9" fill="${tealLight}" stroke="${ink}" stroke-width="6"/><circle cx="196" cy="128" r="9" fill="${tealLight}" stroke="${ink}" stroke-width="6"/><g transform="translate(264 336)">${shape(
      "M-156 6C-156 -62 -72 -96 12 -88C84 -82 124 -40 150 -22L186 -64C196 -74 214 -66 206 -50L184 0L216 34C226 46 210 58 198 50L148 18C120 72 40 94 -36 88C-116 82 -156 50 -156 6Z",
      tealDeep,
      9,
    )}<path d="M-148 36C-110 74 -30 84 40 74C90 66 126 46 146 22C120 72 40 94 -36 88C-104 82 -144 58 -148 36Z" fill="${tealLight}"/>${line("M-106 52Q-102 64 -96 70M-76 58Q-72 72 -66 78M-46 62Q-42 76 -38 82", ink, 5)}<ellipse cx="-104" cy="-6" rx="9" ry="12" fill="${ink}"/><circle cx="-107" cy="-10" r="3.5" fill="#fff"/>${line("M-140 28Q-124 38 -108 30", ink, 7)}</g>${coin({ x: 304, y: 184, s: 0.66, eyes: "shades", mouth: "smirk", cheeks: false })}`,

  dip: () =>
    coin({
      x: 256,
      y: 268,
      s: 0.74,
      eyes: "shiny",
      brow: "determined",
      mouth: "grin",
      sweat: true,
      under:
        tube("M46 92L120 150L158 128L256 330", red, 16) +
        tube("M256 330L344 204L380 226L452 112", green, 16) +
        shape("M424 104L470 88L462 136Z", green, 8),
    }) +
    hand(166, 300) +
    hand(346, 300),

  fud: () =>
    `${
      candle(70, 96, 40, red, 24) +
      candle(96, 250, 40, red, 24) +
      candle(452, 248, 40, red, 24) +
      candle(462, 72, 40, red, 24) +
      candle(46, 360, 30, red, 22)
    }<g transform="rotate(-10 280 150)">${shape(
      "M120 158A160 118 0 0 1 440 158Q400 134 360 158Q320 134 280 158Q240 134 200 158Q160 134 120 158Z",
      teal,
      9,
    )}<path d="M280 40Q238 90 240 150Q262 138 280 158Q298 138 320 150Q322 90 280 40Z" fill="${bone}"/>${line(
      "M280 40Q238 90 240 150M280 40Q322 90 320 150M280 40Q170 70 160 148M280 40Q390 70 400 148",
      ink,
      6,
    )}${shape(
      "M120 158A160 118 0 0 1 440 158Q400 134 360 158Q320 134 280 158Q240 134 200 158Q160 134 120 158Z",
      "none",
      9,
    )}${line("M280 40V26", ink, 10)}${line("M280 158V330q0 22 -22 22", ink, 9)}</g>${coin({ x: 214, y: 290, s: 0.74, eyes: "open", look: [10, 0], mouth: "smirk" })}${hand(312, 322)}`,

  burn: () =>
    `<g transform="translate(256 0)">${shape(
      "M0 26C40 92 128 108 120 214C114 292 66 340 0 340C-66 340 -116 292 -120 214C-126 144 -70 130 -60 66C-36 104 -16 86 0 26Z",
      flameOrange,
      9,
    )}<path d="M0 98C26 142 82 158 76 228C72 280 40 312 0 312C-40 312 -76 280 -78 228C-82 178 -44 168 -38 128C-20 152 -8 136 0 98Z" fill="${flameYellow}"/>${shape("M-150 160C-122 186 -128 222 -116 250C-150 236 -170 200 -150 160Z", flameOrange, 7)}${shape("M150 150C124 182 130 218 118 248C152 232 172 196 150 150Z", flameOrange, 7)}</g>${coin({ x: 256, y: 266, s: 0.78, eyes: "happy", mouth: "grin" })}`,

  ca: () =>
    `${
      tube("M180 286C150 260 140 220 146 178", gold, 10) +
      tube("M332 286C362 260 372 220 366 178", gold, 10)
    }<rect x="70" y="40" width="372" height="146" rx="16" fill="${bone}" stroke="${ink}" stroke-width="9" transform="rotate(-3 256 113)"/><g transform="rotate(-3 256 113)"><text x="256" y="92" text-anchor="middle" font-family="Mona" font-weight="800" font-size="30" letter-spacing="2" fill="${tealDeep}">ONLY TRUST</text><text x="256" y="152" text-anchor="middle" font-family="Commit" font-weight="700" font-size="44" fill="${ink}">4eTk…YUh5</text></g>${hand(148, 180)}${hand(364, 176)}${coin({ x: 256, y: 300, s: 0.76, eyes: "open", brow: "determined", mouth: "smile" })}`,

  few: () =>
    sparkle(86, 110, 18) +
    sparkle(430, 300, 16, tealLight) +
    coin({ x: 256, y: 226, eyes: "shades", mouth: "smirk", cheeks: false }),

  welcome: () =>
    line("M440 92q22 26 12 60M466 76q30 40 14 90", ink, 7) +
    sparkle(452, 300, 16) +
    coin({
      x: 236,
      y: 236,
      eyes: "happy",
      mouth: "open",
      tails: "left",
      under: arm("M354 234C392 214 404 170 404 128", 404, 118),
    }),

  rekt: () =>
    `${
      sparkle(130, 70, 16, red) + sparkle(256, 46, 14, gold) + sparkle(382, 70, 16, red)
    }<ellipse cx="256" cy="110" rx="140" ry="26" fill="none" stroke="${ink}" stroke-width="5" stroke-dasharray="4 14" stroke-linecap="round"/>${coin({ x: 256, y: 250, rotate: 14, eyes: "x", mouth: "tongue", sweat: true })}`,

  dyor: () =>
    `${
      sparkle(76, 92, 16) +
      coin({ x: 220, y: 236, eyes: "open", look: [6, 0], brow: "raised", mouth: "o" }) +
      tube("M330 268L410 352", goldDeep, 18)
    }<circle cx="294" cy="226" r="56" fill="${tealLight}" fill-opacity=".45" stroke="${ink}" stroke-width="11"/><ellipse cx="270" cy="230" rx="22" ry="30" fill="${ink}"/><circle cx="262" cy="218" r="8" fill="#fff"/>${line("M266 192a36 36 0 0 1 30 -8", "#fff", 7)}${hand(372, 312)}`,
};

// ------------------------------------------------------------------ outputs
const pack = [
  { file: "01-gm", scene: "gm", text: caption("GM", { size: 120 }), emoji: ["☀️", "☕"] },
  {
    file: "02-gn",
    scene: "gn",
    text: caption("GN", { size: 120, fill: tealLight }),
    emoji: ["🌙", "😴"],
  },
  {
    file: "03-lfg",
    scene: "lfg",
    text: caption("LFG!", { size: 112, fill: teal }),
    emoji: ["🔥", "🙌"],
  },
  {
    file: "04-bullish",
    scene: "bullish",
    text: caption("BULLISH", { size: 88, fill: green }),
    emoji: ["📈", "🟢"],
  },
  {
    file: "05-wagmi",
    scene: "wagmi",
    text: caption("WAGMI", { size: 100, fill: teal }),
    emoji: ["👍", "🤝"],
  },
  {
    file: "06-hodl",
    scene: "hodl",
    text: caption("HODL", { size: 100, y: 482 }),
    emoji: ["💎", "🙌"],
  },
  {
    file: "07-moon",
    scene: "moon",
    text: caption("TO THE MOON", { size: 56, y: 476 }),
    emoji: ["🚀", "🌕"],
  },
  {
    file: "08-whale",
    scene: "whale",
    text: caption("WHALE ALERT", { size: 58, y: 488, fill: tealLight }),
    emoji: ["🐋", "🐳"],
  },
  {
    file: "09-buy-the-dip",
    scene: "dip",
    text: caption("BUY THE DIP", { size: 60, y: 480, fill: green }),
    emoji: ["📉", "🛒"],
  },
  {
    file: "10-fud-proof",
    scene: "fud",
    text: caption("FUD-PROOF", { size: 66, y: 484, fill: teal }),
    emoji: ["☂️", "😎"],
  },
  {
    file: "11-burned",
    scene: "burn",
    text: caption("BURNED", { size: 96, y: 484, fill: flameYellow }),
    emoji: ["🔥"],
  },
  {
    file: "12-official-ca",
    scene: "ca",
    text: caption("OFFICIAL CA", { size: 58, y: 484 }),
    emoji: ["✅", "📋"],
  },
  {
    file: "13-few-understand",
    scene: "few",
    text: caption("FEW UNDERSTAND", { size: 46, y: 456, fill: bone }),
    emoji: ["😎", "🧠"],
  },
  {
    file: "14-welcome-ser",
    scene: "welcome",
    text: caption("WELCOME, SER", { size: 52, y: 470, fill: teal }),
    emoji: ["👋", "🤗"],
  },
  {
    file: "15-rekt",
    scene: "rekt",
    text: caption("REKT", { size: 112, y: 482, fill: red }),
    emoji: ["💀", "😵"],
  },
  {
    file: "16-dyor",
    scene: "dyor",
    text: caption("DYOR", { size: 112, fill: gold }),
    emoji: ["🔍", "🧐"],
  },
];

const alerts = [
  { file: "buy", scene: "bullish", title: ["NEW", "BUY"], color: green },
  { file: "big-buy", scene: "lfg", title: ["BIG", "BUY"], color: teal },
  { file: "mega-buy", scene: "moon", title: ["MEGA", "BUY"], color: gold },
  { file: "whale", scene: "whale", title: ["WHALE", "ALERT"], color: tealLight },
  { file: "stats", scene: "dyor", title: ["MARKET", "CHECK"], color: gold },
];

// White die-cut border plus a soft drop shadow, as on a printed sticker.
const diecut = `<filter id="diecut" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
  <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="grow"/>
  <feGaussianBlur in="grow" stdDeviation="4"/>
  <feComponentTransfer result="outline"><feFuncA type="linear" slope="14" intercept="-2"/></feComponentTransfer>
  <feFlood flood-color="#fff"/><feComposite in2="outline" operator="in" result="white"/>
  <feGaussianBlur in="outline" stdDeviation="5"/><feOffset dy="5" result="blur"/>
  <feFlood flood-color="${ink}" flood-opacity=".38"/><feComposite in2="blur" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`;

const fontCss = `
@font-face{font-family:Mona;font-weight:800;src:url(data:font/woff2;base64,${font("mona-sans-latin-800-normal.woff2")}) format("woff2")}
@font-face{font-family:Mona;font-weight:500;src:url(data:font/woff2;base64,${font("mona-sans-latin-500-normal.woff2")}) format("woff2")}
@font-face{font-family:Commit;font-weight:700;src:url(data:font/woff2;base64,${font("commit-mono-latin-700-normal.woff2")}) format("woff2")}
@font-face{font-family:Commit;font-weight:500;src:url(data:font/woff2;base64,${font("commit-mono-latin-500-normal.woff2")}) format("woff2")}`;

const page = (w, h, svg) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head>
<body><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${diecut}</defs>${svg}</svg></body></html>`;

function stickerSvg({ scene, text }) {
  return `<g filter="url(#diecut)">${scenes[scene]()}${text}</g>`;
}

function alertSvg({ scene, title, color }) {
  const grid =
    Array.from({ length: 33 }, (_, i) => `M${i * 40} 0V640`).join("") +
    Array.from({ length: 17 }, (_, i) => `M0 ${i * 40}H1280`).join("");
  return [
    `<defs><radialGradient id="glow" cx="76%" cy="50%" r="46%"><stop offset="0" stop-color="${color}" stop-opacity=".26"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101B23"/><stop offset="1" stop-color="${ink}"/></linearGradient></defs>`,
    `<rect width="1280" height="640" fill="url(#bg)"/>`,
    `<path d="${grid}" stroke="${teal}" stroke-opacity=".07" stroke-width="1"/>`,
    `<rect width="1280" height="640" fill="url(#glow)"/>`,
    // wordmark
    `<g transform="translate(84 70)"><path d="${S_MARK}" transform="scale(1.1)" fill="none" stroke="${gold}" stroke-width="3.6" stroke-linecap="round"/>`,
    `<path d="M8.8 26.4h8M36 26.4h8" stroke="${teal}" stroke-width="3.6" stroke-linecap="round"/><circle cx="44" cy="26.4" r="2.4" fill="${teal}"/>`,
    `<text x="66" y="36" font-family="Commit" font-weight="500" font-size="26" letter-spacing="8" fill="${bone}">SISERA</text></g>`,
    `<text font-family="Mona" font-weight="800" font-size="150" letter-spacing="-4" fill="${color}">`,
    `<tspan x="76" y="300">${title[0]}</tspan><tspan x="76" y="446">${title[1]}</tspan></text>`,
    `<text x="84" y="548" font-family="Commit" font-weight="500" font-size="26" letter-spacing="4" fill="${bone}" fill-opacity=".62">$SISERA · SOLANA</text>`,
    `<g transform="translate(700 40) scale(1.1)"><g filter="url(#diecut)">${scenes[scene]()}</g></g>`,
  ].join("");
}

function render(html, w, h, out) {
  const dir = mkdtempSync(join(tmpdir(), "sisera-stickers-"));
  const src = join(dir, "page.html");
  writeFileSync(src, html);
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        "--virtual-time-budget=3000",
        `--window-size=${w},${h}`,
        `--screenshot=${out}`,
        pathToFileURL(src).href,
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv.slice(2);
const packDir = join(root, "stickers/pack");
const alertDir = join(root, "stickers/alerts");
mkdirSync(packDir, { recursive: true });
mkdirSync(alertDir, { recursive: true });

for (const sticker of pack) {
  if (only.length && !only.includes(sticker.file)) continue;
  render(page(512, 512, stickerSvg(sticker)), 512, 512, join(packDir, `${sticker.file}.png`));
  console.log(`sticker  stickers/pack/${sticker.file}.png`);
}
for (const card of alerts) {
  if (only.length && !only.includes(card.file)) continue;
  render(page(1280, 640, alertSvg(card)), 1280, 640, join(alertDir, `${card.file}.png`));
  console.log(`alert    stickers/alerts/${card.file}.png`);
}
writeFileSync(
  join(packDir, "pack.json"),
  `${JSON.stringify(
    pack.map(({ file, emoji }) => ({ file: `${file}.png`, emoji })),
    null,
    2,
  )}\n`,
);
