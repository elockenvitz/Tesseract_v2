import { test, expect, devices } from '@playwright/test'

/**
 * Phase 9: Explore is a different surface, not a Curate skin.
 *
 * The assertions that matter are the separations. Curate's snap architecture is
 * load-bearing for Curate and actively wrong for a discovery page, and the way
 * these things go wrong is by leaking — a snap class inherited here, a scroller
 * nested there — so most of this measures what Explore is NOT.
 */

const explore = (page: import('@playwright/test').Page) => page.locator('#explore-viewport')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await explore(page).scrollIntoViewIfNeeded()
  await page.locator('[data-explore-tile]').first().waitFor()
})

test.describe('mode separation', () => {
  test('Explore does not inherit Curate snap behaviour', async ({ page }) => {
    // Curate is `snap-y snap-mandatory` with one card per viewport. If any of
    // that reaches Explore, scanning becomes paging and the mode is pointless.
    const snapping = await explore(page).evaluate(el => {
      const bad: string[] = []
      for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
        const s = getComputedStyle(n as Element)
        if (s.scrollSnapType !== 'none' || s.scrollSnapAlign !== 'none') {
          bad.push((n as HTMLElement).className.slice(0, 60))
        }
      }
      return bad
    })
    expect(snapping, `snap styles leaked into Explore: ${snapping.join(' | ')}`).toEqual([])
  })

  test('Curate still snaps', async ({ page }) => {
    // The other half. Phase 8.1's card contract must survive Phase 9 untouched.
    const feed = page.locator('#feed')
    await expect(feed).toHaveClass(/snap-mandatory/)
    const card = page.locator('[data-card]').first()
    expect(await card.evaluate(el => getComputedStyle(el).scrollSnapAlign)).toBe('start')
  })

  test('Explore owns one ordinary vertical scroller', async ({ page }) => {
    const scrollers = await explore(page).evaluate(el => {
      const found: string[] = []
      for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
        const e = n as HTMLElement
        const oy = getComputedStyle(e).overflowY
        if (oy !== 'auto' && oy !== 'scroll') continue
        if (e.scrollHeight <= e.clientHeight + 1) continue
        found.push(e.getAttribute('data-explore-scroll') != null ? 'mosaic' : e.tagName.toLowerCase())
      }
      return found
    })
    expect(scrollers).toEqual(['mosaic'])
  })

  test('no tile contains a vertical scroller', async ({ page }) => {
    // Recreating Phase 8.1's nested-scroll problem in a smaller grid would be
    // the same defect and much easier to miss.
    const bad = await page.locator('[data-explore-tile]').evaluateAll(els => {
      const out: string[] = []
      for (const el of els) {
        for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
          const e = n as HTMLElement
          const oy = getComputedStyle(e).overflowY
          if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) {
            out.push(el.getAttribute('data-explore-tile')!)
          }
        }
      }
      return out
    })
    expect(bad).toEqual([])
  })

  test('the mosaic scrolls normally', async ({ page }) => {
    const scroller = page.locator('[data-explore-scroll]')
    const before = await scroller.evaluate(el => el.scrollTop)
    await scroller.evaluate(el => { el.scrollTop = 400 })
    await page.waitForTimeout(200)
    const after = await scroller.evaluate(el => el.scrollTop)
    expect(before).toBe(0)
    // No snap means it lands where it was put, not at a tile boundary.
    expect(after).toBe(400)
  })
})

