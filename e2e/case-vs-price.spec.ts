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

// ── Two things that must render whole ───────────────────────────────────────

test.describe('nothing on this card is shown cut in half', () => {
  /**
   * The body fits its clamp, so no "more" is painted over the end of it.
   *
   * `SignalCardView` clamps every card body to two lines and, on overflow,
   * positions a "more" affordance over a fade at the end of the second line.
   * That is the right control for prose with something left to read. It is the
   * wrong one for the last five characters of a date, which is what it became
   * here: the builder appended " Ladder last updated 5 Feb 2026." and pushed
   * the body from 2 lines to 3 — measured scrollHeight 68 against clientHeight
   * 45 — so the card printed "Ladder last updated 5 Feb" with "more" over the
   * year.
   *
   * 320px is the assertion that matters. At 390px only the longest fixture
   * clipped; at 320 every one of them did, so a copy trim would have moved the
   * bug rather than fixed it. The date lives under the ladder now.
   */
  for (const width of [390, 360, 320]) {
    test(`the body never clamps to a "more" at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(200)
      for (const slug of [WIDE, DENSE, PRICED]) {
        const c = card(page, slug)
        await expect(c.locator('[data-slot="body-more"]'), `${slug} @${width}`).toHaveCount(0)
        await expect(c.locator('[data-slot="body-toggle"]'), `${slug} @${width}`).toHaveCount(0)
        // And the date that used to be cut is somewhere it cannot be — now on
        // one line with the instruction rather than a sentence of its own.
        await toPane(c, 'ladder')
        await expect(c.locator('[data-testid="ladder-stated-on"]'), slug)
          .toContainText(/Updated \d/)
        // One line at every supported width. It must never wrap.
        const hintLines = await c.locator('[data-testid="ladder-hint"]').evaluate(el =>
          el.getClientRects().length)
        expect(hintLines, `${slug} @${width}`).toBe(1)
      }
    })
  }

  /**
   * A note stays where it was typed instead of scrolling out to the left.
   *
   * The field was an `<input>`, and `index.css` forces 16px on inputs and
   * textareas so iOS does not zoom the viewport on focus and refuse to zoom
   * back. 352px of content width at 16px is about 40 characters; the note may
   * be 300. A single-line field given more than it can show scrolls to keep the
   * CARET visible, so everything before it left the box — measured at
   * `scrollLeft` 190, with the note starting mid-word against the left border.
   *
   * `scrollLeft` is therefore the assertion: a wrapping field cannot have one.
   */
  test('a long note wraps in the field rather than scrolling sideways', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    const note = c.locator('[data-testid="scenario-respond-note"]')
    await note.fill(
      'Consensus caught up on the margin story before the new capacity landed, '
      + 'and the bull case was written against the old cost base.',
    )
    await page.waitForTimeout(200)
    const m = await note.evaluate(el => {
      const n = el as HTMLTextAreaElement
      return { tag: n.tagName, scrollLeft: n.scrollLeft, over: n.scrollWidth - n.clientWidth }
    })
    expect(m.tag).toBe('TEXTAREA')
    expect(m.scrollLeft).toBe(0)
    expect(m.over).toBeLessThanOrEqual(1)
    // The first characters are visible, not 190px off the left edge.
    await expect(note).toHaveValue(/^Consensus caught up/)
  })

  /** And it still clears the indicators and the bar with three rows. */
  test('the taller note field still clears the indicators', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    const note = (await c.locator('[data-testid="scenario-respond-note"]').boundingBox())!
    const dots = (await c.locator('[data-testid="carousel-indicators"]').boundingBox())!
    expect(note.y + note.height).toBeLessThanOrEqual(dots.y + 1)
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


// ── The price header, and the Respond column ────────────────────────────────

test.describe('the price header states one metric, whole', () => {
  /**
   * It read `AMZN 266.43 -32.4% t…` on the phone. Four elements plus an expand
   * control plus six range chips in a 390px row, and the compare figure
   * carried `truncate` — an ellipsized metric, which is the one thing a number
   * in a header may never be.
   */
  for (const width of [390, 360, 320]) {
    test(`nothing in the header truncates at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const c = card(page, PRICED)
      await toPane(c, 'price')
      const clipped = await c.evaluate(el => {
        const bad: string[] = []
        el.querySelectorAll('[data-testid="price-readout"], [data-testid="price-change"]')
          .forEach(n => {
            if (n.scrollWidth > n.clientWidth + 1) bad.push(`${n.getAttribute('data-testid')} clipped`)
          })
        return bad
      })
      expect(clipped, `@${width}`).toEqual([])
      // The price is whole and carries its currency.
      await expect(c.locator('[data-testid="price-readout"]')).toHaveText(/^\$[\d,]+\.\d\d$/)
    })
  }

  /** The ticker is gone — the card's headline says AMZN 200px above this. */
  test('the header carries no ticker and no case-gap figure', async ({ page }) => {
    const c = card(page, PRICED)
    await toPane(c, 'price')
    await expect(c.locator('[data-testid="price-compare"]')).toHaveCount(0)
    const header = await c.locator('[data-testid="price-change"]').textContent()
    // The window return, and nothing else. Never "% to bull" — that is the
    // top card's metric — and no "· 6M" suffix either: the range chips at the
    // other end of this row already name the window, one of them filled.
    expect(header).not.toMatch(/to (bull|bear|base)/i)
    expect(header).toMatch(/^[+-]?\d+\.\d%$/)
    // The window is still assertable, and still follows the selection.
    await expect(c.locator('[data-testid="price-change"]'))
      .toHaveAttribute('data-range', /^(5d|1m|3m|6m|1y|all)$/i)
  })

  /** Change the range, and the number changes with it. */
  test('the return follows the selected timeframe', async ({ page }) => {
    const c = card(page, PRICED)
    await toPane(c, 'price')
    const change = c.locator('[data-testid="price-change"]')
    const ranges = c.locator('[data-price-range]')
    const n = await ranges.count()
    expect(n).toBeGreaterThan(1)
    await ranges.nth(0).click(); await page.waitForTimeout(250)
    const first = await change.getAttribute('data-range')
    await ranges.nth(n - 1).click(); await page.waitForTimeout(250)
    expect(await change.getAttribute('data-range')).not.toBe(first)
  })
})

