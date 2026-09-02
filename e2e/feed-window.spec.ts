import { test, expect } from '@playwright/test'

/**
 * The feed mounts a bounded number of cards, and collapsing the rest moves
 * nothing.
 *
 * ── What this is really testing ───────────────────────────────────────────
 *
 * "The feed gets bogged down when I use the filters" was, structurally, a DOM
 * that grew with scroll depth: every entry mounted at once, each a full card
 * with a carousel and an SVG chart, all of them rebuilt with fresh identities
 * on every recompute — so the cost of one filter change was proportional to
 * how far the reader had scrolled.
 *
 * Windowing bounds that. But windowing a SNAP scroller is the risky kind of
 * fix: a virtual list with estimated heights shifts the snap points under the
 * reader. This feed avoids that because a slot's height is decided from its
 * ENTRY — one of three declared tiers — so a collapsed slot is an empty box of
 * precisely the size its card would have filled, and no slot's height depends
 * on whether anyone has scrolled past it yet.
 *
 * These assertions are the two halves of that bargain — the saving is real,
 * and the geometry is untouched. Measured rather than argued, because the
 * failure mode of the geometry half is a feed that drifts a few pixels per
 * collapsed tile and only becomes obvious a hundred cards down.
 */

const viewport = (page: import('@playwright/test').Page) => page.locator('#window-viewport')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await viewport(page).scrollIntoViewIfNeeded()
  await page.locator('[data-feed-slot]').first().waitFor()
})

