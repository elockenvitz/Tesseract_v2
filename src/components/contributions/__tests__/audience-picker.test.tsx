/**
 * The audience picker.
 *
 * The assertions that matter most are about what does NOT happen: opening the
 * panel and clicking around must not change the audience, and a failed Apply
 * must not look like a success. The previous control failed both — every click
 * wrote straight through to the page's state, and there was no save to fail
 * because there was no Apply.
 *
 * The reach numbers are EFFECTIVE (a group plus everyone beneath it), matching
 * `user_effective_node_ids()` on the server. A picker that showed direct
 * members would understate what the author is about to share.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudiencePicker, describeAudience, reachOf, type AudienceSelection } from '../AudiencePicker'
import { effectiveMemberCounts, type AudienceNode } from '../../../lib/contributions/audience-reach'

/*
 *   D ── P1 ── T1, T2
 *     └─ P2 ── T3
 *
 * The same tree the SQL suite uses, so both halves of the hierarchy work are
 * pinned to one shape.
 */
const TREE: AudienceNode[] = [
  { id: 'D',  name: 'Equity Division', node_type: 'division',   parent_id: null },
  { id: 'P1', name: 'Fundamental',     node_type: 'department', parent_id: 'D' },
  { id: 'P2', name: 'Quant',           node_type: 'department', parent_id: 'D' },
  { id: 'T1', name: 'Consumer',        node_type: 'team',       parent_id: 'P1' },
  { id: 'T2', name: 'Industrials',     node_type: 'team',       parent_id: 'P1' },
  { id: 'T3', name: 'Systematic',      node_type: 'team',       parent_id: 'P2' },
]

const MEMBERS = [
  { node_id: 'T1', user_id: 'u1' },
  { node_id: 'T2', user_id: 'u2' },
  { node_id: 'T3', user_id: 'u3' },
]

const counts = effectiveMemberCounts(TREE, MEMBERS)
const nodeById = new Map(TREE.map(n => [n.id, n]))
const nodesFor = (v: string) => TREE.filter(n => n.node_type === v)

const setup = (over: Partial<React.ComponentProps<typeof AudiencePicker>> = {}) => {
  const onApply = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <AudiencePicker
      saved={{ visibility: 'firm', targetIds: [] }}
      nodesFor={nodesFor as never}
      memberCounts={counts}
      nodeById={nodeById}
      onApply={onApply}
      {...over}
    />
  )
  return { onApply, ...utils }
}

describe('inherited reach is what the picker reports', () => {
  it('counts a department as its teams, not its own membership rows', () => {
    // Nobody holds a row on P1; its two teams hold one person each.
    expect(counts.get('P1')).toBe(2)
    expect(counts.get('D')).toBe(3)
  })

  it('shows a department reaching people even with no direct members', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-department'))
    expect(screen.getByTestId('audience-group-P1')).toHaveTextContent('2 people')
  })

  it('says "no members yet" rather than disabling an empty group', async () => {
    const user = userEvent.setup()
    const empty = effectiveMemberCounts(TREE, [])
    setup({ memberCounts: empty })
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    const row = screen.getByTestId('audience-group-T1')
    expect(row).toHaveTextContent('No members yet')
    expect(row).not.toBeDisabled()
  })
})

describe('exploring writes nothing', () => {
  it('does not call onApply while browsing scopes and toggling groups', async () => {
    const user = userEvent.setup()
    const { onApply } = setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-division'))
    await user.click(screen.getByTestId('audience-group-D'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-group-T2'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('Cancel discards the draft and leaves the saved audience showing', async () => {
    const user = userEvent.setup()
    const { onApply } = setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-cancel'))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByTestId('audience-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('audience-trigger')).toHaveTextContent('Firm-wide')
  })

  it('reopening after Cancel starts from the saved audience, not the abandoned draft', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-cancel'))
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByTestId('audience-firm')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('multi-selection and Apply', () => {
  it('applies several groups at one scope', async () => {
    const user = userEvent.setup()
    const { onApply } = setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-group-T2'))
    await user.click(screen.getByTestId('audience-apply'))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toEqual({ visibility: 'team', targetIds: ['T1', 'T2'] })
  })

  it('switching scope clears the selection, because a team id is not a department id', async () => {
    const user = userEvent.setup()
    const { onApply } = setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-scope-department'))
    await user.click(screen.getByTestId('audience-group-P1'))
    await user.click(screen.getByTestId('audience-apply'))
    expect(onApply.mock.calls[0][0]).toEqual({ visibility: 'department', targetIds: ['P1'] })
  })

  it('refuses to apply a restricted audience naming nobody', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    // a scope chosen, nothing selected
    expect(screen.getByTestId('audience-apply')).toBeDisabled()
    expect(screen.getByTestId('audience-pending-line')).toHaveTextContent('Pick at least one group')
  })

  it('cannot apply when nothing changed', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByTestId('audience-apply')).toBeDisabled()
    expect(screen.getByTestId('audience-pending-line')).toHaveTextContent('No changes')
  })

  it('applies Firm-wide with no groups', async () => {
    const user = userEvent.setup()
    const { onApply } = setup({ saved: { visibility: 'team', targetIds: ['T1'] } })
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-firm'))
    await user.click(screen.getByTestId('audience-apply'))
    expect(onApply.mock.calls[0][0]).toEqual({ visibility: 'firm', targetIds: [] })
  })
})

describe('the current saved audience is always visible', () => {
  it('names the saved groups, not the draft', async () => {
    const user = userEvent.setup()
    setup({ saved: { visibility: 'team', targetIds: ['T1', 'T2'] } })
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByTestId('audience-saved-line')).toHaveTextContent('Consumer and Industrials')
    await user.click(screen.getByTestId('audience-group-T2'))      // deselect
    expect(screen.getByTestId('audience-saved-line')).toHaveTextContent('Consumer and Industrials')
    expect(screen.getByTestId('audience-pending-line')).toHaveTextContent('Pending: Consumer')
  })

  it('opens on the saved scope with the saved groups checked', async () => {
    const user = userEvent.setup()
    setup({ saved: { visibility: 'department', targetIds: ['P1'] } })
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByTestId('audience-group-P1')).toHaveAttribute('aria-checked', 'true')
  })

  it('states the reach of the pending selection', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-division'))
    await user.click(screen.getByTestId('audience-group-D'))
    expect(screen.getByTestId('audience-pending-line')).toHaveTextContent('3 people')
  })
})

