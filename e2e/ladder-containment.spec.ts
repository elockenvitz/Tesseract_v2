import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Nothing inside the ladder may be cut off, at any pane the carousel can give.
 *
 * ── The regression this exists for ────────────────────────────────────────
 *
 * Production showed AMZN with the readout cut off at the TOP of the ladder and
 * LOW $199 / HIGH $284 cut off at the BOTTOM — the same card, both edges. The
 * cause was a fixed internal floor: the status rail (30px), its gap, and an
 * axis carrying `min-h-[190px]` demanded 224px of the pane whatever the pane
 * had, and when it could not be met the block centred inside `overflow-hidden`
 * and the excess was split evenly between the two edges.
 *
 * Every existing layout test missed it because the gallery pins the phone frame
 * at 844px, which yields a 317px pane — 93px more than the ladder's floor. The
 * ladder was never once measured in a pane it could not fit. So this file
 * SHRINKS THE FRAME, which is the only thing that reproduces the report.
 *
 * Measured onset before the fix: clipping begins at a 223px pane and reaches
 * 14px off the top and 14px off the bottom at 196px.
 */

const card = (page: Page, slug: string): Locator => page.locator(`[data-card="${slug}"]`)

/** Text needs breathing room; a mark may sit on the boundary it belongs to. */
const PAD = 3

/**
 * Resize the gallery's phone frame.
 *
 * The frame is `h-[844px]`, so the pane is the same 317px at every viewport
 * height and the real device — Safari with its chrome, which is 640-720px of
 * usable height — is not reachable by `setViewportSize` alone.
 */
async function setFrame(page: Page, px: number) {
  await page.evaluate((h) => {
    for (const el of document.querySelectorAll('div')) {
      if ((el.className || '').toString().includes('h-[844px]')) {
        (el as HTMLElement).style.height = `${h}px`
      }
    }
  }, px)
}

/** Every text-bearing mark in the ladder, against the box that clips it. */
async function containment(c: Locator) {
  return c.evaluate((root) => {
    const lad = root.querySelector('[data-testid="scenario-ladder"]')!
    const clip = lad.getBoundingClientRect()
    // The two wrappers ARE the clip boxes; measuring them against themselves
    // says nothing, and the axis box is deliberately flush with its parent.
    const SKIP = new Set(['scenario-ladder', 'ladder-axis-box', 'ladder-baseline-group'])
    const out: { id: string; text: string; top: number; bottom: number }[] = []
    for (const e of lad.querySelectorAll('[data-testid]')) {
      const id = e.getAttribute('data-testid')!
      if (SKIP.has(id)) continue
      // LEAVES only. A wrapper's box is its children's union and is meant to be
      // flush with the layout around it; measuring it asserts nothing about
      // whether any actual text was cut.
      if (e.querySelector('[data-testid]')) continue
      const text = (e.textContent ?? '').trim()
      if (!text) continue
      if (getComputedStyle(e).opacity === '0') continue
      const b = e.getBoundingClientRect()
      out.push({ id, text: text.slice(0, 24), top: b.top, bottom: b.bottom })
    }
    return {
      clipTop: clip.top, clipBottom: clip.bottom, marks: out,
      // The root-cause invariant. Content taller than its box is what
      // `justify-center` divided between the two edges.
      blockH: Math.round(clip.height),
      contentH: (lad as HTMLElement).scrollHeight,
      paneH: Math.round(lad.parentElement!.getBoundingClientRect().height),
    }
  })
}

function expectContained(
  g: Awaited<ReturnType<typeof containment>>, where: string,
) {
  expect(g.marks.length, `${where}: nothing measured`).toBeGreaterThan(0)
  // Nothing to divide between the edges in the first place.
  expect(g.contentH, `${where}: the ladder overflows its own box`)
    .toBeLessThanOrEqual(g.blockH)
  expect(g.blockH, `${where}: the ladder overflows its pane`)
    .toBeLessThanOrEqual(g.paneH)
  for (const m of g.marks) {
    expect(m.top, `${where}: "${m.text}" (${m.id}) cut off at the TOP`)
      .toBeGreaterThanOrEqual(g.clipTop + PAD)
    expect(m.bottom, `${where}: "${m.text}" (${m.id}) cut off at the BOTTOM`)
      .toBeLessThanOrEqual(g.clipBottom - PAD)
  }
}

/**
 * 640 is where clipping used to begin (a 223px pane) and 600 is where it reached
 * 14px off each edge. 680 and 844 are the roomier phones and the gallery's own
 * frame, which is the only one the rest of the suite has ever measured.
 */
const FRAMES = [844, 680, 640, 600]
const WIDTHS = [390, 360, 320]

const CARDS = [
  // Price above every case AND above the whole 52-week range.
  { slug: 'scenario-prod-amzn', label: 'AMZN', ev: false },
  // At its expected value, weighted, unheld.
  { slug: 'scenario-prod-dash', label: 'DASH', ev: true },
  // Base and Bull close enough that the case rail needs a second row.
  { slug: 'scenario-price-bands', label: 'TSLA dense', ev: false },
]