test.describe('feed windowing', () => {
  test('every slot exists whether or not its card is mounted', async ({ page }) => {
    // The slots are the geometry. Only their contents come and go.
    const el = viewport(page)
    const count = Number(await el.getAttribute('data-slot-count'))
    await expect(page.locator('[data-feed-slot]')).toHaveCount(count)
  })

  test('the scroll height is the full list, not the mounted part', async ({ page }) => {
    /**
     * The scrollbar has to describe the whole feed from the first paint. If it
     * grew as cards mounted, the position would shift under anyone scrolling —
     * and a saved scroll offset could never be restored.
     *
     * Asserted against the SUM of the slots rather than `clientHeight * count`.
     * That older form was the same statement while every tile was one screen,
     * and it silently stopped being a test of anything once tiles came in three
     * heights: it would have passed a feed whose slots were all wrong by
     * construction, so long as they averaged out. Summing the boxes actually on
     * the page makes no assumption about what any of them should be — only that
     * the scroller accounts for all of them.
     */
    const { scrollHeight, slotTotal, mounted, count } = await viewport(page).evaluate(el => {
      const slots = [...el.querySelectorAll('[data-feed-slot]')] as HTMLElement[]
      return {
        scrollHeight: el.scrollHeight,
        slotTotal: slots.reduce((a, s) => a + s.offsetHeight, 0),
        mounted: el.querySelectorAll('[data-feed-slot="mounted"]').length,
        count: Number(el.getAttribute('data-slot-count')),
      }
    })
    expect(scrollHeight).toBeCloseTo(slotTotal, -1)
    // And the sum is the WHOLE list, not just what happens to be mounted —
    // which is the half of the claim a self-referential sum cannot make.
    expect(mounted).toBeLessThan(count)
  })

  test('a slot is its final height before its card ever mounts', async ({ page }) => {
    /**
     * The property the three tiers rest on.
     *
     * A tier read off the card at mount time would look correct in every
     * screenshot and still be wrong: a slot's height would depend on whether
     * the reader had been past it, so the feed would quietly reflow behind
     * them and a deep offset would mean two different things depending on how
     * you got there. Decided from the ENTRY, a collapsed slot is already the
     * size its card will need.
     *
     * Measured by comparing collapsed slots against mounted ones of the same
     * tier — if the collapsed ones were falling back to a default, the two
     * would not agree.
     */
    const byTier = await viewport(page).evaluate(el => {
      const out: Record<string, { mounted: number[]; collapsed: number[] }> = {}
      for (const s of [...el.querySelectorAll('[data-feed-slot]')] as HTMLElement[]) {
        const tier = s.getAttribute('data-slot-tier') ?? '?'
        const state = s.getAttribute('data-feed-slot') === 'mounted' ? 'mounted' : 'collapsed'
        out[tier] ??= { mounted: [], collapsed: [] }
        out[tier][state].push(s.offsetHeight)
      }
      return out
    })

    // The fixture cycles three tiers, so all three must be represented — a
    // version of this that silently degraded to one tier would pass vacuously.
    expect(Object.keys(byTier).sort()).toEqual(['compact', 'standard', 'tall'])

    for (const [tier, { mounted, collapsed }] of Object.entries(byTier)) {
      const all = [...mounted, ...collapsed]
      expect(collapsed.length, `${tier} has no collapsed slots to compare`).toBeGreaterThan(0)
      // Every slot of a tier is the same height, whatever its state.
      expect(new Set(all).size, `${tier} slots differ: ${[...new Set(all)].join(', ')}`).toBe(1)
    }

    // And the three tiers are actually different, or there is no vocabulary.
    const heights = Object.values(byTier).map(v => [...v.mounted, ...v.collapsed][0])
    expect(new Set(heights).size).toBe(3)
  })

  test('mounts only a handful, however deep the reader goes', async ({ page }) => {
    /**
     * The whole point. Sixty tiles, and the mounted set stays around four
     * wherever you stand — so the cost of a re-render stops depending on how
     * long the session has run.
     */
    const el = viewport(page)
    const mountedNow = () => page.locator('[data-feed-slot="mounted"]').count()

    await expect.poll(mountedNow).toBeLessThan(10)

    for (const page_ of [10, 25, 50]) {
      await el.evaluate((n, i) => { n.scrollTop = n.clientHeight * i }, page_)
      await expect.poll(mountedNow).toBeGreaterThan(0)
      await expect.poll(mountedNow).toBeLessThan(10)
    }
  })

  test('a tile sits at the same offset whether the ones above it are mounted', async ({ page }) => {
    /**
     * The geometry half, and the one that would rot silently. A collapsed slot
     * must occupy exactly the box its card would have — not approximately, or
     * the error accumulates once per tile and the feed drifts.
     *
     * Measured by landing on a deep tile from two different directions: from
     * above, where everything before it has been mounted and released, and by
     * jumping straight to it, where most of them never mounted at all.
     */
    const el = viewport(page)
    const offsetOfSlot = (i: number) => el.evaluate((n, idx) => {
      const slot = n.querySelectorAll('[data-feed-slot]')[idx] as HTMLElement
      return slot.offsetTop
    }, i)

    const direct = await offsetOfSlot(40)

    // Now walk there, mounting and releasing every slot on the way.
    for (let i = 0; i <= 40; i += 4) {
      await el.evaluate((n, k) => { n.scrollTop = n.clientHeight * k }, i)
    }
    await expect.poll(() => page.locator('[data-feed-slot="mounted"]').count()).toBeGreaterThan(0)

    expect(await offsetOfSlot(40)).toBe(direct)
  })

  test('a collapsed slot still stops the scroller', async ({ page }) => {
    /**
     * Snap points live on the slot, not on the card, so releasing a card does
     * not remove the place the scroller comes to rest. Without this, a fast
     * fling into a collapsed region would sail past to the next mounted card.
     */
    const styles = await viewport(page).evaluate(el => {
      const collapsed = el.querySelector('[data-feed-slot="collapsed"]')
      if (!collapsed) return null
      const s = getComputedStyle(collapsed)
      return { align: s.scrollSnapAlign, stop: s.scrollSnapStop, height: (collapsed as HTMLElement).offsetHeight }
    })
    expect(styles).not.toBeNull()
    expect(styles!.align).toContain('start')
    expect(styles!.stop).toBe('always')
    // And it is a full tile, not a collapsed sliver.
    expect(styles!.height).toBeGreaterThan(100)
  })
})