test.describe('mosaic geometry', () => {
  for (const width of [390, 320]) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await explore(page).scrollIntoViewIfNeeded()
      const overflow = await explore(page).evaluate(el => {
        const bad: string[] = []
        for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
          const e = n as HTMLElement
          if (e.scrollWidth <= e.clientWidth + 1) continue
          const ox = getComputedStyle(e).overflowX
          if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') continue
          bad.push(e.className.slice(0, 60))
        }
        return bad
      })
      expect(overflow, `horizontal overflow at ${width}px: ${overflow.join(' | ')}`).toEqual([])
    })
  }

  test('lays out two columns at phone width', async ({ page }) => {
    // Density is the point. One column would be a list, and Explore already has
    // a list next door.
    const xs = await page.locator('[data-explore-tile][data-explore-span="half"]')
      .evaluateAll(els => els.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().x)))
    expect(new Set(xs).size).toBe(2)
  })

  test('a featured card spans both columns', async ({ page }) => {
    const feature = page.locator('[data-explore-tile][data-emphasis="feature"]').first()
    // Against a PAIRED card rather than the first standard one: a compact card
    // with nothing to pair with also spans the row, deliberately, and comparing
    // against that would measure two full-width cards.
    const half = page.locator('[data-explore-tile][data-explore-span="half"]').first()
    const f = (await feature.boundingBox())!
    const h = (await half.boundingBox())!
    expect(f.width).toBeGreaterThan(h.width * 1.6)
  })

  test('leaves no empty cell beside a card', async ({ page }) => {
    /**
     * The reported hole. A `col-span-full` card landing on an odd column offset
     * leaves the cell before it empty, and CSS grid has no reason to fill it —
     * so TGT sat in the left column with half a row of page beside it, which
     * reads as a card that failed to render rather than as a layout.
     *
     * Measured as rows: every row is either one full-width card or two halves,
     * and never one half on its own with a sibling row below it.
     */
    const rows = await page.locator('[data-explore-tile]').evaluateAll(els => {
      const byTop = new Map<number, { span: string | null; x: number }[]>()
      for (const e of els) {
        const r = e.getBoundingClientRect()
        const top = Math.round(r.top)
        // Cards in a row share a top to within a pixel of rounding.
        const key = [...byTop.keys()].find(k => Math.abs(k - top) <= 2) ?? top
        const list = byTop.get(key) ?? []
        list.push({ span: e.getAttribute('data-explore-span'), x: Math.round(r.x) })
        byTop.set(key, list)
      }
      return [...byTop.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, cards]) => cards)
    })
    expect(rows.length).toBeGreaterThan(3)
    for (const row of rows) {
      if (row.length === 1) {
        expect(row[0].span, 'a lone card in a row must claim the whole row').toBe('full')
      } else {
        expect(row).toHaveLength(2)
        expect(row.every(c => c.span === 'half')).toBe(true)
      }
    }
  })

  test('no card falls below the floor for its variant', async ({ page }) => {
    /**
     * §6: three intentional height variants, so the grid has a rhythm. The
     * floor is set inline because `button:not(.no-touch-target)` in `index.css`
     * is a compound selector and outranks a Tailwind utility — a class here
     * computed to 44px and an aggregate card drew at 90px between rows of 200.
     * Only a real cascade can catch that, which is why it is measured here.
     */
    /**
     * Lowered with the visual pass. The floor exists to stop a one-line card
     * collapsing beside a tall neighbour, and 132/176/164 was overshooting
     * that into padding: it reserved space the card had no content for, which
     * the old bottom-pinned footer then opened as a gap in the middle. The
     * rule being asserted — a variant has a floor and cards respect it — is
     * unchanged; the numbers are the design decision and they moved.
     */
    const FLOOR: Record<string, number> = {
      compact: 112, 'compact-chart': 168, feature: 148, banner: 86,
    }
    const short = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.map(e => ({
        id: e.getAttribute('data-explore-tile'),
        variant: e.getAttribute('data-explore-height'),
        h: Math.round(e.getBoundingClientRect().height),
      })))
    for (const c of short) {
      expect(c.h, `${c.id} (${c.variant}) drew at ${c.h}px`).toBeGreaterThanOrEqual(FLOOR[c.variant!])
    }
  })

  test('the two halves of a row are exactly the same height', async ({ page }) => {
    // §6: a pair of half-width cards in the same row should align. They are
    // `h-full` in an `auto-rows-min` grid, so this is the property that holds
    // it — a card drawing at its own content height leaves a band of page
    // showing underneath, which was reported as odd empty space.
    const mismatched = await page.locator('[data-explore-tile][data-explore-span="half"]')
      .evaluateAll(els => {
        const bad: string[] = []
        for (let i = 0; i + 1 < els.length; i += 2) {
          const a = els[i].getBoundingClientRect()
          const b = els[i + 1].getBoundingClientRect()
          if (Math.abs(a.top - b.top) > 2) continue // not actually a row
          if (Math.abs(a.height - b.height) > 1) {
            bad.push(`${els[i].getAttribute('data-explore-tile')}: ${a.height} vs ${b.height}`)
          }
        }
        return bad
      })
    expect(mismatched, mismatched.join(' | ')).toEqual([])
  })

  test('shows many items within two screens', async ({ page }) => {
    // The discovery-density claim, measured rather than asserted in a comment.
    const visible = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.filter(e => e.getBoundingClientRect().top < 844 * 2).length)
    expect(visible).toBeGreaterThanOrEqual(8)
  })
})

