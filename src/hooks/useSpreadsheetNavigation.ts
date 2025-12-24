/**
 * useSpreadsheetNavigation - Keyboard navigation for spreadsheet-like table experience
 *
 * Handles:
 * - Arrow key navigation between cells
 * - Tab/Shift+Tab for horizontal movement
 * - Enter/F2 to start editing
 * - Escape to cancel editing
 * - Cmd+A to select all
 * - Space to toggle row selection
 */

import { useEffect, useCallback, useRef } from 'react'
import { useTableContext, ColumnConfig, CellPosition } from '../contexts/TableContext'

export interface SpreadsheetNavigationOptions {
  columns: ColumnConfig[]
  totalRows: number
  tableRef: React.RefObject<HTMLElement>
  onStartEdit?: (cell: CellPosition, value: string) => void
  onCommitEdit?: (cell: CellPosition, value: string) => void
  getCellValue?: (rowIndex: number, columnId: string) => string
  isEditable?: (columnId: string) => boolean
  onRowSelect?: (rowIndex: number, addToSelection?: boolean) => void
  onSelectAll?: () => void
  scrollToRow?: (rowIndex: number) => void
}

export function useSpreadsheetNavigation({
  columns,
  totalRows,
  tableRef,
  onStartEdit,
  onCommitEdit,
  getCellValue,
  isEditable = () => true,
  onRowSelect,
  onSelectAll,
  scrollToRow
}: SpreadsheetNavigationOptions) {
  const {
    state,
    focusCell,
    navigateCell,
    startEditing,
    cancelEditing,
    commitEdit,
    selectAll,
    clearSelection
  } = useTableContext()

  const lastNavigationTime = useRef<number>(0)

  // Get visible columns for navigation
  const visibleColumns = columns.filter(c => c.visible)

  // Find next editable cell in a direction
  const findNextEditableCell = useCallback((
    startRow: number,
    startColIndex: number,
    direction: 'left' | 'right'
  ): CellPosition | null => {
    const delta = direction === 'right' ? 1 : -1
    let colIndex = startColIndex + delta

    while (colIndex >= 0 && colIndex < visibleColumns.length) {
      const col = visibleColumns[colIndex]
      if (col && isEditable(col.id)) {
        return { rowIndex: startRow, columnId: col.id }
      }
      colIndex += delta
    }

    return null
  }, [visibleColumns, isEditable])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if focus is in an input/textarea (unless it's our editing)
    const target = e.target as HTMLElement
    const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

    // Allow Escape in inputs to cancel editing
    if (isInInput && e.key !== 'Escape' && e.key !== 'Tab' && e.key !== 'Enter') {
      return
    }

    // Check if table is focused or if we're in editing mode
    const tableHasFocus = tableRef.current?.contains(document.activeElement) ||
                          state.mode === 'editing' ||
                          state.focusedCell !== null

    if (!tableHasFocus && state.mode === 'normal') {
      return
    }

    // Prevent rapid-fire navigation
    const now = Date.now()
    if (now - lastNavigationTime.current < 50 &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      return
    }

    switch (e.key) {
      // Arrow navigation
      case 'ArrowUp':
        if (state.mode !== 'editing') {
          e.preventDefault()
          lastNavigationTime.current = now

          if (state.focusedCell) {
            navigateCell('up', columns, totalRows)

            // Scroll to keep cell visible
            const newRow = Math.max(0, state.focusedCell.rowIndex - 1)
            scrollToRow?.(newRow)
          } else if (totalRows > 0) {
            // Start at first cell
            focusCell({ rowIndex: 0, columnId: visibleColumns[0]?.id || '' })
          }
        }
        break

      case 'ArrowDown':
        if (state.mode !== 'editing') {
          e.preventDefault()
          lastNavigationTime.current = now

          if (state.focusedCell) {
            navigateCell('down', columns, totalRows)

            // Scroll to keep cell visible
            const newRow = Math.min(totalRows - 1, state.focusedCell.rowIndex + 1)
            scrollToRow?.(newRow)
          } else if (totalRows > 0) {
            focusCell({ rowIndex: 0, columnId: visibleColumns[0]?.id || '' })
          }
        }
        break

      case 'ArrowLeft':
        if (state.mode !== 'editing') {
          e.preventDefault()
          lastNavigationTime.current = now
          navigateCell('left', columns, totalRows)
        }
        break

      case 'ArrowRight':
        if (state.mode !== 'editing') {
          e.preventDefault()
          lastNavigationTime.current = now
          navigateCell('right', columns, totalRows)
        }
        break

      // Tab navigation (horizontal movement)
      case 'Tab':
        if (state.focusedCell) {
          e.preventDefault()
          const direction = e.shiftKey ? 'left' : 'right'

          if (state.mode === 'editing') {
            // Commit current edit and move
            commitEdit()
            onCommitEdit?.(state.focusedCell, state.editValue)
          }

          navigateCell(direction, columns, totalRows)
        }
        break

      // Enter: Start editing or confirm and move down
      case 'Enter':
        if (state.mode === 'editing') {
          e.preventDefault()
          commitEdit()
          onCommitEdit?.(state.focusedCell!, state.editValue)

          // Move down after editing
          if (!e.shiftKey && state.focusedCell) {
            navigateCell('down', columns, totalRows)
            const newRow = Math.min(totalRows - 1, state.focusedCell.rowIndex + 1)
            scrollToRow?.(newRow)
          }
        } else if (state.focusedCell && !e.shiftKey) {
          e.preventDefault()
          const col = visibleColumns.find(c => c.id === state.focusedCell!.columnId)

          if (col && isEditable(col.id)) {
            const value = getCellValue?.(state.focusedCell.rowIndex, col.id) || ''
            startEditing(state.focusedCell, value)
            onStartEdit?.(state.focusedCell, value)
          }
        }
        break

      // F2: Start editing current cell
      case 'F2':
        if (state.focusedCell && state.mode !== 'editing') {
          e.preventDefault()
          const col = visibleColumns.find(c => c.id === state.focusedCell!.columnId)

          if (col && isEditable(col.id)) {
            const value = getCellValue?.(state.focusedCell.rowIndex, col.id) || ''
            startEditing(state.focusedCell, value)
            onStartEdit?.(state.focusedCell, value)
          }
        }
        break

      // Escape: Cancel editing
      case 'Escape':
        if (state.mode === 'editing') {
          e.preventDefault()
          cancelEditing()
        } else if (state.focusedCell) {
          e.preventDefault()
          focusCell(null)
        }
        break

      // Space: Toggle row selection
      case ' ':
        if (state.mode !== 'editing' && state.focusedCell) {
          e.preventDefault()
          onRowSelect?.(state.focusedCell.rowIndex, e.shiftKey)
        }
        break

      // Cmd+A: Select all
      case 'a':
        if ((e.metaKey || e.ctrlKey) && state.mode !== 'editing') {
          e.preventDefault()
          onSelectAll?.()
        }
        break

      // Home: Go to first cell in row
      case 'Home':
        if (state.focusedCell && state.mode !== 'editing') {
          e.preventDefault()
          const firstCol = visibleColumns[0]
          if (firstCol) {
            focusCell({ rowIndex: state.focusedCell.rowIndex, columnId: firstCol.id })
          }
        }
        break

      // End: Go to last cell in row
      case 'End':
        if (state.focusedCell && state.mode !== 'editing') {
          e.preventDefault()
          const lastCol = visibleColumns[visibleColumns.length - 1]
          if (lastCol) {
            focusCell({ rowIndex: state.focusedCell.rowIndex, columnId: lastCol.id })
          }
        }
        break

      // Page Up/Down: Jump multiple rows
      case 'PageUp':
        if (state.focusedCell && state.mode !== 'editing') {
          e.preventDefault()
          const newRow = Math.max(0, state.focusedCell.rowIndex - 10)
          focusCell({ ...state.focusedCell, rowIndex: newRow })
          scrollToRow?.(newRow)
        }
        break

      case 'PageDown':
        if (state.focusedCell && state.mode !== 'editing') {
          e.preventDefault()
          const newRow = Math.min(totalRows - 1, state.focusedCell.rowIndex + 10)
          focusCell({ ...state.focusedCell, rowIndex: newRow })
          scrollToRow?.(newRow)
        }
        break

      // Ctrl+Home: Go to first cell in table
      case 'Home':
        if ((e.metaKey || e.ctrlKey) && state.mode !== 'editing') {
          e.preventDefault()
          const firstCol = visibleColumns[0]
          if (firstCol) {
            focusCell({ rowIndex: 0, columnId: firstCol.id })
            scrollToRow?.(0)
          }
        }
        break

      // Ctrl+End: Go to last cell in table
      case 'End':
        if ((e.metaKey || e.ctrlKey) && state.mode !== 'editing') {
          e.preventDefault()
          const lastCol = visibleColumns[visibleColumns.length - 1]
          if (lastCol) {
            focusCell({ rowIndex: totalRows - 1, columnId: lastCol.id })
            scrollToRow?.(totalRows - 1)
          }
        }
        break
    }
  }, [
    state,
    columns,
    totalRows,
    visibleColumns,
    tableRef,
    focusCell,
    navigateCell,
    startEditing,
    cancelEditing,
    commitEdit,
    isEditable,
    getCellValue,
    onStartEdit,
    onCommitEdit,
    onRowSelect,
    onSelectAll,
    scrollToRow
  ])

  // Add event listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Focus tracking for visual indicators
  const isCellFocused = useCallback((rowIndex: number, columnId: string): boolean => {
    return state.focusedCell?.rowIndex === rowIndex &&
           state.focusedCell?.columnId === columnId
  }, [state.focusedCell])

  const isCellEditing = useCallback((rowIndex: number, columnId: string): boolean => {
    return state.editingCell?.rowIndex === rowIndex &&
           state.editingCell?.columnId === columnId
  }, [state.editingCell])

  const isRowFocused = useCallback((rowIndex: number): boolean => {
    return state.focusedCell?.rowIndex === rowIndex
  }, [state.focusedCell])

  // Manual focus setter for click handling
  const handleCellClick = useCallback((rowIndex: number, columnId: string, e?: React.MouseEvent) => {
    focusCell({ rowIndex, columnId })
  }, [focusCell])

  const handleCellDoubleClick = useCallback((rowIndex: number, columnId: string, value: string) => {
    const col = visibleColumns.find(c => c.id === columnId)
    if (col && isEditable(columnId)) {
      startEditing({ rowIndex, columnId }, value)
      onStartEdit?.({ rowIndex, columnId }, value)
    }
  }, [visibleColumns, isEditable, startEditing, onStartEdit])

  return {
    focusedCell: state.focusedCell,
    editingCell: state.editingCell,
    editValue: state.editValue,
    mode: state.mode,
    isCellFocused,
    isCellEditing,
    isRowFocused,
    handleCellClick,
    handleCellDoubleClick,
    focusCell,
    cancelEditing,
    commitEdit
  }
}

export default useSpreadsheetNavigation
