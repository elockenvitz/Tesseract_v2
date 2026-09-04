import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * The same cards, on every phone the product claims to support.
 *
 * ── Why this exists as its own suite ──────────────────────────────────────
 *
 * `signal-cards.spec.ts` is thorough and runs at ONE viewport, 390x844 — the
 * tall phone. Every geometry defect reported by a human this cycle was found
 * somewhere else: the clipped GOOGL chart at 400x700, the note field cut off
 * at 400x590, the card 110px taller than its container when the ceiling was
 * `100dvh` rather than the feed's own height. A suite that only ever measures
 * the roomiest case cannot see any of them.
 *
 * So this runs the shipping card set across the widths and, more importantly,
 * the HEIGHTS that real devices have — including the short one, which is where
 * everything breaks first. It asserts the four things that were actually
 * wrong, and deliberately not more: a suite that re-asserts the other file's
 * rules at five viewports is five times the runtime for no extra coverage.
 */

/**
 * The reference devices, feed area included in the height.
 *
 * 400x700 leads because it is the viewport the reader reproduces on: "Device
 * emulation is set to 400x700, which is the closest match to the actual iPhone
 * 17 experience I am seeing. Treat 400x700 as the primary real-world
 * reproduction viewport." 390x650 is the sanity case — deliberately shorter
 * than anything shipped, because a rule that only holds above some height is a
 * rule waiting for a device with a taller keyboard.
 */
const VIEWPORTS = [
  { name: '400x700 (primary reproduction)', width: 400, height: 700 },
  { name: '360x700 (narrow)', width: 360, height: 700 },
  { name: '390x844 (tall)', width: 390, height: 844 },
  { name: '430x932 (large)', width: 430, height: 932 },
  { name: '390x650 (short sanity)', width: 390, height: 650 },
] as const

/** The families a human actually reported a defect on, plus their neighbours. */
const CARDS = [
  'target-expired', 'no-target', 'unreviewed-move', 'unreviewed-size',
  'scenario-below-bear', 'scenario-above-bull', 'conviction-cohort',
  'active-risk-real', 'recommendation', 'news', 'idea-thought',
  'portfolio-unwritten-position',
] as const

const card = (page: Page, slug: string): Locator => page.locator(`[data-card="${slug}"]`)

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('no card pushes its own action tray outside itself', async ({ page }) => {
      /**
       * The GOOGL defect, generalised. The tray sat at 294 while content
       * reached 460, so the body ran 166px THROUGH it. Measured inside the
       * card because cards are stacked — a page-relative comparison fails
       * every card but the first and says nothing.
       */
      for (const slug of CARDS) {
        const box = await card(page, slug).boundingBox()
        if (!box) continue
        const tray = await card(page, slug).locator('[data-slot="primary"]').boundingBox()
        if (!tray) continue
        expect(
          tray.y - box.y + tray.height,
          `${slug} at ${vp.name}: tray ends ${Math.round(tray.y - box.y + tray.height)} ` +
          `in a ${Math.round(box.height)} card`,
        ).toBeLessThanOrEqual(box.height + 1)
      }
    })

    test('nothing widens the page', async ({ page }) => {
      // `overflow-x: clip` on the shell makes a too-wide child invisible
      // rather than loud, so width regressions have to be measured.
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over).toBeLessThanOrEqual(1)
    })

    test('no card hides content behind an inner scroller', async ({ page }) => {
      /**
       * The silent-collapse failure. A flex child that SHRINKS does not
       * overflow — it compresses until the analytical region is worthless
       * while the outer box still measures correctly. An inner scroller is the
       * other shape of the same bug: content the reader cannot see and is
       * given no affordance to reach.
       *
       * Two-line clamps are excluded by name: they are a deliberate summary
       * with a `more` control beside them, which is the opposite of hidden.
       */
      for (const slug of CARDS) {
        const trapped = await card(page, slug).evaluate(el => {
          const out: string[] = []
          el.querySelectorAll('*').forEach(n => {
            const e = n as HTMLElement
            const cs = getComputedStyle(e)
            if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return
            if (e.scrollHeight <= e.clientHeight + 4) return
            if (/line-clamp/.test(e.className)) return
            out.push(`${e.tagName}.${String(e.className).slice(0, 40)}`)
          })
          return out
        }).catch(() => [] as string[])
        expect(trapped, `${slug} at ${vp.name} traps content`).toEqual([])
      }
    })

    test('every card still draws the evidence it claims', async ({ page }) => {
      /**
       * The regression this cycle closed twice: a card whose whole claim is
       * the price rendering as a bare number, because the band was withheld
       * (the Research builder declared no evidence) or compressed to nothing
       * (the plot squeezed from 128px to 99). If a card mounts a chart at the
       * tall viewport it must mount one here, at a readable height.
       */
      for (const slug of ['target-expired', 'unreviewed-move', 'no-target']) {
        const chart = card(page, slug).locator('[data-testid="price-chart"]').first()
        await expect(chart, `${slug} at ${vp.name} lost its chart`).toBeVisible()
        const box = await chart.boundingBox()
        expect(
          box!.height,
          `${slug} at ${vp.name}: plot compressed to ${Math.round(box!.height)}px`,
        ).toBeGreaterThanOrEqual(96)
      }
    })
  })
}

