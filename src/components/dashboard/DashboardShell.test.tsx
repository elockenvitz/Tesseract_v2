/**
 * Browse, focus, deep — three states, one tab.
 *
 * The bug this suite exists to prevent: a Dashboard action that navigates.
 * Clicking an issue must move between two states of the SAME Dashboard tab;
 * only an explicit "Open full Asset" may open a top-level work tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

/**
 * Each lens is stubbed, and reports what it was handed through data
 * attributes rather than a captured array.
 *
 * `vi.mock` factories are hoisted above every top-level binding, so each builds
 * its stub inline; reading the DOM avoids needing shared mutable state up here
 * at all.
 */
const stub = vi.hoisted(() => (lens: string) => (props: any) =>
  ({
    type: 'div',
    key: null,
    ref: null,
    props: {
      'data-testid': `lens-${lens}`,
      'data-selected': props.focusObjectId ?? '',
      'data-book': props.selectedPortfolioId ?? '',
      'data-issue': props.issue ?? '',
      // What a cross-lens arrival hands the lens it lands on. Distinct from
      // `data-selected`, which is the deck.
      'data-idea': props.selectedIdeaId ?? '',
      'data-asset': props.selectedAssetId ?? '',
    },
    $$typeof: Symbol.for('react.element'),
  }) as any)

vi.mock('../today/TodayPage', () => ({ TodayPage: stub('today') }))
vi.mock('../ideas-v2/IdeasWorkspace', () => ({ IdeasWorkspace: stub('ideas') }))
vi.mock('../research-v2/ResearchWorkspace', () => ({ ResearchWorkspace: stub('research') }))
vi.mock('../portfolio-v2/PortfolioWorkspace', () => ({ PortfolioWorkspace: stub('portfolio') }))
vi.mock('../decisions-v2/DecisionsWorkspace', () => ({ DecisionsWorkspace: stub('decisions') }))

import { DashboardShell } from './DashboardShell'
import { openDashboardFocus, type RailCard } from '../../lib/dashboard/focus'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tabEvents: CustomEvent[] = []
const capture = (e: Event) => tabEvents.push(e as CustomEvent)

beforeEach(() => {
  tabEvents.length = 0
  // The lens AND the expanded card are both session-scoped now, so a test
  // that expands a card would otherwise hand the next test a restored deck.
  try { sessionStorage.clear() } catch { /* jsdom always has it; be safe */ }
  window.addEventListener('decision-engine-action', capture)
})
afterEach(() => window.removeEventListener('decision-engine-action', capture))

describe('one Dashboard, five lenses', () => {
  it('opens on Today and offers all five', () => {
    render(<DashboardShell />)
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
    for (const l of ['today', 'ideas', 'research', 'portfolio', 'decisions']) {
      expect(screen.getByRole('button', { name: new RegExp(l, 'i') })).toBeInTheDocument()
    }
  })

  it('mounts one lens at a time', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await user.click(screen.getByRole('button', { name: /Research/i }))
    expect(screen.getByTestId('lens-research')).toBeInTheDocument()
    expect(screen.queryByTestId('lens-today')).not.toBeInTheDocument()
  })

  it('opens a saved v2 session on its own lens', () => {
    render(<DashboardShell initialLens="portfolio" selectedPortfolioId="p1" />)
    expect(screen.getByTestId('lens-portfolio')).toHaveAttribute('data-book', 'p1')
  })
})

/**
 * Crossing lenses is a move inside this tab.
 *
 * The defect, measured in the running app: on the Decisions lens, "Open the
 * idea" opened a SECOND Dashboard tab. Both lenses are this one shell, so the
 * reader's words were exact: "it opens another tab that shows the same
 * workspace screen."
 *
 * The cause was a pair of dispatches fired unconditionally -- a tab descriptor
 * for `ideas-v2` plus the typed `openIdea` event -- on the theory that the
 * typed one would be handled when a workspace was mounted and the descriptor
 * would be a harmless no-op otherwise. Only `IdeasWorkspace` subscribed, and
 * this shell renders ONE lens at a time, so from Decisions the typed event had
 * no listener and the descriptor fired every time.
 *
 * The shell is what knows a lens exists to switch to, so the shell is what
 * listens.
 */
