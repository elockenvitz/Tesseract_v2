/**
 * QuickPromptInput - Inline quick prompt input with history
 *
 * Allows users to run one-off AI prompts without saving to library
 */

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Clock, Send, Loader2, ChevronRight, Save, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuickPromptHistory } from '../../hooks/useAIColumns'

interface QuickPromptInputProps {
  position: { x: number; y: number }
  onClose: () => void
  onRun: (prompt: string) => void
  onSaveToLibrary?: (prompt: string) => void
  isRunning?: boolean
}

export function QuickPromptInput({
  position,
  onClose,
  onRun,
  onSaveToLibrary,
  isRunning = false,
}: QuickPromptInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(true)
  const { history, isLoading: loadingHistory, addPrompt, deletePrompt } = useQuickPromptHistory()

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on outside click (with delay to prevent immediate close)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Add small delay to prevent immediate close from the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 100)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!prompt.trim() || isRunning) return

    addPrompt(prompt.trim())
    onRun(prompt.trim())
  }

  const handleUseHistoryPrompt = (historyPrompt: string) => {
    setPrompt(historyPrompt)
    setShowHistory(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Adjust position to keep in viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 380),
    y: Math.min(position.y, window.innerHeight - 400),
  }

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 w-96 animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <h3 className="text-sm font-medium text-gray-900">Quick AI Prompt</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      {/* Input */}
      <div className="p-3">
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setShowHistory(false) }}
              onFocus={() => !prompt && setShowHistory(true)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about these assets..."
              rows={3}
              className="w-full px-3 py-2.5 pr-12 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none text-sm"
              disabled={isRunning}
            />
            <button
              type="submit"
              disabled={!prompt.trim() || isRunning}
              className={clsx(
                'absolute right-2 bottom-2 p-2 rounded-lg transition-colors',
                prompt.trim() && !isRunning
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-1.5 px-1">
            Press Enter to run, Shift+Enter for new line
          </p>
        </form>
      </div>

      {/* History */}
      {showHistory && !prompt && history.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="px-4 py-2 flex items-center gap-1.5 text-xs text-gray-400">
            <Clock className="h-3 w-3" />
            Recent prompts
          </div>
          <div className="max-h-48 overflow-y-auto">
            {history.slice(0, 5).map(item => (
              <div
                key={item.id}
                className="group flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
              >
                <button
                  onClick={() => handleUseHistoryPrompt(item.prompt)}
                  className="flex-1 text-left text-sm text-gray-700 truncate"
                >
                  {item.prompt}
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deletePrompt(item.id)
                    }}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Remove from history"
                  >
                    <Trash2 className="h-3 w-3 text-gray-400" />
                  </button>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading History */}
      {showHistory && !prompt && loadingHistory && (
        <div className="border-t border-gray-100 py-4 text-center text-sm text-gray-500">
          Loading history...
        </div>
      )}

      {/* Footer with Save option */}
      {prompt && !isRunning && onSaveToLibrary && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onSaveToLibrary(prompt)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200"
          >
            <Save className="h-4 w-4" />
            Save to Library
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

export default QuickPromptInput
