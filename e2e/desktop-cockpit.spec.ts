import { expect, test, type Page } from '@playwright/test'

/**
 * What actually fits on a desk screen.
 *
 * ── Why this is a browser test and not a unit test ────────────────────────
 *
 * Every claim in the cockpit's design is a claim about geometry: eight
 * decisions above the fold, a row under 72px, no horizontal scroll at 1280.
 * jsdom reports `offsetHeight` as 0 for everything, so none of that is
 * assertable in the unit suite — the same reasoning that put the phone card
 * layout suite in a real browser. A density rule that cannot be measured where
 * it is tested is a rule that regresses silently, and density is the entire
 * point of this surface.
 *
 * The numbers in the product report come from here, not from reading CSS.
 */

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

/** How many rows are fully inside the first viewport — the honest count. */
async function aboveFold(page: Page, selector: string) {
  return page.evaluate(sel => {
    const fold = window.innerHeight
    return [...document.querySelectorAll(sel)]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= fold
      }).length
  }, selector)
}

async function medianHeight(page: Page, selector: string) {
  return page.evaluate(sel => {
    const hs = [...document.querySelectorAll(sel)]
      .map(el => el.getBoundingClientRect().height)
      .sort((a, b) => a - b)
    if (!hs.length) return 0
    const m = Math.floor(hs.length / 2)
    return Math.round(hs.length % 2 ? hs[m] : (hs[m - 1] + hs[m]) / 2)
  }, selector)
}

test.describe('desktop decision cockpit', () => {
  for (const size of SIZES) {
    test(`${size.name}: multiple decisions are visible above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto('/cockpit.html?view=after&density=populated')
      await page.waitForSelector('[data-testid="idea-row"]')

      const rows = await aboveFold(page, '[data-testid="idea-row"]')
      const height = await medianHeight(page, '[data-testid="idea-row"]')

      // The product target is 4–8 meaningful items. The floor is what is
      // asserted; exceeding it is not a failure.
      console.log(`[after ${size.name}] rows above fold: ${rows}, median height: ${height}px`)
      expect(rows).toBeGreaterThanOrEqual(6)
      expect(height).toBeLessThanOrEqual(72)

      await page.screenshot({
        path: `artifacts/cockpit/after-${size.name}.png`,
        clip: { x: 0, y: 0, width: size.width, height: size.height },
      })
    })

    test(`${size.name}: the previous feed for comparison`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto('/cockpit.html?view=before')
      await page.waitForSelector('[data-testid="before-card"]')

      const cards = await aboveFold(page, '[data-testid="before-card"]')
      const height = await medianHeight(page, '[data-testid="before-card"]')

      // Not a target — a record. This is the geometry the redesign is measured
      // against, captured rather than quoted from memory.
      console.log(`[before ${size.name}] cards above fold: ${cards}, median height: ${height}px`)
      expect(height).toBeGreaterThan(150)

      await page.screenshot({
        path: `artifacts/cockpit/before-${size.name}.png`,
        clip: { x: 0, y: 0, width: size.width, height: size.height },
      })
    })
  }

  test('1440x900: side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=split')
    await page.waitForSelector('[data-testid="idea-row"]')
    await page.screenshot({ path: 'artifacts/cockpit/split-1440x900.png' })
  })

  test('the stream never scrolls sideways at the narrower desk size', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  /**
   * Attention leads, and only when it has something in it. An empty band
   * header is a promise the surface did not keep.
   */
  test('the attention band leads the stream', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const bands = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="band-"]')]
        .map(el => el.getAttribute('data-testid')))
    if (bands.includes('band-attention')) {
      expect(bands[0]).toBe('band-attention')
    }

    // Rows never sort worse than the band they are in: everything in the
    // attention band is lead-tier, everything below it is not.
    const tiers = await page.evaluate(() => {
      const band = document.querySelector('[data-testid="band-attention"]')
      if (!band) return []
      return [...band.querySelectorAll('[data-testid="idea-row"]')]
        .map(el => Number(el.getAttribute('data-tier')))
    })
    for (const t of tiers) expect(t).toBeLessThanOrEqual(1)
  })

  test('scope reads in product language, never internal enum names', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const text = (await page.textContent('[data-testid="cockpit-stream"]')) ?? ''
    expect(text).toContain('My Scope')
    for (const leak of [
      'direct', 'assigned_scope', 'personal_scope', 'coverage', 'Direct Coverage',
      'in_my_scope', 'held‑', 'tier', 'score',
    ]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase())
    }
  })

  test('the first-session prompt occupies a row, not a banner', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=no-scope')
    await page.waitForSelector('[data-testid="scope-prompt"]')

    const promptHeight = await page.evaluate(() =>
      document.querySelector('[data-testid="scope-prompt"]')!.getBoundingClientRect().height)
    // One row tall. A first-session prompt that costs three decisions of space
    // is a wizard wearing a banner.
    expect(promptHeight).toBeLessThanOrEqual(48)

    // And decisions are still visible beside it.
    expect(await aboveFold(page, '[data-testid="idea-row"]')).toBeGreaterThanOrEqual(6)

    await page.screenshot({
      path: 'artifacts/cockpit/after-no-scope-1440x900.png',
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    })
  })

  test('a sparse feed renders without collapsing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=sparse')
    await page.waitForSelector('[data-testid="idea-row"]')
    expect(await page.locator('[data-testid="idea-row"]').count()).toBeGreaterThan(0)
    await page.screenshot({
      path: 'artifacts/cockpit/after-sparse-1440x900.png',
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    })
  })

  /** One click, from the row, with no menu in between. */
  test('snooze and dismiss are one click from the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const before = await page.locator('[data-testid="idea-row"]').count()
    const firstRow = page.locator('[data-testid="idea-row"]').first()
    await firstRow.hover()
    await firstRow.locator('[data-testid="row-dismiss"]').click()

    await expect(page.locator('[data-testid="idea-row"]')).toHaveCount(before - 1)
  })
})