describe('a cross-lens request is answered in place, not in a new tab', () => {
  it('switches to Ideas and hands it the idea', async () => {
    const { openIdea } = await import('../../lib/desktop-ideas/navigate')
    render(<DashboardShell initialLens="decisions" />)
    expect(screen.getByTestId('lens-decisions')).toBeInTheDocument()

    let claimed = false
    await act(async () => { claimed = openIdea({ ideaId: 'tq-9', issue: 'Awaiting decision' }) })

    // Claimed, so the caller knows not to open a tab.
    expect(claimed).toBe(true)
    const ideas = screen.getByTestId('lens-ideas')
    expect(ideas).toHaveAttribute('data-idea', 'tq-9')
    expect(ideas).toHaveAttribute('data-issue', 'Awaiting decision')
    expect(screen.queryByTestId('lens-decisions')).not.toBeInTheDocument()
    // The whole point: no tab.
    expect(tabEvents).toHaveLength(0)
  })

  it('switches to Research and hands it the asset', async () => {
    const { openResearch } = await import('../../lib/desktop-research/navigate')
    render(<DashboardShell initialLens="portfolio" selectedPortfolioId="p1" />)

    let claimed = false
    await act(async () => { claimed = openResearch({ assetId: 'a-orcl', issue: 'No thesis on file' }) })

    expect(claimed).toBe(true)
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-asset', 'a-orcl')
    expect(tabEvents).toHaveLength(0)
  })

  it('does not let an arrival outlive the lens the reader leaves', async () => {
    /*
     * The arrival overrides the tab's own selection, so it has to end when
     * the reader navigates by hand. Otherwise coming back to Ideas later
     * re-opens an idea they finished with, and the AI subject chip keeps
     * reading it -- the same staleness `onFocusConsumed` exists to prevent
     * for the tab payload.
     */
    const user = userEvent.setup()
    const { openIdea } = await import('../../lib/desktop-ideas/navigate')
    render(<DashboardShell initialLens="decisions" />)
    await act(async () => { openIdea({ ideaId: 'tq-9' }) })
    expect(screen.getByTestId('lens-ideas')).toHaveAttribute('data-idea', 'tq-9')

    await user.click(screen.getByRole('button', { name: /Research/i }))
    await user.click(screen.getByRole('button', { name: /Ideas/i }))
    expect(screen.getByTestId('lens-ideas')).toHaveAttribute('data-idea', '')
  })
})

const card = (id: string, over: Partial<RailCard> = {}): RailCard => ({
  id, workspaceLens: 'research', objectType: 'asset',
  symbol: id.toUpperCase(), reason: 'Thesis may be stale',
  figure: '247d', figureLabel: 'since the case', detail: 'Nobody has revisited it.',
  ...over,
})

/**
 * An arrival into Portfolio, used by the deck's selection and rotation cases.
 *
 * It no longer carries the deck HEADER cases: Portfolio draws its own
 * identity row and was printing the deck's above it, saying "JNJ / No thesis
 * on file / 28.2% of the book in JNJ, with no thesis behind it." and then
 * that sentence again, verbatim, 40px down. It yields now (`ownHeader`), so
 * the header rules moved to `intoIdeas` below.
 */
const intoPortfolio = (objectId = 'a-tgt', rail = [card('a-amzn', { workspaceLens: 'portfolio' })]) =>
  openDashboardFocus({
    target: {
      originLens: 'today', workspaceLens: 'portfolio', objectType: 'asset',
      objectId, symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
    },
    backLabel: 'Today',
    rail,
  })

/**
 * The same arrival, into the one lens that does NOT draw its own identity
 * header and so still relies on the deck's. This is where the deck-header
 * rules are tested.
 */
