/**
 * Reaching a conversation without a mouse.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * A row was a `<div onClick>`. Every ACTION on it was a real button --
 * Rename, Archive, Pin, Delete -- so a keyboard reader could tab to five
 * controls that act on a thread, on a row they had no way to OPEN. The one
 * thing a list of conversations exists for was the one thing only a mouse
 * could do.
 *
 * Two smaller faults in the same row: the action group was
 * `opacity-0 group-hover:opacity-100` with no `focus-within`, so tabbing
 * into it moved focus through five invisible buttons; and the tag count was
 * a `<button>` whose only handler stopped propagation, which took a tab stop
 * to do nothing.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * Keyboard interaction on the real list: Tab to reach a row and Enter to
 * select it, through `userEvent`, which dispatches the same events a browser
 * does rather than calling the handler directly. The list is driven entirely
 * by props, so this needs no Supabase client, auth or organization provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConversationList } from '../AIConversationList'

const conversation = (id: string, title: string) => ({
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
  folder_id: null,
  tags: [{ type: 'asset' as const, id: 'a-aapl' }],
})

const conversations = [
  conversation('c-aapl', 'AAPL target review'),
  conversation('c-lrcx', 'LRCX bear and bull'),
]

const handlers = {
  onSelect: vi.fn(),
  onNewConversation: vi.fn(),
  onRename: vi.fn(),
  onArchive: vi.fn(),
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
}

function renderList(overrides: Record<string, unknown> = {}) {
  return render(
    <AIConversationList
      conversations={conversations}
      activeConversationId={null}
      isLoading={false}
      tagLabels={{ 'asset:a-aapl': 'AAPL' }}
      {...handlers}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  for (const fn of Object.values(handlers)) fn.mockReset()
})

describe('a conversation can be opened from the keyboard', () => {
  it('puts the title in the tab order', async () => {
    const user = userEvent.setup()
    renderList()

    const titles = screen.getAllByTestId('ai-conversation-title')
    expect(titles).toHaveLength(2)

    /* Tab until focus lands on a conversation title. The search box and the
       new-conversation control come first; what matters is that a title is
       reachable at all, which it was not. */
    let guard = 0
    while (!titles.includes(document.activeElement as HTMLElement) && guard < 20) {
      await user.tab()
      guard += 1
    }
    expect(titles).toContain(document.activeElement)
  })

  it('selects the focused conversation on Enter', async () => {
    const user = userEvent.setup()
    renderList()

    const title = screen.getAllByTestId('ai-conversation-title')
      .find(t => t.textContent === 'LRCX bear and bull')!
    title.focus()
    await user.keyboard('{Enter}')

    expect(handlers.onSelect).toHaveBeenCalledWith('c-lrcx')
  })

  it('selects it on Space too, as a button does', async () => {
    const user = userEvent.setup()
    renderList()

    screen.getAllByTestId('ai-conversation-title')[0].focus()
    await user.keyboard(' ')

    expect(handlers.onSelect).toHaveBeenCalledWith('c-aapl')
  })

  it('names the row by its title, and marks the open one', () => {
    renderList({ activeConversationId: 'c-lrcx' })

    const open = screen.getByRole('button', { name: 'LRCX bear and bull' })
    expect(open).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('button', { name: 'AAPL target review' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('still selects on a mouse click anywhere in the row', async () => {
    const user = userEvent.setup()
    renderList()

    /* The row keeps its own click handler: making the title focusable was not
       meant to shrink the target a mouse has to hit. */
    /* The relative timestamp, whatever today makes it: a fixed string here
       would be a date bomb rather than a test of the click target. */
    await user.click(screen.getAllByText(/\d+[mhd] ago$/)[0])
    expect(handlers.onSelect).toHaveBeenCalled()
  })
})

/**
 * The rail draws no object tags.
 *
 * Every row that had attached objects used to carry a chip -- a tag icon and
 * a count, with the names in a tooltip. It has been asked for three times
 * and removed once; these are the two halves of it staying removed.
 *
 * The first half is that nothing object-shaped is DRAWN in the rail. It was
 * a dead label by the end, not a control, so "no dead buttons" was no longer
 * the point: an object presentation in a navigation rail is the point, and a
 * reader choosing where to go is not helped by "2".
 *
 * The second half is that the fact is not lost with the chip. A screen
 * reader has no object band or search field to fall back on, so the names
 * stay in the row's accessible description -- clipped, not hidden, so they
 * are still read.
 */
describe('the rail draws no object tags', () => {
  it('draws nothing for the objects a thread is about', () => {
    renderList()

    /* The chip's own role, and the icon it drew. `sr-only` is clipped rather
       than hidden, so this asks about PAINT: a tag chip would still be an
       `img` in the tree. */
    expect(screen.queryAllByRole('img', { name: /attached object/i })).toHaveLength(0)
    expect(document.querySelectorAll('.lucide-tag')).toHaveLength(0)
  })

  it('takes up no room in the row for them', () => {
    renderList()

    /* The chip sat in the row's bottom line, between the timestamp and the
       actions, and pushed the actions along. What is left occupies no space
       at all, which is what `sr-only` means and what a layout-free renderer
       can still check: the class is the contract. */
    const stated = Array.from(
      document.querySelectorAll('[data-slot="ai-conversation-objects"]'),
    )
    expect(stated.length).toBeGreaterThan(0)
    for (const el of stated) expect(el).toHaveClass('sr-only')
  })

  it('still says which objects, for a reader who cannot see the row', () => {
    renderList()

    /* Named, not counted. "2 attached objects" was the old chip's whole
       accessible name and it is the thing a screen reader could not act on. */
    const stated = document.querySelectorAll('[data-slot="ai-conversation-objects"]')
    expect(stated).toHaveLength(2)
    expect(stated[0].textContent).toMatch(/AAPL/)
    expect(stated[0].textContent).not.toMatch(/^\d/)
  })
})
