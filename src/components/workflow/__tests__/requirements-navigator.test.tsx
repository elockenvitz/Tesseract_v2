/**
 * The requirements rail's behaviour.
 *
 * The thing worth testing is that reading a requirement and finishing one
 * are different gestures. In the accordion they were adjacent targets on the
 * same row, and the whole point of the rail is that a reader can walk five
 * requirements to read them without discovering they have ticked any off.
 *
 * Identity is the other half: the rail is keyed on
 * `asset_checklist_items.id`, never on a row's position, so reordering or
 * inserting a requirement cannot move the selection onto a different one.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RequirementsNavigator } from '../RequirementsNavigator'
import type { ChecklistItemData } from '../../ui/checklist/types'

const item = (over: Partial<ChecklistItemData> & { id: string; text: string }): ChecklistItemData => ({
  completed: false,
  status: 'unchecked',
  ...over,
})

const ITEMS: ChecklistItemData[] = [
  item({ id: 'a1', text: 'Read/Summarize News' }),
  item({ id: 'a2', text: 'Review Our Model', status: 'completed', completed: true }),
  item({ id: 'a3', text: 'Flex Model', notes: 'has a note' }),
  item({ id: 'a4', text: 'Where are We?', status: 'na' }),
]

const setup = (over: Partial<React.ComponentProps<typeof RequirementsNavigator>> = {}) => {
  const onSelect = vi.fn()
  const onToggleStatus = vi.fn()
  render(
    <RequirementsNavigator
      items={ITEMS}
      selectedId={null}
      onSelect={onSelect}
      onToggleStatus={onToggleStatus}
      isEditable
      {...over}
    />,
  )
  return { onSelect, onToggleStatus, user: userEvent.setup() }
}

describe('completion and selection are different gestures', () => {
  it('selecting a requirement does not complete it', async () => {
    const { onSelect, onToggleStatus, user } = setup()
    await user.click(screen.getByTestId('requirement-select-a1'))
    expect(onSelect).toHaveBeenCalledWith('a1')
    expect(onToggleStatus).not.toHaveBeenCalled()
  })

  it('completing a requirement does not move the selection', async () => {
    const { onSelect, onToggleStatus, user } = setup({ selectedId: 'a3' })
    await user.click(screen.getByTestId('requirement-toggle-a1'))
    expect(onToggleStatus).toHaveBeenCalledWith('a1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('reading every requirement in turn completes none of them', async () => {
    const { onSelect, onToggleStatus, user } = setup()
    for (const i of ITEMS) await user.click(screen.getByTestId(`requirement-select-${i.id}`))
    expect(onSelect.mock.calls.map(c => c[0])).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(onToggleStatus).not.toHaveBeenCalled()
  })
})

describe('identity is the requirement id', () => {
  it('reports the id, not the row index', async () => {
    const { onSelect, user } = setup()
    await user.click(screen.getByTestId('requirement-select-a3'))
    expect(onSelect).toHaveBeenCalledWith('a3')
    // The one argument is the id. Nothing positional is passed alongside it
    // that a caller could start depending on.
    expect(onSelect.mock.calls[0]).toHaveLength(1)
  })

  it('marks the selected row for assistive technology', () => {
    setup({ selectedId: 'a2' })
    expect(screen.getByTestId('requirement-select-a2')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('requirement-select-a1')).not.toHaveAttribute('aria-current')
  })

  it('holds the selection on the same requirement when the rows are reordered', () => {
    const reordered = [ITEMS[3], ITEMS[2], ITEMS[1], ITEMS[0]]
    render(
      <RequirementsNavigator
        items={reordered}
        selectedId="a3"
        onSelect={vi.fn()}
        onToggleStatus={vi.fn()}
        isEditable
      />,
    )
    // Two renders are mounted; both agree the marked row is a3's.
    for (const el of screen.getAllByTestId('requirement-select-a3')) {
      expect(el).toHaveAttribute('aria-current', 'true')
    }
  })
})

describe('what the rail will and will not do', () => {
  it('disables completion when the reader cannot edit, but never selection', async () => {
    const { onSelect, onToggleStatus, user } = setup({ isEditable: false })
    expect(screen.getByTestId('requirement-toggle-a1')).toBeDisabled()
    await user.click(screen.getByTestId('requirement-select-a1'))
    expect(onSelect).toHaveBeenCalledWith('a1')
    expect(onToggleStatus).not.toHaveBeenCalled()
  })

  it('names the completion control by what it will do', () => {
    setup()
    expect(screen.getByTestId('requirement-toggle-a1')).toHaveAttribute('aria-label', 'Complete Read/Summarize News')
    // Completed and n/a are both "done" — the control reopens either.
    expect(screen.getByTestId('requirement-toggle-a2')).toHaveAttribute('aria-label', 'Reopen Review Our Model')
    expect(screen.getByTestId('requirement-toggle-a4')).toHaveAttribute('aria-label', 'Reopen Where are We?')
  })

  it('shows an indicator only where the row data supports one', () => {
    setup()
    // a3 has notes; nothing else does, and no count is fetched per row.
    expect(screen.getByLabelText('Has notes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Has attachments')).not.toBeInTheDocument()
  })

  it('renders the passed-in add control rather than one of its own', () => {
    setup({ addSlot: <button>Add requirement</button> })
    expect(screen.getByRole('button', { name: 'Add requirement' })).toBeInTheDocument()
  })
})
