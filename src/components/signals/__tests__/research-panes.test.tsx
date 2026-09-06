import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'

import { CasePane } from '../CasePane'
import { EvidencePane } from '../EvidencePane'
import { PriceContext } from '../PriceContext'
import type { EvidenceArrival } from '../../../lib/research/case-state'

/**
 * The three Research panes, asserted on what they must never say.
 *
 * Most of these are honesty guards rather than layout checks: a pane that
 * renders a plausible-looking number it does not have is the failure mode this
 * family is most exposed to, and it is invisible in a screenshot.
 */

const ev = (over: Partial<EvidenceArrival> = {}): EvidenceArrival => ({
  id: 'e1', at: '2026-04-01T00:00:00Z', kind: 'note',
  authorName: 'Priya Raman', title: 'PSKY x WBD Analysis', preview: 'A short preview.',
  ...over,
})

describe('EvidencePane', () => {
  it('lists each arrival with its author and date', () => {
    render(<EvidencePane items={[ev(), ev({ id: 'e2', at: '2026-05-02T00:00:00Z', title: null })]} reviewAnchor="2026-01-01T00:00:00Z" />)
    expect(screen.getByText('PSKY x WBD Analysis')).toBeTruthy()
    // A note with no title says what it is rather than showing an empty row.
    expect(screen.getByText('Untitled note')).toBeTruthy()
    expect(screen.getAllByText(/Priya Raman/).length).toBe(2)
    expect(screen.getByText(/2 arrived since the case/)).toBeTruthy()
  })

  it('names a quick thought as one, since it has no title to show', () => {
    render(<EvidencePane items={[ev({ kind: 'thought', title: null })]} reviewAnchor={null} />)
    expect(screen.getByText('Quick thought')).toBeTruthy()
  })

  it('never claims the evidence supports or challenges anything', () => {
    /**
     * The single most important assertion in this file. `note_type` is a
     * document class and `sentiment` is about the asset; neither is a relation
     * to the thesis, and nothing else records one. The pane says so explicitly
     * rather than leaving the reader to assume the product has already judged.
     */
    const { container } = render(<EvidencePane items={[ev()]} reviewAnchor="2026-01-01T00:00:00Z" />)
    // Matched against ASSERTIVE phrasing only. The pane's own disclaimer uses
    // the same two verbs, which is the point — the only place a stance appears
    // is in the sentence saying nobody has taken one.
    expect(container.textContent).not.toMatch(
      /(supports|challenges|contradicts|confirms|refutes) the (thesis|case)(?!\.\s*That is the review)/i,
    )
    expect(container.textContent).toMatch(/Nothing records whether this supports or challenges the thesis/)
    expect(container.textContent).not.toMatch(/\b(bullish|bearish|positive for|negative for)\b/i)
  })

  it('tints nothing, because nothing here is graded', () => {
    const { container } = render(<EvidencePane items={[ev()]} reviewAnchor={null} />)
    const classes = container.innerHTML
    expect(classes).not.toMatch(/text-(red|rose|green|emerald|amber)-/)
  })

  it('renders nothing at all when there is no evidence', () => {
    const { container } = render(<EvidencePane items={[]} reviewAnchor="2026-01-01T00:00:00Z" />)
    // An empty pane in a carousel costs a swipe and teaches the reader that
    // swiping is not worth it.
    expect(container.firstChild).toBeNull()
  })
})

