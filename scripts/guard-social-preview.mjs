/**
 * The link-preview image must be reachable, and its URL must change whenever
 * its bytes do.
 *
 * ── The failure this exists to catch ─────────────────────────────────────
 *
 * The preview shipped as `/social-preview.png` and was replaced 22 minutes
 * later at that same URL (#239 -> #240). Link-preview caches are keyed on the
 * URL and belong to Apple, Meta, Slack and WhatsApp; several ignore
 * `Cache-Control` and Apple's is effectively permanent. So the deployed asset
 * was correct while every conversation that had already previewed a link kept
 * rendering the superseded image — a regression that is invisible from the
 * server, because the server is serving the right thing.
 *
 * A new URL is a new cache key, and it is the only purge available to us.
 * `scripts/build-social-preview.mjs` therefore names the file after a hash of
 * its own bytes and rewrites every reference. This guard is what makes that
 * mechanism load-bearing rather than a convention: it recomputes the hash
 * from the file on disk and fails if the published URL disagrees.
 *
 *     node scripts/guard-social-preview.mjs
 *
 * Checks, in the order they would actually break a preview:
 *
 *   1. The og:image and twitter:image URLs agree with each other.
 *   2. The file they name exists in `public/`.
 *   3. Its content hash matches the hash in the filename — the check that
 *      catches someone overwriting the bytes and leaving the name.
 *   4. It is a PNG at exactly the dimensions og:image:width/height declare.
 *      Crawlers that trust the declared size crop or reject on a mismatch.
 *   5. The old unversioned URL still redirects, above the SPA catch-all.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const checks = []

const ok = (name, condition, detail = '') => {
  if (condition) checks.push(name)
  else problems.push(`${name}${detail ? `\n    ${detail}` : ''}`)
}

const html = readFileSync(join(root, 'index.html'), 'utf8')
const redirects = readFileSync(join(root, 'public/_redirects'), 'utf8')

const attr = (re) => (html.match(re) || [])[1] ?? null

const ogImage = attr(/<meta\s+property="og:image"\s+content="([^"]+)"/)
const twImage = attr(/<meta\s+name="twitter:image"\s+content="([^"]+)"/)
const ogUrl = attr(/<meta\s+property="og:url"\s+content="([^"]+)"/)
const declaredW = Number(attr(/<meta\s+property="og:image:width"\s+content="([^"]+)"/))
const declaredH = Number(attr(/<meta\s+property="og:image:height"\s+content="([^"]+)"/))

// ── 1. Present, absolute, and consistent ─────────────────────────────────
ok('og:image is declared', Boolean(ogImage))
ok('twitter:image is declared', Boolean(twImage))
ok('og:image and twitter:image are the same asset', ogImage === twImage,
  `og:image=${ogImage}\n    twitter:image=${twImage}`)
ok('og:image is absolute',
  Boolean(ogImage?.startsWith('https://')),
  'Relative image URLs are not resolved by most crawlers.')
ok('og:url is absolute', Boolean(ogUrl?.startsWith('https://')))

// A preview must describe Tesseract and nothing else: the SPA catch-all means
// a crawler asking for `/invite/<token>` is served this same file, and these
// tags end up in caches we do not control.
const description = attr(/<meta\s+property="og:description"\s+content="([^"]+)"/)
ok('og:description is the product tagline',
  description === 'Decision intelligence for investment teams.',
  `found: ${description}`)

if (!ogImage) {
  report()
}

// ── 2. The named file exists ─────────────────────────────────────────────
const filename = ogImage.split('/').pop()
const filePath = join(root, 'public', filename)
ok('the image named by og:image exists in public/', existsSync(filePath),
  `looked for public/${filename}`)

if (existsSync(filePath)) {
  const bytes = readFileSync(filePath)

  // ── 3. The URL moves when the bytes do ─────────────────────────────────
  const named = (filename.match(/^social-preview\.([0-9a-f]{8})\.png$/) || [])[1]
  ok('the published filename carries a content hash', Boolean(named),
    `"${filename}" should look like social-preview.<8 hex>.png — an unversioned `
    + 'name cannot be purged from a third-party cache.')

  if (named) {
    const actual = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    ok('the hash in the filename matches the file on disk', named === actual,
      `filename says ${named}, bytes hash to ${actual}.\n    `
      + 'Re-run `node scripts/build-social-preview.mjs`, which renames the file '
      + 'and rewrites every reference. Overwriting the image without moving the '
      + 'URL is the exact regression this guard exists for.')
  }

  // ── 4. A PNG at the declared size ──────────────────────────────────────
  const isPng = bytes.length > 24 && bytes.slice(1, 4).toString() === 'PNG'
  ok('the image is a PNG', isPng)
  if (isPng) {
    const w = bytes.readUInt32BE(16)
    const h = bytes.readUInt32BE(20)
    ok('the image matches the dimensions og:image declares',
      w === declaredW && h === declaredH,
      `file is ${w}x${h}, tags declare ${declaredW}x${declaredH}`)
    // Twitter rejects over 5MB; WhatsApp is the tightest in practice.
    ok('the image is small enough for every crawler', bytes.length < 1_000_000,
      `${(bytes.length / 1024).toFixed(0)}KB`)
  }
}

// ── 5. The old URL still resolves ────────────────────────────────────────
const lines = redirects.split(/\r?\n/).map(l => l.trim())
const ruleIdx = lines.findIndex(l => l.startsWith('/social-preview.png'))
const catchAllIdx = lines.findIndex(l => /^\/\*\s/.test(l))

ok('the old unversioned URL has a redirect', ruleIdx !== -1,
  'Without it /social-preview.png falls through the SPA catch-all and answers '
  + '200 text/html, which breaks the preview outright for any cache that revalidates.')
ok('the redirect sits above the SPA catch-all',
  ruleIdx !== -1 && catchAllIdx !== -1 && ruleIdx < catchAllIdx,
  'Netlify applies the first match; below the catch-all the rule never fires.')
if (ruleIdx !== -1) {
  ok('the redirect points at the current image',
    lines[ruleIdx].includes(filename), lines[ruleIdx])
}

// ── No orphans ───────────────────────────────────────────────────────────
const strays = readdirSync(join(root, 'public'))
  .filter(f => /^social-preview\./.test(f) && f !== filename)
ok('no superseded preview images are left in public/', strays.length === 0,
  strays.join(', '))

report()

function report() {
  for (const c of checks) console.log(`  ok   ${c}`)
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} link-preview problem(s).\n`)
    for (const p of problems) console.error(`  ${p}\n`)
    process.exit(1)
  }
  console.log(`\nLink preview is publishable. ${checks.length} checks passed.`)
  process.exit(0)
}
