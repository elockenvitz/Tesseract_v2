import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Portfolio, the one thing on this screen that is not a card.
 *
 * ── What is at risk, and what is not ──────────────────────────────────────
 *
 * Not the book report: `PortfolioWorkspace` is the lens the Portfolio tab has
 * always mounted and it has its own suites. It is mocked here, because what
 * this file guards is the three things the SHELL decides about it, each of
 * which a reader feels directly.
 *
 * 1. It costs several queries. A reader who never opens Portfolio must not pay
 *    for it, so it is not mounted until it is asked for.
 * 2. Once opened it must stay mounted, or coming back from the feed resets the
 *    book they had chosen and the range they had picked.
 * 3. Switching to Portfolio must not unmount the feed, for the same reason in
 *    the other direction: the feed's scroll position, its loaded pages and the
 *    Start here band above it all have to survive a look at the book.
 *
 * (2) and (3) are the same property stated twice because they are implemented
 * by two different mechanisms -- a latch and a class -- and either can break
 * without the other.
 *
 * The mocked workspace carries an uncontrolled input, which is how these cases
 * tell "still mounted" from "mounted again": a remount loses the DOM value,
 * and no amount of re-rendering does.
 */

vi.mock('../../portfolio-v2/PortfolioWorkspace', () => ({
  PortfolioWorkspace: ({ onOpenPosition }: {
    onOpenPosition?: (t: Record<string, unknown>) => void
  }) => (
    <div data-testid="portfolio">
      {/* Uncontrolled on purpose: its value is the evidence of a surviving
          mount, in the same way the real lens's chosen book is. */}
      <input data-testid="chosen-book" defaultValue="" />
      {/* The real lens builds this descriptor from a `Position` and a
          `PositionFrame`; what the SHELL has to get right is only that it
          receives one and puts a workspace on screen for it. The fields are
          the ones `selectionForPosition` reads. */}
      <button
        data-testid="open-holding"
        onClick={() => onOpenPosition?.({
          originLens: 'portfolio', workspaceLens: 'portfolio', objectType: 'position',
          objectId: 'asset-jnj', symbol: 'JNJ', label: 'Johnson & Johnson',
          portfolioId: 'book-1', portfolioName: 'Large Cap Core',
          issue: 'No thesis on file', origin: 'portfolio',
        })}
      >
        Open JNJ
      </button>
    </div>
  ),
}))

vi.mock('../../ideas-app/IdeasExplore', () => ({
  IdeasExplore: () => <div data-testid="feed" />,
}))
vi.mock('../../ideas-app/IdeasExploreBrowse', () => ({
  IdeasExploreBrowse: () => <div data-testid="explore" />,
}))
vi.mock('../../ideas-app/IdeasWorkPane', () => ({
  /* The pane carries no label of its own any more -- the back control lives
     over the browse column, and `BackToSection` renders for real here. */
  IdeasWorkPane: () => <div data-testid="work-pane" />,
}))
vi.mock('../../mobile/ArticleReader', () => ({
  ArticleReader: () => null,
}))

vi.mock('../../../hooks/useDesktopAttentionFeed', () => ({
  useDesktopAttentionFeed: () => ({ entries: [], isLoading: false }),
}))
vi.mock('../../../hooks/usePromptResolve', () => ({
  usePromptResolve: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../../hooks/usePilotOnboarding', () => ({
  usePilotOnboarding: () => ({ markSignalWorked: vi.fn() }),
}))
/*
 * The shell now reads the signed-in reader, because the place it remembers
 * across a tab switch is keyed to them -- see `../place`. `useAuth` throws
 * rather than returning a default outside a provider, so without this every
 * case here fails on the context and not on its own subject.
 *
 * A fixed id, and `forgetPlace()` before each case below: the store is
 * module-scoped by design, so two cases in one file would otherwise hand each
 * other their lens and the ordering would decide what passes.
 */
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'reader-1' } }),
}))

import { DashboardNext } from '../DashboardNext'
import { forgetPlace } from '../place'

/* Each case opens the Dashboard cold, as a reader who has not been here. */
beforeEach(forgetPlace)

const lens = (name: string) => screen.getByRole('button', { name })

/**
 * The lens the reader is not standing in is hidden by class, never unmounted.
 *
 * ── Why the class is no longer `hidden` ───────────────────────────────────
 *
 * It was Tailwind's `hidden`, which is `display: none` -- the one way of
 * hiding something that destroys every layout object in the subtree and
 * rebuilds them on the way back. MEASURED on the live Dashboard with all
 * three surfaces warm and React doing nothing but toggling that class:
 * a 74-81ms task going back to Ideas, and 50-67ms between frames going back
 * to Explore with no script running at all, because 145 tiles were having
 * their boxes built from nothing.
 *
 * `.lens-stowed` is `content-visibility: hidden`, which skips the contents
 * the same way and keeps their rendering state. What these cases are about
 * is unchanged -- mounted, not visible -- so the spelling moves and the
 * assertions do not.
 */
