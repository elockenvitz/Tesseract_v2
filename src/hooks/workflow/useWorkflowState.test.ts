import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowState } from './useWorkflowState'

describe('useWorkflowState', () => {
  it('should initialize with default state values', () => {
    const { result } = renderHook(() => useWorkflowState())

    expect(result.current.searchTerm).toBe('')
    expect(result.current.filterBy).toBe('all')
    expect(result.current.sortBy).toBe('usage')
    expect(result.current.selectedWorkflow).toBeNull()
    expect(result.current.activeView).toBe('overview')
  })

  it('should update search term', () => {
    const { result } = renderHook(() => useWorkflowState())

    act(() => {
      result.current.setSearchTerm('test query')
    })

    expect(result.current.searchTerm).toBe('test query')
  })

  it('should update filter', () => {
    const { result } = renderHook(() => useWorkflowState())

    act(() => {
      result.current.setFilterBy('my')
    })

    expect(result.current.filterBy).toBe('my')
  })

  it('should update sort by', () => {
    const { result } = renderHook(() => useWorkflowState())

    act(() => {
      result.current.setSortBy('name')
    })

    expect(result.current.sortBy).toBe('name')
  })

  it('should update active view', () => {
    const { result } = renderHook(() => useWorkflowState())

    act(() => {
      result.current.setActiveView('stages')
    })

    expect(result.current.activeView).toBe('stages')
  })

  it('should toggle show workflow manager', () => {
    const { result } = renderHook(() => useWorkflowState())

    expect(result.current.showWorkflowManager).toBe(false)

    act(() => {
      result.current.setShowWorkflowManager(true)
    })

    expect(result.current.showWorkflowManager).toBe(true)

    act(() => {
      result.current.setShowWorkflowManager(false)
    })

    expect(result.current.showWorkflowManager).toBe(false)
  })

  it('should manage modal visibility states', () => {
    const { result } = renderHook(() => useWorkflowState())

    // Test showAddStage modal
    expect(result.current.showAddStage).toBe(false)

    act(() => {
      result.current.setShowAddStage(true)
    })

    expect(result.current.showAddStage).toBe(true)

    // Test showCreateBranchModal
    expect(result.current.showCreateBranchModal).toBe(false)

    act(() => {
      result.current.setShowCreateBranchModal(true)
    })

    expect(result.current.showCreateBranchModal).toBe(true)
  })

  it('should handle branch status filter changes', () => {
    const { result } = renderHook(() => useWorkflowState())

    expect(result.current.branchStatusFilter).toBe('all')

    act(() => {
      result.current.setBranchStatusFilter('archived')
    })

    expect(result.current.branchStatusFilter).toBe('archived')

    act(() => {
      result.current.setBranchStatusFilter('deleted')
    })

    expect(result.current.branchStatusFilter).toBe('deleted')
  })

  it('should manage expansion states', () => {
    const { result } = renderHook(() => useWorkflowState())

    // Test collapsed branches Set
    expect(result.current.collapsedBranches.size).toBe(0)

    act(() => {
      const newSet = new Set(['branch-1', 'branch-2'])
      result.current.setCollapsedBranches(newSet)
    })

    expect(result.current.collapsedBranches.size).toBe(2)
    expect(result.current.collapsedBranches.has('branch-1')).toBe(true)
    expect(result.current.collapsedBranches.has('branch-2')).toBe(true)
  })

  it('should track template changes', () => {
    const { result } = renderHook(() => useWorkflowState())

    expect(result.current.templateChanges).toEqual([])

    act(() => {
      result.current.setTemplateChanges([
        { type: 'stage_added', description: 'Added new stage' }
      ])
    })

    expect(result.current.templateChanges).toHaveLength(1)
    expect(result.current.templateChanges[0].type).toBe('stage_added')
  })
})
