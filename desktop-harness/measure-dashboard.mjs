/**
 * Screenshot and measure the desktop Dashboard shell.
 *
 * Reports what the brief asks to be held accountable: how much of the viewport
 * is spent before the first piece of investment content, how many actionable
 * objects reach the first fold, each tile's height, and the dead space between
 * the bottom of the last tile in a row and the row's baseline.
 *
 *   node desktop-harness/measure-dashboard.mjs <label> [width]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const label = process.argv[2] ?? 'shot'
const width = Number(process.argv[3] ?? 1920)
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const url = `${base}?surface=dashboard`
const dir = '.shots'
const FOLD = 1080
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: FOLD }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="today-tile"]')
await page.waitForTimeout(500)

const data = await page.evaluate((fold) => {
  const y = (el) => Math.round(el.getBoundingClientRect().top)
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }
  }

  const lensBar = document.querySelector('[data-testid="dashboard-lenses"]')
  const tiles = [...document.querySelectorAll('[data-testid="today-tile"]')]

  // The first pixel of actual investment content: the leading tile's top edge.
  const firstTile = tiles[0] ? box(tiles[0]) : null

  // Everything above it is chrome: lens bar, page title, blurb, summary,
  // section head.
  const chrome = firstTile ? firstTile.top : null

  const rows = []
  for (const t of tiles) {
    const b = box(t)
    const row = rows.find(r => Math.abs(r.top - b.top) <= 3)
    const rec = {
      ...b,
      rank: t.getAttribute('data-rank'),
      tier: t.getAttribute('data-tier'),
      ticker: t.querySelector('span.font-black')?.textContent?.trim() ?? '?',
      // Does this tile carry a real explanatory graphic, or only metrics?
      visual: !!t.querySelector('svg') || !!t.querySelector('[data-visual]'),
      inFold: b.top < fold,
      actionable: !!t.querySelector('button'),
    }
    if (row) row.cards.push(rec); else rows.push({ top: b.top, cards: [rec] })
  }

  const alsoWatching = [...document.querySelectorAll('div')].find(
    d => d.textContent?.startsWith('Also watching'))

  return {
    lensBar: lensBar ? box(lensBar) : null,
    chromeBeforeContent: chrome,
    tileCount: tiles.length,
    actionableInFold: tiles.filter(t => box(t).top < fold && t.querySelector('button')).length,
    fullyVisibleInFold: tiles.filter(t => box(t).bottom <= fold).length,
    rows: rows.map(r => ({
      top: r.top,
      height: Math.max(...r.cards.map(c => c.h)),
      bottomDelta: Math.max(...r.cards.map(c => c.bottom)) - Math.min(...r.cards.map(c => c.bottom)),
      cards: r.cards,
    })),
    alsoWatchingTop: alsoWatching ? y(alsoWatching) : null,
    surfaceHeight: Math.round(
      document.querySelector('[data-harness]')?.firstElementChild?.scrollHeight ?? 0),
  }
}, FOLD)

console.log(`\n=== ${label} @ ${width} ===`)
console.log(`lens bar          : ${data.lensBar?.h}px`)
console.log(`chrome before 1st : ${data.chromeBeforeContent}px  (${((data.chromeBeforeContent / FOLD) * 100).toFixed(1)}% of a ${FOLD}px fold)`)
console.log(`tiles             : ${data.tileCount}`)
console.log(`actionable in fold: ${data.actionableInFold}   fully visible: ${data.fullyVisibleInFold}`)
console.log(`also-watching at  : ${data.alsoWatchingTop}px`)
for (const [i, r] of data.rows.entries()) {
  console.log(
    `row ${i + 1}  top ${String(r.top).padStart(4)}  height ${String(r.height).padStart(4)}px  ` +
    `bottom-delta ${String(r.bottomDelta).padStart(3)}px  ` +
    r.cards.map(c => `#${c.rank} ${c.ticker}(${c.h}px,${c.w}w,${c.visual ? 'visual' : 'no-visual'})`).join(' '),
  )
}

await page.screenshot({ path: `${dir}/${label}-dash-fold-${width}.png` })
await page.screenshot({ path: `${dir}/${label}-dash-full-${width}.png`, fullPage: true })

for (const [i, r] of data.rows.entries()) {
  await page.screenshot({
    path: `${dir}/${label}-dash-row${i + 1}-${width}.png`,
    fullPage: true,
    clip: { x: 0, y: Math.max(0, r.top - 8), width, height: r.height + 16 },
  })
}

// The header region on its own, so chrome cost is visible rather than argued.
await page.screenshot({
  path: `${dir}/${label}-dash-header-${width}.png`,
  fullPage: true,
  clip: { x: 0, y: 0, width, height: Math.min(data.chromeBeforeContent + 40, 700) },
})

await browser.close()