describe('CasePane', () => {
  it('shows every core section, present or not', () => {
    render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    // The product's own field names, not a third vocabulary for the same
    // three fields. `research_fields` calls them exactly this.
    expect(screen.getByText('Investment thesis')).toBeTruthy()
    expect(screen.getByText('Where we differ')).toBeTruthy()
    expect(screen.getByText('Risks to thesis')).toBeTruthy()
    // And the heading names the SET, so three rows cannot read as the case.
    expect(screen.getByText('Core thesis')).toBeTruthy()
    expect(screen.getAllByLabelText('not written')).toHaveLength(2)
    expect(screen.getAllByLabelText('written')).toHaveLength(1)
  })

  it('never turns presence into a score', () => {
    // 1 of 3 is not 33% of a case. The sections are different kinds of work,
    // not interchangeable units of it.
    const { container } = render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    expect(container.textContent).not.toMatch(/%|33|67|complete|score|quality/i)
  })

  it('says "written" for the edit, and says nothing about a review that did not happen', () => {
    const { container } = render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    expect(container.textContent).toMatch(/Last written 177 days ago/)
    expect(container.textContent).not.toMatch(/review|looked/i)
  })

  it('shows both clocks when a completed review is newer than the edit', () => {
    /**
     * §6. The review is why the card may be quiet; the write date is what the
     * reader will actually find when they open the case. Before the clocks were
     * separated this pane said "Last written 5 days ago" about a case last
     * edited in November.
     */
    const { container } = render(
      <CasePane present={['thesis']} caseWrittenAt="2025-11-21T00:00:00Z" daysSinceWritten={283} daysSinceReviewed={5} />,
    )
    expect(container.textContent).toMatch(/Reviewed 5 days ago · unchanged/)
    expect(container.textContent).toMatch(/Last written 283 days ago/)
    // The write date is never restated as a review date.
    expect(container.textContent).not.toMatch(/written 5 days/)
  })

  it('says so plainly when the case has never been written', () => {
    const { container } = render(<CasePane present={[]} caseWrittenAt={null} daysSinceWritten={null} />)
    expect(container.textContent).toMatch(/Never written/)
  })
})

describe('CasePane, as the one pane for a name with no case', () => {
  /**
   * The `Known` pane's assertions, moved rather than dropped.
   *
   * A no-case card carried Known, Start, Case and Respond — four full-screen
   * panes for a state whose entire truth is "there is no written case". The
   * facts and the section rows answer one question between them, so they are
   * one pane now; these are the honesty rules that pane still has to keep.
   */
  const gap = {
    present: [] as never[],
    caseWrittenAt: null,
    daysSinceWritten: null,
  }

  it('names the current weight when there is one', () => {
    render(<CasePane {...gap} held portfolioName="Vision Fund 10K" weightPct={5.1} portfolioCount={1} />)
    expect(screen.getByText('5.1% · Vision Fund 10K')).toBeTruthy()
  })

  it('never prints 0.0% for a held name with no weight recorded', () => {
    // 26 of 36 current production positions carry no weight at all.
    const { container } = render(<CasePane {...gap} held portfolioName="Vision Fund 10K" portfolioCount={1} />)
    expect(screen.getByText('Vision Fund 10K')).toBeTruthy()
    expect(container.textContent).not.toMatch(/0\.0%/)
  })

  it('shows no exposure row at all for a covered but unheld name', () => {
    // ORCL and the twelve like it. Coverage put them in the universe; a book
    // row would be a claim the data does not support.
    const { container } = render(<CasePane {...gap} coverageOwners={['Priya Raman']} />)
    expect(screen.getByText('Priya Raman')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Exposure/)
  })

  it('counts several live ideas rather than picking one', () => {
    render(<CasePane {...gap} liveIdeas={[{ id: 'a', action: 'buy' }, { id: 'b', action: 'sell' }]} />)
    expect(screen.getByText('2 live')).toBeTruthy()
  })

  it('says the case was never written, and shows no facts it does not have', () => {
    const { container } = render(<CasePane {...gap} />)
    expect(container.textContent).toMatch(/Never written/)
    // No table of dashes where there is nothing to say.
    expect(container.textContent).not.toMatch(/Covered by|Exposure|Live idea|Notes on file/)
  })

  it('still refuses to turn presence into a score', () => {
    const { container } = render(<CasePane {...gap} held weightPct={5.1} portfolioName="Core" />)
    expect(container.textContent).not.toMatch(/0\/3|33%|67%|complete|score|quality/i)
  })
})

describe('CasePane names the case honestly', () => {
  it('shows supporting case content separately from the core thesis', () => {
    /**
     * NVDA in production: a written business model and no thesis. Folding it
     * into the three rows would make the count mean two things; omitting it is
     * what let the card claim nothing was written.
     */
    render(
      <CasePane
        present={[]} supporting={['business_model']}
        caseWrittenAt={null} daysSinceWritten={null}
      />,
    )
    expect(screen.getByText('Supporting case')).toBeTruthy()
    expect(screen.getByText('Business model')).toBeTruthy()
    // Still no thesis, and the core rows still say so.
    expect(screen.getAllByLabelText('not written')).toHaveLength(3)
  })

  it('omits the supporting block entirely when there is none', () => {
    const { container } = render(
      <CasePane present={[]} caseWrittenAt={null} daysSinceWritten={null} />,
    )
    expect(container.textContent).not.toMatch(/Supporting case/)
  })

  it('never counts supporting fields into the core-thesis rows', () => {
    const { container } = render(
      <CasePane
        present={['thesis']} supporting={['business_model', 'key_catalysts']}
        caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177}
      />,
    )
    expect(container.querySelectorAll('[data-section]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-supporting]')).toHaveLength(2)
  })
})

