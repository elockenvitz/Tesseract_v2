import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Case vs price, at 390×844 and at 320.
 *
 * ── Why this is its own file ──────────────────────────────────────────────
 *
 * `signal-cards.spec.ts` is the layout contract for every fixture: it asserts
 * that each one fits a phone, has the action slots it should, scrolls in no
 * direction it must not, and never clips content beneath its own action bar.
 * Those rules are card-agnostic and belong together.
 *
 * What is here is specific to one card: a footer that substitutes on exactly
 * one pane, a response flow where selection mutates nothing, and a 52-week
 * range that has to be legible as context and never as a scenario. Mixing them
 * into the general file would bury a tile's product rules inside a geometry
 * suite.
 *
 * ── The fixtures these run against ────────────────────────────────────────
 *
 * All three mount `ScenarioGapPanes`, which is the component the FEED composes
 * with. Before this pass the gallery rendered `evidence` and `detail` as two
 * stacked carousels — two indicator rows and two pane counts — so every
 * geometry assertion about this card was true of the fixture and unverified
 * against what ships.
 */

const card = (page: Page, slug: string): Locator => page.locator(`[data-card="${slug}"]`)

/** The three fixtures, and what each one is for. */
const WIDE = 'scenario-above-bull'      // AMZN: 3 cases, a 52w range that names both ends
const DENSE = 'six-cases'               // AAPL: 6 cases, a 52w range whose ends collide
const PRICED = 'scenario-price-bands'   // TSLA: the only fixture carrying a price pane

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-card="news"]').waitFor()
})

/** Page to a pane and let the scroll settle before measuring. */
async function toPane(c: Locator, id: string) {
  await c.locator(`[data-carousel-dot="${id}"]`).click()
  await c.page().waitForTimeout(400)
}

// ── The one action bar ──────────────────────────────────────────────────────

test.describe('the shared action bar', () => {
  /**
   * Bottom-left is `Actions` on every pane, always.
   *
   * It is the card's own quick action — `capture` — rendered under the one
   * display name it has. Nothing about paging may turn it into "Add note",
   * "Note" or "Capture": those were three names for one sheet.
   */
  test('the left button says Actions on all four panes', async ({ page }) => {
    const c = card(page, PRICED)
    for (const pane of ['ladder', 'verdict', 'price', 'cases']) {
      await toPane(c, pane)
      await expect(c.locator('[data-slot="quick"]'), pane).toHaveText('Actions')
    }
  })

  test('the right button is Review cases on ladder, price and cases', async ({ page }) => {
    const c = card(page, PRICED)
    for (const pane of ['ladder', 'price', 'cases']) {
      await toPane(c, pane)
      const primary = c.locator('[data-slot="primary"]')
      await expect(primary, pane).toHaveText('Review cases')
      // The card's own declared action, not a substitution. `open_cases` is
      // what `buildScenarioGapCard` emits and what `resolveFeedAction` routes.
      await expect(primary, pane).toHaveAttribute('data-primary-source', 'card')
      await expect(primary, pane).toHaveAttribute('data-action-id', 'open_cases')
    }
  })

  test('the right button becomes Submit response on RESPOND, and waits for an answer', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')

    const primary = c.locator('[data-slot="primary"]')
    await expect(primary).toHaveText('Submit response')
    await expect(primary).toHaveAttribute('data-primary-source', 'pane')
    // Disabled rather than absent: the bar keeping its shape is what stops the
    // card reflowing under the thumb as the reader pages across it.
    await expect(primary).toBeDisabled()

    await c.locator('[data-verdict="scenario_thesis_weaker"]').click()
    await expect(primary).toBeEnabled()
    await expect(primary).toHaveText('Submit response')
  })

  test('paging back off RESPOND hands the bar to the card again', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Submit response')
    await toPane(c, 'cases')
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Review cases')
  })

  /** Two buttons on every pane. Never three, never one. */
  test('the bar holds exactly two controls throughout', async ({ page }) => {
    const c = card(page, PRICED)
    for (const pane of ['ladder', 'verdict', 'price', 'cases']) {
      await toPane(c, pane)
      const bar = c.locator('[data-slot="actions"]')
      await expect(bar.locator('button'), pane).toHaveCount(2)
    }
  })
})

// ── The response ────────────────────────────────────────────────────────────

