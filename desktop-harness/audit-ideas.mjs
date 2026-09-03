import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const label = process.argv[2] ?? 'BEFORE'
mkdirSync('.shots', { recursive: true })
const b = await chromium.launch()
for (const [w, h] of [[1920,1080],[1440,900],[1366,768],[2560,1440],[1024,768]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${base}?surface=dashboard&lens=ideas&h=2400`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="idea-tile"]')
  await p.waitForTimeout(400)
  await p.screenshot({ path: `.shots/${label}-ideas-${w}.png` })
  const r = await p.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid="idea-tile"]')]
    const rows = []
    for (const t of tiles) {
      const b = t.getBoundingClientRect()
      const row = rows.find(r => Math.abs(r.top - Math.round(b.top)) <= 3)
      const rec = {
        sym: t.querySelector('span.font-black')?.textContent?.trim(),
        d: t.getAttribute('data-density'),
        h: Math.round(b.height), w: Math.round(b.width),
        visual: t.querySelector('[data-visual]')?.getAttribute('data-visual'),
        controls: t.querySelectorAll('button,a').length,
        pills: t.querySelectorAll('[class*="rounded-full"]').length,
        rounded: t.querySelectorAll('[class*="rounded-lg"],[class*="rounded-xl"]').length,
      }
      if (row) row.cards.push(rec); else rows.push({ top: Math.round(b.top), cards: [rec] })
    }
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      firstTileTop: tiles[0] ? Math.round(tiles[0].getBoundingClientRect().top) : null,
      rows, total: tiles.length,
    }
  })
  console.log(`\n--- ${label} @ ${w}x${h} --- overflow=${r.overflow} chrome=${r.firstTileTop}px tiles=${r.total}`)
  for (const [i, row] of r.rows.entries()) {
    console.log(`  row${i+1} ` + row.cards.map(c =>
      `${c.sym}[${c.d}] ${c.h}x${c.w} vis=${c.visual} btn=${c.controls} pill=${c.pills} rnd=${c.rounded}`).join('  '))
  }
  await p.close()
}
await b.close()
