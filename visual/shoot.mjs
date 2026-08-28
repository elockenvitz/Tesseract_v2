/**
 * Screenshot the coverage visual harness at desktop and phone widths.
 *
 * Drives the REAL component: it selects two suggestions and presses the save
 * button so the confirmation state is photographed as the user reaches it,
 * rather than mocked into place.
 */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const ROOT = new URL('../dist-visual/', import.meta.url).pathname.replace(/^\//, '')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = createServer(async (req, res) => {
  const p = join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]))
  try {
    const body = await readFile(p)
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('not found') }
})
await new Promise(r => server.listen(4321, r))

const browser = await chromium.launch()

// --- desktop -----------------------------------------------------------------
const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
await desktop.goto('http://localhost:4321/')
await desktop.waitForSelector('[data-harness="desktop"] [data-slot="coverage-quick-start"]')
await desktop.waitForSelector('text=NVDA')
await desktop.locator('[data-harness="desktop"]').screenshot({ path: 'artifacts/coverage/desktop-prompt.png' })

// Drive the real flow in the confirm frame: select two, save.
const confirm = desktop.locator('[data-harness="confirm"]')
await confirm.locator('[data-slot="coverage-quick-start-option"]').nth(0).click()
await confirm.locator('[data-slot="coverage-quick-start-option"]').nth(1).click()
await confirm.locator('[data-slot="coverage-quick-start-save"]').click()
await confirm.locator('[data-slot="coverage-quick-start-done"]').waitFor()
await confirm.screenshot({ path: 'artifacts/coverage/desktop-confirmation.png' })

// --- phone, 390px ------------------------------------------------------------
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true })
await phone.goto('http://localhost:4321/')
await phone.waitForSelector('[data-harness="mobile"] [data-slot="coverage-quick-start"]')
await phone.waitForSelector('text=NVDA')
await phone.locator('[data-harness="mobile"]').screenshot({ path: 'artifacts/coverage/mobile-390-prompt.png' })

// Overflow check: the card must not push the 390px viewport sideways.
const overflow = await phone.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth)

console.log('desktop-prompt.png, desktop-confirmation.png, mobile-390-prompt.png written')
console.log('horizontal overflow at 390px:', overflow, 'px (expect 0)')

await browser.close()
server.close()
