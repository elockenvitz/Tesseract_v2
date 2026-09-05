import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
await p.goto(`${base}?surface=dashboard&lens=ideas&h=2400`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="idea-tile"]')
await p.waitForTimeout(400)

const lly = p.locator('[data-testid="idea-tile"]').filter({ hasText: 'LLY' }).first()
const rest = await lly.locator('[data-testid="case-readout"]').count()
console.log('resting readout present:', rest === 0, '(should be 0 = calm resting state)')

for (const c of ['bear', 'base', 'bull']) {
  await lly.locator(`[data-testid="case-${c}"]`).hover()
  await p.waitForTimeout(150)
  const txt = await lly.locator('[data-testid="case-readout"]').innerText().catch(() => '(none)')
  const sel = await lly.locator(`[data-testid="case-${c}"]`).getAttribute('data-selected')
  console.log(`hover ${c.padEnd(5)} selected=${sel} readout=${JSON.stringify(txt.replace(/\n/g, ' '))}`)
}

await p.mouse.move(5, 5)
await p.waitForTimeout(200)
console.log('pointer leave restores:', (await lly.locator('[data-testid="case-readout"]').count()) === 0)

// Keyboard: focus reaches a case and selects it.
await lly.locator('[data-testid="case-bear"]').focus()
await p.waitForTimeout(150)
console.log('keyboard focus selects :', await lly.locator('[data-testid="case-bear"]').getAttribute('data-selected'))

// Inspecting must not navigate.
const openedBefore = await p.locator('[data-testid="dashboard-focus"]').count()
await lly.locator('[data-testid="case-bull"]').hover()
await p.waitForTimeout(200)
const openedAfter = await p.locator('[data-testid="dashboard-focus"]').count()
console.log('hover navigated?       :', openedAfter > openedBefore, '(must be false)')

// Activating a case routes into the idea.
await lly.locator('[data-testid="case-bull"]').click()
await p.waitForTimeout(500)
console.log('activate opens deck    :', (await p.locator('[data-testid="dashboard-focus"]').count()) === 1)
if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
