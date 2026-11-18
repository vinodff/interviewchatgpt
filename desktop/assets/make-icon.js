"use strict";
// Generates assets/icon.png (512x512): brand-green rounded square with a mint audio-wave mark.
// Pure Node (zlib + crc), no dependencies.
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 512;
const GREEN = [18, 97, 74];
const DEEP = [15, 42, 34];
const MINT = [111, 218, 168];

const px = Buffer.alloc(SIZE * SIZE * 4);
const set = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};

const radius = 112;
const inRounded = (x, y) => {
  const cx = Math.min(Math.max(x, radius), SIZE - radius);
  const cy = Math.min(Math.max(y, radius), SIZE - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    if (!inRounded(x, y)) { set(x, y, DEEP, 0); continue; }
    const t = y / SIZE; // subtle vertical gradient
    set(x, y, [GREEN[0] + (DEEP[0] - GREEN[0]) * t, GREEN[1] + (DEEP[1] - GREEN[1]) * t, GREEN[2] + (DEEP[2] - GREEN[2]) * t].map(Math.round));
  }
}

// Five vertical bars (heights mirror the shell's wave mark).
const bars = [0.5, 0.95, 0.68, 1.0, 0.42];
const barW = 34;
const gap = 56;
const totalW = bars.length * barW + (bars.length - 1) * gap;
let bx = (SIZE - totalW) / 2;
for (const h of bars) {
  const barH = Math.round(h * 230);
  const top = (SIZE - barH) / 2;
  for (let y = top; y < top + barH; y += 1) {
    for (let x = bx; x < bx + barW; x += 1) set(Math.round(x), Math.round(y), MINT);
  }
  bx += barW + gap;
}

// --- minimal PNG encode ---
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, "icon.png"), png);
console.log("wrote assets/icon.png", png.length, "bytes");
