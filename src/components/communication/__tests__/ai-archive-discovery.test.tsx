/**
 * Finding a thread you archived, in the rendered sidebar.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Archiving was reversible only in principle. The search box, the folder
 * rail and the reference chips filtered the live list; the archive disclosed
 * underneath honoured none of them, and it was fetched only when the reader
 * opened it by hand. So a reader who archived "NVDA supply chain" and later
 * typed "NVDA" saw an empty list and a collapsed row that could not even
 * show a count, because nothing had been loaded to count. The thread was not
 * archived; it was gone.
 *
 * ── Why this renders the real list ────────────────────────────────────────
 *
 * `conversation-filter.test` drives the rules. What only a render can be
 * wrong about is whether the archive is wired to them at all: the previous
 * implementation passed every rule test it had, because its rules were
 * correct and simply never applied to the second list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConversationList } from '../AIConversationList'
import { UNFILED, type AIProjectFolder } from '../../../lib/ai/folders'
import type { TagRef } from '../../../hooks/useAI'

const folders: AIProjectFolder[] = [
  { id: 'f-apple', name: 'Apple investment case', isArchived: false, organizationId: 'org-a', updatedAt: null },
  { id: 'f-earnings', name: 'Earnings season', isArchived: false, organizationId: 'org-a', updatedAt: null },
]

const thread = (
  id: string, title: string, folderId: string | null,
  { archived = false, tags = [] as TagRef[] } = {},
) => ({
  id,
  user_id: 'u-1',
  context_type: null,
  context_id: null,
  title,
  is_archived: archived,
  is_pinned: false,
  last_message_at: '2026-11-10T12:00:00Z',
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-10T12:00:00Z',
  folder_id: folderId,
  tags,
})

const LIVE = [
  thread('c-aapl', 'AAPL target review', 'f-apple', { tags: [{ type: 'asset', id: 'a-aapl' }] }),
  thread('c-loose', 'A thought about rates', null),
]

const ARCHIVED = [
  thread('c-nvda', 'NVDA supply chain', 'f-earnings', {
    archived: true, tags: [{ type: 'asset', id: 'a-nvda' }],
  }),
  thread('c-msft', 'MSFT Q4 setup', 'f-earnings', { archived: true }),
  thread('c-rates', 'Rates, again', null, {
    archived: true, tags: [{ type: 'theme', id: 't-rates' }],
  }),
]

const onUnarchive = vi.fn()
const onLoadArchived = vi.fn()

function list(overrides: Partial<Parameters<typeof AIConversationList>[0]> = {}) {
  return (
    <AIConversationList
      conversations={LIVE}
      activeConversationId={null}
      isLoading={false}
      folders={folders}
      archivedFolders={[]}
      activeFolderId={null}
      archivedConversations={ARCHIVED}
      onLoadArchived={onLoadArchived}
      onUnarchive={onUnarchive}
      tagLabels={{ 'asset:a-aapl': 'AAPL', 'asset:a-nvda': 'NVDA', 'theme:t-rates': 'Rates' }}
      onSelect={vi.fn()}
      onNewConversation={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onTogglePin={vi.fn()}
      onDelete={vi.fn()}
      onSelectFolder={vi.fn()}
      onCreateFolder={vi.fn()}
      onRenameFolder={vi.fn()}
      onArchiveFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
      onMoveConversation={vi.fn()}
      {...overrides}
    />
  )
}

const search = () => screen.getByPlaceholderText('Search conversations and objects…')
const toggle = () => screen.getByTestId('ai-archived-toggle')
const archived = () => screen.getByTestId('ai-archived-list')
const archivedTitles = () =>
  [...archived().querySelectorAll('li')].map(li => li.textContent?.trim() ?? '')
const titlesOf = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="ai-conversation-title"]')].map(n => n.textContent)
const openArchive = async (user: ReturnType<typeof userEvent.setup>) => {
  if (toggle().getAttribute('aria-expanded') !== 'true') await user.click(toggle())
}
/*
 * ── How a reference is chosen now ────────────────────────────────────────
 *
 * This used to be `chip()`, scoped to `ai-tag-filters`: a permanent row of
 * every reference across both lists, frequency-sorted and cut to twelve.
 * That band is gone -- twelve chips out of two hundred objects is a sample
 * rather than an index, and it was on screen whether or not the reader was
 * looking for an object.
 *
 * The CAPABILITY these cases were written for is unchanged, and still runs
 * through the same `filter.tag` axis: opening an object narrows both the live
 * list and the archive to its conversations. What changed is how the object
 * is reached. So they drive it by searching and pressing the result, which is
 * also the path a reader now takes.
 *
 * The results are a prop, because the list is props-driven and holds no
 * Supabase client; `AISection` owns the search, and `object-discovery.test`
 * owns the ranking.
 */
