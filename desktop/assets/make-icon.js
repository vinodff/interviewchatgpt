"use strict";
// Generates assets/icon.png (512x512) and multi-size Windows .ico files used by the installer.
// Each size is drawn fresh (not only downsampled) so 16–48px keep five distinct wave bars.
// Pure Node (zlib + crc), no dependencies.
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const MASTER = 512;
const GREEN = [18, 97, 74];
const DEEP = [15, 42, 34];
const MINT = [111, 218, 168];
const BAR_HEIGHTS = [0.5, 0.95, 0.68, 1.0, 0.42];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function paintIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const radius = Math.max(2, Math.round(size * (112 / MASTER)));
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - 1 - radius);
    const cy = Math.min(Math.max(y, radius), size - 1 - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inRounded(x, y)) continue;
      const t = y / Math.max(1, size - 1);
      set(x, y, [
        Math.round(GREEN[0] + (DEEP[0] - GREEN[0]) * t),
        Math.round(GREEN[1] + (DEEP[1] - GREEN[1]) * t),
        Math.round(GREEN[2] + (DEEP[2] - GREEN[2]) * t),
      ]);
    }
  }
  // Keep five readable bars even at 16px: prefer odd widths and at least one-pixel gaps.
  const barW = Math.max(1, Math.round(size * (34 / MASTER)));
  const gap = Math.max(1, Math.round(size * (56 / MASTER)));
  const maxBarH = Math.round(size * (230 / MASTER));
  const totalW = BAR_HEIGHTS.length * barW + (BAR_HEIGHTS.length - 1) * gap;
  let bx = Math.round((size - totalW) / 2);
  for (const h of BAR_HEIGHTS) {
    const barH = Math.max(2, Math.round(h * maxBarH));
    const top = Math.round((size - barH) / 2);
    for (let y = top; y < top + barH; y += 1) {
      for (let x = bx; x < bx + barW; x += 1) set(x, y, MINT);
    }
    bx += barW + gap;
  }
  return px;
}

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

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(count * 16);
  const blobs = [];
  let offset = 6 + count * 16;
  pngs.forEach(({ size, png }, index) => {
    const o = index * 16;
    entries[o] = size >= 256 ? 0 : size;
    entries[o + 1] = size >= 256 ? 0 : size;
    entries[o + 2] = 0; entries[o + 3] = 0;
    entries.writeUInt16LE(1, o + 4); entries.writeUInt16LE(32, o + 6);
    entries.writeUInt32LE(png.length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    blobs.push(png);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...blobs]);
}

const assetsDir = __dirname;
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(buildDir, { recursive: true });

const masterPng = encodePng(paintIcon(MASTER), MASTER);
fs.writeFileSync(path.join(assetsDir, "icon.png"), masterPng);

const icoPngs = ICO_SIZES.map((size) => ({ size, png: encodePng(paintIcon(size), size) }));
const ico = encodeIco(icoPngs);
for (const name of ["icon.ico", "installerIcon.ico", "uninstallerIcon.ico"]) {
  fs.writeFileSync(path.join(buildDir, name), ico);
}
fs.writeFileSync(path.join(assetsDir, "icon.ico"), ico);

console.log("wrote assets/icon.png", masterPng.length, "bytes");
console.log("wrote build/icon.ico (+ installer/uninstaller)", ico.length, "bytes,", ICO_SIZES.join("/"));
