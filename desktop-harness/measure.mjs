/**
 * Screenshot and measure the desktop Ideas field.
 *
 * Reports the outer height of every card, grouped into rows by their top edge,
 * so a row's height and its bottom-edge alignment can both be checked. Row
 * heights are what Stage 3S.1 budgeted; bottom-edge delta is what its
 * alignment work bought.
 *
 *   node desktop-harness/measure.mjs <label> [width]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const label = process.argv[2] ?? 'shot'
const width = Number(process.argv[3] ?? 1920)
const url = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const dir = '.shots'
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="idea-tile"]')
await page.waitForTimeout(400)

const data = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('[data-testid="idea-tile"]')]
  const cards = tiles.map(t => {
    const r = t.getBoundingClientRect()
    const sym = t.querySelector('span.font-black')?.textContent?.trim() ?? '?'
    const zone = t.querySelector('[data-visual]')
    return {
      sym,
      density: t.getAttribute('data-density'),
      rank: Number(t.getAttribute('data-rank')),
      visual: zone?.getAttribute('data-visual') ?? null,
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      h: Math.round(r.height), w: Math.round(r.width),
      plot: zone ? Math.round(zone.getBoundingClientRect().height) : null,
    }
  })
  // Group by top edge; same row = same top within a couple of px.
  const rows = []
  for (const c of cards.sort((a, b) => a.rank - b.rank)) {
    const row = rows.find(r => Math.abs(r.top - c.top) <= 3)
    if (row) row.cards.push(c)
    else rows.push({ top: c.top, cards: [c] })
  }
  const field = document.querySelector('[data-testid="idea-field"]')
  return {
    rows: rows.map(r => ({
      top: r.top,
      height: Math.max(...r.cards.map(c => c.h)),
      bottomDelta: Math.max(...r.cards.map(c => c.bottom)) - Math.min(...r.cards.map(c => c.bottom)),
      cards: r.cards,
    })),
    fieldHeight: field ? Math.round(field.getBoundingClientRect().height) : null,
  }
})

console.log(`\n=== ${label} @ ${width} ===`)
console.log(`field height: ${data.fieldHeight}px`)
for (const [i, r] of data.rows.entries()) {
  const d = r.cards[0].density
  console.log(
    `row ${i + 1} [${d.padEnd(8)}] height ${String(r.height).padStart(4)}px  ` +
    `bottom-delta ${r.bottomDelta}px  ` +
    r.cards.map(c => `${c.sym}(${c.h}px,${c.w}w,${c.visual},zone ${c.plot})`).join(' '),
  )
}

await page.screenshot({ path: `${dir}/${label}-first-viewport-${width}.png` })
await page.screenshot({ path: `${dir}/${label}-full-${width}.png`, fullPage: true })

// Row crops, so featured / standard / compact can be compared directly.
const crops = { featured: 0, standard: null, compact: null }
data.rows.forEach((r, i) => {
  const d = r.cards[0].density
  if (crops[d] == null) crops[d] = i
})
for (const [name, idx] of Object.entries(crops)) {
  if (idx == null) continue
  const r = data.rows[idx]
  await page.screenshot({
    path: `${dir}/${label}-row-${name}-${width}.png`,
    fullPage: true,
    clip: { x: 0, y: r.top - 8, width, height: r.height + 16 },
  })
}
// A second compact row where one exists.
const compactRows = data.rows.map((r, i) => [r, i]).filter(([r]) => r.cards[0].density === 'compact')
if (compactRows[1]) {
  const [r] = compactRows[1]
  await page.screenshot({
    path: `${dir}/${label}-row-compact2-${width}.png`,
    fullPage: true,
    clip: { x: 0, y: r.top - 8, width, height: r.height + 16 },
  })
}

// The engaged state: actions replace metadata inside the reserved strip.
const lead = page.locator('[data-testid="idea-tile"]').first()
await lead.hover()
await page.waitForTimeout(300)
const lr = await lead.boundingBox()
await page.screenshot({
  path: `${dir}/${label}-hover-featured-${width}.png`,
  fullPage: true,
  clip: { x: 0, y: lr.y - 8, width, height: lr.height + 16 },
})
const compact = page.locator('[data-testid="idea-tile"][data-density="compact"]').first()
await compact.hover()
await page.waitForTimeout(300)
const cr = await compact.boundingBox()
await page.screenshot({
  path: `${dir}/${label}-hover-compact-${width}.png`,
  fullPage: true,
  clip: { x: 0, y: cr.y - 8, width, height: cr.height + 16 },
})

await browser.close()
