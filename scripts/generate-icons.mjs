// Draws the app icons `public/manifest` points at (ticket 10). Run with
// `node scripts/generate-icons.mjs`; the PNGs it writes are committed, so this
// only needs re-running when the mark changes.
//
// The icon is drawn pixel by pixel and encoded by hand rather than pulled from a
// design tool: it's three kanban lanes of stacked cards, which is a handful of
// rounded rectangles, and a dependency-free script keeps the source of truth for
// the mark inside the repo.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BACKGROUND = [15, 23, 42]; // slate-900, matching the manifest theme colour
const LANE = [30, 41, 59]; // slate-800
const CARDS = [
  [56, 189, 248], // sky-400
  [167, 139, 250], // violet-400
  [52, 211, 153], // emerald-400
];

/** A canvas of RGBA pixels, drawn on with `fill`, read back as raw scanlines. */
function createCanvas(size) {
  const pixels = new Uint8Array(size * size * 4);
  return {
    size,
    pixels,
    /** Paint a rounded rectangle. Corners use a radius test, so no anti-aliasing. */
    fill(x0, y0, width, height, [r, g, b], radius = 0) {
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(size, Math.round(y0 + height)); y++) {
        for (let x = Math.max(0, Math.round(x0)); x < Math.min(size, Math.round(x0 + width)); x++) {
          if (radius > 0 && !insideRoundedRect(x, y, x0, y0, width, height, radius)) continue;
          const offset = (y * size + x) * 4;
          pixels[offset] = r;
          pixels[offset + 1] = g;
          pixels[offset + 2] = b;
          pixels[offset + 3] = 255;
        }
      }
    },
  };
}

function insideRoundedRect(x, y, x0, y0, width, height, radius) {
  const left = x0 + radius;
  const right = x0 + width - 1 - radius;
  const top = y0 + radius;
  const bottom = y0 + height - 1 - radius;
  const cx = x < left ? left : x > right ? right : x;
  const cy = y < top ? top : y > bottom ? bottom : y;
  if (cx === x || cy === y) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode a canvas as a PNG: 8-bit RGBA, one unfiltered scanline per row. */
function encodePng({ size, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The mark: three lanes, each holding cards of differing heights.
 *
 * `inset` is the share of the canvas left as padding. A maskable icon is drawn
 * small (a platform may crop everything outside the centre 80%), an "any" icon
 * fills more of its square since nothing crops it.
 */
function drawIcon(size, { inset, rounded }) {
  const canvas = createCanvas(size);
  const corner = rounded ? size * 0.22 : 0;
  canvas.fill(0, 0, size, size, BACKGROUND, corner);

  const pad = size * inset;
  const board = size - pad * 2;
  const gap = board * 0.08;
  const laneWidth = (board - gap * 2) / 3;
  const cardsPerLane = [3, 2, 1];

  for (let lane = 0; lane < 3; lane++) {
    const x = pad + lane * (laneWidth + gap);
    canvas.fill(x, pad, laneWidth, board, LANE, laneWidth * 0.18);

    const cardHeight = board * 0.17;
    const cardGap = board * 0.07;
    const cardPad = laneWidth * 0.14;
    for (let card = 0; card < cardsPerLane[lane]; card++) {
      canvas.fill(
        x + cardPad,
        pad + cardPad + card * (cardHeight + cardGap),
        laneWidth - cardPad * 2,
        cardHeight,
        CARDS[lane],
        cardHeight * 0.28,
      );
    }
  }

  return encodePng(canvas);
}

mkdirSync(OUT_DIR, { recursive: true });
const icons = [
  ["icon-192.png", drawIcon(192, { inset: 0.14, rounded: true })],
  ["icon-512.png", drawIcon(512, { inset: 0.14, rounded: true })],
  // Maskable: background bleeds to the edge, the mark stays inside the safe zone.
  ["icon-maskable-512.png", drawIcon(512, { inset: 0.24, rounded: false })],
  ["apple-touch-icon.png", drawIcon(180, { inset: 0.14, rounded: false })],
];
for (const [name, png] of icons) {
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote public/icons/${name} (${png.length} bytes)`);
}
