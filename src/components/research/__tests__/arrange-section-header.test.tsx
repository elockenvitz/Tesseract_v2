/**
 * Section controls inside arrange mode.
 *
 * Arrange mode could move fields and nothing else; renaming, reordering,
 * hiding and adding a SECTION lived only in the Customize Layout modal,
 * the screen arrange mode was built to replace. These are the rules that
 * make the header safe to use rather than merely present.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArrangeableSectionHeader } from '../ResearchArrangeSection'

const base = {
  sectionId: 'sec-1',
  name: 'Thesis',
  originalName: 'Thesis',
  isHidden: false,
  isAdded: false,
  canMoveUp: true,
  canMoveDown: true,
  onRename: () => {},
  onToggleHidden: () => {},
  onMove: () => {},
}

describe('a section header while arranging', () => {
  it('renames to what was typed', async () => {
    const onRename = vi.fn()
    render(<ArrangeableSectionHeader {...base} onRename={onRename} />)

    await userEvent.click(screen.getByTestId('arrange-section-rename-sec-1'))
    const input = screen.getByTestId('arrange-section-name-input-sec-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Bull case{Enter}')

    expect(onRename).toHaveBeenCalledWith('Bull case')
  })

  it('treats typing the real name back as undoing the rename', async () => {
    /* Storing "Thesis" as an override of a section called "Thesis" pins
       the stock to a value that merely agrees with the schema — the same
       trap no-op field overrides set, where the page looks right and the
       stock silently stops following later changes. */
    const onRename = vi.fn()
    render(
      <ArrangeableSectionHeader
        {...base}
        name="Bull case"
        originalName="Thesis"
        onRename={onRename}
      />,
    )
    await userEvent.click(screen.getByTestId('arrange-section-rename-sec-1'))
    const input = screen.getByTestId('arrange-section-name-input-sec-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Thesis{Enter}')

    expect(onRename).toHaveBeenCalledWith(null)
  })

  it('clears the rename when the name is emptied', async () => {
    const onRename = vi.fn()
    render(<ArrangeableSectionHeader {...base} name="Bull case" originalName="Thesis" onRename={onRename} />)
    await userEvent.click(screen.getByTestId('arrange-section-rename-sec-1'))
    const input = screen.getByTestId('arrange-section-name-input-sec-1')
    await userEvent.clear(input)
    await userEvent.type(input, '{Enter}')
    expect(onRename).toHaveBeenCalledWith(null)
  })

  it('writes nothing when the name is unchanged', async () => {
    /* Opening the editor and closing it is not an edit. Writing anyway
       would create an override out of a glance. */
    const onRename = vi.fn()
    render(<ArrangeableSectionHeader {...base} onRename={onRename} />)
    await userEvent.click(screen.getByTestId('arrange-section-rename-sec-1'))
    await userEvent.type(screen.getByTestId('arrange-section-name-input-sec-1'), '{Enter}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('abandons the edit on Escape', async () => {
    const onRename = vi.fn()
    render(<ArrangeableSectionHeader {...base} onRename={onRename} />)
    await userEvent.click(screen.getByTestId('arrange-section-rename-sec-1'))
    const input = screen.getByTestId('arrange-section-name-input-sec-1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Half-typed{Escape}')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByTestId('arrange-section-rename-sec-1')).toHaveTextContent('Thesis')
  })

  it('offers the original name back once renamed, and not before', () => {
    const { rerender } = render(<ArrangeableSectionHeader {...base} />)
    expect(screen.queryByTestId('arrange-section-reset-name-sec-1')).toBeNull()

    rerender(<ArrangeableSectionHeader {...base} name="Bull case" originalName="Thesis" />)
    expect(screen.getByTestId('arrange-section-reset-name-sec-1')).toHaveTextContent('Thesis')
  })

  it('hides and shows, and says which state it is in', async () => {
    const onToggleHidden = vi.fn()
    const { rerender } = render(
      <ArrangeableSectionHeader {...base} onToggleHidden={onToggleHidden} />,
    )
    expect(screen.queryByTestId('arrange-section-hidden-sec-1')).toBeNull()
    await userEvent.click(screen.getByTestId('arrange-section-visibility-sec-1'))
    expect(onToggleHidden).toHaveBeenCalledWith(true)

    /* A hidden section must still draw a header while arranging, or
       hiding one is a one-way door: nothing left to click to bring it
       back, and the only route out is the old customizer. */
    rerender(<ArrangeableSectionHeader {...base} isHidden onToggleHidden={onToggleHidden} />)
    expect(screen.getByTestId('arrange-section-hidden-sec-1')).toHaveTextContent('Hidden')
    await userEvent.click(screen.getByTestId('arrange-section-visibility-sec-1'))
    expect(onToggleHidden).toHaveBeenLastCalledWith(false)
  })

  it('says hiding does not delete anything', () => {
    render(<ArrangeableSectionHeader {...base} />)
    expect(screen.getByTestId('arrange-section-visibility-sec-1').getAttribute('title'))
      .toMatch(/nothing in it is deleted/i)
  })

  it('moves up and down, and refuses at the ends', async () => {
    const onMove = vi.fn()
    const { rerender } = render(<ArrangeableSectionHeader {...base} onMove={onMove} />)
    await userEvent.click(screen.getByTestId('arrange-section-up-sec-1'))
    await userEvent.click(screen.getByTestId('arrange-section-down-sec-1'))
    expect(onMove).toHaveBeenNthCalledWith(1, -1)
    expect(onMove).toHaveBeenNthCalledWith(2, 1)

    rerender(
      <ArrangeableSectionHeader {...base} canMoveUp={false} canMoveDown={false} onMove={onMove} />,
    )
    expect(screen.getByTestId('arrange-section-up-sec-1')).toBeDisabled()
    expect(screen.getByTestId('arrange-section-down-sec-1')).toBeDisabled()
  })

  it('offers removal only for a section this reader added', () => {
    /* A system section holds fields that belong to the whole
       organisation. It can be hidden on this stock; it cannot be
       removed, and offering a bin for it would promise otherwise. */
    const onRemove = vi.fn()
    const { rerender } = render(<ArrangeableSectionHeader {...base} onRemove={onRemove} />)
    expect(screen.queryByTestId('arrange-section-remove-sec-1')).toBeNull()

    rerender(<ArrangeableSectionHeader {...base} isAdded onRemove={onRemove} />)
    expect(screen.getByTestId('arrange-section-remove-sec-1')).toBeInTheDocument()
    expect(screen.getByTestId('arrange-section-remove-sec-1').getAttribute('title'))
      .toMatch(/not deleted/i)
  })

  it('stops every control while a write is in flight', () => {
    render(<ArrangeableSectionHeader {...base} isAdded busy onRemove={() => {}} />)
    for (const id of [
      'arrange-section-rename-sec-1',
      'arrange-section-up-sec-1',
      'arrange-section-down-sec-1',
      'arrange-section-visibility-sec-1',
      'arrange-section-remove-sec-1',
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled()
    }
  })

  it('shows the current name when the editor is reopened, not a stale one', () => {
    /* The draft value is seeded from the prop, so a rename landing from
       another tab — or a template switch underneath — must be what the
       input shows next time it opens. */
    const { rerender } = render(<ArrangeableSectionHeader {...base} />)
    rerender(<ArrangeableSectionHeader {...base} name="Renamed elsewhere" />)
    expect(screen.getByTestId('arrange-section-rename-sec-1')).toHaveTextContent(
      'Renamed elsewhere',
    )
  })
})