const intoIdeas = (objectId = 'a-tgt', rail = [card('a-amzn', { workspaceLens: 'ideas' })]) =>
  openDashboardFocus({
    target: {
      originLens: 'today', workspaceLens: 'ideas', objectType: 'asset',
      objectId, symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
    },
    backLabel: 'Today',
    rail,
  })

const fromToday = (objectId = 'a-tgt', rail = [card('a-amzn'), card('a-wmt')]) =>
  openDashboardFocus({
    target: {
      originLens: 'today', workspaceLens: 'research', objectType: 'asset',
      objectId, symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
    },
    backLabel: 'Today',
    rail,
  })

describe('expanding a card, in this tab', () => {
  it('expands the card and keeps the deck it came from alive', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    // The workspace that answers the issue is research-shaped...
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-tgt')
    // ...and the deck underneath is still Today, still mounted, so its scroll
    // and selection survive the return.
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-browse')).toHaveAttribute('aria-hidden', 'true')
  })

  it('creates no tab', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    expect(tabEvents).toHaveLength(0)
  })

  it('names Back for the deck, never for the workspace', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    // The bug this fixes: a research-shaped workspace offering "All research"
    // to a reader who was never in Research.
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
    expect(screen.getByTestId('workspace-back')).not.toHaveTextContent(/research/i)
  })

  it('still has the card open after the reader leaves the tab and comes back', async () => {
    /*
     * The workspace's own primary action for most states opens the Asset
     * tab. Coming back unmounted and remounted this shell, and `deck` was
     * component state -- so every hop out to write cost the reader the card
     * they were working and put them back at the top of the Today deck.
     *
     * Unmount/remount is exactly what the tab switch does, so that is what
     * this asserts: no event is replayed, the card comes back from the
     * session.
     */
    const first = render(<DashboardShell />)
    await React.act(async () => { fromToday('a-amzn') })
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
    first.unmount()

    render(<DashboardShell />)
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
  })

  it('does not bring the card back after the reader closed it', async () => {
    // The other half of the rule: leaving deliberately is remembered just as
    // accurately as staying. Without this, Back would be undone by a tab
    // switch -- a worse bug than the one above.
    const user = userEvent.setup()
    const first = render(<DashboardShell />)
    await React.act(async () => { fromToday('a-amzn') })
    await user.click(screen.getByTestId('workspace-back'))
    first.unmount()

    render(<DashboardShell />)
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
  })

  it('never lets a remembered card override a deep link', async () => {
    // A v2 surface mounts this shell with its own lens. That is an explicit
    // destination, and a card remembered from browsing must not take it.
    const first = render(<DashboardShell />)
    await React.act(async () => { fromToday('a-amzn') })
    first.unmount()

    render(<DashboardShell initialLens="portfolio" selectedPortfolioId="p1" />)
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('lens-portfolio')).toHaveAttribute('data-book', 'p1')
  })

  it('returns to the deck it came from', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    await user.click(screen.getByTestId('workspace-back'))

    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('dashboard-browse')).not.toHaveAttribute('aria-hidden')
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
  })

  it('names the selected object on the surface answering it', async () => {
    // The measured gap: clicking TSM mounted a workspace whose header knows
    // about an asset, while the finding -- and the object's own name until the
    // workspace loaded -- did not survive the click. The rail listed the three
    // things the reader did not choose; nothing named the one they did.
    /*
     * Opened into IDEAS, which was PORTFOLIO, which was research.
     *
     * The rule is unchanged -- the surface answering a click must name the
     * object that was clicked -- but who draws that name depends on the lens,
     * and the list of lenses drawing their own identity row has grown each
     * time one was measured against the deck's. Research, then Decisions,
     * then Portfolio, each of which was printing the deck's header and then
     * repeating it. Ideas is the one left that relies on the deck's, so it
     * is where the deck-header rules are asserted.
     */
    render(<DashboardShell />)
    await React.act(async () => {
      intoIdeas('a-tgt', [card('a-tgt', { workspaceLens: 'ideas' })])
    })

    const header = screen.getByTestId('focus-header')
    expect(header).toHaveAttribute('data-symbol', 'A-TGT')
    expect(header).toHaveTextContent('Thesis may be stale')
    expect(header).toHaveTextContent('Nobody has revisited it.')
  })

  it('yields the header to a lens that draws its own', async () => {
    /*
     * The two-ticker bug. Opening AMZN from Today drew the deck's header --
     * "AMZN / THESIS MAY BE STALE / <claim>" -- and then, 75px below,
     * Research's own "AMZN / Amazon.com, Inc." with its own figures and its
     * own sentence saying the same thing in different words.
     */
    render(<DashboardShell />)
    await React.act(async () => { fromToday('a-tgt', [card('a-amzn')]) })

    expect(screen.getByTestId('lens-research')).toBeInTheDocument()
    expect(screen.queryByTestId('focus-header')).not.toBeInTheDocument()
  })

  it('yields it to Decisions too, which also draws one', async () => {
    /*
     * The same bug, in the lens `ownHeader` was never applied to. Measured
     * live: the deck printed "NKE / sell · Awaiting decision / The Barbero
     * Fund / Mar 13, 2026" and `DecisionDetailPane` printed the same four
     * facts again 40px below, the second at 30px against the deck's 22.
     *
     * Decisions is safe to yield in a way Portfolio is not: nothing raises a
     * focus INTENT toward this lens -- only Today's and Ideas' tiles carry
     * one, and both open Research -- so the deck's header is carrying nothing
     * here that the pane does not already say.
     */
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'decisions', workspaceLens: 'decisions', objectType: 'decision',
          objectId: 'dec-1', symbol: 'NKE', issue: 'Awaiting decision', origin: 'decisions',
        },
        backLabel: 'Decisions',
        rail: [card('dec-1', { workspaceLens: 'decisions', objectType: 'decision' })],
      })
    })

    // Scoped to the expanded region: opening a Decisions card from the
    // Decisions lens leaves the browse lens of the same name mounted behind
    // it, so an unscoped query matches two.
    const focus = screen.getByTestId('dashboard-focus')
    expect(within(focus).getByTestId('lens-decisions')).toBeInTheDocument()
    expect(within(focus).queryByTestId('focus-header')).not.toBeInTheDocument()
  })

  it('yields it to Portfolio, which was saying the same sentence twice', async () => {
    /*
     * Measured live: the deck printed "JNJ / No thesis on file / 28.2% of the
     * book in JNJ, with no thesis behind it." and `PositionDetailPane`
     * printed that sentence again, verbatim, 40px below, under a 30px ticker.
     *
     * What this gives up is the focus INTENT chip, which only the deck header
     * renders. `PortfolioWorkspace` is not passed the intent and does nothing
     * with it, so the chip named a mode the surface never entered.
     */
    render(<DashboardShell />)
    await React.act(async () => {
      intoPortfolio('a-tgt', [card('a-tgt', { workspaceLens: 'portfolio' })])
    })

    const focus = screen.getByTestId('dashboard-focus')
    expect(within(focus).getByTestId('lens-portfolio')).toBeInTheDocument()
    expect(within(focus).queryByTestId('focus-header')).not.toBeInTheDocument()
  })

  it('finds the expanded card by id, never by symbol', async () => {
    // Two findings can concern one ticker. Matching on symbol would collapse
    // them and put the wrong claim above the workspace.
    render(<DashboardShell />)
    await React.act(async () => {
      // Ideas, for the same reason as the case above: it is the lens whose
      // pane does not draw its own identity, so the deck's header is here
      // to be read.
      intoIdeas('a-two', [
        { ...card('a-one', { workspaceLens: 'ideas' }), symbol: 'DUP', detail: 'The first finding.' },
        { ...card('a-two', { workspaceLens: 'ideas' }), symbol: 'DUP', detail: 'The second finding.' },
      ])
    })
    expect(screen.getByTestId('focus-header')).toHaveTextContent('The second finding.')
    expect(screen.getByTestId('focus-header')).not.toHaveTextContent('The first finding.')
  })

  it('grows out of the tile that was clicked, when one said where it was', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'today', workspaceLens: 'research', objectType: 'asset',
          objectId: 'a-tgt', symbol: 'TGT', origin: 'today',
          source: {
            elementId: 'today-tile-f-1',
            role: 'lead',
            rect: { top: 100, left: 0, width: 200, height: 100 },
          },
        },
        backLabel: 'Today',
        rail: [card('a-amzn')],
      })
    })
    // An origin, not a translate: the surface expands from where the card was.
    const style = screen.getByTestId('dashboard-focus').getAttribute('style') ?? ''
    expect(style).toMatch(/transform-origin/)
  })

  it('expands from the centre when no source was captured', async () => {
    // A typed arrival or a rotation raises a focus with no tile behind it.
    // That must degrade to the plain expand, never to a broken style.
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    const style = screen.getByTestId('dashboard-focus').getAttribute('style')
    expect(style ?? '').not.toMatch(/transform-origin/)
  })

  it('moves a keyboard reader into what just opened, and back to where they were', async () => {
    /*
     * The continuity the animation expresses, for a reader who has turned the
     * animation off — and the part that still has to be right when it does not
     * run at all.
     *
     * Activating a tile used to leave `document.activeElement` on <body>: the
     * button was still in the DOM but inside a now `aria-hidden` deck, so the
     * next Tab landed on the lens bar above a workspace the reader had just
     * opened. Returning is keyed on the `elementId` the request carried, which
     * is the whole reason that seam exists.
     */
    const user = userEvent.setup()
    render(
      <div>
        <article data-testid="today-tile" data-focus-source="today-tile-f-1" tabIndex={-1} />
        <DashboardShell />
      </div>,
    )

    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'today', workspaceLens: 'research', objectType: 'asset',
          objectId: 'a-tgt', symbol: 'TGT', origin: 'today',
          source: { elementId: 'today-tile-f-1', role: 'lead', rect: null },
        },
        backLabel: 'Today',
        rail: [card('a-amzn')],
      })
    })

    // Forward: focus is inside the surface that just opened, not on <body>.
    const region = screen.getByTestId('dashboard-focus')
    expect(region).toHaveAttribute('tabindex', '-1')
    expect(region.contains(document.activeElement)).toBe(true)
    // And it announces which object it is.
    expect(region).toHaveAttribute('aria-label', expect.stringContaining('TGT'))

    await user.click(screen.getByTestId('workspace-back'))

    // Back: the exact tile it came out of, found by id.
    expect(document.activeElement).toBe(
      document.querySelector('[data-focus-source="today-tile-f-1"]'),
    )
  })

  it('carries book context into a portfolio-origin deck', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'portfolio', workspaceLens: 'portfolio', objectType: 'position',
          objectId: 'a-jnj', portfolioId: 'p-lcc', portfolioName: 'Large Cap Core',
          issue: 'No thesis on file', origin: 'portfolio',
        },
        backLabel: 'Large Cap Core',
        rail: [card('a-aapl', { workspaceLens: 'portfolio', objectType: 'position' })],
      })
    })
    const focus = within(screen.getByTestId('dashboard-focus'))
    const lens = focus.getByTestId('lens-portfolio')
    expect(lens).toHaveAttribute('data-book', 'p-lcc')
    expect(lens).toHaveAttribute('data-selected', 'a-jnj')
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Large Cap Core')
  })

  it('refuses a request that names no card or no deck', () => {
    render(<DashboardShell />)
    expect(openDashboardFocus({ target: { objectId: '' } } as any)).toBe(false)
    expect(openDashboardFocus({ target: { objectId: 'x' } } as any)).toBe(false)
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
  })
})

