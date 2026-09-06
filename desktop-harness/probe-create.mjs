import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
// Capture the creation events the app would act on.
await p.addInitScript(() => {
  window.__creates = []
  window.addEventListener('openThoughtsCapture', e => window.__creates.push(e.detail))
})
await p.goto(`${base}?surface=dashboard&h=1500`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(300)

// --- card menu, overview intent
const dash = p.locator('[data-testid="today-tile"]').filter({ hasText: 'DASH' }).first()
await dash.locator('[data-testid="create-menu"]').click()
await p.waitForTimeout(200)
const cardItems = await p.locator('[data-testid="create-menu-list"] [role="menuitem"]').allInnerTexts()
console.log('card Create (overview):', cardItems.map(t => t.split('\n')[0]))

// Does the child control avoid the card portal?
const openedBefore = await p.locator('[data-testid="dashboard-focus"]').count()
await p.locator('[data-testid="create-trade_idea"]').click()
await p.waitForTimeout(300)
const openedAfter = await p.locator('[data-testid="dashboard-focus"]').count()
const creates = await p.evaluate(() => window.__creates)
console.log('create dispatched   :', JSON.stringify(creates[0]))
console.log('card portal fired?  :', openedAfter > openedBefore, '(must be false)')

// --- workbench menu, claim intent
await p.goto(`${base}?surface=dashboard&h=1500`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(250)
const d2 = p.locator('[data-testid="today-tile"]').filter({ hasText: 'DASH' }).first()
await d2.locator('[data-testid="claim-portal"]').click()
await p.waitForSelector('[data-testid="research-detail"]')
await p.waitForTimeout(400)
await p.locator('[data-testid="work-surface"] [data-testid="create-menu"]').click()
await p.waitForTimeout(200)
const wbItems = await p.locator('[data-testid="create-menu-list"] [role="menuitem"]').allInnerTexts()
console.log('workbench Create (claim):', wbItems.map(t => t.split('\n')[0]))

// Escape closes it.
await p.keyboard.press('Escape')
await p.waitForTimeout(150)
console.log('Escape closes menu  :', (await p.locator('[data-testid="create-menu-list"]').count()) === 0)

if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
