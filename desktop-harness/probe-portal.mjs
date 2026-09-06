import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
await p.goto(`${base}?surface=dashboard&h=1400`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(400)

// 1. Chart scrub: does the read-out change?
const chart = p.locator('[data-testid="today-tile"] svg[role="img"]').first()
const box = await chart.boundingBox()
const before = await p.locator('[data-testid="chart-readout"]').first().innerText()
await p.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2)
await p.waitForTimeout(120)
const mid = await p.locator('[data-testid="chart-readout"]').first().innerText()
await p.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2)
await p.waitForTimeout(120)
const late = await p.locator('[data-testid="chart-readout"]').first().innerText()
await p.mouse.move(10, 10)
await p.waitForTimeout(150)
const restored = await p.locator('[data-testid="chart-readout"]').first().innerText()
console.log('chart readout  rest:', JSON.stringify(before))
console.log('               35%: ', JSON.stringify(mid))
console.log('               75%: ', JSON.stringify(late))
console.log('               left:', JSON.stringify(restored), restored === before ? '(RESTORED)' : '(NOT restored)')

// 2. Whole-card portal from whitespace.
const tile = p.locator('[data-testid="today-tile"]').first()
const tb = await tile.boundingBox()
await p.mouse.click(tb.x + tb.width - 40, tb.y + 12)   // chrome band whitespace
await p.waitForTimeout(500)
const opened = await p.locator('[data-testid="dashboard-focus"]').count()
const intent1 = await p.locator('[data-testid="focus-intent"]').count()
console.log('\nwhitespace click -> focus mounted:', opened === 1, ' intent chip shown:', intent1)
await p.locator('[data-testid="workspace-back"]').first().click()
await p.waitForTimeout(300)

// 3. Claim portal carries the claim intent.
await p.locator('[data-testid="claim-portal"]').first().click()
await p.waitForTimeout(500)
const claimIntent = await p.locator('[data-testid="focus-intent"]').first().getAttribute('data-intent').catch(() => null)
console.log('claim click      -> intent:', claimIntent)
await p.locator('[data-testid="workspace-back"]').first().click()
await p.waitForTimeout(300)

// 4. Visual portal carries price/framework intent.
await p.locator('[data-testid="visual-portal"]').first().click()
await p.waitForTimeout(500)
const visIntent = await p.locator('[data-testid="focus-intent"]').first().getAttribute('data-intent').catch(() => null)
console.log('visual click     -> intent:', visIntent)
await p.locator('[data-testid="workspace-back"]').first().click()
await p.waitForTimeout(300)

// 5. A control inside the card must NOT trigger the whole-card portal.
const askBefore = await p.locator('[data-testid="dashboard-focus"]').count()
await p.locator('[data-testid="today-tile"]').first().getByRole('button', { name: /Ask AI/ }).click()
await p.waitForTimeout(400)
const askAfter = await p.locator('[data-testid="dashboard-focus"]').count()
console.log('Ask AI click     -> opened workbench?', askAfter > askBefore, '(must be false)')

if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 3))
await b.close()
