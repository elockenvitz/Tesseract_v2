/**
 * The phone board: one stage at a time.
 *
 * The desktop board is four columns side by side. At 390px, dividing the
 * width gave ~58px a column, and giving each column a real width turned the
 * board into a horizontally scrolled page where you saw one column and could
 * not tell where you were in the row — which removes the only thing a kanban
 * board is for. This shows every stage and its count at once, and one
 * stage's projects at a time.
 *
 * These assertions are about the model staying intact: the same four stages
 * in the same order as the desktop board, counts that match the data, and a
 * stage's own projects and no others.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MobileProjectBoard, BOARD_STAGES } from '../MobileProjectBoard'

function project(id: string, title: string, status: string) {
  return {
    id,
    title,
    status,
    priority: 'medium',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    due_date: null,
    created_by: 'u1',
    description: null,
    project_deliverables: [],
    project_assignments: [],
  } as any
}

const PROJECTS = [
  project('p1', 'Planning one', 'planning'),
  project('p2', 'Planning two', 'planning'),
  project('p3', 'Active one', 'in_progress'),
  project('p4', 'Blocked one', 'blocked'),
  project('p5', 'Cancelled one', 'cancelled'),
]

function renderBoard(projects = PROJECTS, onOpenActions = vi.fn()) {
  const utils = render(
    <MobileProjectBoard projects={projects} onOpenActions={onOpenActions} />
  )
  // The stage rail and the footer's step controls both name stages, so every
  // stage query is scoped to the rail. That ambiguity was real, not a test
  // artefact: without the group label and the footer's explicit labels, a
  // screen reader heard "Blocked" twice with nothing to tell them apart.
  const rail = () => screen.getByRole('group', { name: /board stages/i })
  const stageChip = (label: string) =>
    within(rail()).getByRole('button', { name: new RegExp(`^${label}`) })
  return { ...utils, onOpenActions, rail, stageChip }
}

describe('stage model', () => {
  it('uses the same four stages, in the same order, as the desktop board', () => {
    expect(BOARD_STAGES).toEqual(['planning', 'in_progress', 'blocked', 'completed'])
  })

  it('shows every stage and its count at once — the part of a board a phone can show', () => {
    const { stageChip } = renderBoard()

    for (const [label, count] of [['Planning', '2'], ['In Progress', '1'], ['Blocked', '1'], ['Completed', '0']]) {
      expect(within(stageChip(label)).getByText(count)).toBeInTheDocument()
    }
  })

  it('leaves cancelled off the board, exactly as the desktop board does', () => {
    const { rail } = renderBoard()
    expect(within(rail()).queryByRole('button', { name: /^Cancelled/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Cancelled one')).not.toBeInTheDocument()
  })
})

describe('stage selection', () => {
  it('opens on the first stage that has work rather than an empty one', () => {
    renderBoard()
    expect(screen.getByText('Planning one')).toBeInTheDocument()
    expect(screen.getByText('Planning two')).toBeInTheDocument()
  })

  it('opens on the first populated stage when earlier stages are empty', () => {
    const { stageChip } = renderBoard([project('p9', 'Only blocked', 'blocked')])
    expect(screen.getByText('Only blocked')).toBeInTheDocument()
    expect(stageChip('Blocked')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows one stage at a time — the selected stage and no other', async () => {
    const user = userEvent.setup()
    const { stageChip } = renderBoard()

    expect(screen.queryByText('Active one')).not.toBeInTheDocument()

    await user.click(stageChip('In Progress'))

    expect(screen.getByText('Active one')).toBeInTheDocument()
    expect(screen.queryByText('Planning one')).not.toBeInTheDocument()
  })

  it('steps to the neighbouring stage, so a moved project can be followed', async () => {
    const user = userEvent.setup()
    const { stageChip } = renderBoard()

    await user.click(stageChip('In Progress'))
    expect(screen.getByText('Active one')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next stage: blocked/i }))
    expect(screen.getByText('Blocked one')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /previous stage: in progress/i }))
    expect(screen.getByText('Active one')).toBeInTheDocument()
  })

  it('says an empty stage is empty, and where the move lives', async () => {
    const user = userEvent.setup()
    const { stageChip } = renderBoard()

    await user.click(stageChip('Completed'))
    expect(screen.getByText(/nothing in completed/i)).toBeInTheDocument()
  })
})

describe('moving a project', () => {
  it('offers the actions sheet per row, which is where a status change happens', async () => {
    const user = userEvent.setup()
    const { onOpenActions } = renderBoard()

    await user.click(screen.getByRole('button', { name: /actions for planning one/i }))

    expect(onOpenActions).toHaveBeenCalledTimes(1)
    expect(onOpenActions.mock.calls[0][0]).toMatchObject({ id: 'p1' })
  })
})