/**
 * Explore's composition, at the same three widths.
 *
 * ── What this is checking, and why it needs several widths ───────────────
 *
 * The composition pass gave Explore a third spatial role. `feature` and
 * `standard` take the row; `compact` takes half of it, and a compact card is
 * one the item EARNED by being short enough to read in a 170px cell. That last
 * clause is the only one that can be wrong in a way a unit test cannot see:
 * whether a claim survives half width is a fact about glyphs, and 360px is
 * where it stops being true first.
 *
 * So this asserts the two failures the role decision can actually produce —
 * a compact card whose headline runs away, and a page that has lost one of its
 * roles entirely — rather than re-testing the rule, which the unit suite owns.
 */
for (const width of [360, 390, 430]) {
  test.describe(`explore composition at ${width}px`, () => {
    test.use({ viewport: { width, height: 780 } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/explore.html')
      await page.locator('[data-explore-tile]').first().waitFor()
    })

    test('all three roles are present, so the page has rhythm', async ({ page }) => {
      /**
       * A page that is all one role is the failure this pass exists to fix,
       * from either side: sixty half-width cards was the reported symptom, and
       * sixty full-width ones was the first attempt at a cure.
       */
      const spans = await page.locator('[data-explore-tile]').evaluateAll(els =>
        els.map(e => `${e.getAttribute('data-explore-span')}:${e.getAttribute('data-explore-height')}`))
      expect(spans.length).toBeGreaterThan(4)
      expect(spans.some(s => s.startsWith('half')), 'no compact cards').toBe(true)
      expect(spans.some(s => s.endsWith('standard') || s.endsWith('feature')),
        'no full-width cards').toBe(true)
    })

    test('a compact headline does not run away in half a row', async ({ page }) => {
      /**
       * The rule is that compact is earned by fitting. Measured rather than
       * asserted about: a headline is allowed to clamp — a story's headline is
       * context and clamping it is the design — but it must not be taller than
       * the three lines the clamp permits, which is what "does not survive at
       * half width" looks like in the DOM.
       */
      const bad = await page.locator('[data-explore-tile][data-explore-span="half"]')
        .evaluateAll(els => els.flatMap(e => {
          const h = e.querySelector('[data-explore-headline]') as HTMLElement | null
          if (!h) return []
          const lines = Math.round(h.getBoundingClientRect().height
            / parseFloat(getComputedStyle(h).lineHeight || '18'))
          return lines > 3 ? [`${(h.textContent || '').slice(0, 40)} = ${lines} lines`] : []
        }))
      expect(bad).toEqual([])
    })

    test('nothing overflows the grid sideways', async ({ page }) => {
      const over = await page.evaluate(() => {
        const sc = document.querySelector('[data-explore-scroll]') as HTMLElement | null
        return sc ? sc.scrollWidth - sc.clientWidth : 0
      })
      expect(over).toBeLessThanOrEqual(1)
    })
  })
}
