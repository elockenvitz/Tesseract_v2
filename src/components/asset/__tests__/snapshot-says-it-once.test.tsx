import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

/**
 * The Overview says each thing once, and only when there is something to say.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Measured on AMZN at 1920 — 899px of Overview across five bands, roughly a
 * third of it restating either the header strip directly above it or the
 * block directly above it:
 *
 *  - THE CASE TWICE. "Our view" (250px) printed the three core sections with
 *    their prose. "Research perspectives" (224px) immediately below printed
 *    the same three section names again, "1 entry" each, by the same single
 *    contributor — a table of contents for the block above it.
 *  - FRESHNESS FIVE TIMES. The strip ("11 mo old", "no new research since"),
 *    the header chip ("Stale"), "Our view" ("written 11 months ago"), "What
 *    changed" (its meta AND its body), and the perspectives block ("newest
 *    update 11mo ago — may be stale").
 *  - A BAND TO SAY NOTHING HAPPENED. "What changed" always rendered; on a
 *    quiet name its whole content was "No research has been filed since the
 *    case was last written", which the strip states permanently in three
 *    words.
 *  - THE RATING AND THE TARGET TWICE. Each is in the strip; the rail beside
 *    "Our view" printed the firm rating again and the foot of "Exposure"
 *    printed the target and its upside again.
 *
 * ── The rule these cases hold ────────────────────────────────────────────
 *
 * The strip is sticky and always on screen. A block whose entire content is
 * a restatement of it is not informing the reader, it is occupying the place
 * where something might have. So the Overview carries what the strip CANNOT:
 * the prose, the spread around the target, the full position, the record —
 * and each conditional block earns its space or is absent.
 */

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE
let ratings: { id: string }[] = []
let consensus: { value: string; count: number; percentage: number }[] = []
let myRating: { rating_value: string } | undefined

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})
vi.mock('../../../hooks/useAssetDecisionTimeline', () => ({
  useAssetDecisionTimeline: () => ({
    events: [], allEvents: [],
    phaseCounts: { all: 0, exploratory: 0, formal: 0, execution: 0, review: 0 },
    isLoading: false, isError: false,
  }),
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings, consensus, myRating, isLoading: false }),
}))
vi.mock('../../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios: [], isLoading: false }),
}))
vi.mock('../../coverage/CoverageDisplay', () => ({
  CoverageDisplay: () => <div data-testid="coverage" />,
}))
vi.mock('../../portfolio-v2/PortfolioVisual', async importOriginal => {
  const actual = await importOriginal<typeof import('../../portfolio-v2/PortfolioVisual')>()
  return { ...actual, FrameworkScale: () => <div data-testid="ladder" /> }
})

import { InvestmentSnapshot } from '../InvestmentSnapshot'

const ASSET = { id: 'a-1', symbol: 'AMZN', company_name: 'Amazon.com, Inc.' }
const WRITTEN = '2025-11-20T00:00:00Z'

const contrib = (section: string, created_by: string) => ({
  id: `${section}-${created_by}`,
  section,
  content: 'We think this name is mispriced.',
  created_by,
  is_archived: false,
}) as never

const FIELDS = [{ field_id: 'thesis', label: 'Investment Thesis' }] as never[]

function renderSnapshot(props: Partial<React.ComponentProps<typeof InvestmentSnapshot>> = {}) {
  return render(
    <InvestmentSnapshot
      asset={ASSET}
      coverage={[]}
      currentQuote={{ price: 243.79, timestamp: '2026-10-29T20:00:00Z' }}
      onOpenSubPage={() => {}}
      {...props}
    />,
  )
}

/** A written case by one author — the shape most names actually have. */
function oneAuthorCase() {
  data = {
    ...BASE,
    caseWrittenAt: WRITTEN,
    coreSections: ['thesis', 'risks_to_thesis'],
    sections: [
      { section: 'thesis', content: 'Jeff Bezos has a sick yacht.', supportingDetail: null, updatedAt: WRITTEN, authorName: 'Eric' },
      { section: 'risks_to_thesis', content: 'Lots of risks.', supportingDetail: null, updatedAt: WRITTEN, authorName: 'Eric' },
    ],
  }
}