describe('rotating through the work', () => {
  it('swaps the expanded card in place, without a tab', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    await user.click(screen.getAllByTestId('rail-card')[0])
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
    expect(tabEvents).toHaveLength(0)
  })

  it('never lets the latest card become the new origin', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    await user.click(screen.getAllByTestId('rail-card')[0])   // AMZN
    await user.click(screen.getAllByTestId('rail-card')[0])   // WMT
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-wmt')
    // Two rotations later, Back still means the deck the reader started in.
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
    expect(screen.getByTestId('lens-today')).toBeInTheDocument()
  })

  it('never shows the expanded card as a peer', async () => {
    render(<DashboardShell />)
    await React.act(async () => {
      fromToday('a-tgt', [card('a-tgt'), card('a-amzn')])
    })
    // Duplicating it would print the same identity, issue and metric twice.
    const ids = screen.getAllByTestId('rail-card').map(el => el.textContent)
    expect(ids.some(t => t?.includes('A-TGT'))).toBe(false)
  })

  it('leaves the deck when the reader chooses a lens by hand', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    // An explicit navigation, so the stale workspace does not survive it.
    await user.click(screen.getByRole('button', { name: /Decisions/i }))
    expect(screen.queryByTestId('dashboard-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('lens-decisions')).toBeInTheDocument()
  })
})