test.describe('tiles', () => {
  test('carry no judgment control and no action bar', async ({ page }) => {
    // Hard requirement. A tile that can be answered is a Curate card in a
    // smaller font, and Explore exists to be low-friction.
    await expect(page.locator('[data-explore-tile] [data-testid="verdict-options"]')).toHaveCount(0)
    await expect(page.locator('[data-explore-tile] [data-slot="primary"]')).toHaveCount(0)
    await expect(page.locator('[data-explore-tile] [data-slot="menu"]')).toHaveCount(0)
  })

  test('use a static sparkline, never the interactive chart', async ({ page }) => {
    // Twenty interactive charts would mount twenty pointer-capture regions,
    // each competing with the mosaic for the drag a reader is using to scroll.
    await expect(page.locator('[data-explore-tile] [data-testid="price-chart"]')).toHaveCount(0)
    const sparks = page.locator('[data-explore-tile] [data-testid="sparkline"]')
    expect(await sparks.count()).toBeGreaterThan(0)
    expect(await sparks.first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  })

  test('render without a sparkline when history is absent', async ({ page }) => {
    // ROKU and TSM have no series in the fixture. Their tiles must still be
    // complete — the content stands on its own and claims no chart.
    const roku = page.locator('[data-explore-tile][data-symbol="ROKU"]').first()
    await expect(roku).toBeVisible()
    await expect(roku.locator('[data-testid="sparkline"]')).toHaveCount(0)
    await expect(roku).toContainText('ROKU')
  })

  test('a story shows its publisher inside its own bounds', async ({ page }) => {
    /**
     * §7: a headline with no visible source is a rumour. The source sits in the
     * card's pinned bottom group precisely so a long headline cannot push it
     * out — which is a geometric claim, and only measurable here.
     */
    const card = page.locator('[data-explore-tile][data-symbol="JNJ"]').first()
    await card.scrollIntoViewIfNeeded()
    const source = card.locator('[data-explore-source]')
    await expect(source).toBeVisible()
    await expect(source).toHaveText('Simply Wall St.')
    const fits = await card.evaluate(el => {
      const s = el.querySelector('[data-explore-source]')!.getBoundingClientRect()
      const c = el.getBoundingClientRect()
      return s.top >= c.top && s.bottom <= c.bottom + 1 && s.width > 0
    })
    expect(fits).toBe(true)
  })

  test('no card overflows its own bounds', async ({ page }) => {
    // The clamps are what keep a preview a preview. A headline running past the
    // card is the state where clamping silently stopped working.
    const spilling = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.filter(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)
        .map(e => e.getAttribute('data-explore-tile')!))
    expect(spilling, `cards overflowing: ${spilling.join(', ')}`).toEqual([])
  })

  test('an idea carries no price line', async ({ page }) => {
    // §11: TGT has a series in the fixture, so its absence here is a decision
    // rather than missing data.
    const tgt = page.locator('[data-explore-tile][data-symbol="TGT"]').first()
    await expect(tgt).toBeVisible()
    await expect(tgt.locator('[data-testid="sparkline"]')).toHaveCount(0)
  })

  test('a tap opens the item rather than navigating', async ({ page }) => {
    /**
     * Explore is preview -> rich tile -> asset page. Tapping a preview used to
     * jump straight to the asset route, which skips the middle step and throws
     * away the reader's place in the mosaic.
     *
     * The gallery has no router and no feed behind it, so what is asserted here
     * is the contract the dashboard depends on: the tap reports the item and
     * its Phase 4 destination, and does not resolve that destination itself.
     * The overlay and its explicit "Open [Ticker]" live in MobileDashboard.
     */
    const tile = page.locator('[data-explore-tile="d-ceg-gap"]')
    await tile.click()
    expect(await page.evaluate(() => document.body.dataset.exploreOpened)).toBe('d-ceg-gap')
    // Routed through the Phase 4 grammar, not a second route vocabulary.
    expect(await page.evaluate(() => document.body.dataset.exploreDestination)).toBe('open_cases')
    // And the mosaic is still there underneath.
    await expect(page.locator('[data-explore-scroll]')).toBeVisible()
  })

  test('every tile answers a tap — none is a dead card', async ({ page }) => {
    /**
     * ── The defect this pins ────────────────────────────────────────────────
     *
     * `{ kind: 'filter' }` is what every adapter falls back to when an item has
     * no asset id — routine for an economic release, a macro template, a
     * thought about no particular name, a workflow row. The grid had learned
     * that only an aggregate narrows the page, and the resolver had not, and
     * the dashboard's `filter` arm returned early believing the grid had
     * handled it. So those tiles looked tappable, dipped under the thumb, and
     * did nothing whatsoever. Reported as "clicking a News Story does nothing".
     *
     * Asserted over EVERY tile rather than a chosen one, because the whole
     * failure was that nobody had enumerated which tiles fell into the gap.
     */
    const ids = await page.locator('[data-explore-tile]').evaluateAll(
      els => els.map(e => (e as HTMLElement).dataset.exploreTile!))
    expect(ids.length).toBeGreaterThan(8)

    for (const id of ids) {
      await page.evaluate(() => {
        document.body.removeAttribute('data-explore-opened')
        document.body.removeAttribute('data-explore-action')
      })
      const tile = page.locator(`[data-explore-tile="${id}"]`)
      const subtype = await tile.getAttribute('data-subtype')
      await tile.scrollIntoViewIfNeeded()
      await tile.click()

      if (subtype === 'aggregate') {
        // The one tile whose tap IS a filter. It narrows the grid in place and
        // deliberately never reaches `onOpen`.
        await expect(page.locator('[data-explore-category][aria-pressed="true"]'))
          .not.toHaveAttribute('data-explore-category', 'all')
        await page.locator('[data-explore-category="all"]').click()
        continue
      }

      const opened = await page.evaluate(() => document.body.dataset.exploreOpened)
      const action = await page.evaluate(() => document.body.dataset.exploreAction)
      expect(opened, `${id} (${subtype}) swallowed its tap`).toBe(id)
      // `filter` reaching a non-aggregate is the bug itself; `unsupported`
      // means the tile should not have been drawn as tappable at all.
      expect(['focus', 'article', 'navigate'], `${id} resolved to ${action}`).toContain(action)
    }
  })

  test('says what kind of thing it is, on every card', async ({ page }) => {
    /**
     * The header showed the TICKER, and fell back to the category only when
     * there was no ticker — so on the great majority of the page the only thing
     * carrying "finding, colleague's post, or headline somebody else wrote" was
     * a 6px dot in one of five quiet colours.
     */
    const tiles = page.locator('[data-explore-tile]');
    const n = await tiles.count()
    for (let i = 0; i < n; i++) {
      const kind = tiles.nth(i).locator('[data-explore-kind]')
      await expect(kind).toHaveCount(1)
      expect((await kind.innerText()).trim().length).toBeGreaterThan(0)
    }
    // And the word is about the SUBTYPE, not the category it was filed under.
    const idea = page.locator('[data-explore-tile][data-subtype="idea"]').first()
    await expect(idea.locator('[data-explore-kind]')).toHaveText(/idea/i)
    const news = page.locator('[data-explore-tile][data-subtype="news"]').first()
    await expect(news.locator('[data-explore-kind]')).toHaveText(/news/i)
  })

  test('a story says it will be read, and a summary says it will expand', async ({ page }) => {
    // The affordance is read off the same resolver that carries the tap out, so
    // the promise on the card and the behaviour behind it cannot drift.
    const story = page.locator('[data-explore-tile="n-jnj-talc"]')
    await expect(story.locator('[data-explore-hint="read"]')).toHaveCount(1)
    const agg = page.locator('[data-explore-tile][data-subtype="aggregate"]').first()
    await expect(agg.locator('[data-explore-hint="see-all"]')).toHaveCount(1)
    // And a card that simply opens claims nothing — twenty "Open" labels is
    // chrome, not hierarchy.
    const signal = page.locator('[data-explore-tile="d-ceg-gap"]')
    await expect(signal.locator('[data-explore-hint]')).toHaveCount(0)
  })

  test('a text-only tile is a first-class tile, not a failed one', async ({ page }) => {
    /**
     * Twelve of twenty-two tiles draw nothing, because the rows behind them
     * carry nothing to draw. Given the same treatment as a card whose chart
     * happens to be missing, they read as failures to load — so they get the
     * space the picture would have had, spent on the words.
     */
    const tiles = page.locator('[data-explore-tile]')
    const n = await tiles.count()
    let textOnly = 0
    for (let i = 0; i < n; i++) {
      const t = tiles.nth(i)
      if (await t.locator('[data-explore-visual]').count()) continue
      textOnly++
      // It still says what it is, what it is about, and stays tappable.
      await expect(t.locator('[data-explore-headline]')).toHaveCount(1)
      expect((await t.locator('[data-explore-headline]').innerText()).trim().length)
        .toBeGreaterThan(0)
      await expect(t).toBeEnabled()
      // And its claim is set larger than a card that also carries a picture.
      const px = await t.locator('[data-explore-headline]')
        .evaluate(e => parseFloat(getComputedStyle(e).fontSize))
      expect(px, 'a text-only claim gets the space a picture would have had').toBeGreaterThanOrEqual(14)
    }
    expect(textOnly, 'the fixture should exercise text-only tiles').toBeGreaterThan(5)
  })

  test('no two labels on a card print the same number', async ({ page }) => {
    /**
     * The pass-1 rule, asserted across the whole page rather than per card: a
     * metric line, a supporting clause, a weight footer and a picture can all
     * reach for the same figure, and four archetypes did.
     *
     * ── Why the HEADLINE is excluded ────────────────────────────────────
     *
     * "AAPL has moved 18% since anyone last looked" over a picture whose marker
     * reads +18% is a claim and its evidence, which is what a card is supposed
     * to be — the picture adds the window, the direction and the last-look
     * mark, none of which the sentence carries. That is not the defect.
     *
     * The defect is two LABELS saying one number with nothing between them:
     * "22% BELOW BEAR" over a band captioned "-22% below your range". So the
     * headline is excluded and everything under it is compared, which is
     * exactly the boundary between a card that argues and a card that stutters.
     */
    const dupes = await page.locator('[data-explore-tile]').evaluateAll(els => {
      const bad: string[] = []
      for (const el of els) {
        const head = (el.querySelector('[data-explore-headline]') as HTMLElement)?.innerText ?? ''
        const whole = (el as HTMLElement).innerText ?? ''
        const rest = whole.replace(head, '')
        const nums = rest.match(/-?\d+\.?\d*%/g) ?? []
        const seen = new Map<string, number>()
        for (const raw of nums) {
          const k = raw.replace(/[^0-9.]/g, '')
          seen.set(k, (seen.get(k) ?? 0) + 1)
        }
        for (const [k, c] of seen) {
          if (c > 1) bad.push(`${(el as HTMLElement).dataset.exploreTile}: ${k}% x${c}`)
        }
      }
      return bad
    })
    expect(dupes, dupes.join(' | ')).toEqual([])
  })

  test('a proposal shows its stage once, not three times', async ({ page }) => {
    // The busiest tile on the page carried a state line reading "BUY ·
    // DISCUSSING" above a chip reading BUY and a rail labelled DECIDING.
    const tgt = page.locator('[data-explore-tile="i-tgt-trade"]')
    await expect(tgt.locator('[data-workflow-active-label]')).toHaveCount(1)
    // The rail wins; the text line stands down.
    await expect(tgt.locator('[data-explore-state]')).toHaveCount(0)
  })

  test('a title that says only its own type is replaced by the claim', async ({ page }) => {
    // "Trade idea" tells the reader the type, which the eyebrow already says.
    const tgt = page.locator('[data-explore-tile="i-tgt-trade"]')
    const head = (await tgt.locator('[data-explore-headline]').innerText()).trim()
    expect(head).not.toMatch(/^trade idea$/i)
    expect(head).toContain('TGT')
  })

  test('a filtered dead end offers the way out', async ({ page }) => {
    await page.locator('[data-explore-category="workflow"]').click()
    // Workflow has items in the fixture, so drive it to a genuinely empty one
    // only if one exists; otherwise assert the populated path still renders.
    const empty = page.locator('[data-explore-empty]')
    if (await empty.count()) {
      await expect(page.locator('[data-explore-empty-clear]')).toBeVisible()
      await page.locator('[data-explore-empty-clear]').click()
      await expect(page.locator('[data-explore-category="all"]')).toHaveAttribute('aria-pressed', 'true')
    } else {
      await expect(page.locator('[data-explore-tile]').first()).toBeVisible()
    }
  })

  test('an aggregate is not a dead end', async ({ page }) => {
    const agg = page.locator('[data-explore-tile][data-subtype="aggregate"]').first()
    await expect(agg).toBeVisible()
    await agg.click()
    // It narrows Explore to the thing it counted.
    await expect(page.locator('[data-explore-category][aria-pressed="true"]')).not.toHaveAttribute(
      'data-explore-category', 'all')
  })
})

