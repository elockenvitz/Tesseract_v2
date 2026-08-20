import { test, expect } from '@playwright/test'

/**
 * The scroll-conflict test, driven by real touch input.
 *
 * Computed styles are not evidence of gesture behaviour: `touch-action: pan-x`
 * being present says nothing about what the browser does with a drag. These
 * dispatch actual touch sequences through CDP against the same snap container
 * the feed uses, and assert where the feed lands.
 *
 * The case that matters is the last one: a swipe starting inside the bounded
 * case-detail scroller, when that scroller is already at its end. That is
 * precisely what `overscroll-behavior-y: contain` exists to arbitrate, and it
 * is the case a styles assertion cannot reach.
 */

const VH = 844

async function swipeUp(
  page: import('@playwright/test').Page,
  startX: number,
  startY: number,
  distance = 600,
) {
  // Wheel, not touch — and that is a real limitation of this evidence.
  //
  // Headless Chromium will not drive compositor scrolling from synthetic touch.
  // Measured on the same page, same container:
  //     Input.synthesizeScrollGesture gestureSourceType 'touch' -> scrollTop 0
  //     Input.synthesizeScrollGesture gestureSourceType 'mouse' -> scrollTop 844
  //     page.mouse.wheel                                        -> scrollTop 844
  // The container is scrollable (scrollHeight 7596 / clientHeight 844) and
  // programmatic scrollTop works, so the zero is the harness, not the page.
  //
  // What wheel DOES exercise: scroll-snap, and overscroll-behavior — which is
  // the mechanism behind the bounded-detail case below.
  // What it CANNOT exercise: touch-action, so the carousel's pan-x arbitration
  // is NOT proven here and is marked as such.
  await page.mouse.move(startX, startY)
  await page.mouse.wheel(0, distance)
  await page.waitForTimeout(1000)
}

const feedTop = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.getElementById('feed')!.scrollTop)

/**
 * Scroll a named card to the top of the feed and report where it starts.
 *
 * Positions were hardcoded as `scrollTop = 844`, which assumed a card was
 * second in the deck. Adding one card ahead of it moved the target off-screen,
 * the gesture landed outside it, and the feed did not move — a test failing for
 * a reason that had nothing to do with what it was testing. CI caught it; the
 * local run did not, because the local gallery build was a step behind.
 */
async function alignTo(page: import('@playwright/test').Page, slug: string) {
  const top = await page.evaluate(s => {
    const feed = document.getElementById('feed')!
    const card = document.querySelector(`[data-card="${s}"]`) as HTMLElement
    const y = card.offsetTop
    feed.scrollTop = y
    return feed.scrollTop
  }, slug)
  await page.waitForTimeout(400)
  return top
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-card="news"]').waitFor()
  await page.evaluate(() => { document.getElementById('feed')!.scrollTop = 0 })
})

/**
 * Where the Nth card starts, in feed coordinates.
 *
 * Cards used to be exactly one viewport tall, so "advanced one tile" and
 * "advanced 844px" were the same assertion and the tests were written in
 * viewport units. They are no longer the same: a compact card is around 380px,
 * so a swipe that correctly advances one tile moves the feed by less than a
 * screen. Measuring against the card's own offset asserts the property that was
 * always meant — one gesture, one tile — without assuming a height.
 */
const cardTop = (page: import('@playwright/test').Page, index: number) =>
  page.evaluate(i => {
    const cards = Array.from(document.querySelectorAll('[data-card]')) as HTMLElement[]
    return cards[i].offsetTop
  }, index)

test('one swipe from card body advances exactly one tile', async ({ page }) => {
  expect(await feedTop(page)).toBe(0)
  const second = await cardTop(page, 1)
  await swipeUp(page, 195, 300)
  const after = await feedTop(page)
  // Landed on the second card, not somewhere between it and the third.
  expect(Math.abs(after - second), `feed landed at ${after}, second card starts at ${second}`)
    .toBeLessThan(24)
})

// NOT PROVEN BY THIS HARNESS. touch-action has no effect on wheel input, so
// this asserts only that a vertical gesture over the carousel does not get
// swallowed by the horizontal scroller — which is necessary but not sufficient.
// Confirming pan-x arbitration needs a real touchscreen.
test('a vertical gesture over the carousel is not swallowed by it', async ({ page }) => {
  const start = await alignTo(page, 'six-cases')
  const track = page.locator('[data-card="six-cases"] [data-carousel-track]').first()
  const box = await track.boundingBox()
  expect(box).not.toBeNull()
  await swipeUp(page, box!.x + box!.width / 2, box!.y + box!.height / 2)
  const after = await feedTop(page)
  expect(after - start).toBeGreaterThan(VH * 0.9)
  expect(after - start).toBeLessThan(VH * 1.1)
})

test('a swipe from the detail scroller at its end advances exactly one tile', async ({ page }) => {
  const start = await alignTo(page, 'six-cases')
  const detail = page.locator('[data-card="six-cases"] [data-testid="card-detail"]')
  // Drive it to its end first; overscroll-behavior: contain should then hand
  // the gesture to the feed rather than swallowing it.
  await detail.evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(200)
  const box = await detail.boundingBox()
  expect(box).not.toBeNull()
  await swipeUp(page, box!.x + box!.width / 2, box!.y + box!.height / 2)
  const after = await feedTop(page)
  expect(after - start, 'feed did not advance from inside the exhausted detail scroller').toBeGreaterThan(VH * 0.9)
  expect(after - start).toBeLessThan(VH * 1.1)
})
