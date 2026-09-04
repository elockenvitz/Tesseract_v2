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

const CARDS = ['active-risk-real', 'six-cases', 'long-label', 'scenario-below-bear', 'scenario-at-expected', 'scenario-above-bull', 'active-risk', 'active-risk-sparkline', 'scenario-price-bands', 'crowding-spread', 'weight-series', 'conviction-cohort', 'idea-trade', 'idea-thought', 'awaiting-review', 'recommendation', 'target-expired', 'no-target', 'unreviewed-move', 'unreviewed-size', 'news',
  // The capital fixtures, added once the gallery began mounting the panes
  // the feed gives them. Before that they were plain cards the feed cannot
  // produce, and holding them to these rules measured the harness.
  'portfolio-unwritten-position', 'portfolio-unwritten-immaterial',
  'portfolio-written-material'] as const

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

    test(`${slug}: has the action slots it should, and no more`, async ({ page }) => {
      const c = card(page, slug)
      // Slots, not labels. Housekeeping moved behind the menu, so the bar
      // carries at most two inline actions plus the primary — asserting literal
      // strings broke the moment a builder reworded one.
      await expect(c.locator('[data-slot="menu"]')).toHaveCount(1)
      await expect(c.locator('[data-slot="primary"]')).toHaveCount(1)
      // `Open TICKER` is gone from the bar. It gave the decision a third of the
      // width and put two ways of leaving the card either side of it; it is now
      // the first entry in the actions sheet. `card.actions.open` is still on
      // the contract — the sheet reads its label and href.
      await expect(c.locator('[data-slot="open"]')).toHaveCount(0)
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
          // Same opt-in, same reason: the case ladder pages sideways so it does
          // not need a vertical scroller, which is the gesture the feed owns.
          if (e.hasAttribute('data-hpager')) continue
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
    await expect(c.getByText('Dismiss')).toBeVisible()
    /**
     * The reason is stated, and no longer asked for.
     *
     * The menu opens with `provenance.reason` under its own heading, so the old
     * "Why am I seeing this" item sat directly beneath the answer to its own
     * question — and every call site in the feed wired it to a no-op. The
     * answer stayed; the control went.
     */
    await expect(c.locator('[data-slot="menu-reason"]')).toBeVisible()
    await expect(c.getByText('Why am I seeing this')).toHaveCount(0)
  })

  test('the case detail opens in place, without navigating', async ({ page }) => {
    const c = card(page, 'scenario-below-bear')
    // Open by default, and it cannot grow the card: the article is h-full
    // overflow-hidden and this region is flex-1 min-h-0 overflow-y-auto, so it
    // absorbs exactly the slack and no more.
    const detail = c.locator('[data-testid="case-detail"]')
    await expect(detail).toHaveCount(1)
    /**
     * The prose pane shows the top cases and SAYS how many it did not.
     *
     * It used to column-wrap the whole ladder into a horizontal pager, which
     * fixed the height and created a worse problem: a sideways scroller inside
     * a pane the carousel already pages sideways. Two nested horizontal
     * scrollers is a gesture nobody can aim.
     *
     * So it is bounded with a stated remainder. Nothing is hidden — the ladder
     * pane beside it draws every case — only the prose for the rest.
     */
    const rows = detail.locator('[data-testid="case-row"], > div')
    expect(await rows.count()).toBeGreaterThan(0)
    const text = await detail.innerText()
    if (/\+\d+ more case/.test(text)) {
      expect(text).toMatch(/\+\d+ more cases? on the asset/)
    }
    // The invariant is that opening the detail never grows the card. Whether
    // the region itself scrolls depends on how many cases there are — TSLA's
    // three fit, AAPL's six do not — so asserting it always scrolls was
    // asserting the fixture, not the rule.
    const article = c.locator('article')
    const grew = await article.evaluate(el => el.scrollHeight > el.clientHeight + 1)
    expect(grew).toBe(false)
    // No toggle to close it with any more: the detail is part of the card
    // rather than a disclosure. The 44px control cost more height than most of
    // what it hid.
    await expect(c.locator('[data-slot="detail-toggle"]')).toHaveCount(0)
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
    // One dot per COORDINATE, each naming itself.
    //
    // The axis carried no labels for a long time — six of them could not fit a
    // 390px line and every packing attempt moved a collision instead of
    // removing it — so identity lived in a chip row underneath and the reader
    // mapped chips back onto anonymous dots. Staggering the labels by index
    // removes the collision instead of relocating it, and the chip row went
    // with it: once every dot is named, a second list is the same list.
    const ladder = card(page, 'six-cases').locator('[data-testid="scenario-ladder"]')
    await expect(ladder).toHaveCount(1)
    await expect(ladder.locator('[data-testid="ladder-dot"]')).toHaveCount(6)
    await expect(ladder.locator('[data-testid="ladder-tape"]')).toHaveCount(1)
    await expect(ladder.locator('[data-testid="ladder-legend-item"]')).toHaveCount(0)

    // Six is past the point where labels fit. They stagger across two rows, so
    // at three coordinates the only pair sharing a row is the two ends — 74px
    // apart at the tightest. At six the same-row gap measured 1px: not
    // overlapping by a rectangle test, and unreadable. Printing six names on a
    // 358px line names none of them, so a dense axis carries marks and the
    // label belongs to whatever is selected.
    const labels = ladder.locator('[data-testid="ladder-dot-label"]')
    await expect(labels).toHaveCount(0)
    await ladder.locator('[data-testid="ladder-dot"]').last().click()
    await expect(labels).toHaveCount(1)
    await expect(labels.filter({ hasText: '$500' })).toHaveCount(1)

    // Three still names every one of them.
    const three = card(page, 'scenario-below-bear').locator('[data-testid="scenario-ladder"]')
    await expect(three.locator('[data-testid="ladder-dot-label"]')).toHaveCount(3)

    // Every MARK is the same size: 11 of 30 rows in this corpus have no
    // probability, so encoding it in diameter would make a missing weight
    // indistinguishable from a real one. Measured on the mark rather than on
    // its button, which now sizes to the label it carries.
    const sizes = await ladder.locator('[data-testid="ladder-dot"] span[aria-hidden]')
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
    /**
     * Same exemption, same reason, as the sibling rule above.
     *
     * `long-label` is a synthetic stress fixture — the AMZN card with a
     * deliberately over-long headline — and it carries no detail region, so
     * there is nothing to fill the space its fixed evidence band leaves. It is
     * already listed as a THIN_CLAIM there.
     *
     * Exempted rather than accommodated: growing the band or padding the card
     * to satisfy a fixture would put real dead space on real cards, which is
     * the defect this rule exists to catch.
     */
    const THIN_FIXTURES = new Set(['long-label'])

    for (const slug of CARDS) {
      if (THIN_FIXTURES.has(slug)) continue
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

  test('every card is the height the resolver gave it', async ({ page }) => {
    /**
     * Replaces "every card is one of four declared heights".
     *
     * That rule was right for a tier table and is meaningless now: heights come
     * from `resolveTile(requirement, container)`, so they are as various as the
     * compositions are. `active-risk-real` at 691px is not a violation, it is
     * the system working.
     *
     * What must still hold is that the number is DECIDED rather than emergent,
     * and that the card occupies exactly what was reserved for it — the
     * property windowing depends on. The gallery publishes the resolved value
     * on each wrapper, so the two can be compared directly.
     */
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#feed [data-card]')].map(el => ({
        slug: el.getAttribute('data-card'),
        resolved: Number(el.getAttribute('data-card-resolved')),
        actual: Math.round((el as HTMLElement).getBoundingClientRect().height),
      })))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.resolved, `${r.slug} has no resolved height`).toBeGreaterThan(0)
      expect(r.actual, `${r.slug}: resolved ${r.resolved}, occupies ${r.actual}`)
        .toBe(r.resolved)
    }
    /**
     * And every one is the same: one tile, one screen.
     *
     * This asserted that heights VARY, which was right while a tile could be
     * shorter than the feed. It cannot be any more — on a snap-start scroller
     * a short tile shows the top of its neighbour, and two tiles on screen at
     * once is the thing product direction rules out. So the resolver floors
     * and caps at the container, and what varies is `requested`, which lives
     * in the calibration suite where it can be compared to what a composition
     * actually needs.
     */
    expect(new Set(rows.map(r => r.resolved)).size).toBe(1)
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
    await expect(c.locator('[data-testid="target-review-consequence"]')).toBeVisible()
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

  test('the price pane scrubs on hold and returns to latest on release', async ({ page }) => {
    /**
     * Two properties, and one is the bug that started this.
     *
     * `onPointerUp` used to clear the gesture and release capture but never
     * clear the picked datum, so lifting a finger left the crosshair and the
     * price frozen on a day in April while the card read as current — the worst
     * failure available to a number somebody might act on.
     *
     * The second is newer: a swipe over the chart belongs to the carousel, so
     * the crosshair only engages after a deliberate hold.
     *
     * Driven with dispatched pointer events. `page.mouse` does not deliver to
     * this element in headless Chromium — instrumented listeners on the SVG
     * recorded zero events from a move/down at its own boundingBox — which is
     * the same class of harness limit the gesture suite documents for touch.
     * What is exercised is the real handler at real coordinates.
     */
    const c = card(page, 'active-risk')
    await c.locator('[data-carousel-dot="price"]').click()
    const chart = c.locator('[data-testid="price-chart"]')
    const readout = c.locator('[data-testid="price-readout"]')
    await chart.scrollIntoViewIfNeeded()
    const latest = (await readout.textContent())!

    const fire = (type: string, frac: number) => chart.evaluate((el, [t, f]) => {
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent(t as string, {
        bubbles: true, pointerId: 1,
        clientX: b.left + b.width * (f as number), clientY: b.top + b.height / 2,
      }))
    }, [type, frac] as const)

    // A quick swipe must NOT scrub — that gesture pages the carousel.
    await fire('pointerdown', 0.85)
    await fire('pointermove', 0.4)
    expect(await chart.getAttribute('data-scrubbing'), 'a swipe engaged the crosshair').toBe('false')
    await fire('pointerup', 0.4)

    // A hold does.
    await fire('pointerdown', 0.85)
    await page.waitForTimeout(320)
    expect(await chart.getAttribute('data-scrubbing')).toBe('true')
    await fire('pointermove', 0.12)
    await expect(readout, 'holding did not move the read-out off the latest close')
      .not.toHaveText(latest)

    await fire('pointerup', 0.12)
    await expect(readout, 'the read-out stayed on the scrubbed close after release')
      .toHaveText(latest)
  })

  test('an interrupted scrub also returns to the latest close', async ({ page }) => {
    // pointercancel and lostpointercapture are the two paths with no pointerup
    // at all: the browser can take capture back without one.
    const c = card(page, 'active-risk')
    await c.locator('[data-carousel-dot="price"]').click()
    const chart = c.locator('[data-testid="price-chart"]')
    const readout = c.locator('[data-testid="price-readout"]')
    await chart.scrollIntoViewIfNeeded()
    const latest = (await readout.textContent())!

    await chart.evaluate(el => {
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 1, clientX: b.left + b.width * 0.85, clientY: b.top + b.height / 2 }))
    })
    await page.waitForTimeout(320)
    await chart.evaluate(el => {
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 1, clientX: b.left + b.width * 0.12, clientY: b.top + b.height / 2 }))
    })
    await expect(readout).not.toHaveText(latest)

    await chart.evaluate(el => el.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })))
    await expect(readout).toHaveText(latest)
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
    /**
     * ONE track, which is the change this asserts as much as the gesture rule.
     *
     * There were two — an evidence carousel and a detail carousel — because the
     * fixture rendered `evidence` and `detail` as separate regions. The feed has
     * composed a single carousel since the panes were merged, so the guard was
     * measuring a card with two indicator rows that the app does not produce.
     *
     * `pan-x pan-y`, not `pan-x`. The narrower value meant "this element pans
     * horizontally and nothing else", so a finger landing on a carousel — which
     * is most of a card — could not scroll the feed at all. Allowing both lets
     * the browser arbitrate on the gesture's own direction, which it does
     * better than a JavaScript threshold.
     */
    const tracks = c.locator('[data-carousel-track]')
    await expect(tracks).toHaveCount(1)
    await expect(tracks.first()).toHaveCSS('touch-action', 'pan-x pan-y')
    // Ladder, Respond, Cases. No price pane on this fixture, which has no
    // series — the pane is omitted rather than paging to "no chart".
    await expect(tracks.first().locator('[data-carousel-pane]')).toHaveCount(3)
  })

  /**
   * The probability problem is stated beside the CASES, not on a pane of its own.
   *
   * `Conviction` and `Reweight` rendered only when a ladder carried usable
   * probabilities, so the card's pane COUNT changed with the data and two extra
   * pages sat between the decision and its evidence. What they said is now on
   * the Cases pane, next to the cases each number belongs to, with the control
   * that repairs it.
   */
  test('a blocked distribution is stated on the cases pane, not on one of its own', async ({ page }) => {
    // AAPL: probabilities sum to 125% across two horizons.
    const six = card(page, 'six-cases')
    await expect(six.locator('[data-carousel-dot="weight"]')).toHaveCount(0)
    await six.locator('[data-carousel-dot="cases"]').click()
    await page.waitForTimeout(400)
    const invalid = six.locator('[data-slot="invalid-probabilities"]')
    await expect(invalid).toBeVisible()
    await expect(six.locator('[data-slot="fix-probabilities"]')).toBeVisible()

    // AMZN: no probabilities at all — a different statement and a different
    // repair, and neither is a chart nobody can read.
    const amzn = card(page, 'scenario-above-bull')
    await amzn.locator('[data-carousel-dot="cases"]').click()
    await page.waitForTimeout(400)
    await expect(amzn.locator('[data-slot="no-probabilities"]')).toBeVisible()
    await expect(amzn.locator('[data-slot="add-probabilities"]')).toBeVisible()
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

  /**
   * The RESPOND pane, chosen rather than merely offered.
   *
   * Replaces the conviction-pane shots: that pane is gone, and this is the one
   * the card exists for. Photographed with an answer selected, because the
   * consequence line and the note placeholder both change on the first tap and
   * the footer becomes `Submit response` — the state worth looking at.
   */
  for (const slug of ['six-cases', 'scenario-above-bull']) {
    test(`screenshot: ${slug} respond pane`, async ({ page }) => {
      const c = card(page, slug)
      await c.locator('[data-carousel-dot="verdict"]').click()
      await page.waitForTimeout(600)
      await c.locator('[data-verdict="scenario_cases_outdated"]').click()
      await page.waitForTimeout(300)
      await c.screenshot({ path: `artifacts/cards/${slug}-respond.png` })
    })
  }

  // The panes a stale target hangs off. Both are reached by paging, so neither
  // appears in the card screenshot above, and the horizon pane in particular is
  // the one that has to be looked at rather than asserted: whether two
  // durations read as two durations is not a property a test can state.
  test('screenshot: target-expired verdict pane', async ({ page }) => {
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(600)
    // Chosen, not merely offered — the consequence line and the note prompt
    // both change on the first tap, and that state is the one worth looking at.
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
    // Moved off `target_expired`, which no longer ends at a checkmark: its
    // resolutions open a flow and the sticky footer is the only primary. The
    // saved-then-offered grammar is still the model for every other kind.
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    /* `unreviewed-move`, because the scenario card no longer carries
       `VerdictBar` at all — its response is `ScenarioRespond` and its commit is
       the sticky footer. This grammar is still the model for every kind whose
       judgment is complete on its own, which is most of them. Its verdict
       carousel holds one pane, so there are no dots to page to: `CardCarousel`
       returns early below two panes. */
    const c = page.locator('[data-card="unreviewed-move"]')
    await c.locator('[data-verdict="view_needs_update"]').click()
    await c.locator('[data-testid="verdict-send"]').click()

    const saved = c.locator('[data-testid="verdict-saved"]')
    await expect(saved).toBeVisible()
    const savedBox = await saved.boundingBox()
    // Never underneath the sticky action bar.
    const bar = await c.locator('[data-slot="primary"]').boundingBox()
    expect(savedBox!.y).toBeLessThanOrEqual(bar!.y + 1)
  })

  /**
   * Backing out of a flow leaves the investment view untouched.
   *
   * Selection no longer commits anything at all, so there is nothing to
   * "correct" on this card — the flow is opened by the footer and abandoned by
   * Cancel, and neither writes. That is the stronger property.
   */
  test('abandoning a target flow changes nothing', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_still_valid"]').click()
    await c.locator('[data-slot="primary"]').click()
    await expect(c.locator('[data-testid="target-review-editor"]')).toBeVisible()

    await c.locator('[data-testid="target-review-back"]').click()
    await expect(c.locator('[data-testid="target-review-options"]')).toBeVisible()
    await expect(c.locator('[data-testid="target-review-editor"]')).toHaveCount(0)
  })

  /**
   * The same correction path, on a card that still ends at a checkmark.
   *
   * Moved off the scenario card: that one no longer carries `VerdictBar` at
   * all — its response is `ScenarioRespond` and its commit is the sticky
   * footer. `unreviewed-move` is a `VerdictBar` card and keeps this covered,
   * which matters because the affordance is still the model for every kind
   * whose judgment is complete on its own.
   */
  test('a completed judgment can be corrected in place', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="unreviewed-move"]')
    // One pane in its verdict carousel, so there is no dot to page to.
    await c.locator('[data-testid="verdict-options"] [role="radio"]').first().click()
    await c.locator('[data-testid="verdict-send"]').click()
    await expect(c.locator('[data-testid="verdict-saved"]')).toBeVisible()

    await c.locator('[data-testid="verdict-change"]').click()
    await expect(c.locator('[data-testid="verdict-options"]')).toBeVisible()
    await expect(c.locator('[data-testid="verdict-saved"]')).toHaveCount(0)
  })
})

