/**
 * TableContext - Centralized state management for the elevated table experience
 *
 * Manages:
 * - Interaction modes (normal, editing, command, selecting, gesturing)
 * - Cell focus and navigation
 * - Row selection for bulk actions
 * - View configuration (density, columns, saved views)
 * - Keyboard shortcuts
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react'

// ============================================================================
// Types
// ============================================================================

export type InteractionMode = 'normal' | 'editing' | 'command' | 'selecting' | 'gesturing'

export type DensityMode = 'comfortable' | 'compact' | 'ultra'

export interface CellPosition {
  rowIndex: number
  columnId: string
}

export interface ColumnConfig {
  id: string
  label: string
  visible: boolean
  width: number
  minWidth: number
  sortable: boolean
  editable: boolean
  pinned: boolean
}

export interface SavedView {
  id: string
  name: string
  icon?: string
  color?: string
  isDefault?: boolean
  config: {
    columns: ColumnConfig[]
    filters: Record<string, any>
    sorts: { field: string; order: 'asc' | 'desc' }[]
    groupBy: string | null
    density: DensityMode
  }
}

export interface TableState {
  // Interaction
  mode: InteractionMode

  // Focus & Selection
  focusedCell: CellPosition | null
  editingCell: CellPosition | null
  editValue: string
  selectionAnchor: CellPosition | null
  selectedRowIds: Set<string>

  // View Configuration
  density: DensityMode
  activeViewId: string | null

  // Command Palette
  commandPaletteOpen: boolean
  commandQuery: string

  // Keyboard Help
  showKeyboardHelp: boolean
}

// ============================================================================
// Density Configurations
// ============================================================================

export const DENSITY_CONFIG = {
  comfortable: {
    rowHeight: 64,
    padding: 'px-4 py-3',
    fontSize: 'text-sm',
    gap: 'gap-3',
    showSecondaryInfo: true,
    showAvatars: true,
    iconSize: 'w-5 h-5'
  },
  compact: {
    rowHeight: 44,
    padding: 'px-3 py-2',
    fontSize: 'text-sm',
    gap: 'gap-2',
    showSecondaryInfo: true,
    showAvatars: false,
    iconSize: 'w-4 h-4'
  },
  ultra: {
    rowHeight: 32,
    padding: 'px-2 py-1',
    fontSize: 'text-xs',
    gap: 'gap-1',
    showSecondaryInfo: false,
    showAvatars: false,
    iconSize: 'w-3.5 h-3.5'
  }
} as const

// ============================================================================
// Actions
// ============================================================================

type TableAction =
  | { type: 'SET_MODE'; mode: InteractionMode }
  | { type: 'SET_FOCUSED_CELL'; cell: CellPosition | null }
  | { type: 'START_EDITING'; cell: CellPosition; initialValue?: string }
  | { type: 'UPDATE_EDIT_VALUE'; value: string }
  | { type: 'CANCEL_EDITING' }
  | { type: 'COMMIT_EDIT' }
  | { type: 'SET_SELECTION_ANCHOR'; cell: CellPosition | null }
  | { type: 'SELECT_ROW'; rowId: string; addToSelection?: boolean }
  | { type: 'DESELECT_ROW'; rowId: string }
  | { type: 'SELECT_ALL'; rowIds: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'TOGGLE_ROW_SELECTION'; rowId: string }
  | { type: 'SET_DENSITY'; density: DensityMode }
  | { type: 'SET_ACTIVE_VIEW'; viewId: string | null }
  | { type: 'OPEN_COMMAND_PALETTE' }
  | { type: 'CLOSE_COMMAND_PALETTE' }
  | { type: 'SET_COMMAND_QUERY'; query: string }
  | { type: 'TOGGLE_KEYBOARD_HELP' }
  | { type: 'NAVIGATE_CELL'; direction: 'up' | 'down' | 'left' | 'right'; columns: ColumnConfig[]; totalRows: number }

// ============================================================================
// Initial State
// ============================================================================

const getInitialState = (): TableState => {
  // Load density preference from localStorage
  const savedDensity = typeof window !== 'undefined'
    ? localStorage.getItem('table-density') as DensityMode
    : null

  return {
    mode: 'normal',
    focusedCell: null,
    editingCell: null,
    editValue: '',
    selectionAnchor: null,
    selectedRowIds: new Set(),
    density: savedDensity || 'comfortable',
    activeViewId: null,
    commandPaletteOpen: false,
    commandQuery: '',
    showKeyboardHelp: false
  }
}

// ============================================================================
// Reducer
// ============================================================================

function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode }

    case 'SET_FOCUSED_CELL':
      return {
        ...state,
        focusedCell: action.cell,
        mode: action.cell ? 'normal' : state.mode
      }

    case 'START_EDITING':
      return {
        ...state,
        mode: 'editing',
        editingCell: action.cell,
        editValue: action.initialValue || '',
        focusedCell: action.cell
      }

    case 'UPDATE_EDIT_VALUE':
      return { ...state, editValue: action.value }

    case 'CANCEL_EDITING':
      return {
        ...state,
        mode: 'normal',
        editingCell: null,
        editValue: ''
      }

    case 'COMMIT_EDIT':
      return {
        ...state,
        mode: 'normal',
        editingCell: null,
        editValue: ''
      }

    case 'SET_SELECTION_ANCHOR':
      return { ...state, selectionAnchor: action.cell }

    case 'SELECT_ROW': {
      const newSelection = new Set(action.addToSelection ? state.selectedRowIds : [])
      newSelection.add(action.rowId)
      return {
        ...state,
        selectedRowIds: newSelection,
        mode: newSelection.size > 0 ? 'selecting' : 'normal'
      }
    }

    case 'DESELECT_ROW': {
      const newSelection = new Set(state.selectedRowIds)
      newSelection.delete(action.rowId)
      return {
        ...state,
        selectedRowIds: newSelection,
        mode: newSelection.size > 0 ? 'selecting' : 'normal'
      }
    }

    case 'SELECT_ALL':
      return {
        ...state,
        selectedRowIds: new Set(action.rowIds),
        mode: action.rowIds.length > 0 ? 'selecting' : 'normal'
      }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedRowIds: new Set(),
        mode: 'normal'
      }

    case 'TOGGLE_ROW_SELECTION': {
      const newSelection = new Set(state.selectedRowIds)
      if (newSelection.has(action.rowId)) {
        newSelection.delete(action.rowId)
      } else {
        newSelection.add(action.rowId)
      }
      return {
        ...state,
        selectedRowIds: newSelection,
        mode: newSelection.size > 0 ? 'selecting' : 'normal'
      }
    }

    case 'SET_DENSITY':
      // Persist to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('table-density', action.density)
      }
      return { ...state, density: action.density }

    case 'SET_ACTIVE_VIEW':
      return { ...state, activeViewId: action.viewId }

    case 'OPEN_COMMAND_PALETTE':
      return {
        ...state,
        commandPaletteOpen: true,
        commandQuery: '',
        mode: 'command'
      }

    case 'CLOSE_COMMAND_PALETTE':
      return {
        ...state,
        commandPaletteOpen: false,
        commandQuery: '',
        mode: 'normal'
      }

    case 'SET_COMMAND_QUERY':
      return { ...state, commandQuery: action.query }

    case 'TOGGLE_KEYBOARD_HELP':
      return { ...state, showKeyboardHelp: !state.showKeyboardHelp }

    case 'NAVIGATE_CELL': {
      if (!state.focusedCell) return state

      const { direction, columns, totalRows } = action
      const visibleColumns = columns.filter(c => c.visible)
      const currentColIndex = visibleColumns.findIndex(c => c.id === state.focusedCell!.columnId)

      let newRowIndex = state.focusedCell.rowIndex
      let newColIndex = currentColIndex

      switch (direction) {
        case 'up':
          newRowIndex = Math.max(0, newRowIndex - 1)
          break
        case 'down':
          newRowIndex = Math.min(totalRows - 1, newRowIndex + 1)
          break
        case 'left':
          newColIndex = Math.max(0, currentColIndex - 1)
          break
        case 'right':
          newColIndex = Math.min(visibleColumns.length - 1, currentColIndex + 1)
          break
      }

      return {
        ...state,
        focusedCell: {
          rowIndex: newRowIndex,
          columnId: visibleColumns[newColIndex]?.id || state.focusedCell.columnId
        }
      }
    }

    default:
      return state
  }
}

// ============================================================================
// Context
// ============================================================================

interface TableContextValue {
  state: TableState
  dispatch: React.Dispatch<TableAction>

  // Convenience methods
  setDensity: (density: DensityMode) => void
  cycleDensity: () => void
  getDensityConfig: () => typeof DENSITY_CONFIG[DensityMode]

  startEditing: (cell: CellPosition, initialValue?: string) => void
  cancelEditing: () => void
  commitEdit: () => void

  focusCell: (cell: CellPosition | null) => void
  navigateCell: (direction: 'up' | 'down' | 'left' | 'right', columns: ColumnConfig[], totalRows: number) => void

  selectRow: (rowId: string, addToSelection?: boolean) => void
  deselectRow: (rowId: string) => void
  toggleRowSelection: (rowId: string) => void
  selectAll: (rowIds: string[]) => void
  clearSelection: () => void
  isRowSelected: (rowId: string) => boolean

  openCommandPalette: () => void
  closeCommandPalette: () => void

  toggleKeyboardHelp: () => void
}

const TableContext = createContext<TableContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

interface TableProviderProps {
  children: ReactNode
}

export function TableProvider({ children }: TableProviderProps) {
  const [state, dispatch] = useReducer(tableReducer, undefined, getInitialState)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if in an input/textarea (unless it's our table editing)
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // Only handle Escape in inputs
        if (e.key === 'Escape' && state.mode === 'editing') {
          e.preventDefault()
          dispatch({ type: 'CANCEL_EDITING' })
        }
        return
      }

      // Command palette: Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (state.commandPaletteOpen) {
          dispatch({ type: 'CLOSE_COMMAND_PALETTE' })
        } else {
          dispatch({ type: 'OPEN_COMMAND_PALETTE' })
        }
        return
      }

      // Keyboard help: ?
      if (e.key === '?' && !state.commandPaletteOpen && state.mode === 'normal') {
        e.preventDefault()
        dispatch({ type: 'TOGGLE_KEYBOARD_HELP' })
        return
      }

      // Density toggle: D
      if (e.key === 'd' && !state.commandPaletteOpen && state.mode === 'normal' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const densities: DensityMode[] = ['comfortable', 'compact', 'ultra']
        const currentIndex = densities.indexOf(state.density)
        const nextDensity = densities[(currentIndex + 1) % densities.length]
        dispatch({ type: 'SET_DENSITY', density: nextDensity })
        return
      }

      // Escape: Cancel editing, close palette, clear selection
      if (e.key === 'Escape') {
        e.preventDefault()
        if (state.mode === 'editing') {
          dispatch({ type: 'CANCEL_EDITING' })
        } else if (state.commandPaletteOpen) {
          dispatch({ type: 'CLOSE_COMMAND_PALETTE' })
        } else if (state.selectedRowIds.size > 0) {
          dispatch({ type: 'CLEAR_SELECTION' })
        } else if (state.showKeyboardHelp) {
          dispatch({ type: 'TOGGLE_KEYBOARD_HELP' })
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.mode, state.commandPaletteOpen, state.density, state.selectedRowIds.size, state.showKeyboardHelp])

  // Convenience methods
  const setDensity = useCallback((density: DensityMode) => {
    dispatch({ type: 'SET_DENSITY', density })
  }, [])

  const cycleDensity = useCallback(() => {
    const densities: DensityMode[] = ['comfortable', 'compact', 'ultra']
    const currentIndex = densities.indexOf(state.density)
    const nextDensity = densities[(currentIndex + 1) % densities.length]
    dispatch({ type: 'SET_DENSITY', density: nextDensity })
  }, [state.density])

  const getDensityConfig = useCallback(() => {
    return DENSITY_CONFIG[state.density]
  }, [state.density])

  const startEditing = useCallback((cell: CellPosition, initialValue?: string) => {
    dispatch({ type: 'START_EDITING', cell, initialValue })
  }, [])

  const cancelEditing = useCallback(() => {
    dispatch({ type: 'CANCEL_EDITING' })
  }, [])

  const commitEdit = useCallback(() => {
    dispatch({ type: 'COMMIT_EDIT' })
  }, [])

  const focusCell = useCallback((cell: CellPosition | null) => {
    dispatch({ type: 'SET_FOCUSED_CELL', cell })
  }, [])

  const navigateCell = useCallback((direction: 'up' | 'down' | 'left' | 'right', columns: ColumnConfig[], totalRows: number) => {
    dispatch({ type: 'NAVIGATE_CELL', direction, columns, totalRows })
  }, [])

  const selectRow = useCallback((rowId: string, addToSelection?: boolean) => {
    dispatch({ type: 'SELECT_ROW', rowId, addToSelection })
  }, [])

  const deselectRow = useCallback((rowId: string) => {
    dispatch({ type: 'DESELECT_ROW', rowId })
  }, [])

  const toggleRowSelection = useCallback((rowId: string) => {
    dispatch({ type: 'TOGGLE_ROW_SELECTION', rowId })
  }, [])

  const selectAll = useCallback((rowIds: string[]) => {
    dispatch({ type: 'SELECT_ALL', rowIds })
  }, [])

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' })
  }, [])

  const isRowSelected = useCallback((rowId: string) => {
    return state.selectedRowIds.has(rowId)
  }, [state.selectedRowIds])

  const openCommandPalette = useCallback(() => {
    dispatch({ type: 'OPEN_COMMAND_PALETTE' })
  }, [])

  const closeCommandPalette = useCallback(() => {
    dispatch({ type: 'CLOSE_COMMAND_PALETTE' })
  }, [])

  const toggleKeyboardHelp = useCallback(() => {
    dispatch({ type: 'TOGGLE_KEYBOARD_HELP' })
  }, [])

  const value: TableContextValue = {
    state,
    dispatch,
    setDensity,
    cycleDensity,
    getDensityConfig,
    startEditing,
    cancelEditing,
    commitEdit,
    focusCell,
    navigateCell,
    selectRow,
    deselectRow,
    toggleRowSelection,
    selectAll,
    clearSelection,
    isRowSelected,
    openCommandPalette,
    closeCommandPalette,
    toggleKeyboardHelp
  }

  return (
    <TableContext.Provider value={value}>
      {children}
    </TableContext.Provider>
  )
}

// ============================================================================
// Hook
// ============================================================================

export function useTableContext() {
  const context = useContext(TableContext)
  if (!context) {
    throw new Error('useTableContext must be used within a TableProvider')
  }
  return context
}

// Optional: Non-throwing version for components that may be outside provider
export function useTableContextOptional() {
  return useContext(TableContext)
}