const stowed = (id: string) => screen.getByTestId(id).closest('.lens-stowed') !== null
const feedIsHidden = () => stowed('feed')

describe('the book sits behind the same bar as the feed', () => {
  it('opens on the feed and has not mounted the book', () => {
    render(<DashboardNext />)
    expect(screen.getByTestId('feed')).toBeInTheDocument()
    /*
     * The whole reason for the latch. `PortfolioWorkspace` runs several
     * queries, and a reader who stays in the feed all day should not fund
     * them. Mounted-and-hidden would pass a visibility assertion and still
     * issue every one of those requests.
     */
    expect(screen.queryByTestId('portfolio')).toBeNull()
  })

  it('mounts the book when it is asked for, and leaves the feed standing', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))

    expect(screen.getByTestId('portfolio')).toBeInTheDocument()
    /* Still in the document, and hidden: an unmounted feed would lose its
       scroll, its loaded pages and the band above it. */
    expect(screen.getByTestId('feed')).toBeInTheDocument()
    expect(feedIsHidden()).toBe(true)
  })

  it('keeps the book the reader chose when they go back and return', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.type(screen.getByTestId('chosen-book'), 'Large Cap Core')

    await userEvent.click(lens('Ideas'))
    expect(feedIsHidden()).toBe(false)
    /* Hidden, not gone, for the same reason the feed is. */
    expect(screen.getByTestId('portfolio')).toBeInTheDocument()

    await userEvent.click(lens('Portfolio'))
    /*
     * The uncontrolled value survives a re-render and dies in a remount, so
     * this is the assertion that the latch is a latch. Rendering the workspace
     * on `lens === 'portfolio'` alone passes every other case in this file and
     * fails here.
     */
    expect((screen.getByTestId('chosen-book') as HTMLInputElement).value).toBe('Large Cap Core')
  })

  /*
   * ── Rewritten, and the reason kept ───────────────────────────────────────
   *
   * This case used to read `does not put a work pane beside the book`, on the
   * reasoning that a book IS the subject on this lens rather than a finding
   * you open a name from, and that `PortfolioWorkspace` already carries its
   * own position detail, so a second pane would be two answers to "what am I
   * looking at".
   *
   * That was reversed on request: the book was the one lens a reader could
   * not open a name from, and it is the lens where "what is going on in this
   * holding" comes up most. The invariant that survives is the half that was
   * always right -- the pane is not FURNITURE. The book gets the whole column
   * until a holding is opened, which is the same rule the feed and Explore
   * follow, and the old case is the first assertion below.
   */
  it('gives the book the whole column until a holding is opened', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    expect(screen.queryByTestId('work-pane')).toBeNull()

    await userEvent.click(screen.getByTestId('open-holding'))
    expect(screen.getByTestId('work-pane')).toBeInTheDocument()
    /* And the book stays beside it, rather than being replaced by it: the
       reader picks the next holding from the same list. */
    expect(screen.getByTestId('portfolio')).toBeInTheDocument()
    expect(stowed('portfolio')).toBe(false)
  })

  /*
   * ── Re-pointed, and the reason kept ──────────────────────────────────────
   *
   * This read the label off a `data-back-to` the mocked work pane reflected,
   * because the back control was drawn inside that pane. It is not any more:
   * pressing it gives this COLUMN its width back, so it belongs over the
   * column, and the pane no longer receives the label at all. Same claim,
   * read where the control now is -- and the real `BackToSection` renders
   * here, so this reads the text a reader would.
   */
  it('names the way back for the lens the holding was opened from', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.click(screen.getByTestId('open-holding'))
    /* The shell reads `LENSES`, so this is also what catches a lens label and
       an exit label drifting apart. */
    expect(screen.getByText(/Back to Portfolio/)).toBeInTheDocument()
  })

  it('offers no way back before a holding is opened', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    /* The band is keyed on `splitOpen`. Drawn unconditionally it would be a
       permanent "Back to Portfolio" above a full-width book that is already
       the thing it goes back to. */
    expect(screen.queryByText(/Back to/)).toBeNull()
  })

  it('puts the way back over the book, not over the workspace', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.click(screen.getByTestId('open-holding'))
    /*
     * Document order is the proxy for screen order: the row lays out left to
     * right with the browse column first. The defect this catches is the
     * control drifting back inside the pane's subtree, which is where it
     * started -- and `Node.compareDocumentPosition` reads it directly rather
     * than inferring it from a class name.
     */
    const back = screen.getByText(/Back to Portfolio/)
    const pane = screen.getByTestId('work-pane')
    expect(back.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pane.contains(back)).toBe(false)
  })

  it('does not draw the feed underneath the book', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    /*
     * The three browse surfaces now share one column. The feed's wrapper was
     * keyed `lens === 'explore' && 'hidden'`, which meant "hidden on Explore"
     * -- correct while Portfolio sat outside this column and wrong the moment
     * it moved in, because Portfolio is not Explore and the feed would render
     * under the book.
     */
    expect(feedIsHidden()).toBe(true)
    expect(stowed('explore')).toBe(true)
  })

  /**
   * And the stowing is the cheap kind.
   *
   * ── Why a class name is the subject ─────────────────────────────────────
   *
   * jsdom has no layout and no `content-visibility`, so the only honest way
   * to assert this here is the contract between the shell and the stylesheet:
   * the shell asks for `.lens-stowed`, and `.lens-stowed` is the rule that
   * keeps the rendering state. Both halves are pinned, because either one
   * alone passes while the other is wrong -- a shell that went back to
   * `hidden` would still find the rule in the stylesheet, and a rule changed
   * to `display: none` would still be named by the shell.
   *
   * The cost it protects is invisible in every other test and plain on
   * screen: a 74-81ms task on every press, measured in the running app.
   */
  it('stows a lens without throwing its layout away', () => {
    const shell = readFileSync(join(process.cwd(), 'src/components/dashboard-next/DashboardNext.tsx'), 'utf8')
    /* Every one of the three, so a lens added later cannot quietly keep the
       expensive spelling. */
    expect(shell.match(/lens !== '(feed|explore|portfolio)' && 'lens-stowed'/g)).toHaveLength(3)

    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
    const rule = css.slice(css.indexOf('.lens-stowed {'))
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/content-visibility:\s*hidden/)
    /* Out of flow, or the showing lens gets a third of the column. */
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/position:\s*absolute/)
  })

  it('is one row with three buttons, not a second navigation idiom', () => {
    render(<DashboardNext />)
    for (const name of ['Ideas', 'Explore', 'Portfolio']) {
      expect(lens(name)).toBeInTheDocument()
    }
    /* `aria-pressed` is what tells a screen reader which lens is live; a row
       of plain buttons says nothing about the current one. */
    expect(lens('Ideas')).toHaveAttribute('aria-pressed', 'true')
    expect(lens('Portfolio')).toHaveAttribute('aria-pressed', 'false')
  })
})

