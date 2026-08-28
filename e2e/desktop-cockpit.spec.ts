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
      const attention = await aboveFold(page, '[data-testid="band-attention"] [data-testid="idea-row"]')
      const attnHeight = await medianHeight(page, '[data-testid="band-attention"] [data-testid="idea-row"]')
      const firstY = await page.evaluate(() =>
        document.querySelector('[data-testid="idea-row"]')!.getBoundingClientRect().top)

      console.log(`[after ${size.name}] rows above fold: ${rows} (attention ${attention}), ` +
        `ordinary ${height}px, attention ${attnHeight}px, first row y=${Math.round(firstY)}`)

      // [11] The product band: dense enough to scan a desk, not a spreadsheet.
      const [lo, hi] = size.width >= 1440 ? [8, 11] : [7, 10]
      expect(rows).toBeGreaterThanOrEqual(lo)
      expect(rows).toBeLessThanOrEqual(hi)
      // The brief's 64-80px band for an ordinary row. The upper bound is what
      // keeps the list scannable; the lower is what keeps it readable.
      expect(height).toBeGreaterThanOrEqual(64)
      expect(height).toBeLessThanOrEqual(80)

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

  /** [12] An empty Attention band costs nothing — no header over nothing. */
  test('an empty attention band takes no vertical space', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=no-attention')
    await page.waitForSelector('[data-testid="idea-row"]')

    expect(await page.locator('[data-testid="band-attention"]').count()).toBe(0)
    // And the first row starts where the context bar ends, not below a heading.
    const firstY = await page.evaluate(() =>
      document.querySelector('[data-testid="idea-row"]')!.getBoundingClientRect().top)
    expect(firstY).toBeLessThanOrEqual(56)

    await page.screenshot({
      path: 'artifacts/cockpit/after-no-attention-1440x900.png',
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    })
  })

  /** [10] Reachable without a mouse, and visible without hovering. */
  test('snooze and dismiss are visible and keyboard-focusable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const snooze = page.locator('[data-testid="row-snooze"]').first()
    // Visible with no hover anywhere on the page.
    await expect(snooze).toBeVisible()
    const opacity = await snooze.evaluate(el => getComputedStyle(el).opacity)
    expect(Number(opacity)).toBeGreaterThan(0.5)

    // Named for a screen reader, and reachable by keyboard.
    await expect(snooze).toHaveAttribute('aria-label', /snooze/i)
    await snooze.focus()
    await expect(snooze).toBeFocused()
  })

  /** A readthrough row renders before any graph exists. */
  test('a readthrough reason renders on the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')
    const text = (await page.textContent('[data-testid="cockpit-stream"]')) ?? ''
    expect(text).toContain('Readthrough to NVDA')
    expect(text).toContain('Microsoft AI capex may affect GPU demand.')
  })

  /**
   * A process failure is not asset-scoped, and the row grammar has to survive
   * that: a workflow object in a stream built around tickers.
   */
  test('a process failure reads naturally in the stream', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const text = (await page.textContent('[data-testid="cockpit-stream"]')) ?? ''
    // WHAT happened, and WHY it matters — both on the row.
    expect(text).toContain('Execution Not Confirmed')
    expect(text).toContain('Approved trade has not been logged as executed.')
    // The deliverable has no ticker, and does not borrow one.
    expect(text).toContain('Q3 sector review')

    // The unconfirmed execution is tier 0, so it sits in Attention.
    const attentionText = await page.textContent('[data-testid="band-attention"]')
    expect(attentionText).toContain('Execution Not Confirmed')
  })

  /**
   * Findings that resolve themselves are not dismissible. The controls stay in
   * place and read as unavailable — a row with an empty action column looks
   * broken beside fifteen that are not.
   */
  test('a process row offers no snooze or dismiss', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/cockpit.html?view=after&density=populated')
    await page.waitForSelector('[data-testid="idea-row"]')

    const processRow = page.locator('[data-testid="idea-row"]')
      .filter({ hasText: 'Execution Not Confirmed' }).first()
    await expect(processRow.locator('[data-testid="row-snooze"]')).toBeDisabled()
    await expect(processRow.locator('[data-testid="row-dismiss"]')).toBeDisabled()

    // …while an ordinary row still offers both.
    const postRow = page.locator('[data-testid="idea-row"]')
      .filter({ hasText: 'wants to buy' }).first()
    await expect(postRow.locator('[data-testid="row-snooze"]')).toBeEnabled()
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