test.describe('phase 6A semantics', () => {
  /**
   * The card still carries its own judgment; the CONTROL changed.
   *
   * It was `VerdictBar` with an in-body Apply. The card's sticky footer already
   * offers a primary, so that was two commit-shaped controls about 150px apart
   * with nothing to say which was authoritative. The answers, their keys and
   * their dispositions are untouched — see `scenario-review.test.ts`, which
   * pins them — and the full flow is in `e2e/case-vs-price.spec.ts`.
   */
  test('the case-vs-price card carries its own judgment, under the footer contract', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="scenario-below-bear"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)

    await expect(c.locator('[data-testid="scenario-respond"]')).toBeVisible()
    for (const k of ['scenario_thesis_intact', 'scenario_thesis_weaker', 'scenario_cases_outdated', 'scenario_needs_review']) {
      await expect(c.locator(`[data-verdict="${k}"]`)).toBeVisible()
    }
    // The commit lives in the one action bar, not in the body.
    await expect(c.locator('[data-testid="verdict-send"]')).toHaveCount(0)
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Submit response')
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
    // The footer IS the offer now — there is no inline follow-on to dedupe
    // against, because there is no inline action at all. "Review cases", not
    // "Build cases": every name with an expired target already has a ladder.
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_replace_with_cases"]').click()
    const primary = c.locator('[data-slot="primary"]')
    await expect(primary).toHaveText('Review cases')
    await expect(primary).toHaveAttribute('data-action-id', 'open_cases')
  })

  /**
   * Revising opens the editor rather than offering a link to one.
   *
   * This used to assert the absence of an inline CTA, because `review_target`
   * was already the persistent primary a few pixels below. That is still true
   * and is now stronger: the follow-on is not a button at all, it is the editor
   * itself, in the pane the reader is already looking at.
   */
  test('revising a target opens the editor from the footer, in place', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
    const c = page.locator('[data-card="target-expired"]')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    await c.locator('[data-verdict="target_revise"]').click()
    // Selection alone opens nothing — the footer does.
    await expect(c.locator('[data-testid="target-review-editor"]')).toHaveCount(0)
    await c.locator('[data-slot="primary"]').click()
    await expect(c.locator('[data-testid="target-review-editor"]'))
      .toHaveAttribute('data-surface', 'revise_target')
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
    // `scenario-respond`, not `verdict-bar`: the control changed, the position
    // it has to hold did not. See `e2e/case-vs-price.spec.ts` for the flow.
    const verdict = await c.locator('[data-testid="scenario-respond"]').boundingBox()
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
    // The copy gained a sign and a decimal, and it names WHOSE silence it
    // means: "since anyone last looked" was about the app, "since its thesis
    // was last written" is about the case. Both are improvements on what this
    // was written against, so the assertion moved to them.
    expect(text).toMatch(/moved \+18\.4%/)
    expect(text).toMatch(/since its thesis was last written/)
  })

  test('the size-driven card does not claim an event that did not happen', async ({ page }) => {
    const text = await card(page, 'unreviewed-size').innerText()
    // "7.5% position" became "7.5% of Core Equity" — the same number, told
    // which book it is 7.5% OF, which is the half a reader needs.
    expect(text).toMatch(/7\.5% of Core Equity/)
    // Nothing moved here. Event language would send the reader looking for news
    // that does not exist, which is worse than the card not appearing at all.
    expect(text).not.toMatch(/moved|since anyone last looked/i)
  })

  test('the card draws the gap it is about rather than counting it', async ({ page }) => {
    /**
     * The principle is unchanged; both halves of it had rotted.
     *
     * The axis marker is labelled "Case written" now, not "Last look" — the
     * anchor is when the case was WRITTEN, and `anchorVerb` made every surface
     * say so. And the chart itself had stopped rendering at all: the builder
     * declared no evidence, so `SignalCardView`'s gate dropped whatever chart
     * its caller passed. Both cards asserted here are about the tape, so both
     * have to draw it — that is what this test has always been for.
     */
    await expect(
      card(page, 'unreviewed-move').locator('[data-testid="price-chart"]').first(),
    ).toBeVisible()
    // The marked anchor, on the card whose window reaches back far enough to
    // contain it. This is the "since when" the claim rests on.
    await expect(card(page, 'unreviewed-size')).toContainText(/Case written/i)
  })

  test('why this surfaced states the ingredients, because the rule is composite', async ({ page }) => {
    const c = card(page, 'unreviewed-move')
    await c.locator('[data-slot="menu"]').click()
    const menu = c.locator('[data-slot="menu-panel"]')
    await expect(menu).toBeVisible()
    const text = await menu.innerText()
    // Both ingredients, at the precision the panel actually states. The day
    // count reads as a pattern rather than a literal, which is what let the
    // old `48 days` rot into a failure when the fixture's anchor moved.
    expect(text).toMatch(/18\.4% price move/)
    expect(text).toMatch(/case last written \d+ days ago/)
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

/**
 * Phase 8.1: the feed owns vertical, and nothing inside a card competes for it.
 *
 * These are geometry assertions on purpose. Every scroll-conflict defect in
 * this project's history looked correct in the DOM and in the computed styles;
 * all of them were found by measuring what actually rendered.
 */
test.describe('scroll ownership', () => {
  test('no card contains a vertical scroller', async ({ page }) => {
    // The hard rule. A second vertical scroll owner inside a vertical snap feed
    // makes every upward drag ambiguous, and the browser resolves that in
    // favour of the inner scroller — so the feed simply stops advancing.
    const offenders = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('[data-card]'))) {
        for (const n of Array.from(el.querySelectorAll('*'))) {
          const e = n as HTMLElement
          const oy = getComputedStyle(e).overflowY
          if (oy !== 'auto' && oy !== 'scroll') continue
          // `overflow-x: auto` forces the computed `overflow-y` to `auto` too,
          // so every horizontal pager reports as a vertical scroller. What
          // matters is whether it can actually scroll vertically — that is what
          // competes with the feed for the gesture.
          if (e.scrollHeight <= e.clientHeight + 1) continue
          bad.push(`${el.getAttribute('data-card')}: ${e.tagName.toLowerCase()}` +
            `${e.dataset.testid ? '#' + e.dataset.testid : ''}`)
        }
      }
      return bad
    })
    expect(offenders, `vertical scrollers inside cards: ${offenders.join(', ')}`).toEqual([])
  })

  test('no card clips content beneath its action bar', async ({ page }) => {
    // The other half of removing the scrollers: content that used to be
    // reachable by scrolling must now FIT, not be hidden. Measured as the
    // lowest rendered content against the top of the action bar.
    const clipped = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('[data-card]'))) {
        const bar = el.querySelector('[data-slot="primary"]')!.closest('div')!
        const barTop = bar.getBoundingClientRect().top
        for (const n of Array.from(el.querySelectorAll('p, h2, [data-testid]'))) {
          const e = n as HTMLElement
          if (bar.contains(e) || !e.offsetHeight) continue
          const over = e.getBoundingClientRect().bottom - barTop
          if (over > 4) bad.push(`${el.getAttribute('data-card')}: ${e.tagName.toLowerCase()}` +
            `${e.dataset.testid ? '#' + e.dataset.testid : ''} +${Math.round(over)}px`)
        }
      }
      return bad
    })
    expect(clipped, `content below the action bar: ${clipped.join(', ')}`).toEqual([])
  })

  test('a vertical swipe over the target control still advances the feed', async ({ page }) => {
    // The target pane was one of the regions that trapped the gesture.
    const start = await page.evaluate(() => {
      const feed = document.getElementById('feed')!
      const c = document.querySelector('[data-card="no-target"]') as HTMLElement
      feed.scrollTop = c.offsetTop
      return feed.scrollTop
    })
    await page.waitForTimeout(300)
    const tuner = page.locator('[data-card="no-target"] [data-testid="target-tuner"]')
    const box = (await tuner.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(800)
    const after = await page.evaluate(() => document.getElementById('feed')!.scrollTop)
    expect(after - start, 'the feed did not advance from over the target control').toBeGreaterThan(400)
  })
})