test.describe('the response pane', () => {
  /**
   * One commit control, and it is the footer's.
   *
   * `VerdictBar` carries its own filled button reading "Apply" or "Write it
   * down". On a card whose sticky footer already offers a primary, that put two
   * commit-shaped controls about 150px apart with nothing to say which was
   * authoritative.
   */
  test('the body carries no Apply of its own', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await c.locator('[data-verdict="scenario_thesis_intact"]').click()

    await expect(c.locator('[data-testid="verdict-send"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="verdict-bar"]')).toHaveCount(0)
    await expect(c.getByText('Apply', { exact: true })).toHaveCount(0)
    await expect(c.getByText('Write it down', { exact: true })).toHaveCount(0)
  })

  test('the note is there without opening anything', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    // No "+ Note" to press: the field is present from the first frame, so the
    // block does not reflow when somebody decides to write.
    await expect(c.locator('[data-testid="verdict-add-note"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="scenario-respond-note"]')).toBeVisible()
  })

  test('the placeholder follows the answer', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    const note = c.locator('[data-testid="scenario-respond-note"]')
    await expect(note).toHaveAttribute('placeholder', /optional/i)
    await c.locator('[data-verdict="scenario_cases_outdated"]').click()
    await expect(note).toHaveAttribute('placeholder', 'What should the cases say instead?')
  })

  test('the four answers are a 2x2 of real touch targets', async ({ page }) => {
    const c = card(page, DENSE)
    await toPane(c, 'verdict')
    for (const k of ['scenario_thesis_intact', 'scenario_thesis_weaker',
                     'scenario_cases_outdated', 'scenario_needs_review']) {
      await expect(c.locator(`[data-verdict="${k}"]`)).toBeVisible()
    }
    const boxes = await c.locator('[data-verdict]').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { y: Math.round(r.y), h: r.height } }))
    expect(new Set(boxes.map(b => b.y)).size).toBe(2)
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44)
  })

  /**
   * Nothing on this pane may reach the indicator row or the action bar.
   *
   * The note used to sit at the bottom of the band with `mt-auto`, which on a
   * 345px carousel band opened about 250px between the answer and the field
   * explaining it — and dropped the field onto the carousel indicators, the one
   * thing directly under it.
   */
  test('the response clears the indicators and the action bar', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await c.locator('[data-verdict="scenario_cases_outdated"]').click()
    await page.waitForTimeout(200)

    const note = (await c.locator('[data-testid="scenario-respond-note"]').boundingBox())!
    const dots = (await c.locator('[data-testid="carousel-indicators"]').boundingBox())!
    const bar = (await c.locator('[data-slot="actions"]').boundingBox())!
    expect(note.y + note.height).toBeLessThanOrEqual(dots.y + 1)
    expect(dots.y + dots.height).toBeLessThanOrEqual(bar.y + 1)
  })

  test('submitting confirms the answer and returns the bar to the card', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await c.locator('[data-verdict="scenario_thesis_intact"]').click()
    await c.locator('[data-slot="primary"]').click()

    await expect(c.locator('[data-testid="scenario-respond-saved"]')).toBeVisible()
    await expect(c.locator('[data-testid="scenario-respond-saved"]')).toContainText('Thesis intact')
    // A disabled "Submitted" would be a dead end on the one pane the reader has
    // finished with; reviewing the cases is what three of four answers point at.
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Review cases')
  })

  test('a mis-tap can be corrected', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await c.locator('[data-verdict="scenario_needs_review"]').click()
    await c.locator('[data-slot="primary"]').click()
    await expect(c.locator('[data-testid="scenario-respond-saved"]')).toBeVisible()

    await c.locator('[data-testid="scenario-respond-change"]').click()
    await expect(c.locator('[data-testid="scenario-respond-options"]')).toBeVisible()
    await expect(c.locator('[data-slot="primary"]')).toHaveText('Submit response')
  })
})

// ── The ladder ──────────────────────────────────────────────────────────────