const OBJECTS = [
  { type: 'asset' as const, id: 'a-nvda', label: 'NVDA', detail: 'NVIDIA Corp' },
  { type: 'asset' as const, id: 'a-aapl', label: 'AAPL', detail: 'Apple Inc.' },
]

/** Type into the search, then press the object result it offers. */
async function openObject(
  user: ReturnType<typeof userEvent.setup>,
  object: { type: string; id: string; label: string },
) {
  await user.clear(search())
  await user.type(search(), object.label)
  await user.click(screen.getByTestId(`ai-object-result-${object.type}-${object.id}`))
  /* The query has done its job -- it was how the object was found. Leaving it
     in place would narrow the object's own conversations by its label as
     well, which is a second filter the reader did not ask for. */
  await user.clear(search())
}

beforeEach(() => {
  onUnarchive.mockClear()
  onLoadArchived.mockClear()
})
afterEach(cleanup)

describe('searching reaches the archive', () => {
  it('finds an archived thread by its title', async () => {
    const user = userEvent.setup()
    render(list())
    await user.type(search(), 'NVDA')
    await openArchive(user)

    expect(archivedTitles().some(t => t.includes('NVDA supply chain'))).toBe(true)
  })

  it('leaves the archived threads that do not match out of it', async () => {
    const user = userEvent.setup()
    render(list())
    await user.type(search(), 'NVDA')
    await openArchive(user)

    expect(archivedTitles().some(t => t.includes('MSFT Q4 setup'))).toBe(false)
  })

  it('opens the archive itself when the live list has nothing and the archive does', async () => {
    /* Otherwise the reader has to already suspect the thread is archived in
       order to look for it there, which is the position they were in before. */
    const user = userEvent.setup()
    render(list())
    await user.type(search(), 'NVDA')

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'))
  })

  it('loads the archive on a search, without the reader opening it', async () => {
    const user = userEvent.setup()
    render(list({ archivedConversations: undefined }))
    await user.type(search(), 'NVDA')

    await waitFor(() => expect(onLoadArchived).toHaveBeenCalled())
  })

  it('says what it searched when nothing in the archive matches', async () => {
    const user = userEvent.setup()
    render(list())
    await user.type(search(), 'Tesla')
    await openArchive(user)

    expect(screen.getByTestId('ai-archived-empty').textContent)
      .toContain('No archived conversation matches Tesla.')
  })

  it('still says the archive is empty when it really is', async () => {
    const user = userEvent.setup()
    render(list({ archivedConversations: [] }))
    await openArchive(user)

    expect(screen.getByTestId('ai-archived-empty').textContent).toContain('Nothing is archived.')
  })
})

describe('the archive respects the folder rail', () => {
  it('shows only the archived threads on the selected shelf', async () => {
    const user = userEvent.setup()
    render(list({ activeFolderId: 'f-earnings' }))
    await openArchive(user)

    const titles = archivedTitles()
    expect(titles.some(t => t.includes('NVDA supply chain'))).toBe(true)
    expect(titles.some(t => t.includes('MSFT Q4 setup'))).toBe(true)
    expect(titles.some(t => t.includes('Rates, again'))).toBe(false)
  })

  it('shows the unfiled archived threads under the unfiled shelf', async () => {
    const user = userEvent.setup()
    render(list({ activeFolderId: UNFILED }))
    await openArchive(user)

    expect(archivedTitles().some(t => t.includes('Rates, again'))).toBe(true)
    expect(archivedTitles().some(t => t.includes('NVDA supply chain'))).toBe(false)
  })

  it('shows nothing for a folder from another organisation', async () => {
    /*
     * The isolation this surface can actually enforce. `ai_conversations`
     * carries no `organization_id` -- the live table's shape -- so the
     * database boundary is ownership (`user_id = auth.uid()`, applied by the
     * query that produced these rows) and the FOLDER is the org-aware axis,
     * since folders are per reader per organization. Switching firms must
     * therefore empty the shelf, not fall through to every archived thread.
     */
    const user = userEvent.setup()
    render(list({ activeFolderId: 'f-from-another-org' }))
    await openArchive(user)

    expect(screen.getByTestId('ai-archived-empty').textContent)
      .toContain('No archived conversation is in this folder.')
  })

  it('counts what the filter leaves, out of what is archived', async () => {
    render(list({ activeFolderId: 'f-earnings' }))
    expect(toggle().textContent).toContain('(2 of 3)')
  })

  it('counts plainly when nothing is filtering', () => {
    render(list())
    expect(toggle().textContent).toContain('(3)')
  })
})

