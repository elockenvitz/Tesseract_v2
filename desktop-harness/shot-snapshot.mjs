/**
 * Screenshots the desktop Investment Snapshot.
 *
 *   node desktop-harness/shot-snapshot.mjs <out.png> [asset] [width]
 */
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'snapshot.png'
const asset = process.argv[3] ?? 'aapl'
const width = Number(process.argv[4] ?? 1440)
const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(`${base}?surface=snapshot&asset=${asset}&h=2200`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="investment-snapshot"]')
await page.waitForTimeout(250)

const box = await page.locator('[data-testid="investment-snapshot"]').boundingBox()
await page.screenshot({
  path: out,
  clip: { x: box.x, y: box.y, width: box.width, height: Math.ceil(box.height) },
})
console.log(`${out}  ${Math.round(box.width)}x${Math.round(box.height)}`)
await browser.close()
