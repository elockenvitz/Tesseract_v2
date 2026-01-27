/**
 * KeyboardHelpModal - Shows keyboard shortcuts for the table
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { X, Keyboard } from 'lucide-react'

interface KeyboardHelpModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ShortcutGroup {
  title: string
  shortcuts: { key: string; description: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: '↑ ↓ ← →', description: 'Move between cells' },
      { key: 'Tab', description: 'Move to next cell' },
      { key: 'Shift + Tab', description: 'Move to previous cell' },
      { key: 'Home', description: 'First cell in row' },
      { key: 'End', description: 'Last cell in row' },
      { key: 'Page Up/Down', description: 'Jump 10 rows' },
      { key: 'Ctrl/⌘ + Home', description: 'First cell in table' },
      { key: 'Ctrl/⌘ + End', description: 'Last cell in table' },
    ]
  },
  {
    title: 'Actions',
    shortcuts: [
      { key: 'Enter', description: 'Expand metric details' },
      { key: 'F2', description: 'Edit current cell' },
      { key: 'Escape', description: 'Close panel / Clear focus' },
      { key: 'Space', description: 'Toggle row selection' },
      { key: 'Ctrl/⌘ + A', description: 'Select all rows' },
    ]
  },
  {
    title: 'Quick Actions',
    shortcuts: [
      { key: 'P', description: 'Open priority picker' },
      { key: 'N', description: 'Edit note' },
      { key: 'E', description: 'Expand/collapse row' },
      { key: 'F', description: 'Cycle flag color' },
      { key: 'Ctrl/⌘ + I', description: 'Insert ticker above (lists)' },
    ]
  },
  {
    title: 'Mouse Shortcuts',
    shortcuts: [
      { key: 'Double-click', description: 'Sort column / Expand row' },
      { key: 'Right-click', description: 'Filter column / Row menu' },
      { key: 'Click', description: 'Focus cell' },
    ]
  },
]

export function KeyboardHelpModal({ isOpen, onClose }: KeyboardHelpModalProps) {
  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Keyboard className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
              <p className="text-sm text-gray-500">Navigate and interact with the table faster</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="grid grid-cols-2 gap-6">
            {SHORTCUT_GROUPS.map(group => (
              <div key={group.title}>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">{group.title}</h3>
                <div className="space-y-2">
                  {group.shortcuts.map(shortcut => (
                    <div key={shortcut.key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{shortcut.description}</span>
                      <kbd className="px-2 py-1 text-xs font-mono font-medium bg-gray-100 text-gray-700 rounded border border-gray-200 shadow-sm">
                        {shortcut.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-200 rounded">?</kbd> anytime to show this help
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default KeyboardHelpModal