test.describe('no price target card', () => {
  const c = (page: import('@playwright/test').Page) => card(page, 'no-target')

  test('says what is actually missing', async ({ page }) => {
    const text = await c(page).innerText()
    // A listed stock has a price. What it does not have is a recorded target.
    expect(text).not.toMatch(/unpriced/i)
    expect(text).not.toMatch(/real position with no price/i)
    expect(text).not.toMatch(/no price on it/i)
    expect(text).toMatch(/no price target on record/i)
  })

  test('does not call it a first target', async ({ page }) => {
    await c(page).locator('[data-carousel-dot="tune"]').click()
    const text = await c(page).innerText()
    expect(text).not.toMatch(/first target/i)
    expect(text).toMatch(/price target/i)
  })

  test('asks whether a target is needed, not how the position is valued', async ({ page }) => {
    const text = await c(page).innerText()
    expect(text).not.toMatch(/how is this position being valued/i)
    expect(text).toMatch(/does this position need a price target/i)
  })

  test('reaches the target editor by paging, not by scrolling', async ({ page }) => {
    await c(page).locator('[data-carousel-dot="tune"]').click()
    const tuner = c(page).locator('[data-testid="target-tuner"]')
    await expect(tuner).toBeVisible()
    // Fully inside the card, not half under the action bar.
    const cardBox = (await c(page).boundingBox())!
    const bar = (await c(page).locator('[data-slot="primary"]').boundingBox())!
    const box = (await tuner.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1)
    expect(box.y).toBeGreaterThanOrEqual(cardBox.y - 1)
  })

  test('the chart and the target control coexist as panes', async ({ page }) => {
    await expect(c(page).locator('[data-testid="price-chart"]').first()).toBeVisible()
    await expect(c(page).locator('[data-carousel-dot="tune"]')).toBeVisible()
    await expect(c(page).locator('[data-carousel-dot="verdict"]')).toBeVisible()
  })
})