/** A target WITH a bear/bull ladder, so the footer band actually renders. */
function withLadder() {
  const rung = (name: string, price: number) => ({
    scenarioId: null, name, price, probability: null, timeframe: null,
    reasoning: null, id: `r-${name}`, userId: null,
  })
  data = {
    ...BASE, target: 180, spot: 243.79,
    ladder: {
      assetId: 'a-1', symbol: 'AMZN', companyName: null, updatedAt: WRITTEN,
      valid: true, reason: '',
      /* Bull is deliberately NOT the target: otherwise "$180.00" appears
         legitimately as a rung and an assertion against the restated target
         could never tell the two apart. */
      cases: [rung('Bear', 90), rung('Base', 120), rung('Bull', 400)],
    },
  }
}

beforeEach(() => {
  data = { ...BASE }
  ratings = []; consensus = []; myRating = undefined
})

describe('the case is told once', () => {
  it('draws no contributor roster when there is only one contributor', () => {
    oneAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me'), contrib('risks_to_thesis', 'me')],
      contributionFields: FIELDS,
    })
    expect(screen.queryByTestId('snapshot-perspectives')).toBeNull()
    // The fact itself is not lost — it moves onto the block it describes.
    // It used to read "1 contributor"; with one author the block now NAMES
    // them instead of counting them, which is strictly more information and
    // is what lets the sections drop their per-section bylines. The subject
    // of this case — the roster is gone and authorship still stated once —
    // is unchanged.
    expect(screen.getByTestId('snapshot-our-view')).toHaveTextContent('by Eric')
  })

  it('draws the roster as soon as a second person has written', () => {
    // Who disagrees with whom is the one thing the prose excerpt cannot show.
    oneAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me'), contrib('thesis', 'other')],
      contributionFields: FIELDS,
    })
    expect(screen.getByTestId('snapshot-perspectives')).toBeTruthy()
    expect(screen.getByTestId('snapshot-our-view')).toHaveTextContent('2 contributors')
  })

  it('still offers the way into Research with the roster gone', () => {
    // The roster carried the only "Open Research →" on that half of the page.
    oneAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me')],
      contributionFields: FIELDS,
    })
    // The label depends on freshness — a stale case is offered as the job
    // ("Update the case") rather than as a destination — so this asserts the
    // CONTROL exists, not which of its two wordings is showing.
    expect(
      within(screen.getByTestId('snapshot-our-view'))
        .getByRole('button', { name: /Open Research|Update the case/ }),
    ).toBeTruthy()
  })
})

describe('a section with nothing to report is absent, not empty', () => {
  it('draws no "What changed" when no research postdates the case', () => {
    oneAuthorCase()
    renderSnapshot({ currentUserId: 'me' })
    expect(screen.queryByTestId('snapshot-what-changed')).toBeNull()
    expect(screen.queryByText(/No research has been filed/)).toBeNull()
  })

  it('draws it the moment something does', () => {
    oneAuthorCase()
    data = {
      ...data,
      evidence: [{
        id: 'e1', title: 'Q3 teardown', content: null, createdAt: '2026-06-01T00:00:00Z',
        authorName: 'Eric', isShared: true, isNewSinceReview: true,
      }] as never,
    }
    renderSnapshot({ currentUserId: 'me' })
    expect(screen.getByTestId('snapshot-what-changed')).toHaveTextContent('1 research item')
  })
})

