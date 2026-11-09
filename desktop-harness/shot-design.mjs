/** Screenshots the two Asset Workspace design directions. */
import { chromium } from '@playwright/test'
const out = process.argv[2]
const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const b = await chromium.launch()
for (const [name, q, w, hh] of [
  ['a-desktop', 'dir=a&h=1000', 1440, 1000],
  ['b-desktop', 'dir=b&h=900', 1440, 900],
  ['a-mobile', 'dir=a&mobile=1', 430, 900],
  ['b-mobile', 'dir=b&mobile=1', 430, 900],
]) {
  const p = await b.newPage({ viewport: { width: w, height: hh }, deviceScaleFactor: 2 })
  await p.goto(`${base}?surface=design&${q}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-harness="design"]')
  await p.waitForTimeout(250)
  await p.locator('[data-harness="design"]').screenshot({ path: `${out}/design-${name}.png` })
  console.log(`design-${name}.png`)
  await p.close()
}
await b.close()
