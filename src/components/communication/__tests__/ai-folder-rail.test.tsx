/**
 * The folder rail, as a reader uses it.
 *
 * The pure rules have their own tests; this is about the parts only a
 * rendered component can be wrong about: what the rail shows before anything
 * is created, whether selecting a shelf actually scopes the list, whether
 * "move" is offered when there is nowhere to move to, and whether deleting a
 * folder tells the truth about what happens to the threads on it.
 *
 * The list is driven entirely by props, so no Supabase client, no auth and no
 * organization provider are needed -- which is the reason the rail takes
 * props rather than calling the hook itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConversationList } from '../AIConversationList'
import { UNFILED, type AIProjectFolder, type FolderSelection } from '../../../lib/ai/folders'

/*
 * In the order the hook supplies them, which is by name.
 *
 * The rail renders the order it is given rather than sorting again: two
 * sorts is two answers to one question, and the query already carries
 * `order('name')`. So the fixture is sorted, the way the host's is.
 */
const folders: AIProjectFolder[] = [
  { id: 'f-apple', name: 'Apple investment case', isArchived: false, organizationId: 'org-a', updatedAt: null },
  { id: 'f-earnings', name: 'Earnings season', isArchived: false, organizationId: 'org-a', updatedAt: null },
]

const conversation = (id: string, title: string, folderId: string | null) => ({
  id,
  user_id: 'u-1',
  context_type: null,
  context_id: null,
  title,
  is_archived: false,
  is_pinned: false,
  last_message_at: '2026-11-10T12:00:00Z',
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-10T12:00:00Z',
  folder_id: folderId,
  tags: [],
})

const conversations = [
  conversation('c-aapl', 'AAPL target review', 'f-apple'),
  conversation('c-msft', 'MSFT Q4 setup', 'f-earnings'),
  conversation('c-nvda', 'NVDA supply chain', 'f-earnings'),
  conversation('c-loose', 'A thought about rates', null),
]

const handlers = {
  onSelect: vi.fn(),
  onNewConversation: vi.fn(),
  onRename: vi.fn(),
  onArchive: vi.fn(),
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
  onSelectFolder: vi.fn(),
  onCreateFolder: vi.fn(),
  onRenameFolder: vi.fn(),
  onArchiveFolder: vi.fn(),
  onDeleteFolder: vi.fn(),
  onMoveConversation: vi.fn(),
}

function list(overrides: Partial<Parameters<typeof AIConversationList>[0]> = {}) {
  return (
    <AIConversationList
      conversations={conversations}
      activeConversationId={null}
      isLoading={false}
      folders={folders}
      archivedFolders={[]}
      activeFolderId={null}
      {...handlers}
      {...overrides}
    />
  )
}

const rail = () => screen.getByTestId('ai-folder-rail')
const rows = () => Array.from(rail().querySelectorAll<HTMLElement>('[data-slot="ai-folder-row"]'))
/* By test id rather than by `li > div > div > div.truncate`. The title is now
   a real button so it can be reached from the keyboard, and a selector
   written against the nesting broke on that without anything being wrong. */
const titles = () =>
  Array.from(
    screen.getByTestId('ai-conversation-list')
      .querySelectorAll('[data-testid="ai-conversation-title"]'),
  ).map(n => n.textContent)

beforeEach(() => {
  for (const fn of Object.values(handlers)) fn.mockReset()
})

describe('the folder rail', () => {
  it('lists every shelf with the count a reader can actually reach', () => {
    render(list())

    /* Counted from the conversations on screen, not from the folder table: a
       number beside a shelf is a promise the list has to keep. */
    expect(rows().map(r => r.textContent)).toEqual([
      expect.stringContaining('All conversations'),
      expect.stringContaining('Apple investment case'),
      expect.stringContaining('Earnings season'),
      expect.stringContaining('Unfiled'),
    ])
    expect(rows()[0]).toHaveTextContent('4')
    expect(rows()[1]).toHaveTextContent('1')
    expect(rows()[2]).toHaveTextContent('2')
    expect(rows()[3]).toHaveTextContent('1')
  })

  it('offers the two rows that always exist even with no folders at all', () => {
    render(list({ folders: [] }))
    expect(rows().map(r => r.textContent)).toEqual([
      expect.stringContaining('All conversations'),
      expect.stringContaining('Unfiled'),
    ])
    /* And the control to make the first one. An empty shelf list is not an
       absent feature. */
    expect(screen.getByTestId('ai-folder-new')).toBeInTheDocument()
  })

  it('renders no rail at all for a surface that was never wired for folders', () => {
    /* `folders` undefined and `folders` empty are different states: the first
       is "this surface has no folders", and it must not grow dead controls. */
    render(list({ folders: undefined }))
    expect(screen.queryByTestId('ai-folder-rail')).not.toBeInTheDocument()
    expect(titles()).toHaveLength(4)
  })

  it('scopes the conversation list to the selected shelf', () => {
    render(list({ activeFolderId: 'f-earnings' }))
    expect(titles()).toEqual(['MSFT Q4 setup', 'NVDA supply chain'])

    expect(rows()[2].getAttribute('data-folder-active')).toBe('true')
  })

  it('shows only the unfiled threads for the unfiled row', () => {
    render(list({ activeFolderId: UNFILED }))
    expect(titles()).toEqual(['A thought about rates'])
  })

  it('names the shelf in its own empty state', () => {
    render(list({ activeFolderId: 'f-earnings', conversations: [conversations[0], conversations[3]] }))
    /* "No conversations match the current filter" would imply the reader has
       nothing; this says which shelf is empty. */
    expect(screen.getByTestId('ai-conversation-empty'))
      .toHaveTextContent('Nothing is filed in Earnings season yet.')
  })

  it('reports the selection back to the host', async () => {
    render(list())
    await userEvent.click(screen.getByText('Earnings season'))
    expect(handlers.onSelectFolder).toHaveBeenCalledWith('f-earnings')

    await userEvent.click(screen.getByText('Unfiled'))
    expect(handlers.onSelectFolder).toHaveBeenLastCalledWith(UNFILED)

    await userEvent.click(screen.getByText('All conversations'))
    expect(handlers.onSelectFolder).toHaveBeenLastCalledWith(null)
  })
})

