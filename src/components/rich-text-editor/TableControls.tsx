import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import {
  Plus, Trash2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  GripVertical, PanelTopClose, Merge, SplitSquareHorizontal
} from 'lucide-react'
import { clsx } from 'clsx'

interface TableControlsProps {
  editor: Editor
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

interface TableInfo {
  element: HTMLTableElement
  rows: number
  cols: number
  rect: DOMRect
}

export function TableControls({ editor }: TableControlsProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })
  const [activeTable, setActiveTable] = useState<TableInfo | null>(null)
  const [hoveredCol, setHoveredCol] = useState<number | null>(null)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const colTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const rowTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Delayed hover handlers to prevent flickering
  const handleColEnter = (index: number) => {
    if (colTimeoutRef.current) clearTimeout(colTimeoutRef.current)
    setHoveredCol(index)
  }

  const handleColLeave = () => {
    colTimeoutRef.current = setTimeout(() => setHoveredCol(null), 300)
  }

  const handleRowEnter = (index: number) => {
    if (rowTimeoutRef.current) clearTimeout(rowTimeoutRef.current)
    setHoveredRow(index)
  }

  const handleRowLeave = () => {
    rowTimeoutRef.current = setTimeout(() => setHoveredRow(null), 300)
  }

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (colTimeoutRef.current) clearTimeout(colTimeoutRef.current)
      if (rowTimeoutRef.current) clearTimeout(rowTimeoutRef.current)
    }
  }, [])

  // Track active table
  useEffect(() => {
    const updateActiveTable = () => {
      if (!editor.isActive('table')) {
        setActiveTable(null)
        return
      }

      const { view } = editor
      const { from } = editor.state.selection

      try {
        const domAtPos = view.domAtPos(from)
        let el = domAtPos.node as HTMLElement
        if (el.nodeType === Node.TEXT_NODE) el = el.parentElement as HTMLElement

        const table = el.closest('table') as HTMLTableElement
        if (table) {
          const rows = table.querySelectorAll('tr').length
          const firstRow = table.querySelector('tr')
          const cols = firstRow ? firstRow.querySelectorAll('th, td').length : 0
          setActiveTable({
            element: table,
            rows,
            cols,
            rect: table.getBoundingClientRect()
          })
        }
      } catch (e) {
        setActiveTable(null)
      }
    }

    editor.on('selectionUpdate', updateActiveTable)
    editor.on('update', updateActiveTable)

    // Also update on scroll/resize
    const handleScroll = () => {
      if (activeTable) {
        setActiveTable(prev => prev ? { ...prev, rect: prev.element.getBoundingClientRect() } : null)
      }
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)

    return () => {
      editor.off('selectionUpdate', updateActiveTable)
      editor.off('update', updateActiveTable)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [editor, activeTable])

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => ({ ...prev, visible: false }))
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle right-click on table
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (!editor.isActive('table')) return

      const target = e.target as HTMLElement
      const cell = target.closest('td, th')
      if (!cell) return

      e.preventDefault()
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
    }

    const editorDom = editor.view.dom
    editorDom.addEventListener('contextmenu', handleContextMenu)
    return () => editorDom.removeEventListener('contextmenu', handleContextMenu)
  }, [editor])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  const executeCommand = useCallback((command: () => void) => {
    command()
    closeContextMenu()
  }, [closeContextMenu])

  // Get column positions for controls
  const getColumnPositions = useCallback(() => {
    if (!activeTable) return []
    const firstRow = activeTable.element.querySelector('tr')
    if (!firstRow) return []

    const cells = firstRow.querySelectorAll('th, td')
    return Array.from(cells).map(cell => {
      const rect = cell.getBoundingClientRect()
      return { left: rect.left, width: rect.width, right: rect.right }
    })
  }, [activeTable])

  // Get row positions for controls
  const getRowPositions = useCallback(() => {
    if (!activeTable) return []
    const rows = activeTable.element.querySelectorAll('tr')
    return Array.from(rows).map(row => {
      const rect = row.getBoundingClientRect()
      return { top: rect.top, height: rect.height, bottom: rect.bottom }
    })
  }, [activeTable])

  const selectColumn = (colIndex: number) => {
    // Focus on a cell in this column to enable column operations
    if (!activeTable) return
    const firstRow = activeTable.element.querySelector('tr')
    if (!firstRow) return
    const cells = firstRow.querySelectorAll('th, td')
    const cell = cells[colIndex] as HTMLElement
    if (cell) {
      try {
        // Find the first text position inside the cell
        const pos = editor.view.posAtDOM(cell, 0)
        const $pos = editor.state.doc.resolve(pos)
        // Find the start of the cell content
        const cellStart = $pos.start($pos.depth)
        editor.chain().focus().setTextSelection(cellStart + 1).run()
      } catch (e) {
        // Fallback: just focus the editor
        editor.commands.focus()
      }
    }
  }

  const selectRow = (rowIndex: number) => {
    if (!activeTable) return
    const rows = activeTable.element.querySelectorAll('tr')
    const row = rows[rowIndex]
    if (!row) return
    const firstCell = row.querySelector('th, td') as HTMLElement
    if (firstCell) {
      try {
        // Find the first text position inside the cell
        const pos = editor.view.posAtDOM(firstCell, 0)
        const $pos = editor.state.doc.resolve(pos)
        // Find the start of the cell content
        const cellStart = $pos.start($pos.depth)
        editor.chain().focus().setTextSelection(cellStart + 1).run()
      } catch (e) {
        // Fallback: just focus the editor
        editor.commands.focus()
      }
    }
  }

  const MenuItem = ({
    onClick,
    icon: Icon,
    label,
    variant = 'default'
  }: {
    onClick: () => void
    icon: React.ElementType
    label: string
    variant?: 'default' | 'danger'
  }) => (
    <button
      onClick={() => executeCommand(onClick)}
      className={clsx(
        'flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm rounded transition-colors',
        variant === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-100'
      )}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{label}</span>
    </button>
  )

  const Divider = () => <div className="h-px bg-gray-200 my-1" />

  const columnPositions = getColumnPositions()
  const rowPositions = getRowPositions()

  return (
    <>
      {/* Column controls - fixed bar above table */}
      {activeTable && columnPositions.length > 0 && (
        <div
          ref={controlsRef}
          className="fixed z-40 flex"
          style={{
            left: `${activeTable.rect.left}px`,
            top: `${activeTable.rect.top - 24}px`,
          }}
        >
          {columnPositions.map((col, index) => (
            <div
              key={index}
              className="relative"
              style={{ width: `${col.width}px` }}
              onMouseEnter={() => handleColEnter(index)}
              onMouseLeave={handleColLeave}
            >
              {/* Column grip - always visible */}
              <div
                className={clsx(
                  "h-5 flex items-center justify-center cursor-pointer border-x border-t border-gray-300 first:rounded-tl last:rounded-tr transition-colors",
                  hoveredCol === index ? "bg-indigo-100 border-indigo-300" : "bg-gray-100 hover:bg-gray-200"
                )}
                onClick={() => selectColumn(index)}
              >
                <GripVertical className={clsx("w-3 h-3", hoveredCol === index ? "text-indigo-500" : "text-gray-400")} />
              </div>

              {/* Column action buttons - show on hover */}
              {hoveredCol === index && (
                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1 bg-white rounded-lg shadow-lg border border-gray-200 p-1 z-50"
                  onMouseEnter={() => handleColEnter(index)}
                  onMouseLeave={handleColLeave}
                >
                  <button
                    onClick={() => { selectColumn(index); editor.chain().focus().addColumnBefore().run() }}
                    className="p-1.5 hover:bg-indigo-50 rounded transition-colors"
                    title="Add column left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                  <button
                    onClick={() => { selectColumn(index); editor.chain().focus().deleteColumn().run() }}
                    className="p-1.5 hover:bg-red-50 rounded transition-colors"
                    title="Delete column"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                  <button
                    onClick={() => { selectColumn(index); editor.chain().focus().addColumnAfter().run() }}
                    className="p-1.5 hover:bg-indigo-50 rounded transition-colors"
                    title="Add column right"
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Row controls - fixed bar to left of table */}
      {activeTable && rowPositions.length > 0 && (
        <div
          className="fixed z-40 flex flex-col"
          style={{
            left: `${activeTable.rect.left - 24}px`,
            top: `${activeTable.rect.top}px`,
          }}
        >
          {rowPositions.map((row, index) => (
            <div
              key={index}
              className="relative"
              style={{ height: `${row.height}px` }}
              onMouseEnter={() => handleRowEnter(index)}
              onMouseLeave={handleRowLeave}
            >
              {/* Row grip - always visible */}
              <div
                className={clsx(
                  "w-5 h-full flex items-center justify-center cursor-pointer border-y border-l border-gray-300 first:rounded-tl last:rounded-bl transition-colors",
                  hoveredRow === index ? "bg-indigo-100 border-indigo-300" : "bg-gray-100 hover:bg-gray-200"
                )}
                onClick={() => selectRow(index)}
              >
                <GripVertical className={clsx("w-3 h-3 rotate-90", hoveredRow === index ? "text-indigo-500" : "text-gray-400")} />
              </div>

              {/* Row action buttons - show on hover */}
              {hoveredRow === index && (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-1 flex flex-col items-center gap-1 bg-white rounded-lg shadow-lg border border-gray-200 p-1 z-50"
                  onMouseEnter={() => handleRowEnter(index)}
                  onMouseLeave={handleRowLeave}
                >
                  <button
                    onClick={() => { selectRow(index); editor.chain().focus().addRowBefore().run() }}
                    className="p-1.5 hover:bg-indigo-50 rounded transition-colors"
                    title="Add row above"
                  >
                    <ArrowUp className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                  <button
                    onClick={() => { selectRow(index); editor.chain().focus().deleteRow().run() }}
                    className="p-1.5 hover:bg-red-50 rounded transition-colors"
                    title="Delete row"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                  <button
                    onClick={() => { selectRow(index); editor.chain().focus().addRowAfter().run() }}
                    className="p-1.5 hover:bg-indigo-50 rounded transition-colors"
                    title="Add row below"
                  >
                    <ArrowDown className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add column button at the end */}
      {activeTable && columnPositions.length > 0 && (
        <button
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          className="fixed z-40 w-5 flex items-center justify-center bg-gray-50 border border-gray-300 border-l-0 rounded-r hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
          style={{
            left: `${activeTable.rect.right}px`,
            top: `${activeTable.rect.top - 24}px`,
            height: `${activeTable.rect.height + 24}px`,
          }}
          title="Add column"
        >
          <Plus className="w-3 h-3 text-gray-500" />
        </button>
      )}

      {/* Add row button at the bottom */}
      {activeTable && rowPositions.length > 0 && (
        <button
          onClick={() => editor.chain().focus().addRowAfter().run()}
          className="fixed z-40 h-5 flex items-center justify-center bg-gray-50 border border-gray-300 border-t-0 rounded-b hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
          style={{
            left: `${activeTable.rect.left - 24}px`,
            top: `${activeTable.rect.bottom}px`,
            width: `${activeTable.rect.width + 24}px`,
          }}
          title="Add row"
        >
          <Plus className="w-3 h-3 text-gray-500" />
        </button>
      )}

      {/* Right-click context menu */}
      {contextMenu.visible && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
        >
          <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Column
          </div>
          <MenuItem
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            icon={ArrowLeft}
            label="Insert left"
          />
          <MenuItem
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            icon={ArrowRight}
            label="Insert right"
          />
          <MenuItem
            onClick={() => editor.chain().focus().deleteColumn().run()}
            icon={Trash2}
            label="Delete column"
            variant="danger"
          />

          <Divider />

          <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Row
          </div>
          <MenuItem
            onClick={() => editor.chain().focus().addRowBefore().run()}
            icon={ArrowUp}
            label="Insert above"
          />
          <MenuItem
            onClick={() => editor.chain().focus().addRowAfter().run()}
            icon={ArrowDown}
            label="Insert below"
          />
          <MenuItem
            onClick={() => editor.chain().focus().deleteRow().run()}
            icon={Trash2}
            label="Delete row"
            variant="danger"
          />

          <Divider />

          <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Cell
          </div>
          <MenuItem
            onClick={() => editor.chain().focus().mergeCells().run()}
            icon={Merge}
            label="Merge cells"
          />
          <MenuItem
            onClick={() => editor.chain().focus().splitCell().run()}
            icon={SplitSquareHorizontal}
            label="Split cell"
          />

          <Divider />

          <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Table
          </div>
          <MenuItem
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            icon={PanelTopClose}
            label="Toggle header"
          />
          <MenuItem
            onClick={() => editor.chain().focus().deleteTable().run()}
            icon={Trash2}
            label="Delete table"
            variant="danger"
          />
        </div>
      )}
    </>
  )
}