describe('the card you leave comes back', () => {
  const book = ['jnj', 'msft', 'jpm', 'pg', 'aapl'].map(id =>
    card(id, { workspaceLens: 'portfolio', objectType: 'position' }))

  const openBook = (active: string) => openDashboardFocus({
    target: {
      originLens: 'portfolio', workspaceLens: 'portfolio', objectType: 'position',
      objectId: active, symbol: active.toUpperCase(), origin: 'portfolio',
    },
    backLabel: 'Large Cap Core',
    rail: book,
  })

  const railIds = () =>
    screen.getAllByTestId('rail-card').map(el => el.getAttribute('data-symbol'))

  it('excludes only whatever is expanded right now', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { openBook('jnj') })

    expect(railIds()).not.toContain('JNJ')

    // Rotate to a card further down the book.
    await user.click(screen.getAllByTestId('rail-card').find(
      el => el.textContent?.includes('AAPL'))!)

    expect(within(screen.getByTestId('dashboard-focus')).getByTestId('lens-portfolio'))
      .toHaveAttribute('data-selected', 'aapl')
    // AAPL is now the workspace, so it leaves the rail -- and JNJ, which the
    // reader came from, is available again. A window pruned once at open time
    // would have dropped it permanently.
    expect(railIds()).not.toContain('AAPL')
    expect(railIds()).toContain('JNJ')
  })

  it('creates no tab while rotating through a book', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { openBook('jnj') })
    await user.click(screen.getAllByTestId('rail-card')[0])
    await user.click(screen.getAllByTestId('rail-card')[0])
    expect(tabEvents).toHaveLength(0)
  })
})