describe('the archive respects the open object', () => {
  it('reaches an object carried only by archived threads', async () => {
    /*
     * The case the chip row was fixed for and the search must not regress.
     * NVDA is on no LIVE thread in this fixture, so a discovery mechanism
     * built from the live list alone would offer nothing to press in the one
     * situation where pressing it is the point. The search queries the
     * database rather than the rendered list, so it does not have that
     * failure mode at all.
     */
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await openObject(user, OBJECTS[0])

    expect(screen.getByTestId('ai-object-name')).toHaveTextContent('NVDA')
  })

  it('counts an object’s conversations across both lists', async () => {
    /* One archived NVDA thread and no live one. The count answers "how many
       of my conversations were about this", and a reader who archived them
       all is not helped by being told there are none. */
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await openObject(user, OBJECTS[0])

    expect(screen.getByTestId('ai-object-threads'))
      .toHaveTextContent('1 conversation about NVDA.')
  })

  it('loads the archive when an object is opened, without being asked', async () => {
    /*
     * Otherwise the band would quietly mean "the live ones" -- it would say
     * "no conversations about NVDA yet" while one sat unfetched.
     *
     * The mock is cleared between typing and pressing, which this test
     * needed and did not have at first: typing already loads the archive
     * through a different effect (searching reaches archived threads), so
     * asserting after the whole gesture passed with the object-open call
     * deleted. It proved the search, not the thing it was written for.
     */
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS, archivedConversations: undefined }))
    await user.type(search(), 'NVDA')
    onLoadArchived.mockClear()

    await user.click(screen.getByTestId('ai-object-result-asset-a-nvda'))

    expect(onLoadArchived).toHaveBeenCalled()
  })

  it('shows only the archived threads carrying the open object', async () => {
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await openObject(user, OBJECTS[0])
    await openArchive(user)

    expect(archivedTitles().some(t => t.includes('NVDA supply chain'))).toBe(true)
    expect(archivedTitles().some(t => t.includes('MSFT Q4 setup'))).toBe(false)
  })

  it('says so when no archived thread carries it', async () => {
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await openObject(user, OBJECTS[1])
    await openArchive(user)

    expect(screen.getByTestId('ai-archived-empty').textContent)
      .toContain('No archived conversation carries that reference.')
  })

  it('lets the reader out again', async () => {
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await openObject(user, OBJECTS[0])

    await user.click(screen.getByTestId('ai-object-leave'))

    expect(screen.queryByTestId('ai-object-view')).not.toBeInTheDocument()
    expect(titlesOf(screen.getByTestId('ai-conversation-list')))
      .toContain('A thought about rates')
  })

  it('offers to start a thread about it', async () => {
    const onNewConversationAbout = vi.fn()
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS, onNewConversationAbout }))
    await openObject(user, OBJECTS[0])

    await user.click(screen.getByTestId('ai-object-new-chat'))

    /* The canonical id, not the label: a symbol can be reassigned and two
       themes can share a name. */
    expect(onNewConversationAbout).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asset', id: 'a-nvda' }),
    )
  })
})

