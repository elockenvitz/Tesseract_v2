import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const browser = await chromium.launch()

for (const motion of ['no-preference', 'reduce']) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: motion })
  const page = await ctx.newPage()
  await page.goto(`${base}?surface=dashboard&h=900`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="today-tile"]')
  await page.waitForTimeout(300)

  await page.locator('[data-testid="today-tile"]').first()
    .getByRole('button', { name: /Confirm execution|Review|Advance/i }).first().click()
  await page.waitForSelector('[data-testid="dashboard-focus"]')
  await page.waitForTimeout(60)

  const r = await page.evaluate(() => {
    const focus = document.querySelector('[data-testid="dashboard-focus"]')
    const cs = getComputedStyle(focus)
    const browse = document.querySelector('[data-testid="dashboard-browse"]')
    const bcs = getComputedStyle(browse)
    const ae = document.activeElement
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      browsePointerEvents: bcs.pointerEvents,
      browseAriaHidden: browse.getAttribute('aria-hidden'),
      activeTag: ae?.tagName ?? null,
      activeText: (ae?.textContent ?? '').trim().slice(0, 40),
      // Is focus trapped inside the now-hidden deck?
      activeInsideHiddenBrowse: !!(ae && browse.contains(ae)),
      strayOverlays: document.querySelectorAll('[data-focus-clone],[data-transition-overlay]').length,
    }
  })
  console.log(`\n--- prefers-reduced-motion: ${motion} ---`)
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(26), v)

  // Keyboard: the next Tab should be inside what just opened.
  await page.keyboard.press('Tab')
  const firstTab = await page.evaluate(() => {
    const ae = document.activeElement
    const focus = document.querySelector('[data-testid="dashboard-focus"]')
    return {
      text: (ae?.textContent ?? '').trim().slice(0, 30),
      insideFocus: !!(ae && focus?.contains(ae)),
    }
  })
  console.log('first Tab lands on'.padEnd(26), JSON.stringify(firstTab))

  // Back, then: does focus return to the tile it came from?
  await page.locator('[data-testid="workspace-back"]').first().click()
  await page.waitForTimeout(250)
  const back = await page.evaluate(() => {
    const ae = document.activeElement
    return {
      activeHandle: ae?.getAttribute?.('data-focus-source') ?? null,
      isTile: ae?.getAttribute?.('data-testid') === 'today-tile',
    }
  })
  console.log('focus after Back'.padEnd(26), JSON.stringify(back))

  await ctx.close()
}
await browser.close()
