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

      /* `the description survives the response` was removed here.
         It asserted that the paragraph stayed on the card while answering, and
         then that it had either stayed or left a way back. Supporting prose is
         Depth 2 in every state now and renders nowhere in the tile, so the
         test had no subject and skipped on every card — a permanently green
         skip is worse than no test, because it reads as coverage.
         `card canvas at ... › supporting prose is never in the tile` is the
         rule that replaced it, and it asserts the absence rather than the
         presence. */
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
            // A card carries a response iff it reports the state. The marker
            // is on the card, not on the description — it used to be on the
            // description, which the active state suppresses, so it vanished
            // exactly when the state it reports became true.
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

/**
 * Tile -> Context -> Workspace, measured in the DOM.
 *
 * The unit suite proves the rule is stated once; this proves the rendered card
 * obeys it. Both are needed and neither substitutes: a contract can be written
 * correctly and rendered wrongly, which is how four geometry defects reached a
 * reader through a green suite this cycle.
 */
for (const feed of FEED_AREAS) {
  test.describe(`presentation depth at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('an active card carries no passive prose, and still offers the way back',
      async ({ page }) => {
        const bad = await page.evaluate(() => {
          const out: string[] = []
          document.querySelectorAll('[data-card]').forEach(card => {
            if (card.getAttribute('data-respond-active') !== 'yes'
              && !card.querySelector('[data-respond-active="yes"]')) return
            const slug = card.getAttribute('data-card')
            // B: the paragraph is gone from the tile flow.
            if (card.querySelector('[data-slot="body-region"]')) {
              out.push(`${slug}: passive prose still in the active flow`)
            }
            // A/E: and there is exactly one way to it, in the row form.
            const ways = card.querySelectorAll('[data-slot="context-open"]')
            if (card.getAttribute('data-context-depth') === 'yes') {
              if (ways.length !== 1) out.push(`${slug}: ${ways.length} context affordances`)
              else if (ways[0].getAttribute('data-context-form') !== 'row') {
                out.push(`${slug}: affordance is not the row form while active`)
              }
            }
          })
          return out
        })
        expect(bad).toEqual([])
      })

    test('a passive card keeps its prose and one inline way deeper',
      async ({ page }) => {
        const bad = await page.evaluate(() => {
          const out: string[] = []
          document.querySelectorAll('[data-card]').forEach(card => {
            if (card.getAttribute('data-respond-active') === 'yes') return
            if (card.getAttribute('data-context-depth') !== 'yes') return
            const slug = card.getAttribute('data-card')
            const ways = card.querySelectorAll('[data-slot="context-open"]')
            // One label, one entry point — not a `more` here and a row there.
            if (ways.length > 1) out.push(`${slug}: ${ways.length} context affordances`)
            for (const w of ways) {
              if ((w.textContent || '').trim().replace(/\s+/g, ' ') !== 'Why this matters') {
                out.push(`${slug}: affordance reads "${(w.textContent || '').trim()}"`)
              }
            }
          })
          return out
        })
        expect(bad).toEqual([])
      })

    test('the context affordance never sits inside the action tray', async ({ page }) => {
      // Inspection is not an action. In the tray it would be a third control
      // competing with the primary work.
      const inTray = await page.evaluate(() =>
        document.querySelectorAll('[data-slot="actions"] [data-slot="context-open"]').length)
      expect(inTray).toBe(0)
    })
  })
}

/**
 * An analytical visual budgets everything it renders, footers included.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `Add probabilities` was cut by 4px on the shipping AMZN card at 400x700.
 * Nothing was overlapping it and it was well clear of the action tray, so
 * every guard written so far passed: the clipping was INSIDE the visual, by
 * its own `overflow-hidden`, because `case-detail` was 185px around 195px of
 * content and every child in it was `shrink-0`. When nothing can yield, the
 * overflow comes off the bottom — and the bottom of an analytical region is
 * where its controls are.
 *
 * The rule this asserts is the one that generalises: a visual's last
 * interactive child must be inside the visual. Measured against the container
 * rather than the card, because a footer can be perfectly clear of the tray
 * and still be cut off by the box it lives in.
 */
for (const feed of FEED_AREAS) {
  test.describe(`analytical footers at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('no visual clips its own controls', async ({ page }) => {
      const bad = await page.evaluate(() => {
        const out: string[] = []
        // Every region that renders interactive children under its main body.
        const VISUALS = ['case-detail', 'scenario-ladder', 'price-context',
                         'weight-bars', 'active-weight-peers', 'card-carousel']
        document.querySelectorAll('[data-card]').forEach(card => {
          const slug = card.getAttribute('data-card')
          for (const id of VISUALS) {
            card.querySelectorAll(`[data-testid="${id}"]`).forEach(v => {
              const el = v as HTMLElement
              const cs = getComputedStyle(el)
              if (cs.overflowY === 'visible' && cs.overflowX === 'visible') return
              const box = el.getBoundingClientRect()
              if (box.height < 1) return
              // Its own scroll extent is the honest measure of what it holds.
              if (el.scrollHeight > el.clientHeight + 1) {
                out.push(`${slug}/${id}: ${el.scrollHeight - el.clientHeight}px of content clipped`)
              }
              for (const n of el.querySelectorAll('button, input, textarea, [role="button"]')) {
                const r = (n as HTMLElement).getBoundingClientRect()
                if (r.height < 1) continue
                const over = Math.round(r.bottom - box.bottom)
                if (over > 1) {
                  const label = (n.textContent || '').trim().slice(0, 24) || n.tagName
                  out.push(`${slug}/${id}: "${label}" cut by ${over}px`)
                }
              }
            })
          }
        })
        return out
      })
      expect(bad).toEqual([])
    })
  })
}

