/**
 * The Research page's layout status — rendered, not grepped.
 *
 * The rule this protects is a judgement about silence, which source-text
 * assertions cannot express. The chip must say nothing in the ordinary
 * case (on your own default layout, no per-stock settings) and must say
 * something specific in each case that is NOT ordinary. A regex over the
 * component can only confirm that both branches exist somewhere in the
 * file; it cannot confirm which one a given state produces, and it was
 * perfectly happy with the version that labelled every page in the app.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutStatusChip } from '../LayoutStatusChip'

describe('the layout status chip', () => {
  it('says nothing at all on your own default layout', () => {
    /* The state of almost every stock almost all of the time. A label
       that is always present and always identical is read once and then
       stops being read, while still taking toolbar space beside the
       controls that decide how the case is read. */
    const { container } = render(
      <LayoutStatusChip templateName="House layout" isDefaultTemplate overridden={false} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('layout-status-chip')).toBeNull()
  })

  it('says nothing on the built-in default either', () => {
    const { container } = render(<LayoutStatusChip templateName={null} overridden={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names a template that is NOT your default, quietly', () => {
    /* Following a template you deliberately chose for this one stock is
       worth stating — it explains why the page differs from your other
       stocks — but it is not a warning, so it carries no reset. */
    render(
      <LayoutStatusChip
        templateName="Banks layout"
        isDefaultTemplate={false}
        overridden={false}
        onReset={() => {}}
      />,
    )
    expect(screen.getByTestId('layout-status-following')).toHaveTextContent(
      'Following Banks layout',
    )
    expect(screen.queryByTestId('layout-status-reset')).toBeNull()
  })

  it('warns when this stock overrides its template, and names the way back', () => {
    /* Both halves. "Custom layout" alone does not say what a reset would
       return the page to, which makes the button unsafe to press; the
       template name alone is what produced the original confusion, where
       the picker said "Default layout" over a page nothing like it. */
    render(
      <LayoutStatusChip templateName={null} overridden onReset={() => {}} />,
    )
    expect(screen.getByTestId('layout-status-overridden')).toHaveTextContent('Custom layout')
    expect(screen.getByTestId('layout-status-reset')).toHaveTextContent(
      'Reset to Default layout',
    )
    expect(screen.queryByTestId('layout-status-following')).toBeNull()
  })

  it('names the actual template in the reset, not the words "default"', () => {
    render(<LayoutStatusChip templateName="Banks layout" overridden onReset={() => {}} />)
    expect(screen.getByTestId('layout-status-reset')).toHaveTextContent('Reset to Banks layout')
  })

  it('says it is a per-stock setting where the reader is about to act on it', () => {
    /* The one thing a reader can get catastrophically wrong here is
       believing a reset — or the override itself — reaches their other
       stocks. The scope belongs on the control, not only in a bar
       elsewhere on the page. */
    render(<LayoutStatusChip templateName="Banks layout" overridden onReset={() => {}} />)
    expect(screen.getByTestId('layout-status-reset').getAttribute('title'))
      .toMatch(/only applies here/i)
  })

  it('still reports the override when no reset is offered', () => {
    /* Arrange mode renders it read-only: resetting mid-arrangement would
       discard the draft the reader is in the middle of. The STATE must
       still be reported there, or arrange mode is back to being the one
       place that does not say what it is editing. */
    render(<LayoutStatusChip templateName="Banks layout" overridden />)
    expect(screen.getByTestId('layout-status-overridden')).toBeInTheDocument()
    expect(screen.queryByTestId('layout-status-reset')).toBeNull()
  })

  it('resets on click, and refuses to fire twice while the write is in flight', () => {
    const onReset = vi.fn()
    const { rerender } = render(
      <LayoutStatusChip templateName={null} overridden onReset={onReset} />,
    )
    const button = screen.getByTestId('layout-status-reset')
    button.click()
    expect(onReset).toHaveBeenCalledTimes(1)

    rerender(
      <LayoutStatusChip templateName={null} overridden onReset={onReset} resetting />,
    )
    expect(screen.getByTestId('layout-status-reset')).toBeDisabled()
    expect(screen.getByTestId('layout-status-reset')).toHaveTextContent('Resetting')
  })

  it('does not swallow a click meant for the reset', async () => {
    const onReset = vi.fn()
    render(<LayoutStatusChip templateName={null} overridden onReset={onReset} />)
    await userEvent.click(screen.getByRole('button', { name: /reset to default layout/i }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