test.describe('portfolio context', () => {
  /**
   * A portfolio name opens a sheet, the same gesture as "more".
   *
   * It used to expand a panel under the chip, which pushed the card's own
   * content down and cost height on a surface that has exactly one screen — so
   * the panel had to cap itself at four rows and state a remainder. A sheet has
   * none of those constraints and, more importantly, makes the two disclosures
   * on this card behave alike: both are "show me more about this".
   *
   * Queried from the page, not the card: the sheet portals to document.body.
   */
  const c = (page: import('@playwright/test').Page) => card(page, 'no-target')
  const open = async (page: import('@playwright/test').Page) => {
    const chip = c(page).locator('[data-slot="context-disclose"]').first()
    // Not "In 2 portfolios": the preposition went when the chip stopped being
    // inert text and became the disclosure control — see the note beside it in
    // `SignalCardView`. The count is what the reader taps, and what this needs.
    await expect(chip).toContainText('2 portfolios')
    await chip.click()
    return page.locator('[data-slot="portfolio-disclosure"]')
  }

  test('tapping the label opens a sheet rather than navigating', async ({ page }) => {
    await expect(page.locator('[data-slot="portfolio-disclosure"]')).toHaveCount(0)
    await expect(await open(page)).toBeVisible()
    // Still on the card behind it — nothing navigated.
    await expect(c(page).locator('[data-testid="price-chart"]').first()).toBeVisible()
  })

  test('the portfolio count names the portfolios', async ({ page }) => {
    await open(page)
    const rows = page.locator('[data-slot="portfolio-row"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Core Equity')
    await expect(rows.nth(1)).toContainText('Large Cap Growth')
  })

  test('navigation is an explicit action per portfolio', async ({ page }) => {
    await open(page)
    const openBtn = page.locator('[data-slot="portfolio-open"]')
    await expect(openBtn).toHaveCount(2)
    await expect(openBtn.first()).toHaveText(/Open/)
  })

  test('the card underneath does not move', async ({ page }) => {
    // The whole reason for the sheet: an inline panel pushed the card around.
    const before = (await c(page).boundingBox())!
    await open(page)
    const after = (await c(page).boundingBox())!
    expect(Math.abs(after.height - before.height)).toBeLessThan(2)
    expect(after.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT + 1)
  })
})

