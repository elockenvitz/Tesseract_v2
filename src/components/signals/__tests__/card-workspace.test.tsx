import { describe, expect, it } from 'vitest'
import { PANE_VIEWPORT_MIN_PX } from '../../../lib/signals/tile-geometry'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render } from '@testing-library/react'

import { SignalCardView } from '../SignalCardView'
import { CasePane } from '../CasePane'
import { EvidencePane } from '../EvidencePane'
import { ScenarioRespond } from '../ScenarioRespond'
import { ScenarioCaseDetail } from '../ScenarioCaseDetail'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'

/**
 * The carousel workspace, and the two dead regions it took to find it.
 *
 * ── What went wrong, in order ─────────────────────────────────────────────
 *
 * 1. The supporting description was the LAST item in the card's flex column,
 *    and free space in a flex column collects after the last item. Every
 *    leftover pixel sat between the description and the footer.
 *
 * 2. So a spacer was added before the description to absorb it — `flex-1`,
 *    which is `flex-grow: 1` and `flex-basis: 0%`, exactly what the carousel
 *    band carries. Two equal claimants: the band was pinned to its `min-h`
 *    floor and the spacer took the rest. Measured on a 836px gallery card, the
 *    workspace was 285px and the gap was 197px. The dead region had not been
 *    removed, only moved above the description and given a reason to grow —
 *    and now it was compressing content to do it.
 *
 * The rule that resolves both: exactly one region in the column may claim the
 * free space, and it is the one showing the investment. The gap is a gap.
 *
 * jsdom applies no layout, so these assert the CONTRACT that produces the
 * geometry — the flex declarations, the order of the regions, and the fact
 * that none of it varies with the active pane. The pixel measurements were
 * taken against a real renderer at 390x844 and 390x667.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const CARD = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}))

const PANES = [
  { id: 'price', label: 'Price', content: <div data-testid="pane-price">chart</div> },
  { id: 'case', label: 'Case', content: <div data-testid="pane-case">case</div> },
  { id: 'respond', label: 'Respond', content: <div data-testid="pane-respond">respond</div> },
]

const noop = () => {}

/**
 * jsdom has no `Element.scrollTo`, and the carousel pages with it.
 *
 * Stubbed here rather than worked around in the component: `scrollTo` is how
 * the pager animates, and `scrollLeft` is not the same behaviour. The stub
 * records nothing — these tests are about the shell's structure, not about
 * where the track ended up.
 */
if (!('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true, value: () => {},
  })
}

function shell(over: Record<string, unknown> = {}) {
  const { container } = render(
    <SignalCardView card={CARD} panes={PANES} onAction={noop} {...over} />,
  )
  return container
}

/** The card's content column: the flex parent every region below lives in. */
const column = (c: HTMLElement) =>
  c.querySelector('[data-slot="body-region"]')!.parentElement!

const slots = (c: HTMLElement) =>
  [...column(c).children].map(el =>
    (el as HTMLElement).dataset.slot ?? (el as HTMLElement).dataset.testid ?? el.tagName,
  )

