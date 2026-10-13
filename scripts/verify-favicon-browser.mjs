/**
 * Verifies the tab branding in a real browser, against the BUILT site.
 *
 *     node scripts/verify-favicon-browser.mjs [url]
 *
 * The static guard reads files. This asks a browser what it actually got:
 * that the tab's title is the new string, that every icon URL resolves with an
 * image content-type (rather than falling through the SPA catch-all to
 * `200 text/html`, which is how this site shipped a broken favicon before),
 * and that the icon still reads as the mark when composited onto a dark tab
 * strip as well as a light one.
 *
 * The composite check is the one a file cannot answer. A transparent PNG looks
 * correct on the white page a screenshot is taken against and can still be
 * invisible in a dark browser chrome — amber on near-black is the case that
 * matters here, and it is checked by drawing the icon onto both grounds and
 * measuring how much of it survives.
 */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const problems = []
const checks = []
const ok = (n, c, d = '') => { if (c) checks.push(n); else problems.push(`${n}${d ? `\n    ${d}` : ''}`) }

if (!existsSync(join(dist, 'index.html'))) {
  console.error('FAIL: dist/index.html is missing. Run `npx vite build` first — this\n'
    + 'verifies what is PUBLISHED, not what is in the source tree.')
  process.exit(1)
}

/*
 * Serve `dist` with the site's SPA catch-all, so a missing icon reproduces the
 * real failure (HTML with a 200) rather than a clean 404 the browser would
 * report differently.
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2',
}
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  const file = join(dist, url)
  if (url !== '/' && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES['.html'] })
  res.end(readFileSync(join(dist, 'index.html')))
})
await new Promise(r => server.listen(0, r))
const base = process.argv[2] ?? `http://localhost:${server.address().port}/`

const browser = await chromium.launch()
const page = await browser.newPage()

const responses = new Map()
page.on('response', r => responses.set(new URL(r.url()).pathname, {
  status: r.status(), type: r.headers()['content-type'] || '',
}))

await page.goto(base, { waitUntil: 'networkidle' })

/* ------------------------------------------------------------------ title */

const title = await page.title()
ok('the browser reports the new tab title',
  title === 'Tesseract | Investment Intelligence', `got: ${title}`)

// Nothing may rewrite it after the app mounts.
await page.waitForTimeout(1500)
const after = await page.title()
ok('no script overwrites the title after mount', after === title, `became: ${after}`)

/* ------------------------------------------------------------------ icons */

const icons = await page.evaluate(() =>
  [...document.querySelectorAll('link[rel*="icon"]')].map(l => ({
    rel: l.getAttribute('rel'),
    href: new URL(l.getAttribute('href'), location.href).pathname,
  })))

ok('the page declares icons', icons.length >= 3, JSON.stringify(icons))

for (const icon of icons) {
  // Fetched explicitly: the browser only downloads the icon it picks.
  const r = await page.request.get(new URL(icon.href, base).href)
  const type = r.headers()['content-type'] || ''
  ok(`${icon.href} resolves`, r.status() === 200, `status ${r.status()}`)
  ok(`${icon.href} is served as an image, not the SPA shell`,
    type.startsWith('image/'),
    `content-type: ${type} — "text/html" means it fell through the catch-all.`)
}

// Requested implicitly by browsers, with no tag to read.
const implicit = await page.request.get(new URL('/favicon.ico', base).href)
ok('/favicon.ico resolves at the fixed path',
  implicit.status() === 200 && (implicit.headers()['content-type'] || '').startsWith('image/'),
  `status ${implicit.status()}, type ${implicit.headers()['content-type']}`)

/* -------------------------------------------- legibility on both chromes */

/**
 * Composite the icon onto a ground and report what fraction of the 16x16 tab
 * rendering is visibly inked.
 */
async function inkOn(ground) {
  return page.evaluate(async ({ href, ground }) => {
    const img = new Image()
    img.src = href
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 16; c.height = 16
    const g = c.getContext('2d')
    g.fillStyle = ground
    g.fillRect(0, 0, 16, 16)
    g.drawImage(img, 0, 0, 16, 16)
    const { data } = g.getImageData(0, 0, 16, 16)
    const base = ground === '#ffffff' ? [255, 255, 255] : [10, 10, 11]
    let inked = 0
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - base[0]) + Math.abs(data[i + 1] - base[1]) + Math.abs(data[i + 2] - base[2])
      if (d > 60) inked++
    }
    return inked / 256
  }, { href: new URL(icons[0].href, base).href, ground })
}

const onLight = await inkOn('#ffffff')
const onDark = await inkOn('#0A0A0B')

// A mark that vanishes on one chrome is the bug a baked-in plate causes, in
// the opposite direction. Both grounds must show a real figure.
ok('the icon is visible on a light tab strip', onLight > 0.08, `${(onLight * 100).toFixed(1)}% inked`)
ok('the icon is visible on a dark tab strip', onDark > 0.08, `${(onDark * 100).toFixed(1)}% inked`)
ok('the icon is not a filled square on either ground',
  onLight < 0.85 && onDark < 0.85,
  `light ${(onLight * 100).toFixed(1)}%, dark ${(onDark * 100).toFixed(1)}% — a plate inks everything.`)

/* ------------------------------------------- a hard refresh changes nothing */

await page.reload({ waitUntil: 'networkidle' })
ok('the title survives a reload', (await page.title()) === 'Tesseract | Investment Intelligence')

await browser.close()
server.close()

for (const c of checks) console.log(`  ok   ${c}`)
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s) in the browser.\n`)
  for (const p of problems) console.error(`  ${p}\n`)
  process.exit(1)
}
console.log(`\nVerified in Chromium against the built site. ${checks.length} checks passed.`)