test.describe('the ladder', () => {
  test('draws Bear, Base and Bull as selectable cases', async ({ page }) => {
    const c = card(page, WIDE)
    await expect(c.locator('[data-testid="ladder-dot"]')).toHaveCount(3)
    await expect(c.locator('[data-testid="ladder-tape"]')).toHaveCount(1)
    const labels = c.locator('[data-testid="ladder-dot-label"]')
    await expect(labels).toHaveCount(3)
    // Case-insensitive: the label is uppercased by CSS, and asserting the
    // transformed form couples the test to a style rule rather than to content.
    await expect(c.locator('[data-testid="scenario-ladder"]')).toContainText(/bear/i)
    await expect(c.locator('[data-testid="scenario-ladder"]')).toContainText(/bull/i)
  })

  /**
   * The 52-week range is context, and must not read as two more cases.
   *
   * Structural rather than visual: a case is a button with a dot and a
   * selection; the range is inert, has no dot and adds no case label.
   */
  test('the 52-week marks are drawn, and none of them is a case', async ({ page }) => {
    const c = card(page, WIDE)
    await expect(c.locator('[data-testid="ladder-52w"]')).toHaveCount(2)
    await expect(c.locator('[data-testid="ladder-52w-span"]')).toHaveCount(1)
    await expect(c.locator('[data-testid="ladder-52w-label"]')).toHaveCount(2)
    // The cases are untouched.
    await expect(c.locator('[data-testid="ladder-dot"]')).toHaveCount(3)
    // Nothing about the range is tappable.
    await expect(c.locator('[data-testid="ladder-52w"] button')).toHaveCount(0)
    await expect(c.locator('[data-testid="ladder-52w-label"] button')).toHaveCount(0)
  })

  /**
   * A fixture with no range draws nothing rather than an empty mark.
   *
   * `range52wFrom` returns null below two closes inside the window, and most
   * assets carry no cached history at all — so absent is the common case and
   * has to be silent.
   */
  test('a card with no range draws no 52-week marks', async ({ page }) => {
    const c = card(page, 'scenario-at-expected')
    await expect(c.locator('[data-testid="ladder-52w"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="ladder-52w-label"]')).toHaveCount(0)
    await expect(c.locator('[data-testid="ladder-52w-span"]')).toHaveCount(0)
    // And the cases still draw.
    await expect(c.locator('[data-testid="ladder-dot"]')).toHaveCount(3)
  })

  test('a range whose ends collide becomes one caption instead of two', async ({ page }) => {
    const c = card(page, DENSE)
    await expect(c.locator('[data-testid="ladder-52w"]')).toHaveCount(2)
    const labels = c.locator('[data-testid="ladder-52w-label"]')
    await expect(labels).toHaveCount(1)
    await expect(labels).toHaveAttribute('data-bound', 'range')
    await expect(labels).toContainText('52W $142–$260')
  })

  /**
   * No label on the ladder overlaps another, at any density.
   *
   * This is the failure the component's history is made of, and the reason the
   * six-case fixture carries a range that lands among its cases: the first
   * version of the 52-week marks rendered "52W LOV52W HIGH" there.
   */
  test('no ladder label overlaps another', async ({ page }) => {
    for (const slug of [WIDE, DENSE, PRICED]) {
      const boxes = await card(page, slug)
        .locator('[data-testid="ladder-dot-label"], [data-testid="ladder-52w-label"]')
        .evaluateAll(els => els.map(e => {
          const r = e.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]; const b = boxes[j]
          const overlaps = a.x < b.x + b.w && b.x < a.x + a.w
            && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlaps, `${slug}: labels ${i} and ${j} overlap`).toBe(false)
        }
      }
    }
  })

  /** The price pill must not crowd whatever the range put above the axis. */
  test('the NOW pill clears the labels beneath it', async ({ page }) => {
    const c = card(page, WIDE)
    const pill = (await c.locator('[data-testid="scenario-ladder"]')
      .getByText(/^now/i).boundingBox())!
    const labels = await c.locator('[data-testid="ladder-52w-label"]')
      .evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }
      }))
    for (const l of labels) {
      const gap = l.y - (pill.y + pill.height)
      // Either well below the pill, or entirely above it — never touching.
      expect(gap > 8 || l.y + l.h < pill.y).toBe(true)
    }
  })

  test('tapping a case still compares it with the price', async ({ page }) => {
    const c = card(page, WIDE)
    const readout = c.locator('[data-testid="ladder-readout"]')
    await expect(readout).toContainText('Tap a case')
    await c.locator('[data-testid="ladder-dot"]').first().click()
    await expect(readout).toContainText('%')
    await expect(readout).toContainText('from $')
    // The comparison block is a fixed two lines, so selecting moves nothing.
    const box = (await readout.boundingBox())!
    expect(Math.round(box.height)).toBeLessThanOrEqual(32)
  })
})

// ── The cases pane ──────────────────────────────────────────────────────────

