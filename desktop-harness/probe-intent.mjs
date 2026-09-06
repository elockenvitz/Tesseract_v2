import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })

async function open(which) {
  await p.goto(`${base}?surface=dashboard&h=1400`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="today-tile"]')
  await p.waitForTimeout(250)
  const dash = p.locator('[data-testid="today-tile"]').filter({ hasText: 'DASH' }).first()
  if (which === 'claim') await dash.locator('[data-testid="claim-portal"]').click()
  else if (which === 'price') await dash.locator('[data-testid="visual-portal"]').click()
  else {
    const tb = await dash.boundingBox()
    await p.mouse.click(tb.x + tb.width - 40, tb.y + 12)
  }
  await p.waitForSelector('[data-testid="research-detail"]')
  await p.waitForTimeout(400)
  return p.evaluate(() => {
    const lead = document.querySelector('[data-testid="work-surface"]')
    // The first section heading in reading order = what leads.
    const heads = [...lead.querySelectorAll('h2,h3')].map(h => h.textContent.trim()).filter(Boolean)
    return {
      intent: document.querySelector('[data-testid="focus-intent"]')?.getAttribute('data-intent') ?? 'overview',
      firstHeadings: heads.slice(0, 4),
    }
  })
}

for (const which of ['overview', 'claim', 'price']) {
  const r = await open(which)
  console.log(`${which.padEnd(9)} intent=${String(r.intent).padEnd(9)} leads with: ${JSON.stringify(r.firstHeadings)}`)
}
await b.close()
