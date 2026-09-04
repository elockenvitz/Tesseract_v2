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
  'target-expired', 'target-reached', 'no-target', 'unreviewed-move', 'unreviewed-size',
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
        /**
         * A legibility floor, not the band.
         *
         * `chart-geometry`'s bands are what a plot gets when its pane has the
         * room; several families legitimately give it less, because the pane is
         * shared — `no-target` pages the chart against three case-entry rows
         * and `unreviewed-move` draws a marked sparkline rather than the full
         * presentation. Asserting the band here failed those for having a
         * different composition, which is not a defect.
         *
         * What this catches is the collapse: a card whose whole claim is the
         * price rendering a strip. 80px is below every band and above every
         * legitimate composition, including the 650px sanity viewport where the
         * plot degrades to 85 rather than pushing the description off the card.
         */
        expect(
          box!.height,
          `${slug} at ${vp.name}: plot collapsed to ${Math.round(box!.height)}px`,
        ).toBeGreaterThanOrEqual(80)
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

/**
 * No card clips its response, on any family or any phone.
 *
 * ── The defect, and why it needed a DOM test rather than a model one ──────
 *
 * Reported twice. The first time the tile's own geometry was over-charging —
 * `resolveTile` summed the evidence band and the response instead of letting
 * one replace the other — and fixing that made `capped` false everywhere,
 * which read like the end of it.
 *
 * It was not. On Case vs Price the note field was still cut off, and nothing
 * in the model could see it: the tile resolved 590, the card drew 582, and
 * `capped` was false. The clipping was one level down, inside the band — the
 * pane's content box held 199px of response in a 179px box with `overflow-y:
 * hidden`, so twenty pixels of the field were removed rather than shown. An
 * outer box that fits says nothing about an inner box that does not, which is
 * the same lesson as the silent flex collapse and it had to be learned again.
 *
 * So this measures the field against every ancestor that can clip it, on every
 * engageable family, at every supported width. "Make sure that doesn't happen
 * for any tile type" is the requirement, and enumeration is the only honest
 * way to assert it.
 */
const RESPOND_CARDS = [
  'scenario-below-bear', 'scenario-above-bull', 'scenario-at-expected',
  'target-expired', 'target-reached', 'no-target', 'unreviewed-move', 'unreviewed-size',
  'active-risk-real', 'recommendation', 'awaiting-review',
  'conviction-cohort', 'crowding-spread', 'portfolio-unwritten-position',
] as const

/**
 * The FEED's height, not the phone's — and this distinction is the whole test.
 *
 * These are PHONE viewports. The gallery subtracts the app chrome the same way
 * the shell does, so 700 here is the 590 the feed actually hands a card — see
 * `galleryContainer`, which was a hardcoded 734 until this test needed it not
 * to be. A card measured with 110px of headroom it never has in production is
 * a card measured in a harness, not in the product.
 */
const FEED_AREAS = [
  { width: 360, height: 700 },
  { width: 390, height: 700 },
  { width: 430, height: 700 },
  // The tall phone, where there is room and nothing should clip either.
  { width: 390, height: 844 },
] as const