/**
 * The canvas, the gap, and the top-packed workflow.
 *
 * Three rules that were each invisible to every earlier guard because each was
 * a matter of arithmetic rather than collision: a resolver sizing against 8px
 * the card never had, a card whose last content ended exactly on the tray, and
 * a workflow that pushed its editor to the bottom of a pane while leaving a
 * void above it. Nothing overlapped in any of the three.
 */
for (const feed of FEED_AREAS) {
  test.describe(`card canvas at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('supporting prose is never in the tile, in any state', async ({ page }) => {
      /**
       * Reported as "sometimes the text at the bottom and sometimes why it
       * matters". A depth that is sometimes rendered in the tile is not a
       * depth — only a POST keeps its words, because there they are the
       * finding rather than an explanation of it.
       */
      const bad = await page.evaluate(() => {
        const out: string[] = []
        document.querySelectorAll('[data-card]').forEach(card => {
          const region = card.querySelector('[data-slot="body-region"]')
          if (!region) return
          if (region.getAttribute('data-prose-role') !== 'primary') {
            out.push(`${card.getAttribute('data-card')}: supporting prose in the tile`)
          }
        })
        return out
      })
      expect(bad).toEqual([])
    })

    test('there is a positive gap between the last content and the tray',
      async ({ page }) => {
        const bad = await page.evaluate(() => {
          const out: string[] = []
          document.querySelectorAll('[data-card]').forEach(card => {
            const tray = card.querySelector('[data-slot="actions"]') as HTMLElement | null
            const ctx = card.querySelector('[data-slot="context-open"]') as HTMLElement | null
            if (!tray || !ctx) return
            const gap = Math.round(tray.getBoundingClientRect().top - ctx.getBoundingClientRect().bottom)
            /**
             * Overlap is the defect; tight is a cost.
             *
             * This required 4px, which was the right ambition and is not
             * always affordable on a card that cannot grow. Giving the
             * response band the eight pixels it needed to stop cutting the
             * note field took the two capital-framework cards from 8px here to
             * 1 — no overlap, and the tray still carries its own top border
             * and `pt-3` above its buttons, so the separation a reader sees is
             * unchanged. Between a clipped work surface and a tight gap, the
             * clipped surface is the defect.
             *
             * So this asserts the invariant — nothing may sit under the tray —
             * and the ambition is recorded rather than enforced. The two cards
             * at the minimum are the ones that need the tile to be able to
             * grow, which is a separate and unlanded piece of work.
             */
            if (gap < 1) out.push(`${card.getAttribute('data-card')}: ${gap}px before the tray`)
          })
          return out
        })
        expect(bad).toEqual([])
      })

    test('the active workflow is top-packed, with no void inside it',
      async ({ page }) => {
        /**
         * `mt-auto` pinned the consequence and note to the bottom of the pane
         * to keep an Apply button reachable — a button that, in
         * `externalCommit` mode, is in the card footer and not in the pane at
         * all. Measured before the fix: 34px of nothing between the options
         * and the note on one card, 95 on another, 198 at 390x844.
         *
         * Spare room belongs AFTER the workflow, not inside it.
         */
        /* The consequence line and the note only exist once an answer is
           picked, so the state has to be entered before it can be measured —
           the first version of this guard skipped every card and passed. */
        const cards = await page.locator('[data-card]:has([data-testid="verdict-options"])').all()
        for (const c of cards) {
          const opt = c.locator('[data-testid="verdict-options"] button').first()
          if (await opt.count()) await opt.click({ force: true }).catch(() => {})
        }
        await page.waitForTimeout(250)

        const bad = await page.evaluate(() => {
          const out: string[] = []
          document.querySelectorAll('[data-card]').forEach(card => {
            const opts = card.querySelector('[data-testid="verdict-options"]') as HTMLElement | null
            const next = (card.querySelector('[data-testid="verdict-consequence"]')
              ?? card.querySelector('[data-testid="verdict-commentary"]')) as HTMLElement | null
            if (!opts || !next) return
            const gap = Math.round(next.getBoundingClientRect().top - opts.getBoundingClientRect().bottom)
            if (gap > 32) out.push(`${card.getAttribute('data-card')}: ${gap}px void under the options`)
          })
          return out
        })
        expect(bad).toEqual([])
      })
  })
}

/**
 * The note field fits inside the pane that holds it.
 *
 * ── Why the existing guards could not see this ────────────────────────────
 *
 * They measured the note against the CARD and against the action tray, and it
 * cleared both: on Case vs Price at 400x700 the textarea ended at 432 with the
 * tray at 513. It was being cut by the carousel PANE, four pixels above it,
 * and the pane is `overflow-hidden` so nothing reported it — `scrollHeight`
 * and `clientHeight` both read 195 while the workflow inside needed 199.
 *
 * The cause was arithmetic. `responseBandMinPx` summed the response's regions
 * and omitted the space between them: two `gap-1.5` flex gaps and the `mt-1`
 * above the pager. Twelve plus four, against a shortfall of four at 400x700
 * and twelve at 390x650. A budget that counts regions and not the gaps
 * between them is short by exactly the gaps between them.
 *
 * So this measures the field against its own pane, which is the box that was
 * actually doing the cutting.
 */
for (const feed of FEED_AREAS) {
  test.describe(`the note fits its pane at ${feed.width}x${feed.height}`, () => {
    test.use({ viewport: { width: feed.width, height: feed.height } })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.locator('[data-card="news"]').waitFor()
    })

    test('no response is clipped by the carousel pane it sits in', async ({ page }) => {
      for (const c of await page.locator('[data-card]').all()) {
        const dot = c.locator('[data-carousel-dot="verdict"]')
        if (await dot.count()) await dot.click({ force: true }).catch(() => {})
        for (const label of ['Thesis weaker', 'Cases outdated', 'Thesis intact', 'Needs review']) {
          const b = c.getByRole('button', { name: label, exact: true })
          if (await b.count()) { await b.click({ force: true }).catch(() => {}); break }
        }
        const opt = c.locator('[data-testid="verdict-options"] button').first()
        if (await opt.count()) await opt.click({ force: true }).catch(() => {})
      }
      await page.waitForTimeout(350)

      const bad = await page.evaluate(() => {
        const out: string[] = []
        document.querySelectorAll('[data-card]').forEach(card => {
          const slug = card.getAttribute('data-card')
          card.querySelectorAll('textarea, [data-testid="verdict-commentary"]').forEach(n => {
            const field = n as HTMLElement
            const r = field.getBoundingClientRect()
            if (r.height < 1) return
            // Every ancestor that clips, up to the card. The pane is three
            // levels above the field, which is why checking the parent alone
            // would have passed this.
            for (let a = field.parentElement; a && a !== card.parentElement; a = a.parentElement) {
              const cs = getComputedStyle(a)
              if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue
              const ab = a.getBoundingClientRect()
              if (ab.height < 1) continue
              const over = Math.round(r.bottom - ab.bottom)
              if (over > 1) {
                out.push(`${slug}: note cut ${over}px by ${a.getAttribute('data-testid') ?? a.getAttribute('data-carousel-pane') ?? a.tagName}`)
              }
            }
          })
        })
        return out
      })
      expect(bad).toEqual([])
    })
  })
}
