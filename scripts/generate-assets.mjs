#!/usr/bin/env node
/**
 * Regenerates the web-optimized brand assets in public/assets from the master
 * logo PNGs (public/assets/busgo-logo-{dark,light}.png).
 *
 * Produces:
 *   - busgo-favicon-dark.ico   square multi-size ICO (16/32/48 px) built from
 *                              the bus glyph (light-on-transparent) — the old
 *                              ICO was 32x26 and got stretched in browser tabs
 *   - busgo-apple-touch.png    180x180 dark tile + glyph for iOS home screen
 *   - busgo-logo-{dark,light}-sm.png  full lockups downscaled for headers
 *                              (the masters are 5842x4675; headers only need ~48px)
 *
 * Requires sharp:  pnpm add -D sharp
 * Usage:           node scripts/generate-assets.mjs
 */

import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const SRC_DARK = 'public/assets/busgo-logo-dark.png' // light glyph, for dark UIs
const SRC_LIGHT = 'public/assets/busgo-logo-light.png' // dark glyph, for light UIs
const OUT = 'public/assets'
const GLYPH_CUTOFF = 0.53 // the bus glyph sits in the top ~50% of the master; the wordmark starts below

/** Alpha bounding box of the top GLYPH_CUTOFF of the image, in original pixels. */
async function glyphBounds(src) {
  const meta = await sharp(src).metadata()
  const scanW = 800
  const { data, info } = await sharp(src)
    .resize(scanW, null, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const scale = meta.width / info.width
  const limitY = Math.floor(info.height * GLYPH_CUTOFF)
  let minX = info.width, minY = limitY, maxX = -1, maxY = -1
  for (let y = 0; y < limitY; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error(`No opaque pixels found in ${src}`)
  const x = Math.round(minX * scale)
  const y = Math.round(minY * scale)
  const w = Math.round((maxX - minX + 1) * scale)
  const h = Math.round((maxY - minY + 1) * scale)
  const pad = Math.round(w * 0.03)
  return {
    left: Math.max(0, x - pad),
    top: Math.max(0, y - pad),
    width: Math.min(meta.width - Math.max(0, x - pad), w + pad * 2),
    height: Math.min(meta.height - Math.max(0, y - pad), h + pad * 2),
  }
}

/** Hand-rolls an ICO container around PNG-encoded frames (PNG-in-ICO). */
function pngToIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)
  const entries = []
  const blobs = []
  let offset = 6 + 16 * frames.length
  for (const frame of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1)
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    blobs.push(frame.png)
    offset += frame.png.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

async function main() {
  mkdirSync(OUT, { recursive: true })

  const bounds = await glyphBounds(SRC_DARK)
  console.log('glyph bounds (dark master):', JSON.stringify(bounds))

  // ── Favicon: light glyph contained in a transparent square ──────────────
  const glyphSquare = () =>
    sharp(SRC_DARK)
      .extract(bounds)
      .resize(512, 512, { fit: 'contain', background: transparent })
      .png()

  const frames = []
  for (const size of [16, 32, 48]) {
    frames.push({ size, png: await glyphSquare().resize(size, size).toBuffer() })
  }
  const ico = pngToIco(frames)
  writeFileSync(`${OUT}/busgo-favicon-dark.ico`, ico)
  console.log('wrote busgo-favicon-dark.ico (16/32/48) + busgo-favicon-dark.png')

  // ── Apple touch icon: glyph on a dark rounded tile ───────────────────────
  const tile = sharp({
    create: { width: 180, height: 180, channels: 4, background: { r: 17, g: 18, b: 20, alpha: 1 } },
  })
  const glyphBuf = await sharp(SRC_DARK)
    .extract(bounds)
    .resize(116, 116, { fit: 'contain', background: transparent })
    .png()
    .toBuffer()
  await tile
    .composite([{ input: glyphBuf, top: 32, left: 32 }])
    .png()
    .toFile(`${OUT}/busgo-apple-touch.png`)
  console.log('wrote busgo-apple-touch.png (180x180)')

  // ── Header lockups, downscaled ───────────────────────────────────────────
  for (const [name, src] of [
    ['busgo-logo-dark-sm.png', SRC_DARK],
    ['busgo-logo-light-sm.png', SRC_LIGHT],
  ]) {
    await sharp(src)
      .resize(240, null, { fit: 'inside' })
      .png()
      .toFile(`${OUT}/${name}`)
    console.log(`wrote ${name}`)
  }

  // ── Glyph marks for compact headers ─────────────────────────────────────
  // The full lockup is tall (glyph + wordmark + tagline), so at header sizes
  // (24–40px) the wordmark becomes unreadable. These are just the bus glyph on
  // a transparent square, crisp at small sizes for the admin header / the
  // session-check card.
  for (const [name, src] of [
    ['busgo-mark-dark.png', SRC_DARK],
    ['busgo-mark-light.png', SRC_LIGHT],
  ]) {
    const g = await glyphBounds(src)
    await sharp(src)
      .extract(g)
      .resize(160, 160, { fit: 'contain', background: transparent })
      .png()
      .toFile(`${OUT}/${name}`)
    console.log(`wrote ${name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