describe('the anchor marker is geometrically true or absent', () => {
  /**
   * §8–§10. `PriceContext` defaults to 6M and the snap tolerance was a
   * fortnight, so an anchor 192 days old — ten days outside the window — was
   * pulled onto the first visible point and labelled "Case written". The marker
   * pointed at a close from ten days AFTER the date on its own label.
   */
  const series = (days: number) => Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i * 0.1,
  }))
  const S = series(400)
  const NOW = new Date(S[S.length - 1].date + 'T00:00:00Z')

  const marker = (date: string, range: 'ALL' | '6M' | '1M') => {
    const { container } = render(
      <PriceContext
        symbol="PLTR" series={S} now={NOW} initialRange={range}
        markers={[{ date, label: 'Case written', kind: 'event' }]}
      />,
    )
    return container.textContent?.includes('Case written') ?? false
  }

  it('draws the marker when the anchor is inside the window', () => {
    // 60 days back, comfortably inside 6M.
    expect(marker(S[S.length - 60].date, '6M')).toBe(true)
  })

  it('does NOT draw it when the anchor is outside the window', () => {
    /**
     * The bug, pinned. This anchor is ~192 days old against a 182-day window:
     * ten days out, which the old fortnight tolerance absorbed by snapping to
     * the edge. It must simply be absent now.
     */
    expect(marker(S[S.length - 192].date, '6M')).toBe(false)
  })

  it('draws that same anchor once the window contains it', () => {
    // Which is exactly what `horizonContaining` opens the Research pane on.
    expect(marker(S[S.length - 192].date, 'ALL')).toBe(true)
  })

  it('disappears rather than clamping when the reader narrows the range', () => {
    // §10: manual narrowing is allowed to lose the marker. Faking it is not.
    expect(marker(S[S.length - 60].date, '1M')).toBe(false)
  })

  it('still absorbs a weekend', () => {
    // The gap the tolerance actually exists for: an anchor dated Saturday has
    // its nearest close on the Monday.
    const inside = S[S.length - 60].date
    const saturday = new Date(new Date(inside).getTime() + 2 * 86_400_000).toISOString().slice(0, 10)
    expect(marker(saturday, '6M')).toBe(true)
  })
})

describe('the arrival list is bounded and individually actionable', () => {
  const arrivals = (n: number) => Array.from({ length: n }, (_, i) => ev({
    id: `e${i}`, at: `2026-0${(i % 9) + 1}-01T00:00:00Z`, title: `Note ${i}`,
  }))

  it('lists newest first, because that is the one that put the card on screen', () => {
    render(<EvidencePane items={arrivals(3)} reviewAnchor={null} />)
    const titles = [...document.querySelectorAll('[data-slot="evidence-item"]')]
      .map(el => el.querySelector('p')?.textContent)
    expect(titles).toEqual(['Note 2', 'Note 1', 'Note 0'])
  })

  it('caps the list and counts the rest truthfully', () => {
    // The pane is one screen; a fifth row makes it a scroller inside a
    // carousel inside a feed.
    const { container } = render(<EvidencePane items={arrivals(7)} reviewAnchor={null} />)
    expect(container.querySelectorAll('[data-slot="evidence-item"]')).toHaveLength(4)
    expect(container.textContent).toContain('+3 more since the thesis was written')
  })

  it('opens each arrival individually, never choosing one for the reader', () => {
    // §12: with several arrivals the card must not pick a note on their behalf.
    const onOpen = vi.fn()
    render(<EvidencePane items={arrivals(3)} reviewAnchor={null} onOpen={onOpen} />)
    const rows = [...document.querySelectorAll('[data-slot="evidence-item"]')]
    fireEvent.click(rows[1])
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe('e1')
  })

  it('offers no affordance where there is nowhere to go', () => {
    const { container } = render(<EvidencePane items={arrivals(2)} reviewAnchor={null} />)
    expect(container.querySelector('[data-slot="evidence-item"][role="button"]')).toBeNull()
  })
})