test.describe('commentary drawer', () => {
  /**
   * "More" opens a sheet, not an expansion.
   *
   * The in-card overlay it replaces was capped at 70% of a fixed-height tile,
   * so long commentary was still clipped with no way to reach the rest. A card
   * is exactly one viewport and cannot grow, which makes it the wrong container
   * for text of unknown length. The sheet is an overlay rather than part of the
   * snap feed, so its scroller competes with nothing.
   */
  const DRAWER_CARD = 'recommendation'

  const openDrawer = async (page: import('@playwright/test').Page) => {
    /**
     * A card whose body is genuinely long.
     *
     * This used to be `six-cases`, a scenario card — and the scenario body is
     * now one sentence by design: the old one ran to 240 characters and the
     * card clamped it mid-word, so the part carrying the argument was the part
     * nobody read. A card with nothing to clamp shows no "More", which is
     * correct, and left this suite asserting a drawer that should not exist.
     * The drawer is a `SignalCardView` feature rather than a scenario one, so
     * any card with commentary exercises it.
     */
    const c = card(page, DRAWER_CARD)
    const toggle = c.locator('[data-slot="body-toggle"]')
    await expect(toggle).toBeVisible()
    await toggle.click()
    return c
  }

  test('More opens a drawer without resizing the card', async ({ page }) => {
    const before = (await card(page, DRAWER_CARD).boundingBox())!
    const c = await openDrawer(page)
    await expect(page.locator('[data-slot="body-drawer"]')).toBeVisible()
    // The card underneath is untouched — same height as before the drawer
    // opened, which is the point of the assertion.
    // Pinned to the card's own measurement rather than to one viewport, which
    // stopped being the same statement once a card can be 416 or 736px.
    const box = (await c.boundingBox())!
    expect(Math.abs(box.height - before.height)).toBeLessThan(2)
  })

  test('the drawer shows the full commentary and its provenance', async ({ page }) => {
    await openDrawer(page)
    const drawer = page.locator('[data-slot="body-drawer"]')
    // Not a duplicate of the card: the body in full, plus what the face has no
    // room for.
    await expect(drawer.locator('p').first()).not.toBeEmpty()
    expect((await drawer.innerText()).length).toBeGreaterThan(80)
  })

  test('the drawer owns a vertical scroller, and the card still does not', async ({ page }) => {
    await openDrawer(page)
    // The one legitimate exception to the single-scroll-owner rule, because it
    // is an overlay rather than a member of the snap feed.
    const cardScrollers = await card(page, 'six-cases').evaluate(el => {
      let n = 0
      for (const e of Array.from(el.querySelectorAll('*'))) {
        const h = e as HTMLElement
        const oy = getComputedStyle(h).overflowY
        if ((oy === 'auto' || oy === 'scroll') && h.scrollHeight > h.clientHeight + 1) n++
      }
      return n
    })
    expect(cardScrollers).toBe(0)
  })

  test('closing restores the card and leaves the feed where it was', async ({ page }) => {
    const c = await openDrawer(page)
    // The feed's own offset, not the card's viewport y. Clicking scrolls the
    // target into view, so an absolute position says where Playwright put the
    // page rather than whether the surface moved under the reader.
    const feedTop = () => page.evaluate(() => document.getElementById('feed')!.scrollTop)
    const before = { top: await feedTop(), h: (await c.boundingBox())!.height }

    // Dispatched rather than clicked: the sheet renders in a portal at the end
    // of the document, and Playwright scrolls a click target into view — which
    // would move the feed itself and make this assert the harness.
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[aria-label="Close"]'))
      ;(buttons[buttons.length - 1] as HTMLElement).click()
    })
    await expect(page.locator('[data-slot="body-drawer"]')).toHaveCount(0)

    expect(await feedTop(), 'the feed scrolled while the drawer was open').toBe(before.top)
    expect(Math.abs((await c.boundingBox())!.height - before.h)).toBeLessThan(2)
  })
})

test.describe('the judgment always fits', () => {
  /**
   * Reported from a phone: the question was visible and the buttons that
   * answer it were not.
   *
   * The cause was a priority inversion in the flex column. The evidence band
   * was `shrink-0` at a fixed height while the region holding the question and
   * its answers was `flex-1 min-h-0`, so whenever a card ran out of room the
   * CHART kept every pixel and the controls were what got clipped. A card
   * exists to be answered; the chart is support.
   */
  test('every answer control sits above the action bar', async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('[data-card]'))) {
        const bar = el.querySelector('[data-slot="primary"]')!.closest('div')!
        const barTop = bar.getBoundingClientRect().top
        for (const b of Array.from(el.querySelectorAll('[data-verdict]'))) {
          const r = b.getBoundingClientRect()
          if (r.bottom > barTop + 1) {
            out.push(`${el.getAttribute('data-card')}: ${b.getAttribute('data-verdict')} +${Math.round(r.bottom - barTop)}px`)
          }
          // And still a real touch target once the region is under pressure.
          if (r.height < 44) {
            out.push(`${el.getAttribute('data-card')}: ${b.getAttribute('data-verdict')} only ${Math.round(r.height)}px tall`)
          }
        }
      }
      return out
    })
    expect(bad, `answer controls out of reach: ${bad.join(', ')}`).toEqual([])
  })

  test('no card leaves a squeezable region between the question and the actions', async ({ page }) => {
    /**
     * The structural rule that replaces reserving height.
     *
     * The card had an evidence band at a fixed height and, below the question, a
     * second region holding the controls — and that lower region was the one
     * with `flex-1`, so it was the one that gave up space when a card ran out.
     * Reserving height for it fixed the symptom and made every card rigid.
     *
     * The better answer is that there is no second region: the chart, the
     * editor and the response are all interactive, so they page together in the
     * band that already has the height. Where a card still has a lower detail
     * region, it must at least not be the thing that collapses.
     */
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('[data-card]'))) {
        const detail = el.querySelector('[data-testid="card-detail"]') as HTMLElement | null
        if (!detail) continue
        // A lower region that exists must still be able to show its content.
        if (detail.scrollHeight > detail.clientHeight + 1) {
          out.push(`${el.getAttribute('data-card')}: detail clipped by ` +
            `${Math.round(detail.scrollHeight - detail.clientHeight)}px`)
        }
      }
      return out
    })
    expect(bad, `content clipped below the question: ${bad.join(', ')}`).toEqual([])
  })
})

