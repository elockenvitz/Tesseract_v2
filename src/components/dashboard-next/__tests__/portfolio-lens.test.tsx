import { describe, it, expect, vi } from 'vitest'
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
  /* `backTo` is reflected so the shell's choice of label can be asserted
     without rendering the real pane's header and every surface under it. */
  IdeasWorkPane: ({ backTo }: { backTo?: string }) => (
    <div data-testid="work-pane" data-back-to={backTo} />
  ),
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

import { DashboardNext } from '../DashboardNext'

const lens = (name: string) => screen.getByRole('button', { name })

/** The feed's half of the screen is hidden by class, never unmounted. */
const feedIsHidden = () => screen.getByTestId('feed').closest('.hidden') !== null

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
    expect(screen.getByTestId('portfolio').closest('.hidden')).toBeNull()
  })

  it('names the way back for the lens the holding was opened from', async () => {
    render(<DashboardNext />)
    await userEvent.click(lens('Portfolio'))
    await userEvent.click(screen.getByTestId('open-holding'))
    /* The shell reads `LENSES`, so this is also what catches a lens label and
       an exit label drifting apart. */
    expect(screen.getByTestId('work-pane')).toHaveAttribute('data-back-to', 'Portfolio')
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
    expect(screen.getByTestId('explore').closest('.hidden')).not.toBeNull()
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