describe('the supporting description: two lines, fixed, at the bottom', () => {
  /**
   * ── Two bugs, one region ─────────────────────────────────────────────────
   *
   * The first was jitter. `line-clamp-1` is `-webkit-line-clamp` over a box
   * whose height still comes from wrapped content, and that height is a
   * function of the available WIDTH — which settles late, as the carousel
   * mounts, a chart resolves, and the `more` affordance appears after the
   * first measurement pass. Each settle re-wrapped the sentence, the clamp box
   * re-resolved, and the chart, pager and footer moved with it.
   *
   * `truncate` stopped that by removing the wrap, and overcorrected: one line
   * is not enough of a sentence to be worth the space, and the card then had
   * a hand's width of nothing between the description and the footer, because
   * free space in a flex column collects after the LAST item.
   *
   * The height was never the clamp's job. A two-line clamp inside a box fixed
   * at `h-[3em]`, with the slack spent above it rather than below, is both
   * stable and readable.
   *
   * jsdom has no layout, so what is asserted here is the CONTRACT that makes
   * the geometry invariant — a class that resolves a height from content, or a
   * clamp with no fixed box around it, is what would put the movement back.
   * The idle-and-resize measurements were taken against the real renderer.
   */
  const src = readFileSync(
    resolve(__dirname, '../SignalCardView.tsx'), 'utf8',
  )

  it('reserves exactly two line-heights, whatever the sentence does', () => {
    // Two line-heights, browsing or answering. The response above it gets its
    // room from `responseBandMinPx` being budgeted properly, not from this box
    // giving way — see `respond-contract`.
    expect(src).toContain("!bodyIsPrimaryProse(card.type) && 'h-[3em] overflow-hidden'")
    /**
     * The one-line BOX is what had to go, and it is still gone.
     *
     * `h-[1.5em]` was the jitter: a box sized from the text re-wraps and moves
     * everything under it. The box is two line-heights and fixed, whatever
     * fills it — which is now one clamped line of the finding plus the
     * affordance, rather than two lines with a control floated over the
     * second. A one-line CLAMP inside a two-line box moves nothing, which is
     * the property this rule was always about.
     */
    expect(src).not.toContain("'h-[1.5em]")
    expect(src).not.toContain("'line-clamp-1'")
  })

  it('never lets the box take its height from the text', () => {
    // The paragraph clamps; the wrapper is what holds the geometry. If the
    // wrapper were sized by content, every clamp re-resolve would move the
    // footer again — which is the original bug, exactly.
    const region = src.slice(src.indexOf('data-slot="body-region"'))
    expect(region.slice(0, 900)).not.toMatch(/min-h-fit|h-auto/)
  })

  it('spends the leftover height above the description, not below it', () => {
    expect(src).toContain('data-slot="body-spacer"')
    expect(src).toContain('data-slot="body-spacer" className="h-3.5 shrink-0 grow"')
  })

  it('does not let the gap compete with the workspace for that height', () => {
    /**
     * The regression this pins.
     *
     * The gap was `min-h-[0.875rem] flex-1` — the same `flex-grow: 1` and
     * `flex-basis: 0%` as the carousel band, so the two split the free space.
     * Measured on a 836px gallery card: the workspace sat at 285px and this
     * took 197px, and every pane was compressed while the card carried a
     * hand's width of nothing between the pager and the description.
     *
     * 999 to 1. Whole numbers on both sides, deliberately: grow factors that
     * sum to less than one distribute only that fraction of the free space and
     * leave the rest unused, so `0.001` against `1` left the space exactly
     * where it was.
     */
    /**
     * The floor moved off the class and onto the style.
     *
     * `min-h-0` was permission to shrink to nothing, and the band shrinks
     * rather than overflows — so a card sized too short collapsed its
     * analytical region silently while its outer height still matched the
     * prediction. The share is unchanged; only the floor is real now, and it
     * is the same minimum `resolveTile` budgets for the pane.
     */
    expect(src).toContain("merged ? 'grow-[999] shrink basis-[38%]'")
    /**
     * Two floors, because a band holding a RESPONSE is not compressible.
     *
     * `PANE_VIEWPORT_MIN_PX` is the least a pane needs to be worth drawing,
     * and it is a fair trade for evidence: a chart at 168px is a small chart.
     * It is not a fair trade for a note field, which at 24px is not small but
     * clipped — the pane's content box held 199px inside 179 with
     * `overflow-y: hidden` and simply removed the difference.
     *
     * So a card that can be answered floors at what answering occupies. Keyed
     * on HAVING the pane rather than on the reader being in it, so the card
     * does not change height under a thumb mid-swipe.
     */
    expect(src).toContain('minHeight: judgmentPane')
    expect(src).toContain('responseBandMinPx(2, (merged?.length ?? 0) > 1)')
    // The ceiling survives only as history. Every line that still names it is
    // a comment line — the record of why it went — and none is a class.
    const ceiling = src.split('\n').filter(l => l.includes('max-h-[46%]'))
    expect(ceiling.length).toBeGreaterThan(0)
    for (const line of ceiling) expect(line.trim().startsWith('*')).toBe(true)
  })

  it('puts the spacer before the description, which is what anchors it', () => {
    // Order is the whole mechanism: a growing box after the paragraph would
    // reproduce the dead region it was added to remove.
    expect(src.indexOf('data-slot="body-spacer"'))
      .toBeLessThan(src.indexOf('data-slot="body-region"'))
  })

  it('reserves nothing for a card that carries no prose at all', () => {
    // Short content still gets the full two lines — that is what makes it a
    // contract. An absent body is not short content, and two blank lines above
    // the footer is the same dead region moved down the card.
    expect(src).toContain('{!!card.body?.trim() && (')
  })

  it('keeps primary prose on its own path, with no fixed box', () => {
    // A thought or a note is the finding, not a description of one. It clamps
    // the same way and is NOT forced into the reserved region.
    expect(src).toContain("!bodyIsPrimaryProse(card.type) && 'h-[3em]")
    expect(src).toContain("data-prose-role={bodyIsPrimaryProse(card.type) ? 'primary' : 'supporting'}")
  })

  it('chooses the rendering path from the card TYPE and nothing else', () => {
    /**
     * §22/§30. The role must not be a function of transient UI state — an
     * active pane, an engaged card, a chart still loading, a footer that has
     * morphed. If it were, the region would change height while the reader
     * was looking at it, which is the bug in a new costume.
     */
    const region = src.slice(
      src.indexOf('data-slot="body-region"'),
      // The paragraph's trailing control, which used to be `body-more` and is
      // now the shared context affordance. Same position, one label.
      src.indexOf('data-slot="context-open"'),
    )
    for (const state of ['engaged', 'judgmentOpen', 'activePane', 'primaryOverride', 'merged']) {
      expect(region, `body region switches on ${state}`).not.toContain(state)
    }
  })

  it('still measures overflow, so the full text stays reachable', () => {
    // Both roles clamp vertically again, so there is one axis and one path to
    // the drawer. Losing this would leave a cut sentence with no way to finish
    // it — the region cannot expand, by design.
    expect(src).toContain('el.scrollHeight > el.clientHeight + 1')
    expect(src).not.toContain('el.scrollWidth > el.clientWidth + 1')
  })
})