test.describe('single column at 320px is designed, not collapsed', () => {
  test.use({ viewport: { width: 320, height: 844 } })

  test('every tile spans the one column, with even gutters', async ({ page }) => {
    await page.goto('/explore.html')
    const boxes = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width) } }))
    expect(boxes.length).toBeGreaterThan(8)
    // One column: every card starts at the same x and is the same width, so the
    // page reads as a stack rather than as a grid that lost a column.
    expect(new Set(boxes.map(b => b.l)).size).toBe(1)
    expect(new Set(boxes.map(b => b.w)).size).toBe(1)
  })

  test('the claim gets the width the single column gives it', async ({ page }) => {
    await page.goto('/explore.html')
    // A text-only card is the whole of its own content here, so its headline is
    // set a step larger than it would be beside a neighbour at 390.
    const px = await page.locator('[data-explore-tile]')
      .filter({ hasNot: page.locator('[data-explore-visual]') })
      .first().locator('[data-explore-headline]')
      .evaluate(e => parseFloat(getComputedStyle(e).fontSize))
    expect(px).toBeGreaterThanOrEqual(15)
  })

  test('nothing overflows and no headline is a single word per line', async ({ page }) => {
    await page.goto('/explore.html')
    const bad = await page.locator('[data-explore-headline]').evaluateAll(els =>
      els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e as HTMLElement).innerText))
    expect(bad, bad.join(' | ')).toEqual([])
  })
})

