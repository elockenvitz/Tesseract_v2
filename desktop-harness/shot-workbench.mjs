import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const label = process.argv[2] ?? 'wb'
const width = Number(process.argv[3] ?? 1920)
mkdirSync('.shots', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
await p.goto(`${base}?surface=dashboard&h=1400`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(300)

// Open DASH (the rich object) by its claim, so intent is meaningful.
const dash = p.locator('[data-testid="today-tile"]').filter({ hasText: 'DASH' }).first()
await dash.locator('[data-testid="claim-portal"]').click()
await p.waitForSelector('[data-testid="dashboard-focus"]')
await p.waitForTimeout(700)
await p.screenshot({ path: `.shots/${label}-workbench-${width}.png` })

const info = await p.evaluate(() => {
  const surface = document.querySelector('[data-testid="work-surface"]')
  const controls = [...(surface?.querySelectorAll('button,a') ?? [])]
    .map(c => (c.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 34))
    .filter(Boolean)
  return {
    detailMounted: !!document.querySelector('[data-testid="research-detail"]'),
    intent: document.querySelector('[data-testid="focus-intent"]')?.getAttribute('data-intent') ?? null,
    controls,
    text: (surface?.innerText ?? '').slice(0, 500),
  }
})
console.log(`\n=== workbench @ ${width} ===`)
console.log('research-detail mounted:', info.detailMounted, ' intent:', info.intent)
console.log('controls (' + info.controls.length + '):')
for (const c of info.controls) console.log('   -', c)
console.log('--- first 500 chars ---')
console.log(info.text)
if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