describe('creating and renaming a shelf', () => {
  it('creates one from a typed name, normalised', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-folder-new'))
    await userEvent.type(screen.getByTestId('ai-folder-name-input'), '  Investment   committee prep  {Enter}')

    expect(handlers.onCreateFolder).toHaveBeenCalledWith('Investment committee prep')
  })

  it('refuses a duplicate before the round trip, in a sentence', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-folder-new'))
    await userEvent.type(screen.getByTestId('ai-folder-name-input'), 'earnings SEASON{Enter}')

    expect(handlers.onCreateFolder).not.toHaveBeenCalled()
    expect(screen.getByTestId('ai-folder-error'))
      .toHaveTextContent('You already have a folder called earnings SEASON')
  })

  it('refuses an empty name', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-folder-new'))
    await userEvent.type(screen.getByTestId('ai-folder-name-input'), '   {Enter}')

    expect(handlers.onCreateFolder).not.toHaveBeenCalled()
    expect(screen.getByTestId('ai-folder-error')).toHaveTextContent('Give the folder a name.')
  })

  it('renames one in place', async () => {
    render(list())
    await userEvent.click(screen.getByRole('button', { name: 'Rename Earnings season' }))
    const input = within(rows()[2]).getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'Q4 earnings{Enter}')

    expect(handlers.onRenameFolder).toHaveBeenCalledWith('f-earnings', 'Q4 earnings')
  })

  it('archives one, and restores it from the archived list', async () => {
    render(list({
      archivedFolders: [{ id: 'f-old', name: 'Last cycle', isArchived: true, organizationId: 'org-a', updatedAt: null }],
    }))

    await userEvent.click(screen.getByRole('button', { name: 'Archive Earnings season' }))
    expect(handlers.onArchiveFolder).toHaveBeenCalledWith('f-earnings', true)

    /* Archived is not deleted, and it is not a dead end: the list is behind a
       disclosure and each row restores. */
    expect(screen.queryByTestId('ai-folder-archived')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('ai-folder-archived-toggle'))
    await userEvent.click(screen.getByRole('button', { name: 'Restore Last cycle' }))
    expect(handlers.onArchiveFolder).toHaveBeenLastCalledWith('f-old', false)
  })

  /**
   * Deleting a shelf is not deleting the research on it.
   *
   * `folder_id` is ON DELETE SET NULL. The confirmation has to say so,
   * because "Delete folder" beside a list of someone's threads reads as
   * deleting the threads, and a reader who believes that will not use the
   * feature.
   */
  it('says what survives before deleting a folder', async () => {
    render(list())
    await userEvent.click(screen.getByRole('button', { name: 'Delete Earnings season' }))

    const dialog = await screen.findByText(/Delete Earnings season\?/)
    expect(dialog).toHaveTextContent('Its 2 conversations are kept')
    expect(dialog).toHaveTextContent('become unfiled')
    expect(dialog).toHaveTextContent('Nothing is deleted with it')
    expect(handlers.onDeleteFolder).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete folder' }))
    expect(handlers.onDeleteFolder).toHaveBeenCalledWith('f-earnings')
  })
})

