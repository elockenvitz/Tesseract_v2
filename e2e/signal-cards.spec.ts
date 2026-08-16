import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * The layout rules, measured rather than asserted about.
 *
 * Every one of these encodes a specific failure of the surface this replaced:
 * full-viewport cards with the payload in the top 40%, an empty chart panel on
 * cards that had nothing to chart, action bars that varied per type or were
 * missing entirely, and horizontal swipe pages that hid the rationale behind
 * near-invisible dots.
 *
 * The screenshots are a by-product. These assertions are the contract.
 */

const CARDS = ['active-risk', 'active-risk-sparkline', 'recommendation', 'news'] as const

/** Above this a card is a screen, not a card, and the queue stops feeling finite. */
const MAX_CARD_HEIGHT = 720

const card = (page: Page, slug: string): Locator => page.locator(`[data-card="${slug}"]`)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-card="news"]').waitFor()
})

test.describe('layout rules', () => {
  for (const slug of CARDS) {
    test(`${slug}: fits on a phone without expanding`, async ({ page }) => {
      const box = await card(page, slug).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeLessThanOrEqual(390)
      // The rule the old surface broke by design — it made every card exactly
      // one viewport tall.
      expect(box!.height).toBeLessThan(MAX_CARD_HEIGHT)
    })

    test(`${slug}: has all four action slots`, async ({ page }) => {
      const c = card(page, slug)
      // Slots, not labels. The first version of this asserted the literal
      // strings "Snooze" and "Dismiss" on every card, which made it fail the
      // moment the recommendation card correctly dropped dismiss in favour of
      // decline. The rule is that every card offers the same four kinds of
      // action; the wording is the builder's business.
      await expect(c.locator('[data-slot="why"]')).toHaveCount(1)
      await expect(c.locator('[data-slot="primary"]')).toHaveCount(1)
      await expect(c.locator('[data-slot="open"]')).toHaveCount(1)
      const quick = await c.locator('[data-slot="quick"]').count()
      expect(quick).toBeGreaterThanOrEqual(1)
      expect(quick).toBeLessThanOrEqual(3)
    })

    test(`${slug}: nothing inside the card scrolls sideways`, async ({ page }) => {
      const overflowing = await card(page, slug).evaluate(el => {
        const bad: string[] = []
        for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
          const e = node as HTMLElement
          // A 1px tolerance: sub-pixel rounding on scaled text produces
          // scrollWidth one greater than clientWidth on elements that are not
          // actually scrollable.
          if (e.scrollWidth > e.clientWidth + 1) {
            bad.push(`${e.tagName.toLowerCase()}.${e.className}`.slice(0, 90))
          }
        }
        return bad
      })
      expect(overflowing).toEqual([])
    })

    test(`${slug}: severity rail is present and 4px`, async ({ page }) => {
      const rail = card(page, slug).locator('[aria-hidden="true"]').first()
      const box = await rail.boundingBox()
      expect(box!.width).toBeCloseTo(4, 0)
    })
  }

  test('no chart node when evidence is absent', async ({ page }) => {
    // Three of the four cards carry no evidence. The old tiles rendered the
    // chart panel regardless, which is why a card with nothing to show still
    // cost half a screen.
    for (const slug of ['active-risk', 'recommendation', 'news']) {
      // The evidence slot itself, not a count of svg elements. Counting svgs
      // was the first version of this assertion and it was wrong: the "show
      // more" chevron only renders on cards with a long body, so the expected
      // count differed per card for reasons that had nothing to do with
      // charts. An assertion that needs a per-case magic number is measuring
      // the wrong thing.
      await expect(card(page, slug).locator('[data-evidence]')).toHaveCount(0)
      await expect(card(page, slug).locator('[data-testid="sparkline"]')).toHaveCount(0)
    }
  })

  test('the chart appears when a card argues for it', async ({ page }) => {
    await expect(card(page, 'active-risk-sparkline').locator('[data-testid="sparkline"]')).toHaveCount(1)
  })

  test('more than one card is visible at once', async ({ page }) => {
    // The point of content-driven height. On the old surface the answer was
    // always exactly one.
    const viewportHeight = 844
    let visible = 0
    for (const slug of CARDS) {
      const box = await card(page, slug).boundingBox()
      if (box && box.y < viewportHeight) visible++
    }
    expect(visible).toBeGreaterThanOrEqual(2)
  })

  test('the eyebrow dates a book number and does not date a live one', async ({ page }) => {
    // Active weight comes off a holdings snapshot; the news card has no quote
    // attached at all. The distinction has to survive to the rendered pixel.
    await expect(card(page, 'active-risk').getByText(/^book /)).toBeVisible()
    await expect(card(page, 'news').getByText(/^book /)).toHaveCount(0)
  })
})

test.describe('artifacts', () => {
  for (const slug of CARDS) {
    test(`screenshot: ${slug}`, async ({ page }) => {
      await card(page, slug).screenshot({ path: `artifacts/cards/${slug}.png` })
    })
  }

  test('screenshot: feed scroll', async ({ page }) => {
    await page.locator('#feed').screenshot({ path: 'artifacts/cards/feed-stack.png' })
  })

  test('screenshot: viewport', async ({ page }) => {
    // What actually meets the eye on a 390x844 phone, unscrolled.
    await page.screenshot({ path: 'artifacts/cards/viewport-390.png' })
  })
})