test.describe('carousel indicators', () => {
  /**
   * Dots, not a row of labelled pills.
   *
   * Every pane used to carry its own uppercase pill. With two that was legible;
   * with five — chart, ladder, cases, target, respond — they collapsed into
   * four-letter stubs that named nothing. Reported as "cramped and illegible",
   * which is what a label becomes when it has no room to be one.
   */
  const carded = (page: import('@playwright/test').Page) => card(page, 'six-cases')

  test('names only the pane you are on', async ({ page }) => {
    const row = carded(page).locator('[data-testid="carousel-indicators"]').first()
    const dots = row.locator('[data-carousel-dot]')
    expect(await dots.count()).toBeGreaterThan(1)
    // Exactly one label visible, however many panes there are.
    const labels = (await row.innerText()).split(String.fromCharCode(10)).map(t => t.trim()).filter(Boolean)
    expect(labels).toHaveLength(1)
  })

  test('every dot is a real touch target', async ({ page }) => {
    // The mark is 5-7px; the button around it is what the thumb hits.
    const dots = carded(page).locator('[data-testid="carousel-indicators"]').first()
      .locator('[data-carousel-dot]')
    for (let i = 0; i < await dots.count(); i++) {
      const box = (await dots.nth(i).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(24)
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
  })

  test('a drag across the row scrubs through the panes', async ({ page }) => {
    /**
     * One gesture instead of four taps end to end.
     *
     * Driven with dispatched pointer events rather than `page.mouse`, which
     * does not reliably produce the capture the handler relies on in headless
     * Chromium — the same limitation the gesture suite documents for touch.
     * What is exercised is the real handler, at real coordinates.
     */
    const c = carded(page)
    const row = c.locator('[data-testid="carousel-indicators"] > div').first()
    await row.scrollIntoViewIfNeeded()
    const before = await c.locator('[data-testid="carousel-indicators"]').first().innerText()

    await row.evaluate(el => {
      const b = el.getBoundingClientRect()
      const y = b.top + b.height / 2
      const fire = (type: string, x: number) => el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }))
      fire('pointerdown', b.left + 4)
      for (let i = 1; i <= 10; i++) fire('pointermove', b.left + (b.width - 8) * (i / 10))
      fire('pointerup', b.right - 4)
    })
    await page.waitForTimeout(300)

    expect(await c.locator('[data-testid="carousel-indicators"]').first().innerText(),
      'the dot row did not move the panes').not.toBe(before)
  })

  test('the row does not steal the vertical feed gesture', async ({ page }) => {
    // `touch-action: none` is safe on a strip of dots because there is nothing
    // to scroll inside it — but it must not sit on anything larger.
    const row = carded(page).locator('[data-testid="carousel-indicators"] > div').first()
    const box = (await row.boundingBox())!
    expect(box.height).toBeLessThan(48)
  })
})

test.describe('chart and caption geometry', () => {
  test('the chart fills its box instead of overflowing it', async ({ page }) => {
    /**
     * An <svg> is a replaced element with an intrinsic aspect ratio from its
     * viewBox — 1:1 here — so without an explicit size it resolves its HEIGHT
     * from its width. A refactor dropped `h-full w-full` and a 318x117 plot box
     * rendered a 318x318 chart with the bottom two thirds cut off. Nothing else
     * in the suite noticed, because the line was still drawn.
     */
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const svg of Array.from(document.querySelectorAll('[data-testid="price-chart"]'))) {
        const box = svg.getBoundingClientRect()
        const parent = (svg.parentElement as HTMLElement).getBoundingClientRect()
        if (box.height > parent.height + 1) {
          out.push(`${Math.round(box.height)}px chart in a ${Math.round(parent.height)}px box`)
        }
      }
      return out
    })
    expect(bad, `charts overflowing their plot box: ${bad.join(', ')}`).toEqual([])
  })

  test('a clamped caption is always tappable', async ({ page }) => {
    /**
     * The ellipsis and the tap handler must agree.
     *
     * The handler was gated on `card.body.length > 150` while the clamp applied
     * to every body, so a 130-character body wrapped to three lines, showed an
     * ellipsis and did nothing when tapped. Clamping is now measured from the
     * DOM, which is the only thing that knows how the text actually wrapped.
     */
    const mismatch = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('[data-card]'))) {
        const p = el.querySelector('article > div > div.relative > p') as HTMLElement | null
        if (!p) continue
        const clamped = p.scrollHeight > p.clientHeight + 1
        const tappable = p.dataset.slot === 'body-toggle'
        if (clamped && !tappable) out.push(`${el.getAttribute('data-card')}: clipped but not tappable`)
      }
      return out
    })
    expect(mismatch, mismatch.join(', ')).toEqual([])
  })
})

/**
 * The actions bar, after `Open TICKER` moved into the sheet.
 *
 * Part of the same change as the footer-slot rule above, kept separate because
 * these are about what the bar now GIVES the decision rather than what it no
 * longer holds.
 */
test.describe('the decision gets the bar', () => {
  test('two buttons, and the primary is the wider of them', async ({ page }) => {
    await page.goto('/')
    const c = card(page, 'scenario-below-bear')
    const bar = c.locator('[data-slot="actions"]')
    // Exactly two: the actions button and the decision. A third was `Open
    // TICKER`, which took a third of the width for navigation.
    await expect(bar.locator('button')).toHaveCount(2)

    const quick = (await bar.locator('[data-slot="quick"]').boundingBox())!
    const primary = (await bar.locator('[data-slot="primary"]').boundingBox())!
    expect(primary.width).toBeGreaterThan(quick.width)
  })

  test('the actions button is named Actions, not Capture', async ({ page }) => {
    await page.goto('/')
    const quick = card(page, 'scenario-below-bear').locator('[data-slot="quick"]')
    await expect(quick).toHaveText('Actions')
  })

  test('both buttons clear the safe-area inset', async ({ page }) => {
    // The bar reserves `env(safe-area-inset-bottom)`; on iOS the home indicator
    // sits over the last ~34px and a button ending flush with the card was a
    // button whose bottom third could not be tapped.
    await page.goto('/')
    const c = card(page, 'scenario-below-bear')
    const box = (await c.boundingBox())!
    for (const slot of ['quick', 'primary']) {
      const b = (await c.locator(`[data-slot="${slot}"]`).boundingBox())!
      expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1)
      expect(b.height).toBeGreaterThanOrEqual(40)
    }
  })
})

/**
 * The Case-vs-Price polish pass, at the viewport it was reported from.
 *
 * Each of these was true on a phone while the unit suite stayed green: a repair
 * line clipped below the pane edge, and two unlabelled prices on one card.
 */
