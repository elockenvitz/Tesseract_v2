/**
 * The stage action bar's behaviour, not its appearance.
 *
 * The thing worth testing is the confirmation: advancing with requirements
 * open is permitted and must stay permitted, but it must take a deliberate
 * second action rather than one click that quietly skips four requirements.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StageActionBar, type StageActionBarProps } from '../StageActionBar'

const STAGES = [
  { id: 's1', label: 'Expectations' },
  { id: 's2', label: 'Earnings Print' },
  { id: 'completed', label: 'Completed' },
]

const setup = (over: Partial<StageActionBarProps> = {}) => {
  const onAdvance = vi.fn()
  render(
    <StageActionBar
      viewingStageId="s1"
      currentStageId="s1"
      stages={STAGES}
      isStarted
      isCompleted={false}
      done={1}
      total={5}
      onAdvance={onAdvance}
      {...over}
    />
  )
  return { onAdvance }
}

describe('progress is stated once, where the work is', () => {
  it('says how much of this stage is done', () => {
    setup()
    expect(screen.getByTestId('stage-progress')).toHaveTextContent('1 of 5 done')
  })

  it('says how much is open', () => {
    setup()
    expect(screen.getByTestId('stage-outstanding')).toHaveTextContent('4 open')
  })

  it('says all done rather than "0 open"', () => {
    setup({ done: 5, total: 5 })
    expect(screen.queryByTestId('stage-outstanding')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-action-bar')).toHaveTextContent('all done')
  })
})

describe('advancing with requirements open asks first', () => {
  it('does not advance on the first click', async () => {
    const user = userEvent.setup()
    const { onAdvance } = setup({ done: 1, total: 5 })
    await user.click(screen.getByTestId('stage-advance'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByTestId('stage-advance-confirm'))
      .toHaveTextContent('4 requirements still open. Advance anyway?')
  })

  it('advances on the confirm, because this was always permitted', async () => {
    const user = userEvent.setup()
    const { onAdvance } = setup({ done: 1, total: 5 })
    await user.click(screen.getByTestId('stage-advance'))
    await user.click(screen.getByTestId('stage-advance-confirm-yes'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('backs out without advancing', async () => {
    const user = userEvent.setup()
    const { onAdvance } = setup({ done: 1, total: 5 })
    await user.click(screen.getByTestId('stage-advance'))
    await user.click(screen.getByTestId('stage-advance-cancel'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByTestId('stage-advance')).toBeInTheDocument()
  })
})

describe('advancing a finished stage does not ask', () => {
  it('advances on the first click when everything is done', async () => {
    const user = userEvent.setup()
    const { onAdvance } = setup({ done: 5, total: 5 })
    await user.click(screen.getByTestId('stage-advance'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('stage-advance-confirm')).not.toBeInTheDocument()
  })

  it('advances on the first click when the stage has no requirements', async () => {
    const user = userEvent.setup()
    const { onAdvance } = setup({ done: 0, total: 0 })
    await user.click(screen.getByTestId('stage-advance'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })
})

describe('the control is absent where it would act on the wrong stage', () => {
  it('shows no advance while merely viewing another stage', () => {
    setup({ viewingStageId: 's2', currentStageId: 's1' })
    expect(screen.queryByTestId('stage-advance')).not.toBeInTheDocument()
    // The progress for the stage being read is still shown.
    expect(screen.getByTestId('stage-progress')).toBeInTheDocument()
  })

  it('names the destination so it cannot be read as "finish the workflow"', () => {
    setup({ done: 5, total: 5 })
    expect(screen.getByTestId('stage-advance')).toHaveTextContent('Advance to Earnings Print')
  })

  it('says "Complete process" only at the last real stage', () => {
    setup({ viewingStageId: 's2', currentStageId: 's2', done: 2, total: 2 })
    expect(screen.getByTestId('stage-advance')).toHaveTextContent('Complete process')
  })
})

describe('a request in flight cannot be sent twice', () => {
  it('disables the control while advancing', () => {
    setup({ done: 5, total: 5, isAdvancing: true })
    expect(screen.getByTestId('stage-advance')).toBeDisabled()
  })

  it('disables the confirm too', async () => {
    const user = userEvent.setup()
    setup({ done: 1, total: 5, isAdvancing: true })
    await user.click(screen.getByTestId('stage-advance'))
    expect(screen.getByTestId('stage-advance')).toBeDisabled()
  })
})
