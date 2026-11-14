/**
 * A project row does not change size when the pointer crosses it.
 *
 * ── The complaint ─────────────────────────────────────────────────────────
 *
 * "Hovering a project folder causes its size or layout to shift." It did,
 * and the cause was in the markup rather than in any handler: the row's
 * actions were three icon buttons inside `hidden group-hover:flex`, so
 * entering the row took them from `display: none` to `display: flex` and
 * ADDED their width to a flex row. The project name beside them is
 * `flex-1 truncate`, so it narrowed and re-truncated under the pointer, and
 * the conversation count after them slid left.
 *
 * ── What can and cannot be verified here ──────────────────────────────────
 *
 * Not the visual result. jsdom has no layout engine and no Tailwind
 * stylesheet, so `getBoundingClientRect` is zero for everything and
 * `getComputedStyle` knows nothing about `group-hover:flex`. Nor can a
 * DOM-diff across hover distinguish the two: both the old markup and the new
 * are CSS-only, so the tree is identical before and after either way. No
 * browser was available in this session, so the moving row has not been
 * watched stop moving. `docs/` records the click-through that would.
 *
 * What IS verifiable, and is the whole mechanism:
 *
 *   the utilities      A `group-hover:` variant that changes a layout
 *                      property is the defect, in any row. The scan below
 *                      allows the variant only on properties that cannot
 *                      reflow -- opacity, colour, ring, shadow -- which is
 *                      the rule the brief states ("use color, background and
 *                      icon visibility for hover feedback, not border or
 *                      padding changes that move surrounding content").
 *   the reserved space The actions are in the tree whether or not the row is
 *                      hovered. A row that mounts them on hover has the same
 *                      problem through React instead of CSS.
 *   one control        Three targets became one `···`, which is what the
 *                      brief asks be maintained and is also why there is no
 *                      longer a width to reveal.
 *
 * The scan is the gate, and it is injectable: putting `hidden
 * group-hover:flex` back on the action cluster fails it by name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConversationList } from '../AIConversationList'
import type { AIProjectFolder } from '../../../lib/ai/folders'

const folders: AIProjectFolder[] = [
  { id: 'f-apple', name: 'Apple investment case', isArchived: false, organizationId: 'org-a', updatedAt: null },
  { id: 'f-earnings', name: 'Earnings season', isArchived: false, organizationId: 'org-a', updatedAt: null },
]

const conversations = [
  {
    id: 'c-aapl',
    user_id: 'u-1',
    context_type: null,
    context_id: null,
    title: 'AAPL target review',
    is_archived: false,
    is_pinned: false,
    last_message_at: '2026-11-10T12:00:00Z',
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-10T12:00:00Z',
    /* Unfiled on purpose. With projects present and none of them open, the
       list below the tree shows the threads no visible project draws -- so a
       thread filed in a collapsed project renders nowhere, and there would be
       no conversation row to scan or to measure truncation on. */
    folder_id: null,
    tags: [],
  },
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

const renderRail = () =>
  render(
    <AIConversationList
      conversations={conversations}
      activeConversationId={null}
      isLoading={false}
      folders={folders}
      archivedFolders={[]}
      activeFolderId={null}
      {...handlers}
    />,
  )

const row = (id: string) => screen.getByTestId(`ai-folder-row-${id}`)

/**
 * Properties a `group-hover:` variant may change.
 *
 * None of them participates in layout, so none of them can move a sibling.
 * Everything else -- a display utility, a width, padding, a margin, a
 * border, a gap, a font size -- reflows the row it is on and is therefore
 * the defect this file exists for.
 */
const CANNOT_REFLOW = [
  'opacity-', 'bg-', 'text-', 'ring-', 'ring', 'shadow-', 'shadow',
  'fill-', 'stroke-', 'border-gray', 'border-primary', 'border-red',
  'underline', 'no-underline', 'visible', 'invisible', 'decoration-',
]

function reflowingHoverUtilities(root: HTMLElement): string[] {
  const found: string[] = []
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const el of all) {
    for (const cls of Array.from(el.classList)) {
      const at = cls.indexOf('group-hover:')
      if (at === -1) continue
      const prop = cls.slice(at + 'group-hover:'.length)
      if (!CANNOT_REFLOW.some(ok => prop === ok || prop.startsWith(ok))) found.push(cls)
    }
  }
  return found
}

beforeEach(() => {
  for (const fn of Object.values(handlers)) fn.mockReset()
})