describe('engagement context follows the expanded card', () => {
  it('never leaves the previous object bound to Ask AI or Team', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => {
      openDashboardFocus({
        target: {
          originLens: 'today', workspaceLens: 'research', objectType: 'asset',
          objectId: 'a-tgt', symbol: 'TGT', issue: 'Thesis may be stale', origin: 'today',
        },
        backLabel: 'Today',
        rail: [card('a-tgt', { symbol: 'TGT' }), card('a-amzn', { symbol: 'AMZN' })],
      })
    })
    // The workspace is rendered for TGT...
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-tgt')

    await user.click(screen.getAllByTestId('rail-card').find(
      el => el.textContent?.includes('AMZN'))!)

    /*
      ...and after rotating it is rendered for AMZN, with no TGT anywhere.

      This is what keeps Ask AI and Team honest: each workspace builds its
      EngagementTarget from the object it is rendering, so a stale target
      cannot survive a swap -- there is no target held above the workspace to
      go stale. Asserted on the rendered object because that IS the binding.
    */
    const lens = screen.getByTestId('lens-research')
    expect(lens).toHaveAttribute('data-selected', 'a-amzn')
    // The work surface is the workspace; TGT survives only as a rail card,
    // which is exactly where the reader can go back to it.
    expect(screen.getByTestId('work-surface')).not.toHaveTextContent('TGT')
  })
})

