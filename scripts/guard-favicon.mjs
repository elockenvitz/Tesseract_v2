/**
 * The browser-tab icon must be the app's mark, genuinely transparent, and
 * reachable under the name index.html publishes.
 *
 *     node scripts/guard-favicon.mjs
 *
 * ── The failures this exists to catch ────────────────────────────────────
 *
 * 1. A PLATE BAKED IN. The previous icons were downscales of the glow PNG on
 *    solid #0A0A0B, so the tab showed a dark square. "Transparent" is not
 *    something you can see in a file listing, and a screenshot of a PNG on a
 *    white page looks identical whether the background is white or absent.
 *    So the alpha channel is decoded here and the corner pixels are asserted
 *    to be fully transparent.
 *
 * 2. A STALE REFERENCE. Two scripts used to write `public/favicon.png` and
 *    whichever ran last won. A tag pointing at a file nobody regenerates, or
 *    a file nobody references, is how the old icon survives a redesign.
 *
 * 3. A CACHED ICON. Browsers keep favicons in their own store and will paint
 *    the old one through a reload. The published names are content-addressed
 *    so a changed icon is a changed URL; this recomputes the hash from the
 *    file and fails if they disagree.
 *
 * `favicon.ico` is deliberately exempt from (3): browsers request that path
 * implicitly, with no tag to read, so its name cannot move.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash, } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const html = readFileSync(join(root, 'index.html'), 'utf8')

const problems = []
const checks = []
const ok = (name, cond, detail = '') => {
  if (cond) checks.push(name)
  else problems.push(`${name}${detail ? `\n    ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ title */

const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? null
ok('the document title is the agreed string',
  title === 'Tesseract | Investment Intelligence', `found: ${title}`)
ok('there is exactly one <title>',
  (html.match(/<title>/g) || []).length === 1)

/* ------------------------------------------------------------- the block */

const START = '<!-- BEGIN generated icons -->'
const END = '<!-- END generated icons -->'
const s = html.indexOf(START)
const e = html.indexOf(END)
ok('the generated icon block is present and ordered', s !== -1 && e > s)

const block = s !== -1 && e > s ? html.slice(s, e) : ''
const links = [...block.matchAll(/<link\b[^>]*href="\/([^"]+)"[^>]*>/g)].map(m => ({
  tag: m[0],
  file: m[1],
  rel: (m[0].match(/rel="([^"]+)"/) || [])[1],
}))

ok('every icon tag lives inside the generated block',
  (html.match(/rel="(icon|apple-touch-icon)"/g) || []).length
    === (block.match(/rel="(icon|apple-touch-icon)"/g) || []).length,
  'An icon tag outside the block is one the generator will not update.')

for (const rel of ['icon', 'apple-touch-icon']) {
  ok(`a ${rel} is declared`, links.some(l => l.rel === rel))
}
ok('an SVG icon is offered first',
  links[0]?.file.endsWith('.svg') === true,
  `first icon is ${links[0]?.file}`)
ok('an .ico fallback is declared at the fixed path',
  links.some(l => l.file === 'favicon.ico'))

/* --------------------------------------------------- files, hashes, alpha */

/**
 * Minimal PNG alpha reader: inflate IDAT, unfilter the first scanline, and
 * return the alpha of its first and last pixel.
 *
 * Only row 0 is needed — the mark is centred, so the top corners are
 * background wherever the background is. Written by hand because no image
 * library is installed and this is the whole of what must be known.
 */
