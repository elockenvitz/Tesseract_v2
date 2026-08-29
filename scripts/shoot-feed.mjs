/**
 * Photograph gallery cards at phone dimensions.
 *
 * Serves the built gallery — the same bundle `guard:layout` measures — so what
 * is photographed is what the phone suite asserts, rather than a second render
 * path that could disagree with it.
 *
 * Usage: node scripts/shoot-feed.mjs <out-dir> <slug> [slug...]
 */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const [outDir, ...slugs] = process.argv.slice(2)
if (!outDir || !slugs.length) {
  console.error('usage: node scripts/shoot-feed.mjs <out-dir> <slug> [slug...]')
  process.exit(1)
}

const ROOT = new URL('../dist-gallery/', import.meta.url).pathname.replace(/^\//, '')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = createServer(async (req, res) => {
  const p = join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]))
  try {
    const body = await readFile(p)
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('not found') }
})
await new Promise(r => server.listen(4322, r))

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await page.goto('http://localhost:4322/')
await page.locator('[data-card="news"]').waitFor()

for (const slug of slugs) {
  const el = page.locator(`[data-card="${slug}"]`)
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.screenshot({ path: join(outDir, `${slug}.png`) })
  console.log('shot', slug)
}

await browser.close()
server.close()