describe('one region owns the spare height, and it is the workspace', () => {
  it('gives the workspace a grow factor three orders above the gap', () => {
    const c = shell()
    const band = c.querySelector('[data-testid="card-carousel"]')!.parentElement!
    const gap = c.querySelector('[data-slot="body-spacer"]')!

    expect(band.className).toContain('grow-[999]')
    expect(gap.className).toContain('grow')
    expect(gap.className).not.toContain('grow-[999]')
    // The declaration that made them equal claimants.
    expect(gap.className).not.toContain('flex-1')
  })

  it('starts the workspace at a share rather than walling it in', () => {
    /**
     * `basis-[38%]` and not `min-h-[38%]`.
     *
     * A minimum is absolute: on a card too short for its content the band kept
     * its 38% and the overflow came out of the bottom — measured at a 612px
     * card, the description sat 78px THROUGH the action bar. A basis is the
     * same 38% as a starting point, so free space is handed back from there
     * when it exists and given back when it does not.
     *
     * ── But the floor is no longer zero ──────────────────────────────────
     *
     * This asserted `min-h-0`, which is permission to shrink to NOTHING — and
     * because the band shrinks rather than overflows, a card sized too short
     * did not clip visibly: the analytical region collapsed and the card
     * rendered as a headline and a button, while its outer height still
     * matched what the resolver predicted. Human review reported it as "Target
     * Reached is now extremely short".
     *
     * A share with a floor is both things at once. It still gives space back
     * rather than pushing the footer off the card, and it cannot give back
     * more than the pane needs to be worth drawing — the same minimum
     * `resolveTile` budgeted for it, so the two cannot disagree.
     */
    const band = shell().querySelector('[data-testid="card-carousel"]')!.parentElement!
    expect(band.className).toContain('basis-[38%]')
    expect(band.className).toContain('shrink')
    expect(band.className).not.toContain('min-h-0')
    expect(band.style.minHeight).toBe(`${PANE_VIEWPORT_MIN_PX}px`)
    expect(band.className).not.toContain('min-h-[38%]')
    expect(band.className).not.toContain('max-h-[46%]')
  })

  it('keeps the gap a fixed size, since it is only a gap', () => {
    const gap = shell().querySelector('[data-slot="body-spacer"]')!
    expect(gap.className).toContain('h-3.5')
    expect(gap.className).toContain('shrink-0')
    // And it renders nothing — an empty box, not a region with content.
    expect(gap.textContent).toBe('')
  })

  it('orders the column so nothing can collect under the description', () => {
    /**
     * Workspace, gap, description, and then the footer outside the column.
     * The description being LAST is what makes the leftover land above it.
     *
     * The context affordance sits at the END of the paragraph rather than
     * below it, which is why this rule is unchanged: a row under the
     * description would be a new item below the slack-absorbing spacer.
     */
    const s = slots(shell())
    expect(s.slice(-2)).toEqual(['body-spacer', 'body-region'])
  })
})

describe('the pager is the bottom of the workspace', () => {
  it('lives inside the band, after the pane track', () => {
    /**
     * Not a sibling of the band. If the pager were in the column it would sit
     * between the workspace and the gap, and the workspace's bottom edge would
     * be wherever the tallest pane happened to end — which is what made the
     * carousel look like it had finished early.
     */
    const c = shell()
    const carousel = c.querySelector('[data-testid="card-carousel"]')!
    const band = carousel.parentElement!
    expect(slots(c)).not.toContain('carousel-dots')

    const kids = [...carousel.children]
    expect(kids.length).toBeGreaterThanOrEqual(2)
    // The track grows; the pager does not. So the pager is pinned to the
    // bottom edge of the band whatever the pane above it contains.
    expect(kids[0].className).toContain('flex-1')
    expect(kids[kids.length - 1].className).toContain('shrink-0')
    expect(band.contains(kids[kids.length - 1])).toBe(true)
  })

  it('hands each pane the whole workspace, bounded', () => {
    // `min-h-0` is what lets a pane be shorter than its content instead of
    // rendering through the pager and the footer beneath it.
    const track = shell().querySelector('[data-testid="card-carousel"]')!.firstElementChild!
    for (const slide of [...track.children]) {
      expect(slide.className).toContain('min-h-0')
      expect(slide.className).toContain('flex-col')
    }
  })
})

