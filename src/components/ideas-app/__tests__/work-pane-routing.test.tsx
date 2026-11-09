import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdeasWorkPane } from '../IdeasWorkPane'
import { selectionFor, selectionForStory } from '../../../lib/desktop-ideas/selection'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

/**
 * What the workspace pane opens, for every candidate that reaches it.
 *
 * ── The two dead ends this file pins shut ─────────────────────────────────
 *
 * Both were reported from the running app, and both ended with the reader
 * looking at a pane that answered nothing.
 *
 *   a NEWS tile    opened a full-screen reader over the whole Dashboard. The
 *                  feed, the book and the workspace all disappeared behind
 *                  it, and on a blocked story -- which is most of them --
 *                  what remained was one sentence and a link out.
 *
 *   a PAIR TRADE   opened "This trade idea is not wired up yet. Its
 *                  underlying row is no longer in the loaded feed." The row
 *                  was in the feed. `postKindOf` calls a pair a trade idea
 *                  and `ideaRowFromFeedItem` accepts only `trade_idea`, both
 *                  correctly, and the gap between them was a dead end.
 *
 * ── Why the heavy children are stubbed ────────────────────────────────────
 *
 * The question here is ROUTING: which surface, for which object. Mounting the
 * real asset workspace would need a query client, an attention pool, market
 * data and a thesis, and would prove nothing this file is about -- while the
 * stub's id makes the one thing that matters, WHICH asset, directly readable.
 * The surfaces themselves are covered where they live.
 */

vi.mock('../../asset-v2/AssetWorkspace', () => ({
  AssetWorkspacePane: ({ asset, issue }: { asset: { id: string }; issue?: unknown }) => (
    <div data-testid="asset-pane" data-asset={asset.id}>{String(issue ?? '')}</div>
  ),
}))

vi.mock('../../mobile/ArticleReader', () => ({
  ArticleReader: ({ url, embedded }: { url: string; embedded?: boolean }) => (
    <div data-testid="story" data-url={url} data-embedded={embedded ? 'yes' : 'no'} />
  ),
}))

vi.mock('../../ideas-v2/IdeaDetail', () => ({
  IdeaDetail: () => <div data-testid="idea-detail" />,
}))

vi.mock('../../ideas/QuickThoughtDetailPanel', () => ({
  QuickThoughtDetailPanel: () => <div data-testid="thought-detail" />,
}))

vi.mock('../../thoughts/PromptDetailView', () => ({
  PromptDetailView: () => <div data-testid="prompt-detail" />,
}))

/* The one real hook in the tree. It maps the feed row onto `IdeaRow`, which
   is the thing a pair cannot be, so stubbing it would stub the defect. */
vi.mock('../../../hooks/useTradeIdeaWorkspace', () => ({
  useTradeIdeaWorkspace: (item: unknown) => ({
    idea: (item as { type?: string } | null)?.type === 'trade_idea' ? { id: 'i1' } : null,
    detail: null,
    exposure: undefined,
  }),
}))

const pane = (selection: ReturnType<typeof selectionForStory>) =>
  render(<IdeasWorkPane selection={selection} entry={null} onClose={() => {}} />)

const post = (item: Record<string, unknown>, entity: unknown): AttentionEntry => ({
  key: 'k1',
  family: 'post',
  card: { type: 'pair_trade', headline: 'Long MCD / Short CMG', entity },
  item,
  input: {},
  source: 'ideas',
} as unknown as AttentionEntry)

const PAIR = {
  id: 'pair-1',
  type: 'pair_trade',
  long_legs: [{ id: 'l1', asset: { id: 'mcd', symbol: 'MCD' } }],
  short_legs: [{ id: 's1', asset: { id: 'cmg', symbol: 'CMG' } }],
}

const ASSET = { kind: 'asset', id: 'mcd', ticker: 'MCD' }

