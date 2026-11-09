/**
 * Measures the Asset page's identity header, before and after.
 *
 * `AssetTab` cannot be mounted in this harness — it reaches for auth, the
 * organization context and a dozen queries — so this measures the markup
 * itself against the application's own compiled stylesheet, which is what
 * decides the height. The class strings below are copied from AssetTab and
 * the assertion is on the DELTA, so a drift in either one shows up as a
 * number that stopped matching rather than as a silent pass.
 *
 *   node desktop-harness/measure-asset-header.mjs
 */
import { chromium } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, 'dist-desktop-harness/assets')
const cssFile = readdirSync(assets).find(f => f.endsWith('.css'))
if (!cssFile) {
  console.error('No built stylesheet. Run `npx vite build --config vite.desktop-harness.config.ts`.')
  process.exit(1)
}
const css = readFileSync(join(assets, cssFile), 'utf8')

const BEFORE = `
<div class="px-8 pt-6 space-y-3">
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-6">
      <div class="flex items-start gap-6">
        <div class="flex flex-col relative">
          <div class="flex items-baseline gap-4">
            <button class="text-3xl font-bold text-gray-900 flex items-baseline gap-1.5">AAPL</button>
            <span class="text-2xl font-bold">$231.40</span>
            <span class="text-xl font-semibold">-1.24%</span>
          </div>
          <p class="text-lg text-gray-600 mt-1">Apple Inc.</p>
        </div>
      </div>
    </div>
  </div>
</div>`

const AFTER = `
<div class="px-8 pt-4 space-y-2">
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-6">
      <div class="flex items-start gap-6">
        <div class="flex flex-col relative">
          <div class="flex items-baseline gap-3 flex-wrap">
            <button class="text-2xl font-bold text-gray-900 flex items-baseline gap-1.5">AAPL</button>
            <span class="text-xl font-semibold">$231.40</span>
            <span class="text-[15px] font-semibold">-1.24%</span>
            <p class="truncate max-w-[34ch] text-[13px] text-gray-500">Apple Inc.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 400 }, deviceScaleFactor: 2 })

async function measure(markup) {
  await page.setContent(
    `<style>${css}</style><body style="margin:0;background:#f9fafb">`
    + `<div id="probe">${markup}</div></body>`,
    { waitUntil: 'load' },
  )
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate(() => Math.round(document.getElementById('probe').getBoundingClientRect().height))
}

const before = await measure(BEFORE)
const after = await measure(AFTER)

// A side-by-side, so the compression can be judged and not just counted.
await page.setContent(
  `<style>${css}</style><body style="margin:0;background:#f9fafb">
    <div style="border-bottom:1px dashed #cbd5e1">
      <div style="font:600 10px system-ui;color:#94a3b8;padding:6px 32px 0">BEFORE — ${before}px</div>
      ${BEFORE}
    </div>
    <div>
      <div style="font:600 10px system-ui;color:#94a3b8;padding:6px 32px 0">AFTER — ${after}px</div>
      ${AFTER}
    </div>
  </body>`,
  { waitUntil: 'load' },
)
await page.evaluate(() => document.fonts.ready)
const out = process.argv[2]
if (out) await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 760, height: before + after + 40 } })

await browser.close()

const saved = before - after
console.log(`identity header: ${before}px -> ${after}px  (${saved}px saved, ${Math.round((saved / before) * 100)}%)`)
if (out) console.log(out)

// The claim is a MATERIAL compression, not a rounding difference.
if (saved < 20) {
  console.error(`\nFAIL: only ${saved}px saved. The header was described as compressed; it is not.`)
  process.exit(1)
}
