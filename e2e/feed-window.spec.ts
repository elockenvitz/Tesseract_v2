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
 * reader. This feed avoids that because every tile is exactly one scroller
 * height, so a collapsed slot is an empty box of precisely the same size.
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
     */
    /**
     * Summed from the slots on the page rather than asserted as
     * `clientHeight * count`. That older form was the same statement only while
     * every tile was one screen; with three tiers it would pass a feed whose
     * slots were each wrong so long as they averaged out.
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
    // And that total is the WHOLE list, not merely the mounted part — the half
    // of the claim a self-referential sum cannot make on its own.
    expect(mounted).toBeLessThan(count)
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
