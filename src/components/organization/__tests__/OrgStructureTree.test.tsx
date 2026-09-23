/**
 * The mobile org tree, and specifically that its filters do something.
 *
 * The type chips and the risk filter compute node-id sets in
 * OrganizationPage, and the desktop canvas consumes them as a *highlight*.
 * The tree shipped consuming only the search set, so tapping "Divisions"
 * changed nothing at all — the chip looked dead because it was.
 *
 * A tree prunes rather than highlights: the sets already carry each match's
 * ancestors, which is exactly what you need to keep the branch that leads to
 * a match while dropping everything else.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OrgStructureTree, type OrgTreeNode } from '../OrgStructureTree'

const TREE: OrgTreeNode[] = [
  {
    id: 'root',
    name: 'Tesseract',
    node_type: 'division',
    children: [
      {
        id: 'fe',
        name: 'Fundamental Equity',
        node_type: 'department',
        children: [
          { id: 'growth', name: 'Growth Team', node_type: 'team' },
          { id: 'best', name: 'The BEST Team', node_type: 'team' },
        ],
      },
      { id: 'ops', name: 'Operations', node_type: 'department' },
    ],
  },
]

function renderTree(props: Partial<React.ComponentProps<typeof OrgStructureTree>> = {}) {
  return render(
    <OrgStructureTree
      tree={TREE}
      collapsedNodes={new Set()}
      onToggleCollapsed={() => {}}
      onOpenNode={() => {}}
      {...props}
    />,
  )
}

describe('OrgStructureTree filtering', () => {
  it('shows the whole hierarchy when no filter is active', () => {
    renderTree()
    for (const name of ['Tesseract', 'Fundamental Equity', 'Growth Team', 'The BEST Team', 'Operations']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    cleanup()
  })

  it('prunes to the filtered nodes and keeps the branch that reaches them', () => {
    // What OrganizationPage computes for "Teams": the matches plus ancestors.
    renderTree({ filterIds: new Set(['growth', 'best', 'fe', 'root']) })

    expect(screen.getByText('Growth Team')).toBeTruthy()
    expect(screen.getByText('The BEST Team')).toBeTruthy()
    // Ancestors survive so the matches are reachable...
    expect(screen.getByText('Fundamental Equity')).toBeTruthy()
    expect(screen.getByText('Tesseract')).toBeTruthy()
    // ...and the unrelated branch is gone, which is the visible difference.
    expect(screen.queryByText('Operations')).toBeNull()
    cleanup()
  })

  it('opens itself while filtering, so a collapsed ancestor cannot hide a match', () => {
    // Everything collapsed: without the override this renders one root row
    // and the filter looks dead for a second reason.
    renderTree({
      collapsedNodes: new Set(['root', 'fe']),
      filterIds: new Set(['growth', 'fe', 'root']),
    })

    expect(screen.getByText('Growth Team')).toBeTruthy()
    cleanup()
  })

  it('still honours collapsed state when no filter is active', () => {
    renderTree({ collapsedNodes: new Set(['root']) })

    expect(screen.getByText('Tesseract')).toBeTruthy()
    expect(screen.queryByText('Fundamental Equity')).toBeNull()
    cleanup()
  })

  it('says so when a filter matches nothing', () => {
    renderTree({ filterIds: new Set(['nobody']) })
    expect(screen.getByText('No organization nodes match.')).toBeTruthy()
    cleanup()
  })
})

describe('OrgStructureTree rows', () => {
  it('separates expanding a branch from opening its detail', () => {
    const onOpenNode = vi.fn()
    const onToggleCollapsed = vi.fn()
    renderTree({ onOpenNode, onToggleCollapsed })

    // The disclosure expands; it must not open the node.
    fireEvent.click(screen.getByLabelText('Collapse Fundamental Equity'))
    expect(onToggleCollapsed).toHaveBeenCalledWith('fe')
    expect(onOpenNode).not.toHaveBeenCalled()

    // The row opens; it must not toggle the branch.
    onToggleCollapsed.mockClear()
    fireEvent.click(screen.getByText('Growth Team'))
    expect(onOpenNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'growth' }))
    expect(onToggleCollapsed).not.toHaveBeenCalled()
    cleanup()
  })

  it('offers no disclosure on a leaf', () => {
    renderTree()
    expect(screen.queryByLabelText(/Growth Team/)).toBeNull()
    cleanup()
  })
})