for (const { slug, label, ev } of CARDS) {
  for (const width of WIDTHS) {
    for (const frame of FRAMES) {
      test(`${label} is fully contained at ${width}px in a ${frame}px frame`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        await page.goto('/')
        await setFrame(page, frame)
        const c = card(page, slug)

        // A. Resting.
        expectContained(await containment(c), `${label} resting @${width}/${frame}`)

        // B. A selected scenario — the state whose two-line readout was the
        //    content reported cut off at the top.
        await c.locator('[data-testid="ladder-dot"]').first().click()
        await page.waitForTimeout(400)
        const sel = await containment(c)
        expectContained(sel, `${label} selected @${width}/${frame}`)
        // The two-line selected readout is the content the report showed cut
        // off at the top; it must be present AND contained, not just contained.
        expect(sel.marks.some(m => m.id === 'ladder-selected-detail'),
          `${label}: no readout detail @${width}/${frame}`).toBe(true)

        await c.locator('[data-testid="ladder-dot"]').first().click()
        await page.waitForTimeout(400)

        // C. The probability view, where the bars and their weights are the
        //    tallest thing the upper half ever has to hold.
        if (ev) {
          await c.locator('[data-testid="ladder-expected-hit"]').click()
          await page.waitForTimeout(500)
          const bars = await containment(c)
          expectContained(bars, `${label} EV @${width}/${frame}`)
          expect(bars.marks.filter(m => /^\d+%$/.test(m.text)).length,
            `${label}: probability labels @${width}/${frame}`).toBe(3)
          expect(bars.marks.some(m => m.text.includes('Expected value')),
            `${label}: EV header @${width}/${frame}`).toBe(true)
          await expect(c.locator('[data-testid="ladder-ev-close"]')).toBeVisible()
          await c.locator('[data-testid="ladder-ev-close"]').click()
          await page.waitForTimeout(400)
        }
      })
    }
  }
}

/**
 * The rails must still be rails, and the marks must still be quantitative —
 * containment is not allowed to buy itself a falsified x or a lost row.
 */
test.describe('containment did not cost the geometry', () => {
  test('TSLA still resolves its collision on a second row', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/')
    await setFrame(page, 640)
    const rows = await card(page, 'scenario-price-bands').evaluate(root =>
      [...root.querySelectorAll('[data-testid="ladder-dot-label"]')]
        .map(n => Math.round(n.getBoundingClientRect().top)))
    expect(new Set(rows).size, 'the second case row is gone').toBe(2)
    expect(Math.max(...rows) - Math.min(...rows), 'row pitch').toBe(28)
  })

  test('the scale stays quantitative in a short pane', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const x = async () => card(page, 'scenario-prod-dash').evaluate(root => {
      const mid = (n: Element) => { const b = n.getBoundingClientRect(); return b.left + b.width / 2 }
      return {
        dots: [...root.querySelectorAll('[data-testid="ladder-dot"]')].map(mid).sort((a, b) => a - b),
        tape: mid(root.querySelector('[data-testid="ladder-tape"]')!),
        ev: mid(root.querySelector('[data-testid="ladder-expected-hit"]')!),
        ticks: ['low', 'high'].map(b =>
          mid(root.querySelector(`[data-testid="ladder-52w"][data-bound="${b}"]`)!)),
      }
    })
    const tall = await x()
    await setFrame(page, 640)
    const short = await x()
    // Height is not a horizontal input. Every mark holds its exact x.
    expect(short).toEqual(tall)

    // And equal dollars are still equal pixels: Bear 180 / Base 250 / Bull 300.
    const perDollar = (tall.dots[2] - tall.dots[0]) / (300 - 180)
    expect(Math.abs((tall.dots[1] - tall.dots[0]) / (250 - 180) - perDollar) / perDollar)
      .toBeLessThan(0.02)
    expect(Math.abs((tall.ticks[1] - tall.ticks[0]) / (282 - 147) - perDollar) / perDollar)
      .toBeLessThan(0.02)
  })

  /**
   * The card must not move when the reader selects something. This is the bug
   * a previous pass fixed by reserving the readout's tallest state; a change to
   * the ladder's internal allocation is exactly how it would come back.
   */
  test('the card does not move between selection states', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await setFrame(page, 640)
    const c = card(page, 'scenario-prod-dash')
    /**
     * RELATIVE to the card, not to the page. Tapping a dot snap-scrolls the
     * feed, so absolute coordinates shift by hundreds of pixels while nothing
     * inside the card has moved at all — an artifact that would read as the
     * exact bug this test is for.
     */
    const frame = () => c.evaluate(root => {
      const base = root.getBoundingClientRect().top
      const r = (s: string) => {
        const n = root.querySelector(s)
        return n ? Math.round(n.getBoundingClientRect().top - base) : null
      }
      return {
        ladder: r('[data-testid="scenario-ladder"]'),
        pager: r('[data-testid="carousel-indicators"]'),
        axis: r('[data-testid="ladder-modelled"]'),
        height: Math.round(root.getBoundingClientRect().height),
      }
    })
    const rest = await frame()
    await c.locator('[data-testid="ladder-dot"]').first().click()
    await page.waitForTimeout(400)
    expect(await frame(), 'selecting a case moved the card').toEqual(rest)
    await c.locator('[data-testid="ladder-dot"]').first().click()
    await page.waitForTimeout(400)
    await c.locator('[data-testid="ladder-expected-hit"]').click()
    await page.waitForTimeout(500)
    expect(await frame(), 'entering the distribution moved the card').toEqual(rest)
  })
})