describe('the price wash is the line colour, not black', () => {
  /**
   * `currentColor` in a `<stop>` does NOT resolve against the shape that
   * references the gradient — it resolves against the GRADIENT element's own
   * inherited colour, and a `<linearGradient>` inside `<defs>` inherits from
   * the `<svg>`, which carries no tone.
   *
   * Measured on the rendered card before the fix: the polygon computed
   * `rgb(225,29,72)` and its stops computed `rgb(0,0,0)`. Black at 0.26 over
   * white is the grey wash under a coloured line that phone review reported
   * twice, through a pass that claimed to have fixed it.
   */
  const src = readFileSync(resolve(__dirname, '../PriceContext.tsx'), 'utf8')
  const spark = readFileSync(resolve(__dirname, '../Sparkline.tsx'), 'utf8')

  it('puts the tone on the gradient element itself', () => {
    expect(src).toMatch(/<linearGradient[^>]*className=\{plotTone\}/)
  })

  it('gives every chart instance its own gradient id', () => {
    // The feed mounts several charts at once; a shared id would let one card's
    // fill resolve to another card's gradient.
    expect(src).toContain('const gradientId = useId()')
    expect(src).toContain('id={gradientId}')
  })

  it('fixes Sparkline, which had the identical construction', () => {
    // Aligning to it as a "reference implementation" is how the defect
    // survived a pass.
    expect(spark).toMatch(/<linearGradient[^>]*className=\{up \?/)
  })
})
