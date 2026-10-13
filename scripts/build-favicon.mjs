/**
 * Renders the browser-tab icons from the app's own mark.
 *
 *     node scripts/build-favicon.mjs
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * `favicon.png` and `apple-touch-icon.png` were downscales of
 * `public/Tesseract Icon.png` — a 1024px soft amber glow on a SOLID BLACK
 * plate. At 16px that is a dark square with a smudge in it, and it is not the
 * mark the application actually shows: the top-left launcher draws the
 * wireframe hypercube, in amber, on nothing.
 *
 * ── Where the geometry comes from ────────────────────────────────────────
 *
 * The resting frame inlined in `index.html` for the pre-JS splash, which is
 * generated from `lib/brand/tesseract-geometry` and is the same projection
 * `TesseractMark` draws. Read rather than re-derived, for the same reason
 * `build-social-preview.mjs` reads it: a hand-copied fourth copy of the
 * geometry is a copy that drifts.
 *
 * Two transforms are applied, and they are exactly what `TesseractLogo`
 * passes `TesseractMark` for the launcher — this is the launcher's icon, so it
 * is rendered with the launcher's parameters rather than the splash's:
 *
 *   fill 1.5    Scaled about the centre. The splash's geometry is sized for
 *               96px, where air around the figure reads as precision. At 16px
 *               that same margin leaves a glyph of about 9px.
 *   weight 1.4  Thinner stroke (links at 0.6 of it, as everywhere else). The
 *               splash's 2.6 at icon scale is a quarter of the glyph's own
 *               width, and the edges close up into a blob.
 *   no nodes    Sixteen vertex dots at 16px fill the gaps between the lines.
 *
 * Nothing else is changed: same vertices, same edges, same per-edge depth
 * opacities, same `#f59e0b`.
 *
 * ── Transparency is the point ────────────────────────────────────────────
 *
 * Every raster here is screenshotted with `omitBackground`, so the alpha
 * channel is genuinely empty rather than filled with the page colour. A tab
 * strip is light in one theme and dark in the other, and a baked-in plate is
 * wrong in one of them — which is the defect being fixed, not a detail.
 *
 * Note for iOS: Safari composites a transparent `apple-touch-icon` onto black
 * when a site is added to the Home Screen. That is Apple's behaviour and no
 * icon can opt out of it; the alternative is baking a plate in, which would
 * reintroduce the black square in every other place the file is used.
 *
 * ── Why the filenames carry a hash ───────────────────────────────────────
 *
 * Browsers cache favicons aggressively and out of band — Chrome keeps its own
 * favicon database and will keep painting the old icon through an ordinary
 * reload, and often through a hard refresh too. A content-addressed filename
 * is a new cache key, which is the only reliable way to make a changed icon
 * actually appear. `favicon.ico` is the exception and must keep its name:
 * browsers request `/favicon.ico` implicitly, by path, with no tag to read.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = join(root, 'index.html')

/* ------------------------------------------------- the mark, from one place */

const indexHtml = readFileSync(indexPath, 'utf8')
const open = indexHtml.indexOf('<svg viewBox="0 0 100 100"')
const close = indexHtml.indexOf('</svg>', open)
if (open === -1 || close === -1) {
  throw new Error('app mark SVG not found in index.html — did the boot loader change?')
}
const bootSvg = indexHtml.slice(open, close + '</svg>'.length)

const FILL = 1.5
/*
 * Heavier than the launcher's 1.4, and the reason is optical sizing.
 *
 * `TesseractLogo` passes 1.4 for a 32px mark. A favicon is drawn at 16 — half
 * that — so the same number is half the apparent weight, and the first render
 * of this icon came out as a faint scratch that disappeared against a light
 * tab strip. Stroke weight has to rise as the glyph shrinks or the figure
 * stops being a figure.
 *
 * Geometry and colour are untouched: same vertices, same edges, same amber.
 * Only the pen gets thicker.
 */
const WEIGHT = 2.4
const LINK_RATIO = 0.6

/**
 * Lift the depth-shading floor, keeping the ordering.
 *
 * The mark fades far edges to carry the 4D projection — the splash runs from
 * about 0.30 to 0.88, which is exactly right at 96px. At 16px everything under
 * ~0.5 is gone, and what survives is the outer hexagon alone: a cube, not a
 * tesseract. The inner frame IS the mark, so losing it loses the brand.
 *
 * This compresses the range into 0.55–1.0 rather than flattening it to one
 * value. Near edges still read as nearer; the far ones merely stop vanishing.
 */
const LO = 0.30
const HI = 0.88
const lift = (o) => {
  const n = (Number(o) - LO) / (HI - LO)
  return (0.55 + Math.max(0, Math.min(1, n)) * 0.45).toFixed(2)
}

/** Scale about the centre of the 100x100 box, as `drawFrame` does for `fill`. */
const grow = (v) => (50 + (Number(v) - 50) * FILL).toFixed(2)

const lines = [...bootSvg.matchAll(/<line\b[^>]*\/>/g)].map(m => m[0])
if (lines.length !== 32) {
  throw new Error(`expected 32 edges in the mark, found ${lines.length}`)
}

const edges = lines.map(tag => {
  const at = (name) => (tag.match(new RegExp(`${name}="([^"]+)"`)) || [])[1]
  const isLink = Number(at('stroke-width')) < 2
  return '<line '
    + `x1="${grow(at('x1'))}" y1="${grow(at('y1'))}" `
    + `x2="${grow(at('x2'))}" y2="${grow(at('y2'))}" `
    + `stroke-width="${(isLink ? WEIGHT * LINK_RATIO : WEIGHT).toFixed(2)}" `
    + `opacity="${lift(at('opacity'))}"/>`
}).join('\n  ')