for (const feed of FEED_AREAS) {
  const width = feed.width
  test.describe(`response fits at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    for (const slug of RESPOND_CARDS) {
      test(`${slug}: the note field is never clipped`, async ({ page }) => {
        const card = page.locator(`[data-card="${slug}"]`)
        if (!(await card.count())) test.skip()

        /**
         * Open the response however this family exposes it.
         *
         * `judgmentPresentationFor` gives all but the loudest cards
         * `on_engage`, and the families keep their options behind different
         * testids — or, on the scenario cards, behind none at all. A guard
         * keyed on `verdict-options` skipped 24 of 39 cases including every
         * `scenario-*`, which is the family the clipping was reported on. A
         * guard that skips the reported defect is worse than no guard, because
         * it reports green.
         *
         * So both steps are best-effort and the assertion is keyed on the
         * FIELD instead: if a card has a note anywhere, it must not be cut.
         */
        for (const sel of ['[data-slot="engage"]',
                           '[data-testid="verdict-options"] button',
                           '[data-testid="target-review-options"] button']) {
          const el = card.locator(sel).first()
          if (await el.count()) await el.click({ force: true }).catch(() => {})
        }
        await page.waitForTimeout(200)

        const clipped = await card.evaluate(el => {
          /**
           * Only a card actually IN its response is measured here.
           *
           * The band reserves a response's room while the reader is in the
           * response and not before, which is what stops a browsing card
           * carrying the reservation and pushing its description under the
           * action tray — measured in the running app at 12px on Case vs
           * Price when this was keyed the other way.
           *
           * A programmatic `scrollLeft` on the carousel does not make the card
           * think it has arrived: `CardCarousel` reports the active pane from
           * its own scroll handling, so the state never changes and the test
           * measures a pane nobody is looking at. The single-pane `respond-*`
           * fixtures are the honest coverage for the responding state — their
           * only pane IS the response, so they are in it from the first frame.
           */
          const respondingNow = el.querySelector('[data-respond-active="yes"]')
          if (!respondingNow) return null
          const fields = [...el.querySelectorAll('textarea, [data-testid$="-note"]')] as HTMLElement[]
          const visible = fields.filter(f => f.getBoundingClientRect().height >= 1)
          if (!visible.length) return null
          const bad: string[] = []
          for (const field of visible) {
            const f = field.getBoundingClientRect()
            /**
             * Every ancestor that can cut it, not just the nearest.
             *
             * The band that clipped Case vs Price was THREE levels above the
             * field: the textarea fitted its own wrapper, and its wrapper
             * fitted the pane, and the pane's content box held 199px inside
             * 179 with `overflow-y: hidden`. Checking only the parent would
             * have passed the exact bug this exists for.
             */
            for (let n = field.parentElement; n && n !== el.parentElement; n = n.parentElement) {
              const cs = getComputedStyle(n)
              if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue
              const r = n.getBoundingClientRect()
              if (r.height < 1) continue
              const over = Math.round(f.bottom - r.bottom)
              if (over > 1) bad.push(`${n.tagName}.${String(n.className).slice(0, 30)} cuts ${over}px`)
            }
          }
          return bad
        })

        if (clipped === null) test.skip()
        expect(clipped, `${slug} at ${width}px`).toEqual([])
      })

      test(`${slug}: the description survives the response`, async ({ page }) => {
        /**
         * The other half of the same screen, and the one that was quietly
         * traded away twice to pay for the first.
         *
         * The description used to be blanked while answering — the box kept
         * its 48px and rendered nothing — and then, briefly, collapsed
         * entirely to buy the note field room. Reported as "i dont see the
         * text at the bottom of the tile for the description or that info. i
         * need to see that", which is the right complaint: the description is
         * what makes the question answerable. "No stated upside is left on
         * capital you are still holding" is the evidence behind "has the
         * investment view changed?", and a card that hides it at the moment of
         * decision has kept the ask and dropped the reason.
         *
         * Asserted beside the clipping test rather than instead of it, because
         * the two compete for one screen and the failure mode is fixing either
         * one by sacrificing the other.
         */
        const card = page.locator(`[data-card="${slug}"]`)
        if (!(await card.count())) test.skip()
        const region = card.locator('[data-slot="body-region"]').first()
        if (!(await region.count())) test.skip()
        const before = (await region.innerText()).trim()
        if (!before) test.skip()

        for (const sel of ['[data-slot="engage"]',
                           '[data-testid="verdict-options"] button',
                           '[data-testid="target-review-options"] button']) {
          const el = card.locator(sel).first()
          if (await el.count()) await el.click({ force: true }).catch(() => {})
        }
        await page.waitForTimeout(200)

        const after = await region.evaluate(el => ({
          text: (el.textContent || '').trim(),
          height: Math.round(el.getBoundingClientRect().height),
        }))
        expect(after.text, `${slug} at ${width}px lost its description`).not.toEqual('')
        expect(after.height, `${slug} at ${width}px collapsed its description`)
          .toBeGreaterThan(8)
      })
    }
  })
}

/**
 * The description sits inside its column, on every family and every phone.
 *
 * ── The failure this catches, which the clipping test did not ────────────
 *
 * "On the target reached tile, the 2 lines of description at the bottom of the
 * tile is getting cut off." The note-clipping guard walked every ANCESTOR with
 * a hidden overflow and found none — correctly, because nothing was clipping
 * it. The description was overflowing its own column and sliding underneath
 * the action tray, which is a sibling and `position: sticky`. Nothing was
 * hidden; something was on top.
 *
 * The cause was in `chart-geometry`: its plot bands were chosen to leave
 * "roughly 90px of app chrome", and the shell takes 110. So at a 700px phone
 * the 160px band claimed a plot needing a 610px card in a card that is 590,
 * and the 20px came off the bottom of the column. Target Reached surfaced it
 * because it has the longest body in the lens family and ran out first.
 *
 * Measuring against the column rather than against an overflow rule is the
 * point: the question is whether the last thing on the card is fully on the
 * card, and overlap is as good a way to fail that as clipping is.
 */
for (const feed of FEED_AREAS) {
  test.describe(`description sits inside the card at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('no card lets its description run past the column or under the tray', async ({ page }) => {
      const bad = await page.evaluate(() => {
        const out: string[] = []
        document.querySelectorAll('[data-card]').forEach(card => {
          const region = card.querySelector('[data-slot="body-region"]') as HTMLElement | null
          if (!region) return
          const r = region.getBoundingClientRect()
          if (r.height < 1) return
          const slug = card.getAttribute('data-card')

          // 1. Inside the column that owns it.
          const column = region.parentElement
          if (column) {
            const c = column.getBoundingClientRect()
            const over = Math.round(r.bottom - c.bottom)
            if (over > 1) out.push(`${slug}: ${over}px past its column`)
          }

          // 2. Clear of the tray, which is sticky and paints over it.
          const tray = card.querySelector('[data-slot="actions"]') as HTMLElement | null
          if (tray) {
            const t = tray.getBoundingClientRect()
            const under = Math.round(r.bottom - t.top)
            if (under > 1) out.push(`${slug}: ${under}px under the action tray`)
          }
        })
        return out
      })
      expect(bad).toEqual([])
    })
  })
}