test.describe('the cases pane', () => {
  test('lists each case with its value, its distance and its horizon', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'cases')
    const detail = c.locator('[data-testid="case-detail"]')
    await expect(detail).toContainText(/bull/i)
    await expect(detail).toContainText('$180.00')
    await expect(detail).toContainText('%')
    await expect(detail).toContainText('12 months')
  })

  /**
   * The probability row is the thing that used to clip.
   *
   * Measured at 390×844: a row was 64.5px, the pane 225px, and three rows plus
   * the 28px status row came to 254 — so the line telling the reader their
   * probabilities need fixing sat 29.5px below the edge, where
   * `overflow-hidden` deleted it.
   */
  test('the probability status and its repair are fully visible', async ({ page }) => {
    for (const [slug, state, cta] of [
      [WIDE, 'no-probabilities', 'add-probabilities'],
      [DENSE, 'invalid-probabilities', 'fix-probabilities'],
    ] as const) {
      const c = card(page, slug)
      await toPane(c, 'cases')
      const row = c.locator(`[data-slot="${state}"]`)
      await expect(row, slug).toBeVisible()
      await expect(c.locator(`[data-slot="${cta}"]`), slug).toBeVisible()

      const rowBox = (await row.boundingBox())!
      const pane = (await c.locator('[data-testid="case-detail"]').boundingBox())!
      const bar = (await c.locator('[data-slot="actions"]').boundingBox())!
      // Inside its own pane, and above the action bar.
      expect(rowBox.y + rowBox.height, slug).toBeLessThanOrEqual(pane.y + pane.height + 1)
      expect(rowBox.y + rowBox.height, slug).toBeLessThanOrEqual(bar.y)
    }
  })

  test('shows probabilities per case where the analyst set them', async ({ page }) => {
    const c = card(page, DENSE)
    await toPane(c, 'cases')
    const detail = c.locator('[data-testid="case-detail"]')
    await expect(detail).toContainText('62%')
    await expect(detail).toContainText('15%')
  })

  /** A bounded list with a stated remainder, never an inner scroller. */
  test('states what it could not fit rather than scrolling', async ({ page }) => {
    const c = card(page, DENSE)
    await toPane(c, 'cases')
    await expect(c.locator('[data-testid="cases-truncated"]')).toContainText('more case')
    const overflow = await c.locator('[data-testid="case-detail"]').evaluate(el => ({
      y: el.scrollHeight - el.clientHeight,
      x: el.scrollWidth - el.clientWidth,
    }))
    expect(overflow.y).toBeLessThanOrEqual(1)
    expect(overflow.x).toBeLessThanOrEqual(1)
  })
})

// ── Geometry, at both widths ────────────────────────────────────────────────

test.describe('the card holds together', () => {
  for (const width of [390, 320]) {
    test(`no pane overflows or collides at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(200)
      for (const slug of [WIDE, DENSE, PRICED]) {
        const c = card(page, slug)
        for (const pane of ['ladder', 'verdict', 'cases']) {
          await toPane(c, pane)
          const geom = await c.evaluate((root, active) => {
            const bar = root.querySelector('[data-slot="actions"]')!
            const barTop = bar.getBoundingClientRect().top
            const box = root.getBoundingClientRect()
            const bad: string[] = []
            for (const n of root.querySelectorAll('[data-testid], [data-slot], h2, input')) {
              if (bar.contains(n)) continue
              const el = n as HTMLElement
              if (!el.offsetHeight) continue
              /**
               * Only the pane on screen, plus the card chrome outside the track.
               *
               * The inactive panes of a carousel sit to the RIGHT of the visible
               * one by construction — that is what paging is — so measuring them
               * against the card's box reports every one of them as overflowing.
               * The first version of this test did exactly that and called
               * correct behaviour a defect.
               */
              const pane = el.closest('[data-carousel-pane]')
              if (pane && pane.getAttribute('data-carousel-pane') !== active) continue
              const r = el.getBoundingClientRect()
              const id = el.getAttribute('data-testid') ?? el.getAttribute('data-slot') ?? el.tagName
              if (r.bottom > barTop + 1) bad.push(`${id} below the bar`)
              if (r.right > box.right + 1 || r.left < box.left - 1) bad.push(`${id} outside the card`)
            }
            return { bad, scrollX: root.scrollWidth - root.clientWidth }
          }, pane)
          expect(geom.bad, `${slug} / ${pane} @${width}`).toEqual([])
          // The card owns no horizontal scroller; the carousel does.
          expect(geom.scrollX, `${slug} / ${pane} @${width}`).toBeLessThanOrEqual(1)
        }
      }
    })
  }

  /** The feed owns vertical; the card pages sideways and never scrolls down. */
  test('the card introduces no vertical scroller', async ({ page }) => {
    for (const slug of [WIDE, DENSE, PRICED]) {
      const over = await card(page, slug).evaluate(el => el.scrollHeight - el.clientHeight)
      expect(over, slug).toBeLessThanOrEqual(1)
    }
  })
})

// ── Artifacts ───────────────────────────────────────────────────────────────

test.describe('artifacts', () => {
  test('screenshot: respond, chosen, with a note', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    await c.locator('[data-verdict="scenario_thesis_weaker"]').click()
    await c.locator('[data-testid="scenario-respond-note"]')
      .fill('Consensus caught up on the margin story before the new capacity landed.')
    await page.waitForTimeout(200)
    await c.screenshot({ path: 'artifacts/cards/scenario-respond-note.png' })
  })

  test('screenshot: ladder with the 52-week range', async ({ page }) => {
    await card(page, WIDE).screenshot({ path: 'artifacts/cards/scenario-ladder-52w.png' })
  })
})