/**
 * Leaving the Dashboard tab and coming back.
 *
 * ── Why unmount and render again, and not a rerender ──────────────────────
 *
 * This is the real event. `DashboardPage.renderTabContent()` renders the
 * ACTIVE tab only, so looking at anything else drops this whole tree and
 * returning builds a new one. `unmount()` followed by a second `render` is
 * that, exactly; a rerender is not, and would pass against the broken
 * behaviour because nothing was ever lost.
 *
 * `forgetPlace()` runs before each case, so each one is a reader arriving
 * cold and then returning -- never inheriting the previous case's place.
 */
describe('coming back to the Dashboard', () => {
  it('returns the reader to the lens they left', async () => {
    const first = render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    expect(lens('Portfolio')).toHaveAttribute('aria-pressed', 'true')
    first.unmount()

    render(<DashboardNext />)
    expect(lens('Portfolio')).toHaveAttribute('aria-pressed', 'true')
    expect(lens('Ideas')).toHaveAttribute('aria-pressed', 'false')
    /* And the book is mounted under the bar. The latch is derived during
       render, so the restored lens mounts it on the first pass -- which is
       why the place does not carry the latch itself. See `../place`. */
    expect(screen.getByTestId('portfolio')).toBeInTheDocument()
  })

  it('returns the reader to what they were working on', async () => {
    const first = render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.click(screen.getByTestId('open-holding'))
    expect(screen.getByTestId('work-pane')).toBeInTheDocument()
    first.unmount()

    render(<DashboardNext />)
    // The open pane, the selection inside it and the way back out of it.
    expect(screen.getByTestId('work-pane')).toBeInTheDocument()
    expect(screen.getByText(/Back to Portfolio/)).toBeInTheDocument()
  })

  /**
   * The counter-check. A reader who closed the pane before leaving must not
   * have it reopened for them, or the restore is not a restore -- it is a
   * surface that reopens whatever was last open.
   */
  it('does not reopen a pane the reader had closed', async () => {
    const first = render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.click(screen.getByTestId('open-holding'))
    await userEvent.click(screen.getByText(/Back to Portfolio/))
    expect(screen.queryByTestId('work-pane')).toBeNull()
    first.unmount()

    render(<DashboardNext />)
    expect(screen.queryByTestId('work-pane')).toBeNull()
    // The lens is still remembered, so this is a closed pane and not a
    // forgotten place.
    expect(lens('Portfolio')).toHaveAttribute('aria-pressed', 'true')
  })

  /** A first arrival, which must look like a first arrival. */
  it('opens on Ideas for a reader with no place to return to', () => {
    render(<DashboardNext />)
    expect(lens('Ideas')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('work-pane')).toBeNull()
    expect(screen.queryByTestId('portfolio')).toBeNull()
  })
})