describe('moving a conversation', () => {
  it('files it onto another shelf', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-move-c-loose'))

    const menu = screen.getByTestId('ai-move-menu-c-loose')
    expect(within(menu).getAllByText(/Earnings season|Apple investment case/)).toHaveLength(2)

    await userEvent.click(within(menu).getByText('Earnings season'))
    expect(handlers.onMoveConversation).toHaveBeenCalledWith('c-loose', 'f-earnings')
  })

  it('takes it off a shelf without touching the thread', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-move-c-msft'))
    await userEvent.click(screen.getByTestId('ai-unfile-c-msft'))
    expect(handlers.onMoveConversation).toHaveBeenCalledWith('c-msft', null)
  })

  it('offers no unfile control for a thread that is already unfiled', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-move-c-loose'))
    expect(screen.queryByTestId('ai-unfile-c-loose')).not.toBeInTheDocument()
  })

  it('sends nothing when the chosen shelf is the one it is already on', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-move-c-msft'))
    const menu = screen.getByTestId('ai-move-menu-c-msft')
    await userEvent.click(within(menu).getByText('Earnings season'))
    expect(handlers.onMoveConversation).not.toHaveBeenCalled()
  })

  it('hides the control entirely when there is nowhere to move to', () => {
    /* No folders and the thread is unfiled: there is no move to make, and an
       enabled control that does nothing is worse than no control. */
    render(list({ folders: [], conversations: [conversations[3]] }))
    expect(screen.queryByTestId('ai-move-c-loose')).not.toBeInTheDocument()
  })

  it('still offers the control for a filed thread when every folder is gone', () => {
    /* The shelf was archived out of the list; the thread is still on it, so
       taking it off has to stay possible. */
    render(list({ folders: [], conversations: [conversations[1]] }))
    expect(screen.getByTestId('ai-move-c-msft')).toBeInTheDocument()
  })
})

/**
 * Archiving a conversation had no way back.
 *
 * The sidebar's query filters `is_archived = false`, so an archived thread
 * was reachable by id and by nothing a reader could click, while
 * `unarchiveConversation` sat in the hook with no caller. These tests are
 * about the round trip existing at all, and about the list not pretending to
 * know what it has not fetched.
 */
describe('archived conversations', () => {
  const archived = [conversation('c-old', 'A thread from March', null)]

  it('fetches them only when the reader opens the disclosure', async () => {
    const onLoadArchived = vi.fn()
    render(list({ onLoadArchived }))

    expect(onLoadArchived).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ai-archived-list')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('ai-archived-toggle'))
    expect(onLoadArchived).toHaveBeenCalledTimes(1)
  })

  it('says it is loading rather than claiming there is nothing', async () => {
    /* `undefined` is "not asked yet" and `[]` is "asked, nothing there". This
       product has shipped a default rendered as a verdict three times; the
       two states are kept apart here. */
    render(list({ onLoadArchived: vi.fn(), archivedConversations: undefined }))
    await userEvent.click(screen.getByTestId('ai-archived-toggle'))
    expect(screen.getByTestId('ai-archived-list')).toHaveTextContent('Loading…')

    render(list({ onLoadArchived: vi.fn(), archivedConversations: [] }))
    await userEvent.click(screen.getAllByTestId('ai-archived-toggle')[1])
    expect(screen.getAllByTestId('ai-archived-list')[1]).toHaveTextContent('Nothing is archived.')
  })

  it('restores one, and offers a delete that confirms first', async () => {
    const onUnarchive = vi.fn()
    render(list({ onLoadArchived: vi.fn(), archivedConversations: archived, onUnarchive }))
    await userEvent.click(screen.getByTestId('ai-archived-toggle'))

    await userEvent.click(screen.getByRole('button', { name: 'Restore A thread from March' }))
    expect(onUnarchive).toHaveBeenCalledWith('c-old')

    await userEvent.click(screen.getByRole('button', { name: 'Delete A thread from March' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()

    /* The confirmation, not a row's own delete icon: several buttons on this
       screen are called Delete, and the one that matters is the one inside
       the dialog that just named the thread. */
    const dialog = screen.getByText(/Delete "A thread from March"\?/).closest('div.fixed, [role="dialog"]')
      ?? document.body
    await userEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Delete' }))
    expect(handlers.onDelete).toHaveBeenCalledWith('c-old')
  })

  it('has no disclosure at all on a surface that cannot load them', () => {
    render(list())
    expect(screen.queryByTestId('ai-archived-toggle')).not.toBeInTheDocument()
  })
})

describe('what the rail does not do', () => {
  it('leaves search and the tag filter working alongside the folder scope', async () => {
    render(list({ activeFolderId: 'f-earnings' }))
    await userEvent.type(screen.getByPlaceholderText('Search conversations…'), 'nvda')
    expect(titles()).toEqual(['NVDA supply chain'])
  })

  it('reports a rejection from the server in the readers words', () => {
    render(list({ folderError: 'You already have a folder called Earnings season.' }))
    expect(screen.getByTestId('ai-folder-error'))
      .toHaveTextContent('You already have a folder called Earnings season.')
  })

  it('never claims a selection the host did not make', () => {
    const selection: FolderSelection = null
    render(list({ activeFolderId: selection }))
    expect(rows().filter(r => r.getAttribute('data-folder-active') === 'true')).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('All conversations')
  })
})