describe('the object results are a search, not a band', () => {
  it('shows nothing until there is a query worth searching for', () => {
    render(list({ objectResults: OBJECTS }))
    expect(screen.queryByTestId('ai-object-results')).not.toBeInTheDocument()
  })

  it('still shows nothing at one character', async () => {
    /* One character matches most of the database and costs the same four
       round trips. See `OBJECT_SEARCH_FLOOR`. */
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await user.type(search(), 'N')
    expect(screen.queryByTestId('ai-object-results')).not.toBeInTheDocument()
  })

  it('appears once the query is long enough, and goes when it is cleared', async () => {
    const user = userEvent.setup()
    render(list({ objectResults: OBJECTS }))
    await user.type(search(), 'NV')
    expect(screen.getByTestId('ai-object-results')).toBeInTheDocument()

    await user.clear(search())
    expect(screen.queryByTestId('ai-object-results')).not.toBeInTheDocument()
  })

  it('mirrors the query up so the host can run the search', async () => {
    const onQueryChange = vi.fn()
    const user = userEvent.setup()
    render(list({ onQueryChange }))
    await user.type(search(), 'NV')
    expect(onQueryChange).toHaveBeenLastCalledWith('NV')
  })

  it('says it is searching rather than that there is nothing', async () => {
    /* "No objects" and "not back yet" are different facts, and the first one
       shown in place of the second reads as an answer. */
    const user = userEvent.setup()
    render(list({ objectResults: [], isSearchingObjects: true }))
    await user.type(search(), 'NV')
    expect(screen.getByTestId('ai-object-results')).toHaveTextContent('Searching…')
  })

  it('draws no band at all once a search has come back empty', async () => {
    const user = userEvent.setup()
    render(list({ objectResults: [], isSearchingObjects: false }))
    await user.type(search(), 'zzzz')
    expect(screen.queryByTestId('ai-object-results')).not.toBeInTheDocument()
  })
})

describe('restoring, and finding it again afterwards', () => {
  it('restores the thread the reader found', async () => {
    const user = userEvent.setup()
    render(list())
    await user.type(search(), 'NVDA')
    await openArchive(user)

    const row = [...archived().querySelectorAll('li')]
      .find(li => li.textContent?.includes('NVDA supply chain'))!
    await user.click(within(row as HTMLElement).getByTitle('Restore NVDA supply chain'))

    expect(onUnarchive).toHaveBeenCalledWith('c-nvda')
  })

  it('shows it in the live list once it is back, found by the same search', async () => {
    /*
     * Restoring is the host's write; what this asserts is that the SAME
     * search term that found it in the archive finds it in the live list
     * afterwards. One filter over both lists is what makes that true.
     */
    const user = userEvent.setup()
    const restored = { ...ARCHIVED[0]!, is_archived: false }
    const { rerender } = render(list())
    await user.type(search(), 'NVDA')

    rerender(list({
      conversations: [...LIVE, restored],
      archivedConversations: ARCHIVED.slice(1),
    }))

    /*
     * Looked for across the whole rail, not only the flat list below the
     * projects: the restored thread is filed in "Earnings season", so it
     * comes back INSIDE that project rather than into the loose list. A
     * search opens every project holding a hit, which is what keeps
     * filtering from hiding the thing being searched for.
     */
    expect(screen.getByTestId('ai-folder-threads-f-earnings').textContent)
      .toContain('NVDA supply chain')
  })

  it('opens the project holding a search hit rather than hiding it', async () => {
    /*
     * The failure this guards. With the tree collapsed by default, a thread
     * filed in a project matched the search and was drawn nowhere: the
     * reader was told "No conversations match the current filter" while the
     * match sat one closed disclosure away.
     */
    const user = userEvent.setup()
    render(list({ conversations: [...LIVE, { ...ARCHIVED[0]!, is_archived: false }] }))

    expect(screen.queryByTestId('ai-folder-threads-f-earnings')).not.toBeInTheDocument()
    await user.type(search(), 'NVDA')

    expect(screen.getByTestId('ai-folder-threads-f-earnings').textContent)
      .toContain('NVDA supply chain')
  })

  it('leaves the archived list empty of it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(list())
    await user.type(search(), 'NVDA')
    await openArchive(user)

    rerender(list({
      conversations: [...LIVE, { ...ARCHIVED[0]!, is_archived: false }],
      archivedConversations: ARCHIVED.slice(1),
    }))

    expect(screen.getByTestId('ai-archived-empty').textContent)
      .toContain('No archived conversation matches NVDA.')
  })
})

describe('what the archive still does not do', () => {
  it('offers no pin, because a pin is about what you are working on now', async () => {
    const user = userEvent.setup()
    render(list())
    await openArchive(user)

    expect(within(archived()).queryByTitle(/^Pin /)).not.toBeInTheDocument()
  })
})
