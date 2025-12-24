/**
 * KeyboardShortcutsHelp - Modal displaying keyboard shortcuts for the table
 *
 * Triggered by pressing '?' key
 * Shows all available keyboard shortcuts organized by category
 */

import React, { useEffect, useRef } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useTableContext } from '../../contexts/TableContext'

interface ShortcutCategory {
  title: string
  shortcuts: Array<{
    keys: string[]
    description: string
  }>
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Arrow Keys'], description: 'Move between cells' },
      { keys: ['Tab'], description: 'Move to next cell' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous cell' },
      { keys: ['Home'], description: 'Go to first cell in row' },
      { keys: ['End'], description: 'Go to last cell in row' },
      { keys: ['Ctrl', 'Home'], description: 'Go to first cell in table' },
      { keys: ['Ctrl', 'End'], description: 'Go to last cell in table' },
      { keys: ['Page Up'], description: 'Jump 10 rows up' },
      { keys: ['Page Down'], description: 'Jump 10 rows down' }
    ]
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Enter'], description: 'Edit cell / Confirm edit' },
      { keys: ['F2'], description: 'Start editing current cell' },
      { keys: ['Escape'], description: 'Cancel edit / Clear focus' }
    ]
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Space'], description: 'Toggle row selection' },
      { keys: ['Ctrl', 'A'], description: 'Select all visible rows' },
      { keys: ['Escape'], description: 'Clear selection' }
    ]
  },
  {
    title: 'View Controls',
    shortcuts: [
      { keys: ['D'], description: 'Cycle density mode' },
      { keys: ['Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['?'], description: 'Show this help' },
      { keys: ['1-9'], description: 'Switch to saved view N' }
    ]
  }
]

interface KeyboardShortcutsHelpProps {
  onClose?: () => void
}

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  const { state, toggleKeyboardHelp } = useTableContext()
  const modalRef = useRef<HTMLDivElement>(null)

  const handleClose = () => {
    onClose?.()
    toggleKeyboardHelp()
  }

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }

    if (state.showKeyboardHelp) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [state.showKeyboardHelp])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    if (state.showKeyboardHelp) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [state.showKeyboardHelp])

  if (!state.showKeyboardHelp) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={modalRef}
        className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Navigate and edit like a spreadsheet</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SHORTCUT_CATEGORIES.map((category) => (
              <div key={category.title}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  {category.title}
                </h3>
                <div className="space-y-2">
                  {category.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <React.Fragment key={keyIndex}>
                            {keyIndex > 0 && (
                              <span className="text-xs text-gray-400">+</span>
                            )}
                            <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm">
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  )
}

export default KeyboardShortcutsHelp