test.describe('case vs price, on a phone', () => {
  test('the probability line sits inside its pane, not under it', async ({ page }) => {
    await page.goto('/')
    const c = card(page, 'six-cases')
    const row = c.locator('[data-slot="no-probabilities"], [data-slot="invalid-probabilities"]')
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()

    const r = (await row.boundingBox())!
    const pane = (await c.locator('[data-testid="case-detail"]').boundingBox())!
    // The message telling the reader their probabilities need fixing was the
    // one thing on the pane they could not read.
    expect(r.y + r.height).toBeLessThanOrEqual(pane.y + pane.height + 1)
  })

  test('every case still lists beside it', async ({ page }) => {
    // The alternative fix was dropping a case row, which would have hidden a
    // scenario to make room for a message about scenarios.
    await page.goto('/')
    const rows = card(page, 'scenario-above-bull').locator('[data-testid="case-detail"] >> text=/^(Bear|Base|Bull)$/')
    expect(await rows.count()).toBeGreaterThanOrEqual(3)
  })

  test('the pane introduces no vertical scroller', async ({ page }) => {
    await page.goto('/')
    const bad = await card(page, 'six-cases').locator('[data-testid="case-detail"]').evaluate(el => {
      for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
        const e = n as HTMLElement
        const st = getComputedStyle(e)
        if (/auto|scroll/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) return true
      }
      return false
    })
    expect(bad).toBe(false)
  })

  test('the chart readout carries no qualifier', async ({ page }) => {
    // "CLOSE" was added to distinguish this readout from the quote a scenario
    // card computes against, and it bought less than it cost: a fourth piece of
    // text in a header already carrying a ticker, a number, a change and six
    // range chips, explaining a distinction most cards do not have.
    await page.goto('/')
    const c = card(page, 'scenario-price-bands')
    await c.locator('[data-testid="price-readout"]').scrollIntoViewIfNeeded()
    await expect(c.locator('[data-testid="price-readout-label"]')).toHaveCount(0)
  })
})

/**
 * The expired-target card, redesigned around three panes.
 *
 * These are rendered-geometry and rendered-flow claims, which is why they are
 * here rather than in the component test: pane count is a carousel fact, the
 * footer is a sticky bar measured against the card, and "no nested scroll" is
 * only answerable from real layout.
 */
test.describe('target expired: evidence, then resolution', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-card="news"]').waitFor()
  })

  const review = async (page: import('@playwright/test').Page) => {
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="verdict"]').click()
    await page.waitForTimeout(400)
    return c
  }

  test('two panes — PRICE and REVIEW', async ({ page }) => {
    const c = card(page, 'target-expired')
    const dots = c.locator('[data-carousel-dot]')
    await expect(dots).toHaveCount(2)
    expect(await dots.evaluateAll(els => els.map(e => e.getAttribute('data-carousel-dot'))))
      .toEqual(['price', 'verdict'])
    // The horizon pane repeated the header and answered no question. THEN vs
    // NOW would have replaced it, and the data does not support one.
    await expect(c.locator('[data-testid="horizon-timeline"]')).toHaveCount(0)
  })

  test('the price pane leads with the distance to the target', async ({ page }) => {
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="price"]').click()
    await page.waitForTimeout(300)
    await expect(c.locator('[data-testid="price-compare"]'))
      .toHaveAttribute('data-compare-label', 'Target')
    /**
     * The window return is NOT part of the resting card.
     *
     * It used to be, and human review on a real phone called it out: a third
     * kind of number — "+11.2% 6M" — sitting between the two date stamps in
     * the smallest type on the card, answering no question the reader asked.
     * The card's claim is the distance to the expired target and the header
     * carries it; the window return is secondary and now appears where it is
     * actually about something, which is while the reader scrubs the series.
     */
    await expect(c.locator('[data-testid="price-window-return"]')).toHaveCount(0)
  })

  test('scrubbing the series reveals the window return', async ({ page }) => {
    const c = card(page, 'target-expired')
    await c.locator('[data-carousel-dot="price"]').click()
    await page.waitForTimeout(300)
    const plot = c.locator('[data-testid="price-chart"]')
    const box = (await plot.boundingBox())!
    /**
     * A mouse inspects on HOVER — `onPointerMove` picks directly for
     * `pointerType === 'mouse'`, with no press and no hold timer. A touch
     * pointer has to clear `GESTURE.CHART_HOLD_MS` first, which is the
     * arbitration that keeps a scroll from becoming a scrub.
     */
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 })
    await expect(c.locator('[data-testid="price-window-return"]')).toBeVisible()
  })

  test('the review body carries no primary action of its own', async ({ page }) => {
    const c = await review(page)
    await c.locator('[data-verdict="target_still_valid"]').click()
    // ONE primary mechanism, and it is the sticky footer.
    await expect(c.locator('[data-testid="verdict-send"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="target-review-note"]')).toBeVisible()
  })

  test('the footer offers nothing actionable until an answer is chosen', async ({ page }) => {
    const c = await review(page)
    const primary = c.locator('[data-slot="primary"]')
    await expect(primary).toHaveAttribute('data-primary-source', 'pane')
    await expect(primary).toHaveText('Choose an answer')
    await expect(primary).toBeDisabled()
  })

  test('the footer becomes the chosen answer own CTA', async ({ page }) => {
    const c = await review(page)
    const primary = c.locator('[data-slot="primary"]')
    const pairs: [string, string][] = [
      ['target_still_valid', 'Refresh horizon'],
      ['target_revise', 'Revise target'],
      ['target_replace_with_cases', 'Review cases'],
      ['target_needs_review', 'Keep open'],
    ]
    for (const [key, cta] of pairs) {
      await c.locator(`[data-verdict="${key}"]`).click()
      await expect(primary).toHaveText(cta)
    }
    // Back on the evidence, the card's own primary returns.
    await c.locator('[data-carousel-dot="price"]').click()
    await page.waitForTimeout(400)
    await expect(primary).toHaveText('Review target')
  })

  test('the note keeps its place and only its prompt changes', async ({ page }) => {
    const c = await review(page)
    const note = c.locator('[data-testid="target-review-note"]')
    const boxes: number[] = []
    const prompts: [string, RegExp][] = [
      ['target_still_valid', /why does the view still hold/i],
      ['target_revise', /what changed/i],
      ['target_needs_review', /what still needs work/i],
    ]
    for (const [key, prompt] of prompts) {
      await c.locator(`[data-verdict="${key}"]`).click()
      await expect(note).toHaveAttribute('placeholder', prompt)
      boxes.push(Math.round((await note.boundingBox())?.y ?? -1))
    }
    // A surface that reflows while somebody is deciding is one they stop
    // trusting: the field does not move between selections.
    expect(new Set(boxes).size).toBe(1)
  })

  test('selecting an answer opens nothing and changes nothing', async ({ page }) => {
    const c = await review(page)
    await c.locator('[data-verdict="target_still_valid"]').click()
    // Opening a flow is not completing it — and selection does not even open one.
    await expect(c.locator('[data-testid="target-review-editor"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="target-review-options"]')).toBeVisible()
  })

  test('Keep target asks only for a horizon, and Cancel keeps the answer', async ({ page }) => {
    const c = await review(page)
    await c.locator('[data-verdict="target_still_valid"]').click()
    await c.locator('[data-testid="target-review-note"]').fill('still holds')
    await c.locator('[data-slot="primary"]').click()

    await expect(c.locator('[data-testid="target-review-editor"]'))
      .toHaveAttribute('data-surface', 'refresh_horizon')
    // The number is kept, so it is not editable.
    await expect(c.locator('[data-testid="revise-target-input"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="revise-horizons"]')).toBeVisible()

    await c.locator('[data-testid="target-review-back"]').click()
    // Cancel mutates nothing and costs the reader no work.
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Refresh horizon')
    await expect(c.locator('[data-testid="target-review-note"]')).toHaveValue('still holds')
  })

  test('Revise target opens the editor and requires a fresh horizon', async ({ page }) => {
    const c = await review(page)
    await c.locator('[data-verdict="target_revise"]').click()
    await c.locator('[data-slot="primary"]').click()
    await expect(c.locator('[data-testid="revise-target-input"]')).toBeVisible()

    await c.locator('[data-testid="revise-target-input"]').fill('400')
    // A new number under the horizon that already expired resolves nothing.
    await expect(c.locator('[data-testid="revise-save"]')).toBeDisabled()
    await c.locator('[data-revise-horizon="12 months"]').click()
    await expect(c.locator('[data-testid="revise-save"]')).toBeEnabled()
    // The chips name their reference.
    await expect(c.getByText(/from current price/i)).toBeVisible()
  })

  test('the editor fits and introduces no vertical scroller', async ({ page }) => {
    const c = await review(page)
    await c.locator('[data-verdict="target_revise"]').click()
    await c.locator('[data-slot="primary"]').click()
    await expect(c.locator('[data-testid="revise-target"]')).toBeVisible()

    const nested = await c.evaluate(el => {
      for (const n of Array.from(el.querySelectorAll('*'))) {
        const e = n as HTMLElement
        const st = getComputedStyle(e)
        if (/auto|scroll/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) return true
      }
      return false
    })
    expect(nested).toBe(false)

    const save = await c.locator('[data-testid="revise-save"]').boundingBox()
    const bar = await c.locator('[data-slot="actions"]').boundingBox()
    expect(save!.y + save!.height).toBeLessThanOrEqual(bar!.y + 1)
  })

  test('the header states the overdue age once, and names it', async ({ page }) => {
    const c = card(page, 'target-expired')
    await expect(c.getByText('Overdue, past its horizon')).toBeVisible()
    await expect(c.locator('h2')).toContainText('$245.00 target')
    await expect(c.locator('h2')).toContainText('12-month horizon')
  })
})