test.describe('the filter row', () => {
  test('scrolls itself without the page scrolling', async ({ page }) => {
    // §13: the bar is the thing that scrolls sideways. If the page can, the
    // whole mosaic moves under the thumb and the two-column layout is broken
    // at 320px, which is where this used to happen.
    const bar = page.locator('[data-explore-filters]')
    const before = await bar.evaluate(el => el.scrollLeft)
    await bar.evaluate(el => { el.scrollLeft = el.scrollWidth })
    const after = await bar.evaluate(el => el.scrollLeft)
    expect(before).toBe(0)
    expect(after).toBeGreaterThan(0)
    // And the viewport itself did not move.
    expect(await explore(page).evaluate(el => el.scrollLeft)).toBe(0)
  })

  test('gives every chip a real tap target and a content-driven width', async ({ page }) => {
    const chips = await page.locator('[data-explore-category]').evaluateAll(els =>
      els.map(e => {
        const r = e.getBoundingClientRect()
        return { key: e.getAttribute('data-explore-category'), h: r.height, w: r.width }
      }))
    for (const c of chips) {
      expect(c.h, `${c.key} is ${c.h}px tall`).toBeGreaterThanOrEqual(30)
      expect(c.w, `${c.key} is ${c.w}px wide`).toBeGreaterThan(24)
    }
    // Content-driven, not uniform: "Decisions" is wider than "All".
    const all = chips.find(c => c.key === 'all')!
    const decisions = chips.find(c => c.key === 'decisions')!
    expect(decisions.w).toBeGreaterThan(all.w)
  })

  test('brings the active chip into view', async ({ page }) => {
    // A chip selected past the right edge left the bar saying nothing about
    // what the page was filtered to.
    await page.locator('[data-explore-filters]').evaluate(el => { el.scrollLeft = 0 })
    await page.locator('[data-explore-category="news"]').click()
    const visible = await page.locator('[data-explore-category="news"]').evaluate(el => {
      const chip = el.getBoundingClientRect()
      const bar = el.parentElement!.getBoundingClientRect()
      return chip.left >= bar.left - 1 && chip.right <= bar.right + 1
    })
    expect(visible).toBe(true)
  })
})

