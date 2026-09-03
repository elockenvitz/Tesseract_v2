import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
const go = async () => {
  await p.goto(`${base}?surface=dashboard&lens=ideas&h=2400`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="idea-tile"]')
  await p.waitForTimeout(350)
}
const lly = () => p.locator('[data-testid="idea-tile"]').filter({ hasText: 'LLY' }).first()
const nvda = () => p.locator('[data-testid="idea-tile"]').filter({ hasText: 'NVDA' }).first()
const focused = () => p.locator('[data-testid="dashboard-focus"]').count()

console.log('=== ARBITRATION: child controls must NOT open the card ===')
for (const [name, sel] of [
  ['framework case', '[data-testid="case-bull"]'],
  ['primary CTA', '[data-testid="idea-quick-open"]'],
  ['Ask AI', '[data-testid="idea-quick-ai"]'],
  ['Discuss', '[data-testid="idea-quick-discuss"]'],
  ['Create', '[data-testid="create-menu"]'],
]) {
  await go()
  const card = sel.includes('case') ? lly() : lly()
  const before = await focused()
  const el = card.locator(sel).first()
  // The action strip reveals on hover, so a real user hovers the card first.
  await card.hover()
  await p.waitForTimeout(200)
  if (await el.count() === 0) { console.log(`  ${name.padEnd(16)} (absent)`); continue }
  await el.click()
  await p.waitForTimeout(350)
  const after = await focused()
  const opened = after > before
  // The framework case and the CTA are SUPPOSED to open; the rest are not.
  const expected = (name === 'framework case' || name === 'primary CTA')
  console.log(`  ${name.padEnd(16)} opened=${String(opened).padEnd(5)} expected=${expected}  ${opened === expected ? 'OK' : 'FAIL'}`)
}

console.log('\n=== PORTAL: inert card body DOES open ===')
await go()
const tb = await lly().boundingBox()
await p.mouse.click(tb.x + tb.width - 30, tb.y + 10)
await p.waitForTimeout(400)
console.log('  whitespace click opened:', (await focused()) === 1)

console.log('\n=== SUB-OBJECT PORTALS ===')
for (const [name, sel] of [
  ['claim', '[data-testid="idea-claim-portal"]'],
  ['framework', '[data-testid="case-bear"]'],
]) {
  await go()
  await lly().locator(sel).first().click()
  await p.waitForTimeout(500)
  const r = await p.evaluate(() => ({
    open: !!document.querySelector('[data-testid="dashboard-focus"]'),
    claimFocused: !!document.querySelector('[data-testid="desktop-section"][data-focused]'),
    fwFocused: !!document.querySelector('[data-testid="desktop-module"][data-focused]'),
    panels: [...document.querySelectorAll('[data-testid="desktop-module"],[data-testid="desktop-section"]')]
      .map(e => e.querySelector('h3')?.textContent?.trim()).filter(Boolean).slice(0, 8),
  }))
  console.log(`  ${name.padEnd(10)} open=${r.open} claimFocused=${r.claimFocused} frameworkFocused=${r.fwFocused}`)
  console.log(`             panels: ${JSON.stringify(r.panels)}`)
}

console.log('\n=== PRICE SCRUB (NVDA, since-open) ===')
await go()
const plot = nvda().locator('[data-testid="since-plot"]').first()
const pb = await plot.boundingBox()
const readout = nvda().locator('[data-testid="since-readout"]').first()
console.log('  resting        :', JSON.stringify(await readout.innerText()))
await p.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height / 2)
await p.waitForTimeout(150)
console.log('  at 30%         :', JSON.stringify(await readout.innerText()))
await p.mouse.move(pb.x + pb.width * 0.8, pb.y + pb.height / 2)
await p.waitForTimeout(150)
console.log('  at 80%         :', JSON.stringify(await readout.innerText()))
const openedDuring = await focused()
await p.mouse.move(5, 5)
await p.waitForTimeout(250)
console.log('  restored       :', JSON.stringify(await readout.innerText()))
console.log('  scrub navigated:', openedDuring > 0, '(must be false)')

if (errs.length) console.log('\nERRORS:', errs.slice(0, 3))
await b.close()