/**
 * The harness renders what the feed renders.
 *
 * ── Why this suite exists ─────────────────────────────────────────────────
 *
 * A density pass measured the capital fixtures at 19-35% ink with 185-271px
 * dead bands, concluded the feed had a hole, and spent most of a stage on it.
 * The hole was in the gallery: those fixtures mounted a plain card with no
 * panes, and an insight entry in the feed ALWAYS receives a case pane. The
 * fixture was a second implementation, and nothing was comparing the two.
 *
 * These assertions are that comparison. They are about composition CAPABILITY
 * rather than pixels, so they fail when a fixture stops representing the feed
 * and not merely when a layout moves.
 */
test.describe('harness fidelity', () => {
  const hasRegion = (page: import('@playwright/test').Page, slug: string, sel: string) =>
    card(page, slug).locator(sel).count()

  test('a capital insight card carries its case pane', async ({ page }) => {
    // The invariant the gallery used to break. `CasePane` renders the section
    // presence rows, so their absence means the fixture is a plain card again.
    for (const slug of ['portfolio-unwritten-position', 'portfolio-unwritten-immaterial',
                        'portfolio-written-material']) {
      expect(await hasRegion(page, slug, '[data-slot="case-pane"], [data-testid="case-pane"]'),
        `${slug} lost its case pane`).toBeGreaterThan(0)
    }
  })

  test('a ladder-capable scenario card carries its ladder', async ({ page }) => {
    for (const slug of ['scenario-below-bear', 'six-cases', 'scenario-price-bands']) {
      expect(await hasRegion(page, slug, '[data-carousel-track]'),
        `${slug} lost its ladder carousel`).toBeGreaterThan(0)
    }
  })

  test('a card offers the response its plan promises', async ({ page }) => {
    /**
     * Corrected twice, which is the point of writing it down.
     *
     * It first asserted news and desk posts were PANE-LESS. That was true of
     * the fixture and false of the feed — the news branch mounts a Respond
     * pane whenever the story names a symbol the desk holds an asset record
     * for, and the idea branch mounts one whenever the post names an asset.
     * Measuring the pane-less version put news at 53% ink with a 101px band;
     * the faithful one is 74% with 21px.
     *
     * It then asserted a visible verdict BAR, which is also wrong: whether the
     * judgment renders as a pane in the carousel or as an engaged band that
     * takes the whole region is `SignalCardView`'s own presentation rule, and
     * it differs by card type. Both are the same promise kept two ways.
     *
     * So the assertion is the promise: a family whose plan carries a verdict
     * offers a route to it. How it draws that is the component's business.
     */
    const RESPONSE_ROUTE = '[data-testid="verdict-bar"], [data-slot="engage"], [data-slot="prompt"]'
    for (const slug of ['news', 'idea-trade', 'idea-thought']) {
      expect(await hasRegion(page, slug, RESPONSE_ROUTE),
        `${slug} offers no way to respond; its plan says it carries a verdict`).toBeGreaterThan(0)
    }
  })

  test('a long post is reachable past the two-line clamp', async ({ page }) => {
    /**
     * `ideaPanePlan` gives a post its own pane once the body passes
     * `IDEA_POST_PANE_MIN_BODY`: the card clamps to two lines, so a longer
     * post has a tail that is otherwise unreachable.
     *
     * Only `idea-trade` is asserted here, and the reason is worth recording:
     * `idea-thought` renders NO body region at all — a thought's headline is
     * its post, so there is no clamp to escape and the plan correctly gives it
     * no Post pane. Asserting both would have pinned a premise the card does
     * not hold. The threshold itself is covered where it can be computed
     * exactly, in `pane-plan.test.ts`.
     */
    expect(await hasRegion(page, 'idea-trade',
      '[data-carousel-track], [data-slot="body-more"], [data-slot="body-toggle"]'),
      'idea-trade clamps its post with no way to read the rest').toBeGreaterThan(0)
  })

  test('a collapsed slot reserves the same box as a mounted one', async ({ page }) => {
    /**
     * The windowing half. Sizing is resolved from the entry before mount, so a
     * slot that has never rendered its card must still occupy the box that
     * card will need — otherwise a deep offset means two different things
     * depending on how the reader got there.
     */
    const viewport = page.locator('#window-viewport')
    await viewport.scrollIntoViewIfNeeded()
    await page.locator('[data-feed-slot]').first().waitFor()
    const rows = await viewport.evaluate(el =>
      [...el.querySelectorAll('[data-feed-slot]')].map(s => ({
        state: s.getAttribute('data-feed-slot'),
        resolved: Number(s.getAttribute('data-slot-resolved')),
        actual: (s as HTMLElement).offsetHeight,
      })))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      // What the resolver decided is what the slot occupies, in either state.
      expect(r.actual, `slot resolved ${r.resolved} but occupies ${r.actual}`).toBe(r.resolved)
    }
    // Both states are present, or the assertion proves nothing.
    expect(new Set(rows.map(r => r.state)).size).toBeGreaterThan(1)
    // Slots of the same resolved height agree exactly, mounted or collapsed.
    const byHeight = new Map<number, Set<number>>()
    for (const r of rows) {
      if (!byHeight.has(r.resolved)) byHeight.set(r.resolved, new Set())
      byHeight.get(r.resolved)!.add(r.actual)
    }
    for (const [resolved, actuals] of byHeight) {
      expect(actuals.size, `slots resolved at ${resolved} occupy ${[...actuals].join(', ')}`).toBe(1)
    }
  })
})
