// Generates resources/icon.png (256x256): a rounded gradient square with a white "play" triangle.
// Run with: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const S = 256
const px = Buffer.alloc(S * S * 4)

const lerp = (a, b, t) => a + (b - a) * t
const inRoundedRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), S - 1 - r)
  const cy = Math.min(Math.max(y, r), S - 1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
// Triangle pointing right, centred slightly to the right so it looks optically centred.
const A = [92, 70], B = [92, 186], C = [194, 128]
const sign = (p, a, b) => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
const inTri = (x, y) => {
  const p = [x, y]
  const d1 = sign(p, A, B), d2 = sign(p, B, C), d3 = sign(p, C, A)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    if (!inRoundedRect(x, y, 56)) continue
    const t = (x + y) / (2 * S)
    let rgb = [lerp(99, 168, t), lerp(102, 85, t), lerp(241, 247, t)]
    if (inTri(x, y)) rgb = [255, 255, 255]
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255
  }
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', png)
console.log('wrote resources/icon.png', png.length, 'bytes')
