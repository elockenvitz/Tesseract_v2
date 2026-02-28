import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ManageNodeDrawer } from '../ManageNodeDrawer'

function makeNode(overrides = {}) {
  return {
    id: 'node-1',
    organization_id: 'org-1',
    parent_id: null,
    node_type: 'team' as const,
    name: 'Equity Research',
    color: '#6366f1',
    icon: 'users',
    sort_order: 0,
    settings: null,
    is_active: true,
    is_non_investment: false,
    created_at: '2026-01-15T00:00:00Z',
    ...overrides,
  }
}

function makeMember(userId: string, extra = {}) {
  return {
    id: `member-${userId}`,
    node_id: 'node-1',
    user_id: userId,
    role: 'Analyst',
    focus: null as string | null,
    created_at: '2026-01-01T00:00:00Z',
    user: {
      id: userId,
      email: `${userId}@example.com`,
      full_name: `User ${userId}`,
    },
    ...extra,
  }
}

describe('ManageNodeDrawer', () => {
  const defaultProps = {
    node: makeNode(),
    members: [],
    availableUsers: [],
    onClose: vi.fn(),
    onSaveNode: vi.fn(),
    onAddMember: vi.fn(),
    onRemoveMember: vi.fn(),
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ── Basic rendering ──

  it('renders drawer with node name and tabs', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    expect(screen.getByText('Equity Research')).toBeInTheDocument()
    expect(screen.getByText('details')).toBeInTheDocument()
    expect(screen.getByText('members')).toBeInTheDocument()
    expect(screen.getByText('coverage')).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
  })

  it('defaults to details tab', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    expect(screen.getByDisplayValue('Equity Research')).toBeInTheDocument()
  })

  // ── Tab switching ──

  it('switches to members tab', () => {
    render(<ManageNodeDrawer {...defaultProps} members={[makeMember('u1')]} />)
    fireEvent.click(screen.getByText('members'))
    expect(screen.getByText('Direct Members (1)')).toBeInTheDocument()
    expect(screen.getByText('User u1')).toBeInTheDocument()
  })

  it('switches to settings tab', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    fireEvent.click(screen.getByText('settings'))
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Non-investment team')).toBeInTheDocument()
  })

  // ── Details tab ──

  it('save button disabled when unchanged', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    const saveButton = screen.getByText('Save changes')
    expect(saveButton).toBeDisabled()
  })

  it('save button enables when name changes', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'New Name' } })
    const saveButton = screen.getByText('Save changes')
    expect(saveButton).not.toBeDisabled()
  })

  it('calls onSaveNode with updated data', () => {
    const onSave = vi.fn()
    render(<ManageNodeDrawer {...defaultProps} onSaveNode={onSave} />)
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'Updated Team' } })
    fireEvent.click(screen.getByText('Save changes'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node-1',
      name: 'Updated Team',
    }))
  })

  // ── Members tab ──

  it('shows add member form when clicking add', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    fireEvent.click(screen.getByText('members'))
    fireEvent.click(screen.getByText('Add member'))
    expect(screen.getByText('Select User')).toBeInTheDocument()
  })

  it('shows member list with remove buttons', () => {
    render(<ManageNodeDrawer {...defaultProps} members={[makeMember('u1'), makeMember('u2')]} />)
    fireEvent.click(screen.getByText('members'))
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('User u2')).toBeInTheDocument()
    expect(screen.getAllByTitle('Remove member')).toHaveLength(2)
  })

  // ── Coverage tab ──

  it('shows non-investment message on coverage tab', () => {
    render(<ManageNodeDrawer {...defaultProps} node={makeNode({ is_non_investment: true })} />)
    fireEvent.click(screen.getByText('coverage'))
    expect(screen.getByText(/Non-investment node/)).toBeInTheDocument()
  })

  it('shows empty state when no members', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    fireEvent.click(screen.getByText('coverage'))
    expect(screen.getByText(/No members in this node/)).toBeInTheDocument()
  })

  // ── Keyboard ──

  it('closes on ESC', () => {
    const closeFn = vi.fn()
    render(<ManageNodeDrawer {...defaultProps} onClose={closeFn} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalled()
  })

  it('closes on backdrop click', () => {
    const closeFn = vi.fn()
    render(<ManageNodeDrawer {...defaultProps} onClose={closeFn} />)
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(closeFn).toHaveBeenCalled()
    }
  })

  it('focuses close button on mount', () => {
    render(<ManageNodeDrawer {...defaultProps} />)
    expect(document.activeElement).toBe(screen.getByTitle('Close (Esc)'))
  })
})