describe('the rail is a deck, not a sidebar', () => {
  it('sits on the left of the work surface', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    const deck = screen.getByTestId('work-deck')
    const rail = screen.getByTestId('work-rail')
    const surface = screen.getByTestId('work-surface')
    // Document order inside a flex row is left-to-right.
    expect(deck.firstElementChild).toBe(rail)
    expect(rail.compareDocumentPosition(surface) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps its column at laptop width', () => {
    /*
     * The rail is core to the interaction, not decoration: hiding it below
     * 2xl would remove the deck on the viewport most readers actually use.
     *
     * Was `toContain('lg:block')`. That named the display utility rather
     * than the breakpoint, so it failed the day the rail became a flex
     * column to pin its back control — a change that does not touch what
     * this case is about. Rewritten to assert the breakpoint the rail
     * appears at, whatever it is laid out as.
     */
    const rail = readFileSync(join(process.cwd(), 'src/components/dashboard/WorkDeck.tsx'), 'utf8')
    expect(rail).toMatch(/\blg:(block|flex|grid)\b/)
    expect(rail).not.toMatch(/\b2xl:(block|flex|grid)\b/)
  })

  it('carries a reason and a figure, not four text rows', async () => {
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })
    const first = screen.getAllByTestId('rail-card')[0]
    expect(first).toHaveTextContent('Thesis may be stale')
    expect(first).toHaveTextContent('247d')
    expect(first).toHaveTextContent('Nobody has revisited it.')
  })

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await React.act(async () => { fromToday() })

    screen.getByTestId('workspace-back').focus()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('lens-research')).toHaveAttribute('data-selected', 'a-amzn')
  })
})

describe('the lens bar is navigation, not a second heading', () => {
  it('marks the current lens for assistive technology', async () => {
    const user = userEvent.setup()
    render(<DashboardShell />)
    await user.click(screen.getByRole('button', { name: /Decisions/i }))
    expect(screen.getByRole('button', { name: /Decisions/i }))
      .toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Today/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('names itself', () => {
    render(<DashboardShell />)
    expect(screen.getByRole('navigation', { name: /Dashboard lenses/i })).toBeInTheDocument()
  })

  it('gives the rail a picture, so neighbours can be compared at a glance', () => {
    /*
     * The rail is where a reader chooses what to look at next, and it was
     * doing that job with a ticker, a percentage and two lines of clamped
     * prose. Ten of those are ten paragraphs: nothing separates them at a
     * glance, so comparing the neighbours of the thing you are reading means
     * reading all of them.
     *
     * A path separates them instantly, and it is the same fact -- measured
     * from the same mark -- that the field behind the deck draws at full size,
     * so moving into a focused object does not lose the picture you were
     * scanning by.
     */
    const deck = readFileSync(
      join(process.cwd(), 'src/components/dashboard/WorkDeck.tsx'), 'utf8')
    expect(deck).toContain('function RailSpark')
    expect(deck).toContain('{card.spark && <RailSpark spark={card.spark} />}')
    // Direction, the same green and red the field uses.
    expect(deck).toContain("up ? 'text-emerald-600 dark:text-emerald-400'")

    /*
     * And deliberately NOT a chart.
     *
     * No axis, no scale, no scrub, no readout. This is the one place in the
     * product where "sparkline" is the right answer rather than the
     * complaint: 22px tall in a list of ten, there to be compared with its
     * neighbours rather than interrogated, with the object one click away in
     * full.
     */
    const spark = deck.slice(deck.indexOf('function RailSpark'))
    const body = spark.slice(0, 1600)
    expect(body).not.toContain('onPointerMove')
    expect(body).not.toContain('data-testid="since-plot"')

    /*
     * Null wherever a price would be a fiction. A decision record and a
     * research document have no price of their own, and drawing one for them
     * would be an invented fact dressed as a shared component.
     */
    const focus = readFileSync(join(process.cwd(), 'src/lib/dashboard/focus.ts'), 'utf8')
    expect(focus).toContain('spark?: { closes: number[]; changePct: number } | null')
  })
})