describe('nothing the strip already states is restated', () => {
  it('does not print the firm rating', () => {
    // The strip states consensus and its n, permanently, a couple of hundred
    // pixels above. On a name with no rating this was a labelled blank.
    ratings = [{ id: 'r1' }, { id: 'r2' }]
    consensus = [{ value: 'Buy', count: 2, percentage: 100 }]
    oneAuthorCase()
    renderSnapshot({ currentUserId: 'me' })
    const view = screen.getByTestId('snapshot-our-view')
    expect(view).not.toHaveTextContent('Firm Buy')
    expect(view).not.toHaveTextContent('No firm rating')
  })

  it('does not print the target or its upside again, even with the band open', () => {
    /*
     * This must be asserted WITH a ladder present. Without one the footer is
     * hidden outright, so a target assertion against that state passes
     * whatever the code does — the first version of this case did exactly
     * that, and a restatement injected straight back in did not fail it.
     */
    withLadder()
    renderSnapshot({ currentUserId: 'me' })
    const exposure = screen.getByTestId('snapshot-exposure')
    expect(exposure).toHaveTextContent(/bear/)   // the band IS open
    expect(exposure).not.toHaveTextContent('Target')
    expect(exposure).not.toHaveTextContent('$180.00')
    expect(exposure.textContent).not.toMatch(/-26\./)
  })

  it('keeps the spread, which the strip cannot say', () => {
    /*
     * One target number says what we think it is worth; the bear/bull pair
     * says how sure we are. That is the part worth the room, and removing
     * the point estimate must not take it with it.
     */
    withLadder()
    renderSnapshot({ currentUserId: 'me' })
    expect(screen.getByTestId('snapshot-exposure')).toHaveTextContent(/bear .*bull/)
  })

  it('leaves no empty rule across the block when there is no spread at all', () => {
    // A target with no bear/bull and no drawable ladder: the whole footer
    // would be a horizontal line and 12px of padding.
    data = { ...BASE, target: 180, spot: null, ladder: null, positions: [] }
    renderSnapshot({ currentUserId: 'me' })
    const exposure = screen.getByTestId('snapshot-exposure')
    expect(exposure.textContent).not.toMatch(/bear|bull|skew/)
    expect(exposure.querySelectorAll('.border-t').length).toBe(0)
  })

  it('still names a missing target, because that is not in the strip as a gap', () => {
    data = { ...BASE, target: null, positions: [] }
    renderSnapshot({ currentUserId: 'me' })
    expect(screen.getByTestId('snapshot-exposure')).toHaveTextContent('No price target set')
  })
})

describe('every book is stated the same way', () => {
  const pos = (name: string, over: Record<string, unknown> = {}) => ({
    portfolioId: `p-${name}`, portfolioName: name,
    shares: 95, price: 243, marketValue: 15_000, weightPct: 14.2,
    avgCost: 148.9, unrealisedGain: 608, unrealisedPct: 4.3,
    asOf: '2025-08-01', ...over,
  }) as never

  it('draws no principal holding and no "also held in" footnote', () => {
    /*
     * One book used to get the full treatment — weight bar, shares, market
     * value, average cost, unrealised — and the rest were a name, a share
     * count and a percentage under "Also held in". Which book was promoted
     * was `primaryPosition`'s sort order, not a decision the firm made.
     *
     * On AMZN that demoted a 16,947-share position in Vision Fund 10K to a
     * footnote beneath a 95-share position in Large Cap Growth.
     */
    data = {
      ...BASE,
      positions: [pos('Large Cap Growth'), pos('Vision Fund 10K', { shares: 16_947, weightPct: 3.9 })],
    }
    renderSnapshot({ currentUserId: 'me' })
    const exposure = screen.getByTestId('snapshot-exposure')
    expect(exposure).not.toHaveTextContent('Also held in')
    // Both books get the same four facts, not one book four and the other two.
    expect(exposure.querySelectorAll('[data-testid="weight-bar"]').length).toBe(2)
    expect(exposure.textContent?.match(/Average cost/g)?.length).toBe(2)
    expect(exposure.textContent?.match(/Unrealised/g)?.length).toBe(2)
  })

  it('names a book whose weight cannot be derived, rather than dropping it', () => {
    data = {
      ...BASE,
      positions: [pos('Large Cap Growth'), pos('Opaque Fund', { weightPct: null })],
    }
    renderSnapshot({ currentUserId: 'me' })
    const exposure = screen.getByTestId('snapshot-exposure')
    expect(exposure).toHaveTextContent('Opaque Fund')
    expect(exposure).toHaveTextContent(/market value could not be derived/)
  })

  it('dates the block from the newest position it draws', () => {
    // Two books settle on different days; the block must not claim the older.
    data = {
      ...BASE,
      positions: [
        pos('A', { asOf: '2025-08-01' }),
        pos('B', { portfolioId: 'p-B', asOf: '2026-02-14' }),
      ],
    }
    renderSnapshot({ currentUserId: 'me' })
    /* The rendered date is localised, and an ISO date parses as UTC midnight,
       so the day can shift by one west of Greenwich. The YEAR is what
       distinguishes the two as-ofs and is immune to that. */
    const exposure = screen.getByTestId('snapshot-exposure')
    expect(exposure).toHaveTextContent(/position as of .*2026/)
    expect(exposure).not.toHaveTextContent(/position as of .*2025/)
  })
})

