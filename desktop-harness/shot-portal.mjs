import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const label = process.argv[2] ?? 'shot'
const width = Number(process.argv[3] ?? 1920)
mkdirSync('.shots', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width, height: 1080 } })
await p.goto(`${base}?surface=dashboard&h=1400`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(400)
await p.screenshot({ path: `.shots/${label}-fold-${width}.png` })

const lead = p.locator('[data-testid="today-tile"]').first()
const lb = await lead.boundingBox()
await p.screenshot({ path: `.shots/${label}-lead-${width}.png`, fullPage: true,
  clip: { x: 0, y: Math.max(0, lb.y - 8), width, height: lb.height + 16 } })

// The lead with a point under inspection.
const chart = lead.locator('svg[role="img"]').first()
const cb = await chart.boundingBox()
if (cb) {
  await p.mouse.move(cb.x + cb.width * 0.4, cb.y + cb.height / 2)
  await p.waitForTimeout(200)
  await p.screenshot({ path: `.shots/${label}-lead-scrub-${width}.png`, fullPage: true,
    clip: { x: 0, y: Math.max(0, lb.y - 8), width, height: lb.height + 16 } })
}

const m = await p.evaluate(() => [...document.querySelectorAll('[data-testid="today-tile"]')].map(t => ({
  sym: t.querySelector('span.font-black')?.textContent?.trim(),
  h: Math.round(t.getBoundingClientRect().height),
  body: t.querySelector('[data-body]')?.getAttribute('data-body'),
  controls: t.querySelectorAll('button,a').length,
})))
console.log(`\n=== ${label} @ ${width} ===`)
for (const c of m) console.log(`  ${c.sym.padEnd(6)} ${String(c.h).padStart(4)}px  ${String(c.body).padEnd(7)} controls=${c.controls}`)
await b.close()