describe('a project row under the pointer', () => {
  it('reveals its actions with nothing that can reflow the row', () => {
    renderRail()

    expect(reflowingHoverUtilities(row('f-earnings'))).toEqual([])
  })

  it('applies the same rule to the whole rail', () => {
    /* The conversation rows reached this shape first and are the reference
       for it. Scanning the rail rather than one row is what stops the next
       row that is added from reintroducing the defect somewhere else. */
    renderRail()

    expect(reflowingHoverUtilities(screen.getByTestId('ai-folder-rail'))).toEqual([])
    expect(reflowingHoverUtilities(screen.getByTestId('ai-conversation-list'))).toEqual([])
  })

  it('keeps the action control mounted while the row is untouched', () => {
    /* Reserved space is the fix. Mounting the menu on hover instead would
       move the row exactly as much, and would also break the menu's own
       focus handling, which needs it in the tree. */
    renderRail()

    const actions = within(row('f-earnings')).getByTestId('ai-folder-menu-f-earnings')
    expect(actions).toBeInTheDocument()
    expect(actions.closest('[data-slot="ai-folder-actions"]')).toHaveClass('opacity-0')
  })

  it('offers one control, not three', () => {
    renderRail()

    const inRow = within(row('f-earnings'))
    /* The `···`, and nothing else that acts on the project: the name opens
       it, the chevron expands it, and those two are the row's other
       buttons. */
    expect(inRow.getAllByRole('button', { name: /more actions/i })).toHaveLength(1)
    expect(inRow.queryByRole('button', { name: /^rename /i })).not.toBeInTheDocument()
    expect(inRow.queryByRole('button', { name: /^archive /i })).not.toBeInTheDocument()
    expect(inRow.queryByRole('button', { name: /^delete /i })).not.toBeInTheDocument()
  })
})

describe('the project menu', () => {
  it('names the project it acts on', () => {
    renderRail()

    expect(screen.getByTestId('ai-folder-menu-f-earnings'))
      .toHaveAccessibleName('More actions for Earnings season')
  })

  it('does not open the project when the menu is opened', async () => {
    /* The row navigates on click. Without `stopPropagation` on the trigger,
       reaching for Delete would also change which project the reader is in,
       so the confirmation would appear over a list that had just changed
       underneath them. */
    renderRail()
    await userEvent.click(screen.getByTestId('ai-folder-menu-f-earnings'))

    expect(handlers.onSelectFolder).not.toHaveBeenCalled()
    expect(screen.getByTestId('ai-folder-menu-panel-f-earnings')).toBeInTheDocument()
  })

  it('offers rename, archive and delete, and nothing destructive on open', async () => {
    renderRail()
    await userEvent.click(screen.getByTestId('ai-folder-menu-f-earnings'))
    const panel = within(screen.getByTestId('ai-folder-menu-panel-f-earnings'))

    expect(panel.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(panel.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(panel.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(handlers.onArchiveFolder).not.toHaveBeenCalled()
    expect(handlers.onDeleteFolder).not.toHaveBeenCalled()
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    renderRail()
    const trigger = screen.getByTestId('ai-folder-menu-f-earnings')
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByTestId('ai-folder-menu-panel-f-earnings')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens from the keyboard with focus on the first item', async () => {
    renderRail()
    screen.getByTestId('ai-folder-menu-f-earnings').focus()
    await userEvent.keyboard('{ArrowDown}')

    const panel = screen.getByTestId('ai-folder-menu-panel-f-earnings')
    expect(within(panel).getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
  })

  it('renames in place rather than calling through on the menu item', async () => {
    /* Rename opens the row's inline edit. Nothing is written until the
       reader commits it, which is the behaviour the three icons had and the
       part of them worth keeping. */
    renderRail()
    await userEvent.click(screen.getByTestId('ai-folder-menu-f-earnings'))
    await userEvent.click(
      within(screen.getByTestId('ai-folder-menu-panel-f-earnings'))
        .getByRole('menuitem', { name: 'Rename' }),
    )

    expect(handlers.onRenameFolder).not.toHaveBeenCalled()
    const input = within(row('f-earnings')).getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'Q4 earnings{Enter}')
    expect(handlers.onRenameFolder).toHaveBeenCalledWith('f-earnings', 'Q4 earnings')
  })
})

describe('the rail is wide enough to read a title in', () => {
  it('is wider than the width that truncated them', () => {
    /* 240px, with a title indented 22px after an icon and a gap, left a
       model-written title about 200px. This is not a layout measurement --
       jsdom has none -- it is the declared width, which is the thing that
       was wrong. */
    renderRail()

    const rail = document.querySelector('[data-slot="ai-conversation-rail"]')!
    expect(rail).toHaveClass('w-72')
    expect(rail).not.toHaveClass('w-60')
  })

  it('truncates at a fixed edge and keeps the whole title available', () => {
    /* A rail that grows to fit its longest title moves the reading column
       when a conversation is renamed, so the trade is a predictable edge
       plus the full title on hover. */
    renderRail()

    const title = screen.getByTestId('ai-conversation-title')
    expect(title).toHaveClass('truncate')
    expect(title).toHaveAttribute('title', 'AAPL target review')
  })
})