/*
 * No `<rect>`, no `fill` on the root: the background is absent, not white.
 * `stroke-linecap`/`linejoin` match the splash so the joints are the same
 * shape at every size.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"
     stroke="#f59e0b" stroke-linecap="round" stroke-linejoin="round" role="img"
     aria-label="Tesseract">
  ${edges}
</svg>
`

const hash = createHash('sha256').update(svg).digest('hex').slice(0, 8)

/* ------------------------------------------------------------- the rasters */

const browser = await chromium.launch()

async function raster(size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;background:transparent}`
    + `svg{width:100%;height:100%;display:block}</style>${svg}`,
    { waitUntil: 'load' },
  )
  // `omitBackground` is what makes the alpha channel genuinely empty. Without
  // it Chromium paints white behind the page and the "transparent" icon is a
  // white square in a dark tab strip.
  const png = await page.screenshot({ type: 'png', omitBackground: true })
  await page.close()
  return png
}

const PNG_SIZES = [16, 32, 48, 180, 192, 512]
const pngs = new Map()
for (const s of PNG_SIZES) pngs.set(s, await raster(s))

await browser.close()

/* ------------------------------------------------------------------- .ico */

/**
 * A real multi-resolution ICO, with PNG payloads.
 *
 * Written by hand because no image library is installed and adding one to
 * emit a 100-byte header is a dependency for nothing. PNG-in-ICO has been
 * supported since Windows Vista and is what every modern toolchain emits.
 *
 * Layout: a 6-byte header, then one 16-byte directory entry per image, then
 * the payloads. `width`/`height` are single bytes where 0 means 256.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)              // reserved
  header.writeUInt16LE(1, 2)              // 1 = icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = []
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)                    // palette size, 0 for PNG
    e.writeUInt8(0, 3)                    // reserved
    e.writeUInt16LE(1, 4)                 // colour planes
    e.writeUInt16LE(32, 6)                // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)])
}

const ico = buildIco([16, 32, 48].map(size => ({ size, data: pngs.get(size) })))

/* ----------------------------------------------------------------- publish */

// Clear superseded hashed icons, so public/ does not collect one dead set per
// design change. `favicon.ico` is overwritten in place — its name is fixed.
for (const f of readdirSync(join(root, 'public'))) {
  // Note the trailing `\.` rather than a full extension: the published names
  // are `favicon.<hash>.32.png` and `favicon.<hash>.svg`, so a pattern anchored
  // on `<hash>.(svg|png)$` matches the SVG and misses every sized PNG. It did,
  // and three dead icons survived a regeneration until the guard named them.
  if (/^(favicon|apple-touch-icon)\.[0-9a-f]{8}\./.test(f) && !f.includes(hash)) {
    unlinkSync(join(root, 'public', f))
  }
}

const names = {
  svg: `favicon.${hash}.svg`,
  png32: `favicon.${hash}.32.png`,
  png192: `favicon.${hash}.192.png`,
  png512: `favicon.${hash}.512.png`,
  apple: `apple-touch-icon.${hash}.png`,
  ico: 'favicon.ico',
}

writeFileSync(join(root, 'public', names.svg), svg)
writeFileSync(join(root, 'public', names.png32), pngs.get(32))
writeFileSync(join(root, 'public', names.png192), pngs.get(192))
writeFileSync(join(root, 'public', names.png512), pngs.get(512))
writeFileSync(join(root, 'public', names.apple), pngs.get(180))
writeFileSync(join(root, 'public', names.ico), ico)

/* --------------------------------------------------- rewrite the references */

/*
 * One managed block, replaced wholesale. Rewriting individual tags in place
 * invites the half-updated state this script exists to prevent — a new PNG
 * beside a stale `apple-touch-icon` that browsers happily keep using.
 */
const START = '<!-- BEGIN generated icons -->'
const END = '<!-- END generated icons -->'

const block = [
  START,
  '<!--',
  '  Generated by scripts/build-favicon.mjs from the mark below. Do not edit',
  '  by hand: the hashes are content-addressed and `guard:favicon` recomputes',
  '  them from the files.',
  '',
  '  SVG first — every current browser prefers it and it stays sharp on a',
  '  high-DPI tab strip. The PNG and the .ico are the fallback chain, and',
  '  /favicon.ico is also requested implicitly by path, with no tag to read.',
  '-->',
  `<link rel="icon" type="image/svg+xml" href="/${names.svg}" />`,
  `<link rel="icon" type="image/png" sizes="32x32" href="/${names.png32}" />`,
  '<link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48" href="/favicon.ico" />',
  `<link rel="apple-touch-icon" sizes="180x180" href="/${names.apple}" />`,
  `<link rel="manifest-icon" type="image/png" sizes="192x192" href="/${names.png192}" />`,
  `<link rel="manifest-icon" type="image/png" sizes="512x512" href="/${names.png512}" />`,
  END,
].join('\n    ')

const s = indexHtml.indexOf(START)
const e = indexHtml.indexOf(END)
if (s === -1 || e === -1) {
  throw new Error(
    `index.html has no "${START}" / "${END}" block. Refusing to guess where the `
    + 'icon tags belong — add the markers around them first.')
}
writeFileSync(indexPath, indexHtml.slice(0, s) + block + indexHtml.slice(e + END.length))

console.log(`wrote public/${names.svg} and 4 PNGs + favicon.ico (${(ico.length / 1024).toFixed(1)}KB)`)
console.log(`updated index.html icon block (hash ${hash})`)