describe('a failed Apply is not reported as success', () => {
  it('keeps the panel open, keeps the draft, and shows the reason', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockRejectedValue(new Error('contribution not found or not yours'))
    render(
      <AudiencePicker
        saved={{ visibility: 'firm', targetIds: [] }}
        nodesFor={nodesFor as never}
        memberCounts={counts}
        nodeById={nodeById}
        onApply={onApply}
      />
    )
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-apply'))

    await waitFor(() => expect(screen.getByTestId('audience-error')).toBeInTheDocument())
    expect(screen.getByTestId('audience-error')).toHaveTextContent('contribution not found or not yours')
    // still open, still holding the draft — nothing claims to have saved
    expect(screen.getByTestId('audience-panel')).toBeInTheDocument()
    expect(screen.getByTestId('audience-group-T1')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('audience-saved-line')).toHaveTextContent('Everyone at the firm')
  })

  it('closes only after a successful apply', async () => {
    const user = userEvent.setup()
    setup({ saved: { visibility: 'firm', targetIds: [] } })
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.click(screen.getByTestId('audience-apply'))
    await waitFor(() => expect(screen.queryByTestId('audience-panel')).not.toBeInTheDocument())
  })
})

describe('loading and keyboard', () => {
  it('does not open while the saved audience is still loading', async () => {
    const user = userEvent.setup()
    setup({ saved: null, isLoading: true })
    const trigger = screen.getByTestId('audience-trigger')
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByTestId('audience-panel')).not.toBeInTheDocument()
  })

  it('Escape cancels without applying', async () => {
    const user = userEvent.setup()
    const { onApply } = setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await user.click(screen.getByTestId('audience-scope-team'))
    await user.click(screen.getByTestId('audience-group-T1'))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('audience-panel')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('moves focus into the panel on open and back to the trigger on cancel', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    await waitFor(() => expect(screen.getByTestId('audience-firm')).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('audience-trigger')).toHaveFocus()
  })

  it('exposes the panel as a dialog and the groups as checkboxes', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByRole('dialog', { name: 'Research audience' })).toBeInTheDocument()
    await user.click(screen.getByTestId('audience-scope-team'))
    expect(screen.getAllByRole('checkbox').length).toBe(3)
  })
})

describe('stale selections survive', () => {
  it('lists and checks a saved group the author can no longer pick', async () => {
    const user = userEvent.setup()
    // 'T3' is saved but not among the author's own candidate nodes.
    setup({
      saved: { visibility: 'team', targetIds: ['T3'] },
      nodesFor: ((v: string) => (v === 'team' ? [TREE[3], TREE[4]] : [])) as never,
    })
    await user.click(screen.getByTestId('audience-trigger'))
    const stale = screen.getByTestId('audience-group-T3')
    expect(stale).toHaveAttribute('aria-checked', 'true')
    expect(stale).toHaveTextContent('already shared')
  })
})

describe('Apply does not claim to persist', () => {
  it('says the audience applies when the section is saved', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    expect(screen.getByTestId('audience-staging-note'))
      .toHaveTextContent('Applies to your research when you save the section.')
  })

  it('never uses language implying the audience is already stored', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('audience-trigger'))
    const panel = screen.getByTestId('audience-panel')
    // "Saved:" labels what the SERVER holds. Nothing else in the panel may
    // suggest the draft has reached it.
    expect(panel.textContent).not.toMatch(/\b(saved successfully|audience updated|now visible to)\b/i)
  })
})

describe('summaries', () => {
  it('names up to two groups then counts the rest', () => {
    const three: AudienceSelection = { visibility: 'team', targetIds: ['T1', 'T2', 'T3'] }
    expect(describeAudience(three, nodeById)).toBe('Consumer, Industrials and 1 more')
  })

  it('reports firm-wide without naming groups', () => {
    expect(describeAudience({ visibility: 'firm', targetIds: [] }, nodeById)).toBe('Everyone at the firm')
  })

  it('sums reach across the selected groups, counting each once', () => {
    expect(reachOf({ visibility: 'team', targetIds: ['T1', 'T2', 'T1'] }, counts)).toBe(2)
  })
})