/**
 * "Our view" reads as prose, and staleness is a state rather than a tint.
 *
 * The block used to give every written section a heading ROW — section name,
 * author, date, a YOU chip, sometimes a "2 views" link — above a two-line
 * paragraph. On the common name, which is one analyst writing in one sitting,
 * that printed the same name and the same date three times and the block read
 * as a form with the answers filled in rather than as an argument.
 *
 * And staleness was the age label tinted amber. Tinted text is not a state:
 * nothing on screen said what the colour meant, so a reader who had not been
 * told the rule could not learn it from the page.
 */
describe('Our view reads as prose', () => {
  /** A case written by two different people, in two different sections. */
  function twoAuthorCase() {
    data = {
      ...BASE,
      caseWrittenAt: WRITTEN,
      coreSections: ['thesis', 'risks_to_thesis'],
      sections: [
        { section: 'thesis', content: 'Jeff Bezos has a sick yacht.', supportingDetail: null, updatedAt: WRITTEN, authorName: 'Eric' },
        { section: 'risks_to_thesis', content: 'Lots of risks.', supportingDetail: null, updatedAt: WRITTEN, authorName: 'Dana' },
      ],
    }
  }

  it('names the one author once, not above every section', () => {
    oneAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me'), contrib('risks_to_thesis', 'me')],
      contributionFields: FIELDS,
    })
    const text = screen.getByTestId('snapshot-our-view').textContent ?? ''
    // Two written sections, one author: the name appears exactly once.
    expect(text.match(/Eric/g)?.length).toBe(1)
  })

  it('runs the section name into the sentence rather than heading it', () => {
    oneAuthorCase()
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    // The claim and its label are ONE paragraph, in reading order.
    const para = within(screen.getByTestId('snapshot-our-view'))
      .getByText(/Jeff Bezos has a sick yacht/)
      .closest('p')
    expect(para).toBeTruthy()
    expect(para!.textContent?.replace(/\s+/g, ' ')).toMatch(
      /^Investment thesis\. Jeff Bezos has a sick yacht\./,
    )
  })

  it('puts attribution back on each section when two people wrote', () => {
    // With one author the meta line can carry it; with two, WHO said it is
    // part of what was said, so it returns — trailing the sentence.
    twoAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me'), contrib('risks_to_thesis', 'other')],
      contributionFields: FIELDS,
    })
    const block = screen.getByTestId('snapshot-our-view')
    expect(block).toHaveTextContent('2 contributors')
    expect(block).toHaveTextContent('Eric')
    expect(block).toHaveTextContent('Dana')
    expect(block.textContent ?? '').not.toMatch(/by Eric/)
  })

  it('never claims a sole author when two people wrote the same section', () => {
    // The trap: `caseSections` holds one row per section, so two analysts on
    // one section leaves only one authorName in the written rows. The byline
    // must come off the contribution count, not off that set.
    oneAuthorCase()
    renderSnapshot({
      currentUserId: 'me',
      contributions: [contrib('thesis', 'me'), contrib('thesis', 'other')],
      contributionFields: FIELDS,
    })
    const text = screen.getByTestId('snapshot-our-view').textContent ?? ''
    expect(text).not.toMatch(/by Eric/)
    expect(text).toMatch(/2 contributors/)
  })
})

