/**
 * Screenshots the Our View summary at a research-column width.
 *
 *   node desktop-harness/shot-our-view.mjs <out.png> [view]
 */
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'our-view.png'
const view = process.argv[3]
const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1700 }, deviceScaleFactor: 2 })
await page.goto(`${base}?surface=our-view&h=1800${view ? `&view=${view}` : ''}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid^="our-view-"]')
await page.locator('[data-testid^="our-view-"]').first().screenshot({ path: out })
await browser.close()
console.log(out)