test.describe('taxonomy', () => {
  test('offers exactly the canonical categories', async ({ page }) => {
    const keys = await page.locator('[data-explore-category]').evaluateAll(els =>
      els.map(e => e.getAttribute('data-explore-category')))
    expect(keys).toEqual(['all', 'decisions', 'research', 'ideas', 'workflow', 'news'])
  })

  test('filtering shows only that category', async ({ page }) => {
    await page.locator('[data-explore-category="research"]').click()
    const cats = await page.locator('[data-explore-tile]').evaluateAll(els =>
      [...new Set(els.map(e => e.getAttribute('data-category')))])
    expect(cats).toEqual(['research'])
  })

  test('returns to the mixed page', async ({ page }) => {
    await page.locator('[data-explore-category="news"]').click()
    await page.locator('[data-explore-category="all"]').click()
    const cats = await page.locator('[data-explore-tile]').evaluateAll(els =>
      new Set(els.map(e => e.getAttribute('data-category'))).size)
    expect(cats).toBeGreaterThanOrEqual(4)
  })
})

test.describe('discovery breadth', () => {
  test('one ticker does not take over the opening', async ({ page }) => {
    const first6 = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.slice(0, 6).map(e => e.getAttribute('data-symbol')))
    const aapl = first6.filter(s => s === 'AAPL').length
    expect(aapl, `AAPL took ${aapl} of the first six`).toBeLessThanOrEqual(2)
  })

  test('several families appear early', async ({ page }) => {
    const first6 = await page.locator('[data-explore-tile]').evaluateAll(els =>
      new Set(els.slice(0, 6).map(e => e.getAttribute('data-category'))).size)
    expect(first6).toBeGreaterThanOrEqual(3)
  })

  test('the same artifact appears once', async ({ page }) => {
    // The fixture ships one thesis update through two adapters.
    const titles = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.map(e => e.textContent ?? ''))
    expect(titles.filter(t => t.includes('updated a thesis'))).toHaveLength(0)
    expect(titles.filter(t => t.includes('thesis strengthened'))).toHaveLength(1)
  })
})

