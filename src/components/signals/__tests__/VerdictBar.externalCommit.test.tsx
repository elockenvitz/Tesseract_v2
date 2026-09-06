import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VerdictBar, type VerdictOption } from '../VerdictBar'

/**
 * The opt-in seam that lets a card's FOOTER own the commit.
 *
 * Two things are asserted here and they matter equally: that the flag does what
 * the Trade Idea shell needs, and that its absence changes nothing — the
 * default path is what Case vs Price's target review and the pair verdict still
 * ride on, and a regression there would be silent.
 */

const OPTS: VerdictOption[] = [
  { key: 'idea_back', label: "I'd back it", tone: 'affirm', disposition: 'settled', note: 'n1', consequence: 'Recorded.' },
  { key: 'idea_pass', label: 'Not for me', tone: 'negate', disposition: 'settled', note: 'n2', consequence: 'Stops asking.' },
]

const renderBar = (props: Partial<React.ComponentProps<typeof VerdictBar>> = {}) =>
  render(
    <VerdictBar
      question="Would you put this on?"
      options={OPTS}
      onRespond={() => true}
      {...props}
    />,
  )

describe('default mode — unchanged for every existing caller', () => {
  it('still owns its commit button once an answer is chosen', () => {
    renderBar()
    fireEvent.click(screen.getByText("I'd back it"))
    expect(screen.getByTestId('verdict-send')).toBeTruthy()
  })

  it('still hides the note behind + Note', () => {
    renderBar()
    fireEvent.click(screen.getByText("I'd back it"))
    expect(screen.getByTestId('verdict-add-note')).toBeTruthy()
    expect(screen.queryByTestId('verdict-commentary')).toBeNull()
  })

  it('still commits through its own button', () => {
    const onRespond = vi.fn(() => true)
    renderBar({ onRespond })
    fireEvent.click(screen.getByText("I'd back it"))
    fireEvent.click(screen.getByTestId('verdict-send'))
    expect(onRespond).toHaveBeenCalled()
  })
})

describe('externalCommit — the footer owns completion', () => {
  it('renders no commit button of its own', () => {
    renderBar({ externalCommit: true })
    fireEvent.click(screen.getByText("I'd back it"))
    expect(screen.queryByTestId('verdict-send')).toBeNull()
  })

  /** Three completion-shaped controls for one completion was the defect. */
  it('offers no + Note affordance, because the field is already open', () => {
    renderBar({ externalCommit: true })
    fireEvent.click(screen.getByText("I'd back it"))
    expect(screen.queryByTestId('verdict-add-note')).toBeNull()
  })

  it('opens a real note input as soon as an answer is chosen', () => {
    renderBar({ externalCommit: true })
    expect(screen.queryByTestId('verdict-commentary')).toBeNull()
    fireEvent.click(screen.getByText("I'd back it"))
    const input = screen.getByTestId('verdict-commentary') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.placeholder).toBe('Add a note…')
  })

  it('reports the selection outward so the footer can enable itself', () => {
    const onPick = vi.fn()
    renderBar({ externalCommit: true, onPick })
    fireEvent.click(screen.getByText("I'd back it"))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'idea_back' }))
  })

  it('reports the note as it is typed', () => {
    const onCommentaryChange = vi.fn()
    renderBar({ externalCommit: true, onCommentaryChange })
    fireEvent.click(screen.getByText("I'd back it"))
    fireEvent.change(screen.getByTestId('verdict-commentary'), { target: { value: 'sizing looks rich' } })
    expect(onCommentaryChange).toHaveBeenCalledWith('sizing looks rich')
  })

  it('clears the selection outward when the answer is unpicked', () => {
    const onPick = vi.fn()
    renderBar({ externalCommit: true, onPick })
    fireEvent.click(screen.getByText("I'd back it"))
    fireEvent.click(screen.getByText("I'd back it"))
    expect(onPick).toHaveBeenLastCalledWith(null)
  })

  it('never commits by itself', () => {
    const onRespond = vi.fn(() => true)
    renderBar({ externalCommit: true, onRespond })
    fireEvent.click(screen.getByText("I'd back it"))
    fireEvent.change(screen.getByTestId('verdict-commentary'), { target: { value: 'x' } })
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('still shows the consequence of the chosen answer', () => {
    renderBar({ externalCommit: true })
    fireEvent.click(screen.getByText('Not for me'))
    expect(screen.getByTestId('verdict-consequence').textContent).toContain('Stops asking')
  })
})
