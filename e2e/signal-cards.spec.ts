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

const CARDS = ['active-risk-real', 'six-cases', 'long-label', 'scenario-below-bear', 'scenario-at-expected', 'scenario-above-bull', 'active-risk', 'active-risk-sparkline', 'scenario-price-bands', 'crowding-spread', 'weight-series', 'conviction-cohort', 'idea-trade', 'idea-thought', 'recommendation', 'target-expired', 'no-target', 'unreviewed-move', 'unreviewed-size', 'news'] as const

/**
 * A card owns one screen and must not exceed it while collapsed.
 *
 * The rule used to be "under 720px", written when short cards were the fix for
 * full-viewport cards that were 60% empty. Shrinking them cured emptiness by
 * removing the space rather than using it, so a card carrying a real finding
 * rendered like a table row beside a full-screen legacy tile. The card now
 * fills the 844px viewport; what must not happen is a collapsed card needing
 * a scroll to reach its own actions.
 */
const VIEWPORT_HEIGHT = 844

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
      // Fills its screen and never exceeds it. Content may scroll inside —
      // the action bar is sticky, so it stays reachable — which is why the
      // earlier "must not scroll at all" version was wrong: it forced the case
      // detail closed and put 400px of nothing above the actions instead.
      expect(box!.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
      // Measured inside the card, not against the page. Cards are stacked, so
      // the second card's button sits at a page y beyond one viewport by
      // definition — comparing it to VIEWPORT_HEIGHT failed every card but the
      // first and said nothing about reachability.
      const primary = await card(page, slug).locator('[data-slot="primary"]').boundingBox()
      expect(primary).not.toBeNull()
      expect(primary!.y - box!.y + primary!.height).toBeLessThanOrEqual(box!.height + 1)
    })

    test(`${slug}: has all four action slots`, async ({ page }) => {
      const c = card(page, slug)
      // Slots, not labels. Housekeeping moved behind the menu, so the bar
      // carries at most two inline actions plus open — asserting literal
      // strings broke the moment a builder reworded one.
      await expect(c.locator('[data-slot="menu"]')).toHaveCount(1)
      await expect(c.locator('[data-slot="primary"]')).toHaveCount(1)
      await expect(c.locator('[data-slot="open"]')).toHaveCount(1)
      const quick = await c.locator('[data-slot="quick"]').count()
      expect(quick).toBeLessThanOrEqual(2)
    })

    test(`${slug}: nothing inside the card scrolls sideways`, async ({ page }) => {
      const overflowing = await card(page, slug).evaluate(el => {
        const bad: string[] = []
        for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
          const e = node as HTMLElement
          // A 1px tolerance: sub-pixel rounding on scaled text produces
          // scrollWidth one greater than clientWidth on elements that are not
          // actually scrollable.
          if (e.scrollWidth <= e.clientWidth + 1) continue
          // Content wider than the box is only a defect when the user can
          // scroll it. `overflow-x: hidden` or `clip` means the text is
          // deliberately ellipsised — which is the correct degradation for a
          // long label, and flagging it made the rule fire on its own fix.
          const ox = getComputedStyle(e).overflowX
          if (ox === 'hidden' || ox === 'clip') continue
          // One named exemption, not a loosened threshold: the carousel track
          // IS a horizontal scroller by design. It is the mechanism that keeps
          // the card at one screen so the vertical feed swipe stays intact, and
          // it opts in explicitly with data-carousel-track. Nothing else may.
          if (e.hasAttribute('data-carousel-track')) continue
          bad.push(`${e.tagName.toLowerCase()}.${e.className}`.slice(0, 90))
        }
        return bad
      })
      expect(overflowing).toEqual([])
    })

    test(`${slug}: severity reads without painting the frame`, async ({ page }) => {
      // Was a 4px rail down the left edge. On a full-screen card that reads as
      // a coloured border around the app, and three risk cards in a row looked
      // like an error state. Severity is now a dot plus the colour of the
      // surface word — present, and not structural.
      const c = card(page, slug)
      const dot = c.locator('span[aria-hidden].rounded-full').first()
      const box = await dot.boundingBox()
      expect(box!.width).toBeLessThanOrEqual(8)
      expect(box!.height).toBeLessThanOrEqual(8)
    })
  }

  test('snooze and dismiss are reachable but not in the action bar', async ({ page }) => {
    const c = card(page, 'news')
    await expect(c.getByText('Snooze for a week')).toHaveCount(0)
    await c.locator('[data-slot="menu"]').click()
    await expect(c.locator('[data-slot="menu-item"]')).not.toHaveCount(0)
    await expect(c.getByText('Snooze for a week')).toBeVisible()
    await expect(c.getByText('Why am I seeing this')).toBeVisible()
  })

  test('the case detail opens in place, without navigating', async ({ page }) => {
    const c = card(page, 'scenario-below-bear')
    // Open by default, and it cannot grow the card: the article is h-full
    // overflow-hidden and this region is flex-1 min-h-0 overflow-y-auto, so it
    // absorbs exactly the slack and no more.
    const detail = c.locator('[data-testid="case-detail"]')
    await expect(detail).toHaveCount(1)
    // Sorted high to low, so the bear case sits below the fold of the bounded
    // scroller — present, reachable by scrolling the detail region, and NOT
    // reachable by growing the card.
    await expect(detail.getByText(/Robotaxi slips/)).toHaveCount(1)
    // The invariant is that opening the detail never grows the card. Whether
    // the region itself scrolls depends on how many cases there are — TSLA's
    // three fit, AAPL's six do not — so asserting it always scrolls was
    // asserting the fixture, not the rule.
    const article = c.locator('article')
    const grew = await article.evaluate(el => el.scrollHeight > el.clientHeight + 1)
    expect(grew).toBe(false)
    await c.locator('[data-slot="detail-toggle"]').click()
    await expect(detail).toHaveCount(0)
  })

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

  test('the scenario ladder renders every case the analyst wrote', async ({ page }) => {
    // Names come from the analyst, never normalised — production carries one
    // called "Uber Bull".
    // One dot per case, and no labels on the axis — six labels could not fit a
    // 390px line and every packing attempt moved a collision instead of
    // removing it. Names and probabilities live in the detail pane.
    const ladder = card(page, 'six-cases').locator('[data-testid="scenario-ladder"]')
    await expect(ladder).toHaveCount(1)
    await expect(ladder.locator('[data-testid="ladder-dot"]')).toHaveCount(6)
    await expect(ladder.locator('[data-testid="ladder-tape"]')).toHaveCount(1)
    // Identity is reachable without leaving the pane: every case is named and
    // priced in the legend beneath the axis. Dots alone were not actionable —
    // "below your bear case" needs the reader to know which dot is bear.
    const legend = ladder.locator('[data-testid="ladder-legend-item"]')
    await expect(legend).toHaveCount(6)
    await expect(legend.filter({ hasText: '$205' })).toHaveCount(1)
    await expect(legend.filter({ hasText: '$500' })).toHaveCount(1)

    // Every dot is the same size: 11 of 30 rows in this corpus have no
    // probability, so encoding it in diameter would make a missing weight
    // indistinguishable from a real one.
    const sizes = await ladder.locator('[data-testid="ladder-dot"]')
      .evaluateAll(els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().width)))])
    expect(sizes).toHaveLength(1)

    // A coherent ladder also shows its expected value as a derived marker.
    const coh = card(page, 'scenario-at-expected').locator('[data-testid="scenario-ladder"]')
    await expect(coh.locator('[data-testid="ladder-dot"]')).toHaveCount(3)
    await expect(coh.locator('[data-testid="ladder-expected"]')).toHaveCount(1)
  })

  test('no card leaves a dead band above its actions', async ({ page }) => {
    // The rule the previous design failed twice: a full-viewport card with the
    // payload in the top 40%. Measures the gap between the bottom of the last
    // content element and the top of the action bar. A screen's worth of
    // padding is not a full card.
    /**
     * Two different problems, kept apart because they have different fixes and
     * mixing them is why a single set would never shrink.
     */

    /**
     * DATA_GAP — the card type is sound; this database has no rows to render.
     *
     * EMPTY as of 2026-08-18, and the reason it was populated has gone away.
     * It read "portfolio_benchmark_weights has zero rows across all ten
     * portfolios". Re-measured: 3,381 rows across 483 names, and two orgs
     * carry the full SPY file. The `active-risk` fixture now renders a ranked
     * peer pane, a price pane and a what-if control, and clears the rule on
     * its own; `active-risk-sparkline` clears it on evidence alone.
     *
     * The lesson is in the ratchet rather than the cards: an allowlist entry
     * outlived its justification by weeks because nothing re-checked the claim
     * in its comment. A stale exemption is indistinguishable from a real one.
     */
    const DATA_GAP = new Set<string>([])

    /**
     * THIN_CLAIM — the claim genuinely does not carry a screen yet.
     *
     * news: a headline, a summary and a holding line. Needs the day's move on
     *   the name (blocked on a dated quote), and the other stories on it.
     * long-label: a synthetic stress fixture of the AMZN card, thin for the
     *   same reason its parent is — no probabilities, so no expectation.
     *
     * `recommendation` LEFT this set. Its entry claimed "proposed weight is
     * null on all 23 open rows"; re-measured 2026-08-18 there are 25 rows that
     * carry one. The builder now declares the two weights as evidence and the
     * feed draws them on one axis, which is what the entry said was needed.
     *
     * active-risk-real LEFT this set, which is the direction the ratchet is
     * supposed to move. Measured at 486px of dead space with a bare claim, 306px
     * once the ranked peer pane was added, and -147px once the full list became
     * the detail — it now overflows into its bounded scroller like the scenario
     * cards. The claim was never weak; it was uncomparable. One active weight
     * says nothing about whether it is the portfolio's largest bet or its fifth.
     */
    const THIN_CLAIM = new Set(['news', 'long-label'])

    const KNOWN_THIN = new Set([...DATA_GAP, ...THIN_CLAIM])
    // Ratcheted. Neither set may grow; entries leave when the underlying gap
    // closes, not when the threshold moves.
    // DATA_GAP is 0. The benchmark table is populated, so nothing is exempt
    // on the grounds that its data does not exist.
    expect(DATA_GAP.size).toBeLessThanOrEqual(0)
    // Down to 2 from 3, because a card was fixed rather than a threshold
    // moved — a ceiling that only ever rises is an allowlist wearing a
    // ratchet's clothes.
    expect(THIN_CLAIM.size).toBeLessThanOrEqual(2)

    for (const slug of CARDS) {
      if (KNOWN_THIN.has(slug)) continue
      const gap = await card(page, slug).evaluate(el => {
        const bar = el.querySelector('[data-slot="primary"]')?.closest('div')
        const content = Array.from(el.querySelectorAll('h2, p, [data-testid], [data-slot="detail-toggle"]'))
        if (!bar || !content.length) return 0
        const lowest = Math.max(...content.map(c => c.getBoundingClientRect().bottom))
        return bar.getBoundingClientRect().top - lowest
      })
      expect(gap, `${slug} leaves ${Math.round(gap)}px of dead space`).toBeLessThan(180)
    }
  })

  test('a card takes the height its content needs and no more', async ({ page }) => {
    /**
     * Replaces "every card fills the screen it occupies".
     *
     * That rule asserted the primary action sat below 55% of the viewport,
     * which is a proxy for "this card is a full screen" — correct while every
     * card WAS a full screen, and actively wrong once compact cards were the
     * goal. It would have failed a two-line workflow card for the crime of
     * being two lines.
     *
     * The property that actually matters is unchanged in spirit: no dead space.
     * A card may be short, and it may be tall, but the gap between its last
     * content and its action bar must stay small either way. That catches both
     * the original defect (a screen padded out with nothing) and the new one (a
     * compact card that somehow still stretches), without prescribing a height.
     */
    for (const slug of CARDS) {
      const gap = await card(page, slug).evaluate(el => {
        const bar = el.querySelector('[data-slot="primary"]')!.closest('div')!
        const content = Array.from(el.querySelectorAll('h2, p, [data-testid], [data-slot]'))
          .filter(n => !bar.contains(n) && (n as HTMLElement).offsetHeight > 0)
        if (!content.length) return 0
        const lowest = Math.max(...content.map(c => c.getBoundingClientRect().bottom))
        return bar.getBoundingClientRect().top - lowest
      })
      expect(gap, `${slug} leaves ${Math.round(gap)}px of dead space`).toBeLessThan(180)
    }
  })

  test('a card with no chart is materially shorter than one screen', async ({ page }) => {
    // The point of the whole change: compact kinds stop being padded to 844px,
    // so the reader can see that a next card exists. Asserted on the kinds that
    // genuinely have nothing to draw — a card WITH a chart is allowed its
    // screen, which is why this does not run over every slug.
    for (const slug of ['idea-thought', 'news']) {
      const box = await card(page, slug).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height, `${slug} is ${Math.round(box!.height)}px`).toBeLessThan(844 * 0.9)
    }
  })

  test('the eyebrow never names the table a number came from', async ({ page }) => {
    // "book 31 Jul", then "holdings 31 Jul", both gone. Readers assume
    // holdings and prices are current; the vintage distinction is real but it
    // is enforced by the suppression rules, not shown on the card. What stays
    // is the DATE, which is the part a reader can act on.
    for (const slug of ['active-risk', 'active-risk-real', 'news', 'recommendation']) {
      await expect(card(page, slug).getByText(/holdings /)).toHaveCount(0)
      await expect(card(page, slug).getByText(/^book /)).toHaveCount(0)
    }
  })

  test('the what-if control fits the card it is disclosed in', async ({ page }) => {
    // The unit suite already proves the control cannot commit by accident.
    // What it cannot prove is that a slider, a two-line readout and a 40px
    // button fit in the slack a card with a metric well leaves — jsdom has no
    // layout engine, so every height there is 0. This is the browser's job.
    const c = card(page, 'active-risk')
    const control = c.locator('[data-testid="what-if-size"]')
    await expect(control).toBeVisible()

    const box = await control.boundingBox()
    const bar = await c.locator('[data-slot="primary"]').boundingBox()
    expect(box).not.toBeNull()
    expect(bar).not.toBeNull()
    // Never underneath the action bar. The disclosure region is bounded by
    // flex-1/min-h-0, so overflowing it means the card grew — the exact
    // failure the one-screen rule exists to prevent.
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1)
  })

  test('a four-option response is a 2x2 grid, not four pills in a row', async ({ page }) => {
    // The claim jsdom cannot make: four labels across 390px leaves ~80px each,
    // which forces 10px type or truncation. Measured on rendered geometry — two
    // distinct rows, two distinct columns.
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(500)

    const boxes = await c.locator('[data-verdict]').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height } }))
    expect(boxes).toHaveLength(4)
    expect(new Set(boxes.map(b => b.y)).size, 'four options should sit on two rows').toBe(2)
    expect(new Set(boxes.map(b => b.x)).size, 'four options should sit in two columns').toBe(2)
    // Every target reachable by a thumb.
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44)
  })

  test('a three-option response stays a readable row', async ({ page }) => {
    const c = card(page, 'no-target')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(500)
    const boxes = await c.locator('[data-verdict]').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { y: Math.round(r.y), w: r.width, h: r.height } }))
    // The no-target set is four, so it grids too; what matters on both is that
    // nothing is squeezed below the touch floor or off the card.
    for (const b of boxes) {
      expect(b.h).toBeGreaterThanOrEqual(44)
      expect(b.w).toBeGreaterThan(100)
    }
  })

  test('choosing a judgment neither navigates nor opens a modal', async ({ page }) => {
    const url = page.url()
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_replace_with_cases"]').click()

    // The consequence appears in place; the reader is still on the feed.
    await expect(c.locator('[data-testid="verdict-consequence"]')).toBeVisible()
    expect(page.url()).toBe(url)
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  })

  test('the controls a reader must hit are big enough to hit', async ({ page }) => {
    /**
     * A rendered-geometry check, because this class of bug is invisible in
     * source. `no-touch-target` sets `min-height: 0` as the documented opt-out
     * from the global 44px hit area, and it had been copied onto the response
     * buttons from surrounding card furniture — so the one control Phase 3 is
     * about declared 44px for itself and rendered at 30.
     *
     * Scoped to the controls that carry a decision. Dense secondary strips
     * (chart range chips, the kind filter, ladder legend items) are
     * deliberately smaller and are not asserted here; what must never shrink is
     * anything that commits, discloses, or is the sole route to an action.
     */
    const CRITICAL = [
      '[data-slot="primary"]', '[data-slot="open"]', '[data-slot="quick"]',
      '[data-slot="menu"]', '[data-slot="detail-toggle"]',
      '[data-verdict]', '[data-testid="verdict-send"]',
      '[data-testid="target-tuner-record"]', '[data-testid="what-if-stage"]',
    ].join(', ')

    const undersized = await page.evaluate(sel => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const e = el as HTMLElement
        const r = e.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.height < 44) {
          const id = e.getAttribute('data-slot') ?? e.getAttribute('data-testid') ?? e.getAttribute('data-verdict')
          bad.push(`${id} ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
        // The opt-out must never appear on one of these. It wins over any
        // min-height the component sets for itself, which is exactly how the
        // original defect stayed invisible.
        if (e.classList.contains('no-touch-target')) {
          bad.push(`${e.getAttribute('data-slot') ?? e.getAttribute('data-testid')} has no-touch-target`)
        }
      }
      return bad
    }, CRITICAL)

    expect(undersized, `undersized or opted-out controls: ${undersized.join(', ')}`).toEqual([])
  })

  test('a case dot on the ladder is tappable without being bigger', async ({ page }) => {
    // 11x11 is about a quarter of a fingertip. The dot stays 11px and the
    // button around it is 32, so the picture is unchanged and the target is
    // three times the area.
    const dots = await card(page, 'scenario-below-bear').locator('[data-testid="ladder-dot"]')
      .evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)) }))
    expect(dots.length).toBeGreaterThan(0)
    for (const d of dots) expect(d).toBeGreaterThanOrEqual(32)
  })

  test('the price pane dates its own window and never claims to be current', async ({ page }) => {
    // Every cached series in this database ends weeks or months ago. The pane
    // that draws them must say so on its face — a chart that looks live while
    // ending in April is `isQuoteFresh` passing on a fabricated quote, drawn
    // at 300 pixels wide.
    const c = card(page, 'active-risk')
    await c.locator('[data-carousel-dot="price"]').click()
    await expect(c.locator('[data-testid="price-chart"]')).toBeVisible()

    const window = c.locator('[data-testid="price-window"]')
    await expect(window).toBeVisible()
    await expect(window).not.toContainText(/today|now/i)
    // MSFT's cached window ends 13 May 2026, so against any real clock this
    // fixture is months old and the flag is not optional.
    await expect(c.locator('[data-testid="price-stale"]')).toContainText('not a current price')
  })

  test('the price pane moves its read-out to the tapped close', async ({ page }) => {
    // jsdom cannot do this one: it needs a laid-out element with a real width
    // for the tap-to-index maths to mean anything.
    const c = card(page, 'active-risk')
    await c.locator('[data-carousel-dot="price"]').click()
    const chart = c.locator('[data-testid="price-chart"]')
    const readout = c.locator('[data-testid="price-readout"]')
    const last = await readout.textContent()

    // A locator click with a position, NOT page.mouse.click. Mouse coordinates
    // are viewport-relative and this is the seventh card in a snap feed, so it
    // sits ~5,000px down — the raw click landed on nothing and the assertion
    // failed for a reason that had no bearing on the component.
    const box = await chart.boundingBox()
    await chart.click({ position: { x: box!.width * 0.1, y: box!.height / 2 } })
    await expect(readout).not.toHaveText(last!)
  })

  test('the crowding card ranks by money differently than by weight', async ({ page }) => {
    // The finding the card exists to surface, asserted on the rendered pixels:
    // the heaviest book by weight is not the largest by exposure, so the two
    // views must not be the same list in a different order.
    const c = card(page, 'crowding-spread')
    const pane = c.locator('[data-testid="card-detail"]')
    const first = pane.locator('[data-testid="weight-bar-row"]').first()
    await expect(first).toContainText('Vision Fund 5K')
    await expect(first).toContainText('$4.0m')
  })

  test('the what-if control cannot commit the weight already held', async ({ page }) => {
    // Rendered state, not a prop. The disabled attribute is what stops a hold
    // from firing, and it is set from a comparison the card computes.
    const commit = card(page, 'active-risk').locator('[data-testid="what-if-stage"]')
    await expect(commit).toBeDisabled()
    await expect(commit).toHaveText('Drag to explore a size')
  })
})

  test('the carousel pages horizontally without touching the feed', async ({ page }) => {
    const c = card(page, 'six-cases')
    // Two tracks now: the evidence carousel and the detail carousel, which is
    // what the feed itself renders on a scenario card. This asserts the
    // EVIDENCE one, and that both obey the same gesture rule — pan-x is the
    // whole mechanism, so a second track that did not honour it would reopen
    // the scroll conflict from inside the disclosure.
    const tracks = c.locator('[data-carousel-track]')
    await expect(tracks).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      await expect(tracks.nth(i)).toHaveCSS('touch-action', 'pan-x')
    }
    const evidence = tracks.first()
    await expect(evidence.locator('[data-carousel-pane]')).toHaveCount(2)
  })

  test('a blocked distribution renders as a statement, not an empty pane', async ({ page }) => {
    // AAPL: probabilities sum to 125% across two horizons.
    const six = card(page, 'six-cases')
    await six.locator('[data-carousel-dot="weight"]').click()
    await expect(six.locator('[data-testid="distribution-blocked"]')).toBeVisible()

    // AMZN: no probabilities at all — a different statement, not a degraded
    // chart, and the pane is still there.
    const amzn = card(page, 'scenario-above-bull')
    await amzn.locator('[data-carousel-dot="weight"]').click()
    await expect(amzn.locator('[data-testid="distribution-empty"]')).toBeVisible()
    // Scoped to the evidence carousel: the detail carousel beside it now
    // carries the judgment control and has panes of its own.
    await expect(amzn.locator('[data-carousel-track]').first().locator('[data-carousel-pane]')).toHaveCount(2)
  })

test.describe('artifacts', () => {
  for (const slug of CARDS) {
    test(`screenshot: ${slug}`, async ({ page }) => {
      await card(page, slug).screenshot({ path: `artifacts/cards/${slug}.png` })
    })
  }

  for (const slug of ['active-risk', 'scenario-price-bands', 'crowding-spread']) {
    test(`screenshot: ${slug} price pane`, async ({ page }) => {
      await card(page, slug).locator('[data-carousel-dot="price"]').click()
      await page.waitForTimeout(600)
      await card(page, slug).screenshot({ path: `artifacts/cards/${slug}-price.png` })
    })
  }

  for (const slug of ['six-cases', 'scenario-above-bull']) {
    test(`screenshot: ${slug} conviction pane`, async ({ page }) => {
      await card(page, slug).locator('[data-carousel-dot="weight"]').click()
      await page.waitForTimeout(600)
      await card(page, slug).screenshot({ path: `artifacts/cards/${slug}-conviction.png` })
    })
  }

  // The panes a stale target hangs off. Both are reached by paging, so neither
  // appears in the card screenshot above, and the horizon pane in particular is
  // the one that has to be looked at rather than asserted: whether two
  // durations read as two durations is not a property a test can state.
  test('screenshot: target-expired horizon pane', async ({ page }) => {
    await card(page, 'target-expired').locator('[data-carousel-dot="horizon"]').click()
    await page.waitForTimeout(600)
    await card(page, 'target-expired').screenshot({ path: 'artifacts/cards/target-expired-horizon.png' })
  })

  test('screenshot: target-expired verdict pane', async ({ page }) => {
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(600)
    // Chosen, not merely offered. The control grows by a preview line and a
    // send button on the first tap, and that taller state is the one that has
    // to survive the disclosure region's height.
    await c.locator('[data-verdict="target_replace_with_cases"]').click()
    await page.waitForTimeout(300)
    await c.screenshot({ path: 'artifacts/cards/target-expired-verdict.png' })
  })

  test('screenshot: feed scroll', async ({ page }) => {
    await page.locator('#feed').screenshot({ path: 'artifacts/cards/feed-stack.png' })
  })

  test('screenshot: viewport', async ({ page }) => {
    // What actually meets the eye on a 390x844 phone, unscrolled.
    await page.screenshot({ path: 'artifacts/cards/viewport-390.png' })
  })
})

test.describe('progressive disclosure', () => {
  test('a follow-on appears beneath the recorded judgment and is tappable', async ({ page }) => {
    // Rendered geometry, because the constraints jsdom cannot check are the
    // ones that matter here: the follow-on must sit BELOW the confirmation, be
    // a real touch target, and not push anything under the action bar.
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_replace_with_cases"]').click()
    await c.locator('[data-testid="verdict-send"]').click()

    const saved = c.locator('[data-testid="verdict-saved"]')
    await expect(saved).toBeVisible()
    const next = c.locator('[data-testid="verdict-next"]')
    await expect(next).toBeVisible()

    const savedBox = await saved.boundingBox()
    const nextBox = await next.boundingBox()
    // Beneath the acknowledgement, not in place of it: the judgment is the
    // contribution and the CTA is the offer.
    expect(nextBox!.y).toBeGreaterThanOrEqual(savedBox!.y)
    expect(nextBox!.height).toBeGreaterThanOrEqual(44)

    // Never underneath the sticky action bar.
    const bar = await c.locator('[data-slot="primary"]').boundingBox()
    expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(bar!.y + 1)
  })

  test('the recorded judgment can be corrected', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_still_valid"]').click()
    await c.locator('[data-testid="verdict-send"]').click()
    await expect(c.locator('[data-testid="verdict-saved"]')).toBeVisible()

    await c.locator('[data-testid="verdict-change"]').click()
    await expect(c.locator('[data-testid="verdict-options"]')).toBeVisible()
    await expect(c.locator('[data-testid="verdict-saved"]')).toHaveCount(0)
  })
})

test.describe('phase 6A semantics', () => {
  test('the case-vs-price card now carries its own judgment', async ({ page }) => {
    // It was the one signal in the feed with no way to respond, while
    // target-expired — which fires on a clock — carried its question.
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="scenario-below-bear"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)

    await expect(c.locator('[data-testid="verdict-bar"]')).toBeVisible()
    for (const k of ['scenario_thesis_intact', 'scenario_thesis_weaker', 'scenario_cases_outdated', 'scenario_needs_review']) {
      await expect(c.locator(`[data-verdict="${k}"]`)).toBeVisible()
    }
    // Four options stay a 2x2 with real targets on the densest card in the feed.
    const boxes = await c.locator('[data-verdict]').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { y: Math.round(r.y), h: r.height } }))
    expect(new Set(boxes.map(b => b.y)).size).toBe(2)
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44)
  })

  test('the target card asks about the target, not the thesis', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    // The card-level prompt reflects the signal: a horizon elapsed.
    await expect(c.locator('[data-slot="prompt"]')).toContainText('Is this target still your view?')
    // And the card primary still corresponds to the SIGNAL, not to any answer.
    await expect(c.locator('[data-slot="primary"]')).toContainText('Review target')

    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    for (const k of ['target_still_valid', 'target_revise', 'target_replace_with_cases', 'target_needs_review']) {
      await expect(c.locator(`[data-verdict="${k}"]`)).toBeVisible()
    }
  })

  test('replacing a target with cases offers the cases surface', async ({ page }) => {
    // The follow-on that survives deduplication here: the action bar already
    // offers `review_target`, so only a DIFFERENT destination is worth showing.
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_replace_with_cases"]').click()
    await c.locator('[data-testid="verdict-send"]').click()
    await expect(c.locator('[data-testid="verdict-next"]')).toHaveAttribute('data-next-label', 'Review cases')
  })

  test('a target judgment that duplicates the card primary shows no inline CTA', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_revise"]').click()
    await c.locator('[data-testid="verdict-send"]').click()
    await expect(c.locator('[data-testid="verdict-saved"]')).toBeVisible()
    // `review_target` is already the persistent primary a few pixels below.
    await expect(c.locator('[data-testid="verdict-next"]')).toHaveCount(0)
  })
})

test('the judgment leads the disclosure on a scenario card', async ({ page }) => {
  /**
   * Measured, because reasoning about it got the answer wrong twice.
   *
   * The verdict pane was added third in the detail carousel, behind the case
   * list. On a card carrying a ladder, a chart and six cases the indicator row
   * that switches to it rendered 184-246px BELOW the action bar — outside the
   * card, unreachable, on the highest-value signal in the feed.
   *
   * Putting the judgment first is also the better answer on its own terms: the
   * card exists to prompt a decision, and the cases are the supporting detail
   * behind it rather than the other way round.
   */
  await page.goto('/')
  await page.locator('[data-card="news"]').waitFor()
  for (const slug of ['scenario-below-bear', 'six-cases']) {
    const c = page.locator(`[data-card="${slug}"]`)
    const bar = await c.locator('[data-slot="primary"]').boundingBox()
    const verdict = await c.locator('[data-testid="verdict-bar"]').boundingBox()
    expect(verdict, `${slug} has no visible judgment control`).not.toBeNull()
    expect(verdict!.y, `${slug} judgment sits below the action bar`).toBeLessThan(bar!.y)
  }
})

/**
 * Phase 7: the unreviewed-change signal, as the reader meets it.
 *
 * The unit tests prove the RULE. These prove the two cards say different things
 * on a phone — which is the failure mode that matters, because both are built
 * by the same builder from the same shape and would happily converge on one
 * voice without anything failing.
 */
test.describe('unreviewed change', () => {
  test('the moved card names the change, not the silence', async ({ page }) => {
    const c = card(page, 'unreviewed-move')
    const text = await c.innerText()
    // "AAPL is going stale" is a fact about the app. This has to be about AAPL.
    expect(text).not.toMatch(/going stale|has gone quiet/i)
    expect(text).toMatch(/moved 18%/)
    expect(text).toMatch(/since anyone last looked/)
  })

  test('the size-driven card does not claim an event that did not happen', async ({ page }) => {
    const text = await card(page, 'unreviewed-size').innerText()
    expect(text).toMatch(/7\.5% position/)
    // Nothing moved here. Event language would send the reader looking for news
    // that does not exist, which is worse than the card not appearing at all.
    expect(text).not.toMatch(/moved|since anyone last looked/i)
  })

  test('the card draws the gap it is about rather than counting it', async ({ page }) => {
    // The claim is "nobody has looked since X". X has to be on the axis, or the
    // reader is being asked to take the whole argument on trust.
    await expect(card(page, 'unreviewed-move').locator('text=Last look').first()).toBeVisible()
  })

  test('why this surfaced states the ingredients, because the rule is composite', async ({ page }) => {
    const c = card(page, 'unreviewed-move')
    await c.locator('[data-slot="menu"]').click()
    const menu = c.locator('[data-slot="menu-panel"]')
    await expect(menu).toBeVisible()
    const text = await menu.innerText()
    expect(text).toMatch(/18% price move/)
    expect(text).toMatch(/48 days/)
  })

  test('the judgment asks about the change and records in one tap', async ({ page }) => {
    const c = card(page, 'unreviewed-move')
    const bar = c.locator('[data-testid="verdict-options"]')
    await expect(bar).toBeVisible()
    // Three answers, matched to the trigger. No fourth added for symmetry.
    await expect(bar.locator('[data-verdict]')).toHaveCount(3)
    await bar.locator('[data-verdict="change_accounted_for"]').click()
    await c.locator('[data-testid="verdict-send"]').click()
    await expect(c.locator('[data-testid="verdict-saved"]')).toBeVisible()
  })

  test('every judgment control clears the touch minimum', async ({ page }) => {
    // The 30px regression came from a utility class silently overriding a
    // declared min-height, and was only ever found by measuring.
    const buttons = card(page, 'unreviewed-move').locator('[data-testid="verdict-options"] [data-verdict]')
    for (let i = 0; i < await buttons.count(); i++) {
      const box = await buttons.nth(i).boundingBox()
      expect(box!.height, `verdict button ${i} rendered ${box!.height}px`).toBeGreaterThanOrEqual(44)
    }
  })
})

/**
 * Phase 8: the ranking, as rendered.
 *
 * The unit suite proves the model. This proves the fixture actually renders the
 * order the model produces — the gap that let a scenario card render in its own
 * block above the feed for six phases without any test noticing.
 */
test.describe('feed ranking fixture', () => {
  const ids = async (page: import('@playwright/test').Page) =>
    page.locator('[data-rank-row]').evaluateAll(els =>
      els.map(e => e.getAttribute('data-rank-row')))

  test('the most consequential unresolved issue leads', async ({ page }) => {
    expect((await ids(page))[0]).toBe('ceg-gap')
  })

  test('a fresh 30% news card still ranks last', async ({ page }) => {
    // Case 3, end to end. Newest and largest thing on the page.
    const order = await ids(page)
    expect(order.indexOf('amzn-news')).toBeGreaterThan(order.indexOf('tsla-stale'))
    expect(order.indexOf('amzn-news')).toBeGreaterThan(order.indexOf('proj-late'))
  })

  test('the bigger position leads on an identical gap', async ({ page }) => {
    const order = await ids(page)
    expect(order.indexOf('aapl-notarget')).toBeLessThan(order.indexOf('roku-notarget'))
  })

  test('tiers are ordered, never interleaved', async ({ page }) => {
    const tiers = await page.locator('[data-rank-row]').evaluateAll(els =>
      els.map(e => Number(e.getAttribute('data-tier'))))
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
  })

  test('a confirmed-current card is shown as suppressed, not silently dropped', async ({ page }) => {
    // A card that vanished is indistinguishable from one never generated, and
    // that difference is the whole acknowledgment policy.
    await expect(page.locator('[data-suppressed-row="meta-confirmed"]')).toBeVisible()
    expect(await ids(page)).not.toContain('meta-confirmed')
  })

  test('an acknowledged-but-unresolved card is back and demoted', async ({ page }) => {
    const order = await ids(page)
    expect(order).toContain('googl-ack')
    // Below the gap nobody has answered, despite being the same signal type.
    expect(order.indexOf('googl-ack')).toBeGreaterThan(order.indexOf('ceg-gap'))
  })

  test('score components are visible for debugging', async ({ page }) => {
    const row = page.locator('[data-rank-row="ceg-gap"]')
    await expect(row).toContainText('materiality')
    await expect(row).toContainText('deviation')
  })
})