test.describe('the Respond column stacks, at every width', () => {
  for (const width of [390, 360, 320]) {
    for (const answer of [null, 'scenario_cases_outdated']) {
      test(`sections keep positive separation at ${width}px, ${answer ?? 'unanswered'}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        const c = card(page, WIDE)
        await toPane(c, 'verdict')
        if (answer) { await c.locator(`[data-verdict="${answer}"]`).click(); await page.waitForTimeout(200) }

        const g = await c.evaluate(el => {
          const r = (s: string) => el.querySelector(s)!.getBoundingClientRect()
          const grid = r('[data-testid="scenario-respond-options"]')
          const help = r('[data-testid="scenario-respond-consequence"]')
          const label = el.querySelector('label[for="scenario-respond-note"]')!.getBoundingClientRect()
          const ta = r('[data-testid="scenario-respond-note"]')
          const pager = r('[data-testid="carousel-indicators"]')
          return {
            gridBottom: grid.bottom, helpTop: help.top, helpBottom: help.bottom,
            labelTop: label.top, taTop: ta.top, taBottom: ta.bottom,
            taHeight: ta.height, pagerTop: pager.top,
            minButton: Math.min(...[...el.querySelectorAll('[data-verdict]')]
              .map(b => b.getBoundingClientRect().height)),
          }
        })

        // The stack, in order, every boundary strictly positive.
        expect(g.gridBottom, 'grid → helper').toBeLessThanOrEqual(g.helpTop + 1)
        expect(g.helpBottom, 'helper → label').toBeLessThanOrEqual(g.labelTop + 1)
        expect(g.labelTop, 'label → textarea').toBeLessThanOrEqual(g.taTop + 1)
        expect(g.taBottom, 'textarea → pager').toBeLessThanOrEqual(g.pagerTop + 1)
        // The answers keep their touch targets and the note stays usable.
        expect(g.minButton, 'touch target').toBeGreaterThanOrEqual(44)
        expect(g.taHeight, 'note height').toBeGreaterThanOrEqual(44)
      })
    }
  }

  test('a long note stays inside the field and above the pager', async ({ page }) => {
    const c = card(page, WIDE)
    await toPane(c, 'verdict')
    const note = c.locator('[data-testid="scenario-respond-note"]')
    await note.fill('x'.repeat(300))
    await page.waitForTimeout(200)
    const g = await c.evaluate(el => {
      const ta = el.querySelector('[data-testid="scenario-respond-note"]') as HTMLTextAreaElement
      const pager = el.querySelector('[data-testid="carousel-indicators"]')!.getBoundingClientRect()
      return { bottom: ta.getBoundingClientRect().bottom, pagerTop: pager.top, scrollLeft: ta.scrollLeft }
    })
    // It scrolls vertically inside the field; it never grows into the pager.
    expect(g.bottom).toBeLessThanOrEqual(g.pagerTop + 1)
    expect(g.scrollLeft).toBe(0)
  })
})


// ── The probability view, measured where layout actually happens ────────────

test.describe('the EV distribution shares the ruler geometry', () => {
  /**
   * jsdom reports no layout, so the unit tests can only prove the path DATA is
   * right. This proves the element carrying it is the right size — which is
   * the bug they could not have caught.
   *
   * An `<svg>` with a viewBox is a replaced element: given a height and no
   * explicit width it takes its width from the viewBox's own aspect ratio, not
   * from `inset-x-0`. Measured before the fix, the axis box was 354 / 324 /
   * 284px across three viewports and the SVG was 220px at ALL THREE — 100:46
   * against its resolved height. The path correctly spanned 4-96 of a 100-unit
   * viewBox and was mapped onto 202px of a 326px axis, so the curve began at
   * the left edge and Base and Bull fell outside it.
   */
  const EV_CARD = 'scenario-at-expected'   // COH: 80/100/140 at 25/50/25

  for (const width of [390, 360, 320]) {
    test(`the curve fills the ruler and lands on every dot at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const c = card(page, EV_CARD)
      await c.locator('[data-testid="ladder-expected-hit"]').click()
      await page.waitForTimeout(400)

      const g = await c.evaluate(el => {
        const svg = el.querySelector('[data-testid="ladder-curve"]') as SVGSVGElement
        const path = svg.querySelectorAll('path')[1]
        const sr = svg.getBoundingClientRect()
        const vb = svg.getAttribute('viewBox')!.split(' ').map(Number)
        const toScreen = (vx: number) => sr.left + (vx - vb[0]) / vb[2] * sr.width
        const pts = [...path.getAttribute('d')!.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)]
          .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
        const box = (el.querySelector('[data-testid="ladder-baseline-group"]')!
          .parentElement as HTMLElement).getBoundingClientRect()
        const dots = [...el.querySelectorAll('[data-testid="ladder-dot"]')]
          .map(n => { const b = n.getBoundingClientRect(); return b.left + b.width / 2 })
          .sort((a, b) => a - b)
        const anchors = dots.map(dx => {
          const near = pts.reduce((best, q) =>
            Math.abs(toScreen(q.x) - dx) < Math.abs(toScreen(best.x) - dx) ? q : best, pts[0])
          return { dx: toScreen(near.x) - dx, h: vb[3] - near.y }
        })
        return {
          svgL: sr.left, svgW: sr.width, boxL: box.left, boxW: box.width, anchors,
          weights: [...el.querySelectorAll('[data-testid="ladder-dot-weight"]')].map(n => n.textContent),
          evLane: !!el.querySelector('[data-testid="ladder-expected-label"]'),
          header: el.querySelector('[data-testid="ladder-ev-header"]')?.textContent ?? null,
          nowOpacity: getComputedStyle(el.querySelector('[data-testid="ladder-tape"]')!).opacity,
        }
      })

      // ONE coordinate space: the plot overlay IS the ruler.
      expect(Math.abs(g.svgL - g.boxL), `left @${width}`).toBeLessThanOrEqual(1)
      expect(Math.abs(g.svgW - g.boxW), `width @${width}`).toBeLessThanOrEqual(1)

      // Every case dot has a curve sample on it, in screen pixels.
      for (const [i, a] of g.anchors.entries()) {
        expect(Math.abs(a.dx), `${['Bear', 'Base', 'Bull'][i]} @${width}`).toBeLessThanOrEqual(2)
      }

      // 25 / 50 / 25 — Base is the peak, the tails match.
      const [bear, base, bull] = g.anchors.map(a => a.h)
      expect(base, `peak @${width}`).toBeGreaterThan(bear)
      expect(base).toBeGreaterThan(bull)
      expect(Math.abs(bear - bull) / base, `tails @${width}`).toBeLessThan(0.05)

      // The probabilities render, and the ladder remnants do not.
      expect(g.weights, `weights @${width}`).toEqual(['25%', '50%', '25%'])
      expect(g.evLane, `EV lane label @${width}`).toBe(false)
      expect(g.header).toContain('Expected value')
      expect(g.nowOpacity, `NOW @${width}`).toBe('0')
    })
  }

  test('deselecting restores the ladder exactly', async ({ page }) => {
    const c = card(page, EV_CARD)
    const xs = () => c.evaluate(el =>
      [...el.querySelectorAll('[data-testid="ladder-dot"]')]
        .map(n => n.getBoundingClientRect().left).sort((a, b) => a - b))
    const before = await xs()
    const hit = c.locator('[data-testid="ladder-expected-hit"]')
    await hit.click(); await page.waitForTimeout(400)
    await hit.click(); await page.waitForTimeout(400)
    expect(await xs()).toEqual(before)
    await expect(c.locator('[data-testid="ladder-curve"]')).toHaveCount(0)
    // NOW and the market range are back.
    expect(await c.evaluate(el =>
      getComputedStyle(el.querySelector('[data-testid="ladder-tape"]')!).opacity)).toBe('1')
  })
})