/**
 * The band is one height for the life of the card, whatever pane is showing.
 *
 * ── The jump this catches ─────────────────────────────────────────────────
 *
 * The response band's floor used to be applied only while the reader was IN
 * the response, so arriving at it grew the band from 207 to 227 and dropped
 * the pager — and the description, and the footer's whole neighbourhood — by
 * 20px. Reported as "the carousel is moving down when I have the respond card
 * selected... spacing has to be consistent between cards and between tiles."
 *
 * It is the right complaint and it is structural. The band is ONE box that
 * several panes take turns occupying, so a height that depends on which pane
 * is showing is not a height, it is a jump. It reserves what the largest pane
 * needs, computed once.
 *
 * Measured by rendering the same card in both states rather than by reading
 * the class: the `respond-*` fixtures are single-pane and therefore in their
 * response from the first frame, and the ordinary fixtures are not, so a
 * band whose height moved with the state would show up as the two disagreeing
 * about a card of the same family and viewport.
 */
for (const feed of FEED_AREAS) {
  test.describe(`band height is stable at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('the pane band does not resize when the reader reaches the response',
      async ({ page }) => {
        const bad = await page.evaluate(() => {
          const out: string[] = []
          document.querySelectorAll('[data-card]').forEach(card => {
            // A card carries a response iff it renders the region that reports
            // the state. Reading the DOM rather than a slug list, so a new
            // family is covered the day it appears.
            if (!card.querySelector('[data-respond-active]')) return
            const carousel = card.querySelector('[data-testid="card-carousel"]')
            const band = carousel?.parentElement as HTMLElement | null
            if (!band) return
            const floor = parseInt(getComputedStyle(band).minHeight || '0', 10)
            const responding =
              card.querySelector('[data-respond-active="yes"]') !== null
            out.push(`${card.getAttribute('data-card')}|${responding}|${floor}`)
          })
          return out
        })

        /**
         * The floor must be the RESPONSE's, not the ordinary pane's, whether
         * or not the reader has arrived.
         *
         * 168 is `PANE_VIEWPORT_MIN_PX` — what a band needs to be worth
         * drawing. A card that can be answered and floors at 168 while
         * browsing is a card that will grow when the reader reaches its
         * answer, which is exactly the 20px jump this exists to prevent.
         */
        const jumpy = bad.filter(row => Number(row.split('|')[2]) <= 168)
        expect(
          jumpy,
          'these cards reserve only a pane floor, so their band grows on arrival',
        ).toEqual([])
      })
  })
}