describe('a news story', () => {
  const STORY = {
    url: 'https://wire.test/oil',
    title: 'Peace sends oil lower',
    source: 'Yahoo',
    desk: { symbol: 'XOM', assetId: 'xom-1' },
  }

  it('is read inside the pane, not over the top of the app', () => {
    pane(selectionForStory(STORY))
    const story = screen.getByTestId('story')
    expect(story.getAttribute('data-url')).toBe('https://wire.test/oil')
    /* The flag IS the fix. Without it the same component portals itself to
       the body as a fixed full-screen box, which is the popup that was
       reported. */
    expect(story.getAttribute('data-embedded')).toBe('yes')
  })

  /* The reason the overlay had to go: the question a story raises here is
     whether the case still holds, and the case was behind it. */
  it('puts the name the desk holds directly under the words', () => {
    pane(selectionForStory(STORY))
    expect(screen.getByTestId('asset-pane').getAttribute('data-asset')).toBe('xom-1')
  })

  it('enters that workspace from the headline, so it is not arrived at cold', () => {
    pane(selectionForStory(STORY))
    expect(screen.getByTestId('asset-pane').textContent).toContain('Peace sends oil lower')
  })

  /* A story about a name with no asset record is still readable, and the
     pane draws no workspace rather than an empty one. */
  it('stands on its own where there is no asset behind the name', () => {
    pane(selectionForStory({ ...STORY, desk: null }))
    expect(screen.getByTestId('story')).toBeTruthy()
    expect(screen.queryByTestId('asset-pane')).toBeNull()
  })
})

describe('a pair trade', () => {
  it('opens the names it is about instead of saying its row is missing', () => {
    pane(selectionFor(post(PAIR, ASSET)) as never)
    expect(screen.queryByText(/not wired up yet/i)).toBeNull()
    expect(screen.getByTestId('asset-pane').getAttribute('data-asset')).toBe('mcd')
  })

  /* The half that was being hidden. A page about MCD is half of
     "Long MCD / Short CMG", and nothing on screen said so. */
  it('states both sides above the page that answers for one', () => {
    pane(selectionFor(post(PAIR, ASSET)) as never)
    expect(screen.getByText('MCD')).toBeTruthy()
    expect(screen.getByText('CMG')).toBeTruthy()
    expect(screen.getByText('long')).toBeTruthy()
    expect(screen.getByText('short')).toBeTruthy()
  })

  it('opens the side the reader picks', async () => {
    pane(selectionFor(post(PAIR, ASSET)) as never)
    await userEvent.click(screen.getByText('CMG'))
    expect(screen.getByTestId('asset-pane').getAttribute('data-asset')).toBe('cmg')
  })

  /* The rail is for a pair and only a pair: a single-name idea has one leg
     at most and a row of one chip would be chrome. */
  it('draws no rail for a single-name idea', () => {
    pane(selectionFor(post({ id: 'r1', type: 'trade_idea' }, ASSET)) as never)
    expect(screen.getByTestId('idea-detail')).toBeTruthy()
    expect(screen.queryByText(/both sides/i)).toBeNull()
  })
})

describe('a post with no surface of its own', () => {
  /* A thesis update, a note from a research system, a message: all of them
     are somebody writing about a NAME, and the name's own workspace answers
     "what do I know about this and what can I do now" truthfully. The old
     branch printed a sentence saying the surface did not exist. */
  it('opens the name it is about', () => {
    pane(selectionFor(post({ id: 'r1', type: 'thesis_update' }, ASSET)) as never)
    expect(screen.queryByText(/not wired up yet/i)).toBeNull()
    expect(screen.getByTestId('asset-pane').getAttribute('data-asset')).toBe('mcd')
  })

  /* And still says so honestly when there is no name either, which is the
     one case where there is genuinely nothing to open. */
  it('says so plainly when the post names no asset', () => {
    pane(selectionFor(post({ id: 'r1', type: 'thesis_update' }, { kind: 'project', id: 'p1' })) as never)
    expect(screen.getByText(/not wired up yet/i)).toBeTruthy()
  })
})