function cornerAlpha(buf) {
  if (buf.slice(1, 4).toString() !== 'PNG') return null
  const width = buf.readUInt32BE(16)
  const bitDepth = buf.readUInt8(24)
  const colorType = buf.readUInt8(25)
  const interlace = buf.readUInt8(28)
  // 6 = truecolour with alpha. Anything else cannot carry per-pixel alpha in
  // the form this check reads, and for an icon is itself the problem.
  if (colorType !== 6 || bitDepth !== 8 || interlace !== 0) {
    return { colorType, bitDepth, unsupported: true }
  }

  const idat = []
  let p = 8
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.slice(p + 4, p + 8).toString()
    if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len))
    if (type === 'IEND') break
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))

  const bpp = 4
  const stride = width * bpp
  const filter = raw[0]
  const row = Buffer.alloc(stride)
  for (let i = 0; i < stride; i++) {
    const x = raw[1 + i]
    const a = i >= bpp ? row[i - bpp] : 0
    // Row 0, so the prior row (b) and its diagonal (c) are zero throughout.
    row[i] = filter === 0 ? x
      : filter === 1 ? (x + a) & 0xff
      : filter === 2 ? x
      : filter === 3 ? (x + (a >> 1)) & 0xff
      : filter === 4 ? (x + a) & 0xff
      : x
  }
  return { colorType, bitDepth, first: row[3], last: row[stride - 1] }
}

const referenced = new Set()
for (const l of links) {
  referenced.add(l.file)
  const path = join(pub, l.file)
  ok(`${l.file} exists`, existsSync(path))
  if (!existsSync(path)) continue

  const bytes = readFileSync(path)

  // Content-addressed, except the one name that cannot move.
  const named = (l.file.match(/\.([0-9a-f]{8})\./) || [])[1]
  if (l.file === 'favicon.ico') {
    ok('favicon.ico keeps its fixed path', named === undefined)
  } else {
    ok(`${l.file} carries a content hash`, Boolean(named),
      'An unversioned icon cannot be purged from a browser\'s favicon store.')
  }

  if (l.file.endsWith('.png')) {
    const a = cornerAlpha(bytes)
    ok(`${l.file} is 8-bit RGBA`, a && !a.unsupported,
      a ? `colorType=${a.colorType} bitDepth=${a.bitDepth}` : 'not a PNG')
    if (a && !a.unsupported) {
      ok(`${l.file} has a genuinely transparent background`,
        a.first === 0 && a.last === 0,
        `top-left alpha=${a.first}, top-right alpha=${a.last} — 0 is transparent, `
        + '255 is an opaque plate (which is the bug this replaced).')
    }
  }

  if (l.file.endsWith('.svg')) {
    const svg = bytes.toString('utf8')
    ok('the SVG paints no background',
      !/<rect\b/.test(svg) && !/\bfill="(?!none)[^"]*"/.test(svg.split('>')[0] + '>'),
      'A background rect or a root fill is an opaque plate by another name.')
    ok('the SVG uses the brand amber', svg.includes('#f59e0b'))
    ok('the SVG carries the full mark', (svg.match(/<line\b/g) || []).length === 32,
      `${(svg.match(/<line\b/g) || []).length} edges — the mark has 32.`)
    // The published name must agree with the bytes, or a changed icon keeps a
    // cached URL. Checked against the SVG only: it is the hash's source.
    const actual = createHash('sha256').update(svg).digest('hex').slice(0, 8)
    ok('the hash in the filename matches the SVG on disk',
      l.file.includes(actual),
      `filename says ${named}, bytes hash to ${actual}. Re-run `
      + '`node scripts/build-favicon.mjs`.')
  }
}

/* ------------------------------------------------------------- no orphans */

const strays = readdirSync(pub).filter(f =>
  /^(favicon|apple-touch-icon)\b/.test(f) && !referenced.has(f))
ok('no unreferenced icon files are left in public/', strays.length === 0,
  `${strays.join(', ')} — a file nothing points at is the old icon waiting to come back.`)

// The social preview is a separate artefact and must not be disturbed by this.
ok('the social preview is untouched by the icon pipeline',
  html.includes('social-preview.') && !/build-favicon[^\n]*social-preview/.test(
    readFileSync(join(root, 'scripts/build-favicon.mjs'), 'utf8')))

/* ---------------------------------------------------------------- report */

for (const c of checks) console.log(`  ok   ${c}`)
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} browser-icon problem(s).\n`)
  for (const p of problems) console.error(`  ${p}\n`)
  process.exit(1)
}
console.log(`\nBrowser tab branding is correct. ${checks.length} checks passed.`)