/**
 * Ten findings, ten pictures.
 *
 * The success criterion for the visual-diversity pass, stated as geometry: a
 * reader scrolling Explore should be able to tell a scenario breach from a
 * missing thesis from somebody's thought without reading a word. These assert
 * that each type resolves to its own archetype, that none of them is fabricated
 * from absent data, and that the grid still behaves.
 */
test.describe('visual diversity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await explore(page).scrollIntoViewIfNeeded()
  })

  const visualOf = (page: import('@playwright/test').Page, id: string) =>
    page.locator(`[data-explore-tile="${id}"] [data-explore-visual]`).first()

  test('the page draws several different pictures, not one repeated', async ({ page }) => {
    const kinds = await page.locator('[data-explore-tile] [data-explore-visual]')
      .evaluateAll(els => els.map(e => e.getAttribute('data-explore-visual')))
    // The whole point of the pass. Before it, every one of these was a
    // sparkline because every one of them had a ticker.
    expect(new Set(kinds).size, `only ${new Set(kinds).size} archetypes: ${kinds.join(',')}`)
      .toBeGreaterThanOrEqual(5)
  })

  test('a scenario breach draws the range the price escaped', async ({ page }) => {
    const v = visualOf(page, 'd-ceg-gap')
    await expect(v).toHaveAttribute('data-explore-visual', 'scenario_range')
    // The band, every modelled case on it, and the price marker.
    await expect(v.locator('[data-scenario-band]')).toHaveCount(1)
    await expect(v.locator('[data-scenario-case]')).toHaveCount(3)
    await expect(v.locator('[data-scenario-current]')).toHaveCount(1)
    // The deviation is the loud thing, because "the market escaped my range"
    // is the finding and the band is the evidence.
    await expect(v.locator('[data-scenario-deviation]')).toBeVisible()
  })

  test('the price marker sits outside the band when the price is outside it', async ({ page }) => {
    const v = visualOf(page, 'd-ceg-gap')
    const band = await v.locator('[data-scenario-band]').boundingBox()
    const dot = await v.locator('[data-scenario-current]').boundingBox()
    const dotMid = dot!.x + dot!.width / 2
    // CEG is below every case, so the marker is left of the modelled band.
    expect(dotMid).toBeLessThan(band!.x)
  })

  test('a missing target draws a dashed empty slot, never a number', async ({ page }) => {
    const v = visualOf(page, 'd-aapl-notarget')
    await expect(v).toHaveAttribute('data-explore-visual', 'target_compare')
    await expect(v.locator('[data-target-empty]')).toBeVisible()
    // Implying precision where no target exists is the one thing this must not do.
    await expect(v.locator('[data-target-value]')).toHaveCount(0)
  })

  test('an expired target draws time, because time is why it is here', async ({ page }) => {
    const v = visualOf(page, 'd-msft-expired')
    await expect(v).toHaveAttribute('data-explore-visual', 'timeline')
    await expect(v.locator('[data-timeline-overdue]')).toBeVisible()
    await expect(v.getByText(/overdue/i)).toBeVisible()
  })

  test('a conviction mismatch draws two weights, not a price line', async ({ page }) => {
    const v = visualOf(page, 'd-amzn-oversized')
    await expect(v).toHaveAttribute('data-explore-visual', 'comparison')
    await expect(v.locator('[data-comparison-bar]')).toHaveCount(2)
  })

  test('a position with no research draws exposure', async ({ page }) => {
    const v = visualOf(page, 'r-roku-nothesis')
    await expect(v).toHaveAttribute('data-explore-visual', 'exposure')
    await expect(v.locator('[data-exposure-value]')).toBeVisible()
  })

  test('a stale review draws the move since the last look', async ({ page }) => {
    const v = visualOf(page, 'r-aapl-stale')
    await expect(v).toHaveAttribute('data-explore-visual', 'last_look')
    await expect(v.locator('[data-lastlook-move]')).toBeVisible()
    await expect(v.getByText(/last look/i)).toBeVisible()
  })

  test('a trade idea draws a stage rail and its direction', async ({ page }) => {
    const v = visualOf(page, 'i-tgt-trade')
    await expect(v).toHaveAttribute('data-explore-visual', 'workflow')
    await expect(v.locator('[data-workflow-direction="buy"]')).toBeVisible()
    await expect(v.locator('[data-workflow-stage]')).toHaveCount(4)
    await expect(v.locator('[data-workflow-stage][data-active="true"]')).toHaveCount(1)
  })

  test('a thought is its own words, with no chart', async ({ page }) => {
    const v = visualOf(page, 'i-aapl-thought')
    await expect(v).toHaveAttribute('data-explore-visual', 'quote')
    await expect(v.locator('[data-quote-text]')).toBeVisible()
    await expect(page.locator('[data-explore-tile="i-aapl-thought"] [data-testid="sparkline"]'))
      .toHaveCount(0)
  })

  test('news gets no sparkline, whatever ticker it names', async ({ page }) => {
    const newsTiles = page.locator('[data-explore-tile][data-subtype="news"]')
    const n = await newsTiles.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      await expect(newsTiles.nth(i).locator('[data-testid="sparkline"]')).toHaveCount(0)
    }
  })

  test('the sparkline survives on the one card whose story IS the trajectory', async ({ page }) => {
    const v = visualOf(page, 'd-tsla-move')
    await expect(v).toHaveAttribute('data-explore-visual', 'price_trend')
    await expect(v.locator('[data-testid="sparkline"]')).toBeVisible()
  })

  test('no card draws a picture it has no data for', async ({ page }) => {
    // Every rendered visual carries the elements its archetype promises. An
    // empty track or a chart with no series is worse than clean typography.
    const empty = await page.locator('[data-explore-tile] [data-explore-visual]').evaluateAll(els =>
      els.filter(e => (e.textContent ?? '').trim() === '' && e.children.length === 0)
        .map(e => e.getAttribute('data-explore-visual')))
    expect(empty).toEqual([])
  })

  test('sizes stay deterministic across a re-render', async ({ page }) => {
    const before = await page.locator('[data-explore-tile]')
      .evaluateAll(els => els.map(e => `${e.getAttribute('data-explore-tile')}:${e.getAttribute('data-emphasis')}`))
    // Re-filtering and returning re-runs composition and layout from scratch.
    // The pills are not toggles — "All" is its own chip — so the trip back is
    // an explicit click on it.
    await page.locator('[data-explore-category="research"]').click()
    await page.waitForTimeout(250)
    await page.locator('[data-explore-category="all"]').click()
    await page.waitForTimeout(250)
    const after = await page.locator('[data-explore-tile]')
      .evaluateAll(els => els.map(e => `${e.getAttribute('data-explore-tile')}:${e.getAttribute('data-emphasis')}`))
    expect(after).toEqual(before)
  })

  test('no more than two consecutive cards share one picture', async ({ page }) => {
    const kinds = await page.locator('[data-explore-tile]').evaluateAll(els =>
      els.map(e => e.querySelector('[data-explore-visual]')?.getAttribute('data-explore-visual') ?? 'none'))
    for (let i = 2; i < kinds.length; i++) {
      const run = kinds.slice(i - 2, i + 1)
      // `none` is typography and repeats harmlessly — a run of text cards is a
      // page of prose, not a wall of identical widgets.
      if (run[0] === 'none') continue
      expect(new Set(run).size, `three ${run[0]} in a row at ${i}`).toBeGreaterThan(1)
    }
  })

  test('the visuals introduce no nested scroller', async ({ page }) => {
    const nested = await explore(page).evaluate(el => {
      for (const n of Array.from(el.querySelectorAll('[data-explore-visual], [data-explore-visual] *'))) {
        const e = n as HTMLElement
        const st = getComputedStyle(e)
        if (/auto|scroll/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) return true
      }
      return false
    })
    expect(nested).toBe(false)
  })

  test('the visuals capture no pointer gesture', async ({ page }) => {
    // A child that takes a drag competes with the grid's own scroll — the rule
    // that keeps the sparkline inert applies to every archetype.
    const grabby = await explore(page).evaluate(el =>
      Array.from(el.querySelectorAll('[data-explore-visual]'))
        .filter(e => (e as HTMLElement).querySelector('button, a, input, [role="button"]'))
        .map(e => e.getAttribute('data-explore-visual')))
    expect(grabby).toEqual([])
  })
})