describe('the shell does not move when the pane does', () => {
  it('keeps the same regions, in the same order, on every pane', () => {
    /**
     * The outer card is fixed and the workspace is fixed by the shell; only
     * the composition inside it changes. So switching panes cannot move the
     * footer, the description or the card boundary.
     *
     * jsdom reports no geometry, so this asserts the structural invariant that
     * produces it: the column's regions do not depend on which pane is active.
     */
    const c = shell()
    const before = slots(c)
    const dots = [...c.querySelectorAll('[data-slot="carousel-dot"], [aria-label]')]
      .filter(el => ['Price', 'Case', 'Respond'].includes(el.getAttribute('aria-label') ?? ''))
    expect(dots.length).toBe(3)

    for (const dot of dots) {
      fireEvent.click(dot)
      expect(slots(c)).toEqual(before)
      expect(c.querySelector('[data-slot="body-region"]')!.className).toContain('h-[3em]')
      expect(c.querySelector('[data-slot="actions"]')).toBeTruthy()
    }
  })

  it('does not measure content to decide how tall anything is', () => {
    /**
     * The jitter this pass must not reintroduce. The height of every region
     * here comes from CSS — a basis, a grow factor, a fixed box — and never
     * from reading the rendered size of what is inside it and writing it back.
     *
     * The one measurement in the card reads whether the BODY overflows, to
     * decide whether to offer "more". It sets no height, so it cannot feed a
     * reflow back into layout.
     */
    const src = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')
    // No inline height anywhere: nothing writes a measured size back into the
    // layout, which is the loop that made the card twitch while idle.
    expect(src).not.toMatch(/style=\{\{[^}]*height/)
    // The single observer in the card writes a BOOLEAN — whether the body is
    // cut off, for the "more" affordance — and never a dimension.
    expect(src).toContain('const measure = () => setBodyIsLong(')
    expect(src).toContain('const ro = new ResizeObserver(measure)')
  })
})

// ── §42: the content that has to survive a taller workspace ────────────────

describe('the panes still say what they said', () => {
  it('renders the core thesis structure in the case pane', () => {
    const { container, getByText } = render(
      <CasePane
        present={['thesis', 'where_different', 'risks_to_thesis']}
        caseWrittenAt="2026-02-20T00:00:00.000Z"
        daysSinceWritten={192}
        held
        portfolioName="Vision Fund 10K"
        weightPct={4.1}
        coverageOwners={['John Homler']}
      />,
    )
    expect(getByText('Investment thesis')).toBeTruthy()
    expect(getByText('Where we differ')).toBeTruthy()
    expect(getByText('Risks to thesis')).toBeTruthy()
    // Exposure and coverage, the two facts below the thesis that change what a
    // reader does — and the first casualties when a pane was clipped.
    expect(container.textContent).toContain('Vision Fund 10K')
    expect(container.textContent).toContain('John Homler')
    // Centred rather than stretched: a fact table is not a chart.
    expect(container.firstElementChild!.className).toContain('justify-center')
  })

  it('leads the evidence pane with the item that arrived', () => {
    const { container } = render(
      <EvidencePane
        items={[{
          id: 'n1', at: '2026-08-01T00:00:00.000Z', kind: 'note',
          title: 'This company is on fire', authorName: 'Eric Lockenvitz',
          preview: 'Gross margin inflected two quarters early.',
        }]}
        reviewAnchor="2026-02-20T00:00:00.000Z"
      />,
    )
    expect(container.textContent).toContain('This company is on fire')
    expect(container.textContent).toContain('Eric Lockenvitz')
    expect(container.textContent).toContain('Gross margin inflected')
    // The list grows into the workspace; the caveat under it does not.
    expect(container.querySelector('ul')!.className).toContain('flex-1')
  })

  it('lets the case rows share the room instead of stacking at the top', () => {
    /**
     * Measured before this pass at a 836px card: the bordered list filled the
     * pane and the three cases sat in its top half with 145px of empty box
     * beneath them. `grow` with an `auto` basis — NOT `flex-1` — is why a case
     * carrying the analyst's reasoning keeps its own height and only shares
     * what is left over.
     */
    const { container } = render(
      <ScenarioCaseDetail
        price={200}
        cases={[
          { name: 'Bear', price: 150, probability: 20, timeframe: '12m', reasoning: null },
          { name: 'Base', price: 220, probability: 55, timeframe: '12m', reasoning: null },
          { name: 'Bull', price: 300, probability: 25, timeframe: '12m', reasoning: null },
        ]}
        expected={218}
      />,
    )
    // The list also carries a probability status line, which is not a case.
    const rows = [...container.querySelectorAll('[data-testid="case-detail"] > div')]
      .filter(r => /Bear|Base|Bull/.test(r.textContent ?? ''))
    expect(rows.length).toBe(3)
    for (const row of rows) {
      expect(row.className).toContain('grow')
      expect(row.className).not.toContain('flex-1')
      expect(row.className).toContain('shrink-0')
    }
    expect(container.textContent).toContain('Bear')
    expect(container.textContent).toContain('Bull')
  })

  it('composes the respond controls in the middle rather than stretching them', () => {
    /**
     * §23. Four 44px targets stretched to the height of a chart is worse than
     * the gap it would close, so this pane does not fill — it centres.
     *
     * `safe` centring, so content taller than the pane aligns to the START:
     * plain centring clips both ends, and the end that matters here is the
     * answers.
     */
    const { container, getByText } = render(
      <ScenarioRespond
        question="Has the investment view changed?"
        selected={null}
        onSelect={noop}
        note=""
        onNoteChange={noop}
      />,
    )
    const root = container.querySelector('[data-testid="scenario-respond"]')!
    expect(root.className).toContain('[justify-content:safe_center]')
    expect(getByText('Thesis intact')).toBeTruthy()
    // And the controls keep their touch floor — the thing that must not give.
    expect(container.querySelector('[data-testid="scenario-respond-options"]')!.className)
      .toContain('shrink-0')
  })
})
