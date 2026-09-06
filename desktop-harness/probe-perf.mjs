import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
await p.goto(`${base}?surface=dashboard&lens=ideas&h=2600`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="idea-tile"]')
await p.waitForTimeout(400)
const nv = p.locator('[data-testid="idea-tile"]').filter({ hasText: 'NVDA' }).first()
console.log('NVDA tile found      :', await nv.count())
console.log('since-plot present   :', await nv.locator('[data-testid="since-plot"]').count())
console.log('perf portal present  :', await nv.locator('[data-testid="performance-portal"]').count())
await nv.locator('[data-testid="performance-portal"]').first().click()
await p.waitForTimeout(700)
const r = await p.evaluate(() => ({
  open: !!document.querySelector('[data-testid="dashboard-focus"]'),
  intent: document.querySelector('[data-testid="focus-intent"]')?.getAttribute('data-intent'),
  panels: [...document.querySelectorAll('[data-testid="desktop-module"],[data-testid="desktop-section"]')]
    .map(e => ({ t: e.querySelector('h3')?.textContent?.trim(), f: e.hasAttribute('data-focused') })),
}))
console.log('opened               :', r.open, ' intent:', r.intent)
console.log('panels               :', r.panels.map(x => (x.f ? `[${x.t}]` : x.t)).join(' · '))
if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
