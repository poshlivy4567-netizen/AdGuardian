// Генерирует иконки AdGuardian (16/32/48/128) в стиле попапа: тёмная
// скруглённая подложка, щит с сине-фиолетовым градиентом, белая галочка.
// Запуск: node tools/make_icons.js — зависимостей не требует.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 32, 48, 128];
const SS = 8; // суперсэмплинг 8x8 для гладких краёв

// --- кодировщик PNG (RGBA, без фильтров) -----------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // бит на канал
  ihdr[9] = 6;  // цвет: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- геометрия в нормализованных координатах [0..1] -------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

function insideRoundedRect(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

// Щит: прямые бока до середины, плавное сужение к нижней точке.
function shieldHalfWidth(y) {
  const top = 0.205, straight = 0.545, bottom = 0.85;
  if (y < top || y > bottom) return -1;
  const hw = 0.262;
  if (y <= straight) return hw;
  const t = (y - straight) / (bottom - straight);
  return hw * Math.pow(Math.cos(t * Math.PI / 2), 0.85);
}

function insideShield(x, y) {
  const hw = shieldHalfWidth(y);
  return hw > 0 && Math.abs(x - 0.5) <= hw;
}

// Галочка из двух отрезков со скруглёнными концами.
const CHECK = [[0.352, 0.505], [0.468, 0.632], [0.664, 0.408]];
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}
function insideCheck(x, y, halfWidth) {
  return distToSegment(x, y, CHECK[0][0], CHECK[0][1], CHECK[1][0], CHECK[1][1]) <= halfWidth
    || distToSegment(x, y, CHECK[1][0], CHECK[1][1], CHECK[2][0], CHECK[2][1]) <= halfWidth;
}

// --- рендер -----------------------------------------------------------------
const BG_TOP = [27, 31, 39];     // #1b1f27
const BG_BOTTOM = [13, 15, 20];  // #0d0f14
const SHIELD_TOP = [154, 164, 255]; // #9aa4ff
const SHIELD_BOTTOM = [87, 97, 236]; // #5761ec
const WHITE = [255, 255, 255];

function render(size) {
  const rgba = new Uint8Array(size * size * 4);
  // Толщина галочки в долях размера: на мелких иконках чуть толще для читаемости.
  const checkHalf = size < 32 ? 0.055 : 0.045;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!insideRoundedRect(x, y, 0.2)) continue;
          let color = mix(BG_TOP, BG_BOTTOM, y);
          if (insideShield(x, y)) color = mix(SHIELD_TOP, SHIELD_BOTTOM, (y - 0.2) / 0.65);
          if (insideCheck(x, y, checkHalf)) color = WHITE;
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePNG(size, size, render(size)));
  console.log(`icon${size}.png  ${size}x${size}  ${fs.statSync(file).size} байт`);
}
console.log("OK");