/**
 * "Our view" is one column, and it leads with where the firm lands.
 *
 * It was two columns: the argument at a 72ch measure, and a rail holding
 * "Your rating", "Your research: 3 of 3 case sections" and a gap chip. On a
 * 1920 screen that left roughly 850px of white between the prose and the
 * card's right edge, and what filled the rail was a progress bar on your own
 * filing, printed next to the filing.
 *
 * And it opened straight into section prose. A reader who wanted to know
 * what this organisation thinks of the name had to read three paragraphs and
 * infer it, and where the analysts disagree they could read all three and
 * still be wrong, because the prose is one person's.
 */
describe('Our view is one column, and states the position first', () => {
  it('draws no rail beside the argument', () => {
    oneAuthorCase()
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    const block = screen.getByTestId('snapshot-our-view')
    expect(block.querySelector('aside')).toBeNull()
    const text = block.textContent ?? ''
    expect(text).not.toMatch(/case sections/)
    expect(text).not.toMatch(/Not yet recorded/)
  })

  it('puts the position above the prose, not after it', () => {
    oneAuthorCase()
    ratings = [{ id: 'r1', rating_value: 'Buy', conviction: 'high' }] as never
    consensus = [{ value: 'Buy', count: 1, percentage: 100 }]
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    const block = screen.getByTestId('snapshot-our-view')
    const line = screen.getByTestId('snapshot-position-line')
    const thesis = within(block).getByText(/Jeff Bezos has a sick yacht/)
    // DOCUMENT_POSITION_FOLLOWING: the prose comes after the position.
    expect(line.compareDocumentPosition(thesis) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    /*
     * And nothing reorders it visually behind the DOM's back. jsdom computes
     * no layout, so a Tailwind `order-*` utility on this block would move it
     * below the prose on screen while every assertion above still passed.
     * This is the only part of "the position comes first" that a render test
     * cannot see, so it is checked on the class list directly.
     */
    expect(line.className).not.toMatch(/\border-(first|last|none|\d+)\b/)
  })

  it('names an unwritten "where we differ" in the prose, like its siblings', () => {
    /*
     * `where_different` used to be filtered out of the prose loop and drawn
     * below it, so an ABSENT one was named nowhere and had to be a gap chip
     * in the rail instead. One fact, two renderings, chosen by which section
     * happened to be missing.
     */
    data = {
      ...BASE,
      caseWrittenAt: WRITTEN,
      coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
      sections: [
        { section: 'thesis', content: 'Jeff Bezos has a sick yacht.', supportingDetail: null, updatedAt: WRITTEN, authorName: 'Eric' },
      ],
    }
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    const block = screen.getByTestId('snapshot-our-view')
    expect(block).toHaveTextContent('Where our thesis differs.')
    // Two unwritten sections, both named the same way.
    expect(within(block).getAllByText('Not written.')).toHaveLength(2)
  })
})

describe('the stale case states its rule', () => {
  it('draws a chip carrying the exact date and the threshold', () => {
    oneAuthorCase() // written 2025-11-20, far past the 120-day threshold
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    const chip = screen.getByTestId('snapshot-stale-chip')
    expect(chip).toHaveTextContent('Stale')
    // The rounded age is readable; the exact date is what you act on.
    expect(chip).toHaveTextContent(/last written .*2025/)
    const why = chip.getAttribute('title') ?? ''
    expect(why).toMatch(/120 days/)
    expect(why).toMatch(/one quarter plus a reporting lag/)
  })

  it('offers the stale case as the job, not as a destination', () => {
    oneAuthorCase()
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    expect(
      within(screen.getByTestId('snapshot-our-view'))
        .getByRole('button', { name: /Update the case/ }),
    ).toBeTruthy()
  })

  it('says nothing about staleness on a case written today', () => {
    oneAuthorCase()
    data = { ...data, caseWrittenAt: new Date().toISOString() }
    renderSnapshot({ currentUserId: 'me', contributionFields: FIELDS })
    expect(screen.queryByTestId('snapshot-stale-chip')).toBeNull()
    expect(
      within(screen.getByTestId('snapshot-our-view'))
        .getByRole('button', { name: /Open Research/ }),
    ).toBeTruthy()
  })
})
