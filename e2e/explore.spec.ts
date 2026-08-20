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
    const xs = await page.locator('[data-explore-tile][data-emphasis="standard"]')
      .evaluateAll(els => els.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().x)))
    expect(new Set(xs).size).toBe(2)
  })

  test('a featured tile spans both columns', async ({ page }) => {
    const feature = page.locator('[data-explore-tile][data-emphasis="feature"]').first()
    const standard = page.locator('[data-explore-tile][data-emphasis="standard"]').first()
    const f = (await feature.boundingBox())!
    const s = (await standard.boundingBox())!
    expect(f.width).toBeGreaterThan(s.width * 1.6)
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

  test('an aggregate is not a dead end', async ({ page }) => {
    const agg = page.locator('[data-explore-tile][data-subtype="aggregate"]').first()
    await expect(agg).toBeVisible()
    await agg.click()
    // It narrows Explore to the thing it counted.
    await expect(page.locator('[data-explore-category][aria-pressed="true"]')).not.toHaveAttribute(
      'data-explore-category', 'all')
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
