/** The Ideas card and its workspace in every focus, for side-by-side judgement. */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const label = process.argv[2] ?? 'BEFORE'
const width = Number(process.argv[3] ?? 1920)
mkdirSync('.shots', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))

const go = async () => {
  await p.goto(`${base}?surface=dashboard&lens=ideas&h=2600`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="idea-tile"]')
  await p.waitForTimeout(350)
}
const dash = () => p.locator('[data-testid="idea-tile"]').filter({ hasText: 'DASH' }).first()

// 1. full field
await go()
await p.screenshot({ path: `.shots/${label}-field-${width}.png` })

// 2. the DASH card alone
const db = await dash().boundingBox()
await p.screenshot({ path: `.shots/${label}-card-${width}.png`, fullPage: true,
  clip: { x: Math.max(0, db.x - 8), y: Math.max(0, db.y - 8), width: db.width + 16, height: db.height + 16 } })

// 3-6. workspace in each focus
const entries = [
  ['overview', async () => { const r = await dash().boundingBox(); await p.mouse.click(r.x + r.width - 30, r.y + 10) }],
  ['thesis', async () => dash().locator('[data-testid="idea-claim-portal"]').click()],
  ['framework', async () => dash().locator('[data-testid="case-bear"]').click()],
  ['performance', async () => {
    // DASH's card draws a range, so use a card that draws a price path to
    // raise the performance intent -- NVDA.
    // The plot itself is deliberately non-navigating -- it is scrubbed. The
    // figure beside it is the portal.
    const nv = p.locator('[data-testid="idea-tile"]').filter({ hasText: 'NVDA' }).first()
    await nv.locator('[data-testid="performance-portal"]').first().click()
  }],
]
for (const [name, act] of entries) {
  await go()
  await act()
  await p.waitForSelector('[data-testid="dashboard-focus"]', { timeout: 4000 }).catch(() => {})
  await p.waitForTimeout(600)
  await p.screenshot({ path: `.shots/${label}-ws-${name}-${width}.png` })
  const panels = await p.evaluate(() => [...document.querySelectorAll('[data-testid="desktop-module"],[data-testid="desktop-section"]')]
    .map(e => ({ t: e.querySelector('h3')?.textContent?.trim(), f: e.hasAttribute('data-focused') })))
  console.log(`${name.padEnd(12)} ${panels.map(x => (x.f ? `[${x.t}]` : x.t)).join(' · ')}`)
}
if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
