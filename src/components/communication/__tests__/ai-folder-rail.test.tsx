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

describe('the project tree', () => {
  /*
   * This rail was a flat list of shelves with "All conversations" and
   * "Unfiled" always present, and selecting a shelf filtered the list below.
   * The product owner could not tell from it which project a thread was in
   * or how to put one there -- a fair complaint about a rail where SELECTING
   * a project and FILING into one were the same gesture on the same row.
   *
   * It is a tree now: one disclosure per project, conversations nested
   * inside, unfiled threads in the list underneath. These cases were
   * rewritten rather than deleted, so what replaced each behaviour is on the
   * record.
   */
  it('lists every project with the count a reader can actually reach', () => {
    render(list())

    /* Counted from the conversations on screen, not from the folder table: a
       number beside a project is a promise the list has to keep. */
    expect(rows().map(r => r.textContent)).toEqual([
      expect.stringContaining('Apple investment case'),
      expect.stringContaining('Earnings season'),
    ])
    expect(rows()[0]).toHaveTextContent('1')
    expect(rows()[1]).toHaveTextContent('2')
  })

  it('shows the unfiled threads in the list below, not as a shelf', () => {
    /* "Unfiled" was a row you selected. The unfiled threads are simply what
       the list holds when no project is selected, because the filed ones are
       visible inside their projects and showing both would duplicate them. */
    render(list())
    expect(titles()).toEqual(['A thought about rates'])
  })

  it('says so, and still offers the create control, with no projects at all', () => {
    render(list({ folders: [] }))
    expect(rows()).toHaveLength(0)
    expect(screen.getByTestId('ai-folder-empty')).toHaveTextContent('No projects yet')
    /* An empty project list is not an absent feature. */
    expect(screen.getByTestId('ai-folder-new')).toBeInTheDocument()
    /* And every thread is reachable, because none of them is filed away
       behind a project that does not exist. */
    expect(titles()).toHaveLength(4)
  })

  it('still shows a thread whose project has been archived away', () => {
    /*
     * The bug the first version of this tree had, and the reason the list
     * below is "not in a VISIBLE project" rather than "unfiled".
     *
     * Archiving a project leaves its threads carrying its `folder_id`. No
     * visible project draws them, so filtering the list to `folder_id IS
     * NULL` made them invisible in both places -- a reader could lose a
     * conversation by tidying up.
     */
    render(list({ folders: [] }))
    expect(titles()).toEqual(expect.arrayContaining([
      'AAPL target review', 'MSFT Q4 setup', 'NVDA supply chain', 'A thought about rates',
    ]))
  })

  it('names the section Projects, not Folders', () => {
    render(list())
    expect(rail()).toHaveTextContent('Projects')
    expect(screen.getByLabelText('New project')).toBeInTheDocument()
  })

  it('renders no rail at all for a surface that was never wired for folders', () => {
    /* `folders` undefined and `folders` empty are different states: the first
       is "this surface has no folders", and it must not grow dead controls. */
    render(list({ folders: undefined }))
    expect(screen.queryByTestId('ai-folder-rail')).not.toBeInTheDocument()
    expect(titles()).toHaveLength(4)
  })

  it('scopes the conversation list to the selected shelf', () => {
    /* Folder SELECTION still works and still narrows the list -- it is the
       filter contract, it has its own suite, and search results rely on it.
       What changed is that pressing a project row no longer invokes it. */
    render(list({ activeFolderId: 'f-earnings' }))
    expect(titles()).toEqual(['MSFT Q4 setup', 'NVDA supply chain'])
    expect(rows()[1].getAttribute('data-folder-active')).toBe('true')
    /* And there is a way back out of the narrowed view. */
    expect(screen.getByTestId('ai-folder-clear')).toHaveTextContent('Show all conversations (4)')
  })

  it('shows only the unfiled threads for the unfiled selection', () => {
    render(list({ activeFolderId: UNFILED }))
    expect(titles()).toEqual(['A thought about rates'])
  })

  it('offers no escape control when nothing is narrowed', () => {
    render(list({ activeFolderId: null }))
    expect(screen.queryByTestId('ai-folder-clear')).not.toBeInTheDocument()
  })

  it('names the shelf in its own empty state', () => {
    render(list({ activeFolderId: 'f-earnings', conversations: [conversations[0], conversations[3]] }))
    /* "No conversations match the current filter" would imply the reader has
       nothing; this says which shelf is empty. */
    expect(screen.getByTestId('ai-conversation-empty'))
      .toHaveTextContent('Nothing is filed in Earnings season yet.')
  })

  it('opens a project to show what is in it, and does not filter', async () => {
    render(list())
    /* The whole point of the change. Pressing a project reveals its
       contents in place rather than narrowing the view to it, so the reader
       can see containment without losing everything else. */
    expect(screen.queryByTestId('ai-folder-threads-f-earnings')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Earnings season'))

    const inside = screen.getByTestId('ai-folder-threads-f-earnings')
    expect(inside).toHaveTextContent('MSFT Q4 setup')
    expect(inside).toHaveTextContent('NVDA supply chain')
    expect(handlers.onSelectFolder).not.toHaveBeenCalled()
  })

  it('closes it again', async () => {
    render(list())
    await userEvent.click(screen.getByText('Earnings season'))
    expect(screen.getByTestId('ai-folder-threads-f-earnings')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Earnings season'))
    expect(screen.queryByTestId('ai-folder-threads-f-earnings')).not.toBeInTheDocument()
  })

  it('can be opened from the keyboard', async () => {
    /* The flat rail's rows were clickable divs, so a project could not be
       opened without a mouse. The disclosure is a real button. */
    render(list())
    const toggle = screen.getByRole('button', { name: 'Expand Earnings season' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('ai-folder-threads-f-earnings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Earnings season' }))
      .toHaveAttribute('aria-expanded', 'true')
  })

  it('says a project is empty rather than drawing nothing', async () => {
    render(list({ conversations: [conversations[3]] }))
    await userEvent.click(screen.getByText('Earnings season'))
    expect(screen.getByTestId('ai-folder-threads-f-earnings'))
      .toHaveTextContent('Nothing in this project yet.')
  })

  it('opens the project holding the conversation being read', () => {
    /* Otherwise a reader who arrived from search is looking at a collapsed
       tree with no sign of where the thread they are reading lives. */
    render(list({ activeConversationId: 'c-msft' }))
    expect(screen.getByTestId('ai-folder-threads-f-earnings')).toBeInTheDocument()
  })

  it('shows a project only its own threads, not every thread', () => {
    /* The failure a nested tree invites: running the folder SELECTION
       through the per-project grouping shows one project's contents under
       every project's heading. */
    render(list({ activeConversationId: 'c-msft' }))
    const inside = screen.getByTestId('ai-folder-threads-f-earnings')
    expect(inside).toHaveTextContent('MSFT Q4 setup')
    expect(inside).not.toHaveTextContent('A thought about rates')
    expect(inside).not.toHaveTextContent('AAPL thesis review')
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
    const input = within(rows()[1]).getByRole('textbox')
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

/**
 * Moving a conversation into a project.
 *
 * This existed and was not discoverable: it was a folder-shaped icon among
 * five 12px icons revealed on hover, identified by a tooltip, and it looked
 * like the control that FILTERED by folder. It is a named item now --
 * `···` -> Move to project -> pick one -- which is the path the brief asks
 * for, and these cases go through that path rather than through a test id
 * that no longer exists on its own.
 */
describe('moving a conversation into a project', () => {
  /**
   * Open a row's overflow menu and step into Move to project.
   *
   * Expands every project first: a filed thread now lives inside its
   * project's disclosure rather than in one flat list, so its row does not
   * exist in the DOM until the project is open.
   */
  const openMove = async (id: string) => {
    for (const toggle of screen.queryAllByRole('button', { name: /^Expand / })) {
      await userEvent.click(toggle)
    }
    await userEvent.click(screen.getByTestId(`ai-conv-menu-${id}`))
    await userEvent.click(screen.getByTestId(`ai-move-${id}`))
    return screen.getByTestId(`ai-conv-menu-panel-${id}`)
  }

  it('is reachable as a named item, not an icon', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-conv-menu-c-loose'))
    const panel = screen.getByTestId('ai-conv-menu-panel-c-loose')
    /* The words, on screen. A tooltip on a folder glyph is what failed. */
    expect(panel).toHaveTextContent('Move to project')
    expect(panel).toHaveTextContent('Rename')
    expect(panel).toHaveTextContent('Archive')
    expect(panel).toHaveTextContent('Delete')
  })

  it('files it into another project', async () => {
    render(list())
    const panel = await openMove('c-loose')
    expect(within(panel).getAllByText(/Earnings season|Apple investment case/)).toHaveLength(2)

    await userEvent.click(within(panel).getByText('Earnings season'))
    expect(handlers.onMoveConversation).toHaveBeenCalledWith('c-loose', 'f-earnings')
  })

  it('takes it out of a project without touching the thread', async () => {
    render(list())
    await openMove('c-msft')
    await userEvent.click(screen.getByTestId('ai-unfile-c-msft'))
    expect(handlers.onMoveConversation).toHaveBeenCalledWith('c-msft', null)
  })

  it('offers no remove control for a thread in no project', async () => {
    render(list())
    await openMove('c-loose')
    expect(screen.queryByTestId('ai-unfile-c-loose')).not.toBeInTheDocument()
  })

  it('sends nothing when the chosen project is the one it is already in', async () => {
    render(list({ activeConversationId: 'c-msft' }))
    const panel = await openMove('c-msft')
    /* Shown with a tick and disabled, rather than hidden: the reader asked
       where it is as much as where it could go. */
    const current = within(panel).getByText('Earnings season').closest('button')!
    expect(current).toBeDisabled()
    await userEvent.click(current)
    expect(handlers.onMoveConversation).not.toHaveBeenCalled()
  })

  it('hides the item entirely when there is nowhere to move to', async () => {
    /* No projects and the thread is unfiled: there is no move to make, and
       an enabled item that does nothing is worse than no item. */
    render(list({ folders: [], conversations: [conversations[3]] }))
    await userEvent.click(screen.getByTestId('ai-conv-menu-c-loose'))
    expect(screen.queryByTestId('ai-move-c-loose')).not.toBeInTheDocument()
  })

  it('still offers it for a filed thread when every project is gone', async () => {
    /* The project was archived out of the list; the thread is still in it,
       so taking it out has to stay possible. */
    render(list({ folders: [], conversations: [conversations[1]] }))
    await userEvent.click(screen.getByTestId('ai-conv-menu-c-msft'))
    expect(screen.getByTestId('ai-move-c-msft')).toBeInTheDocument()
  })
})

describe('one overflow menu, not five hover icons', () => {
  it('shows a single control on the row', () => {
    render(list())
    /*
     * The literal complaint: "hovering a conversation reveals too many small
     * buttons". Five icon buttons -- move, pin, rename, archive, delete --
     * with Delete adjacent to Archive, which is the arrangement where a
     * mis-click is destructive.
     */
    const row = screen.getByTestId('ai-conv-menu-c-loose').closest('li')!
    const buttons = within(row).getAllByRole('button')
    /* The title, and the menu trigger. Nothing else. */
    expect(buttons).toHaveLength(2)
    expect(buttons.map(b => b.getAttribute('data-testid')))
      .toContain('ai-conversation-title')
  })

  it('names the conversation it acts on', () => {
    render(list())
    expect(screen.getByLabelText('More actions for A thought about rates'))
      .toBeInTheDocument()
  })

  it('confirms before deleting rather than deleting on click', async () => {
    render(list())
    await userEvent.click(screen.getByTestId('ai-conv-menu-c-loose'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()
    /* The app's own dialog, naming the thread and that it cannot be undone. */
    expect(await screen.findByText(/This can't be undone/)).toHaveTextContent(
      'A thought about rates',
    )
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    render(list())
    const trigger = screen.getByTestId('ai-conv-menu-c-loose')
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('ai-conv-menu-panel-c-loose')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens from the keyboard with focus on the first item', async () => {
    render(list())
    const trigger = screen.getByTestId('ai-conv-menu-c-loose')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByTestId('ai-conv-menu-panel-c-loose')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
  })

  it('moves between items with the arrow keys', async () => {
    render(list())
    const trigger = screen.getByTestId('ai-conv-menu-c-loose')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Move to project' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
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
    /*
     * There is no "All conversations" row to carry the null selection any
     * more -- the tree shows containment and the list below shows what is
     * not in a project, so "all" is the resting state rather than a row.
     * What still matters is that no PROJECT is highlighted when none is
     * selected: a tree that marks one anyway tells the reader their view is
     * narrowed when it is not.
     */
    const selection: FolderSelection = null
    render(list({ activeFolderId: selection }))
    expect(rows().filter(r => r.getAttribute('data-folder-active') === 'true')).toHaveLength(0)
  })
})
