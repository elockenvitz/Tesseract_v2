import React, { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Loader2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

interface AIPromptModalProps {
  isOpen: boolean
  onClose: () => void
  onGenerate: (prompt: string, content: string) => void
  assetContext?: { id: string; symbol: string } | null
}

export function AIPromptModal({
  isOpen,
  onClose,
  onGenerate,
  assetContext
}: AIPromptModalProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedContent, setGeneratedContent] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt('')
      setError(null)
      setGeneratedContent(null)
    }
  }, [isOpen])

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    setError(null)

    try {
      // Use the existing AI infrastructure
      const { supabase } = await import('../../lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
            context: assetContext ? {
              type: 'asset',
              id: assetContext.id,
              title: assetContext.symbol
            } : undefined
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate content')
      }

      const data = await response.json()
      setGeneratedContent(data.response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate content')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleInsert = () => {
    if (generatedContent) {
      onGenerate(prompt, generatedContent)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (generatedContent) {
        handleInsert()
      } else {
        handleGenerate()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center">
            <Sparkles className="w-5 h-5 text-purple-500 mr-2" />
            <h3 className="font-semibold text-gray-900">AI Generate</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Context indicator */}
          {assetContext && (
            <div className="flex items-center text-sm text-gray-500">
              <span>Context:</span>
              <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                {assetContext.symbol}
              </span>
            </div>
          )}

          {/* Prompt input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What would you like AI to write?
            </label>
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Write a brief summary of the investment thesis..."
              className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              rows={3}
              disabled={isGenerating}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Generated content preview */}
          {generatedContent && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Generated content:
              </label>
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-gray-700 max-h-48 overflow-y-auto">
                {generatedContent}
              </div>
            </div>
          )}

          {/* Quick prompts */}
          {!generatedContent && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Quick prompts:
              </label>
              <div className="flex flex-wrap gap-2">
                {getQuickPrompts(assetContext).map((quickPrompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPrompt(quickPrompt)}
                    className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                  >
                    {quickPrompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <span className="text-xs text-gray-500">
            {generatedContent ? '⌘+Enter to insert' : '⌘+Enter to generate'}
          </span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded transition-colors"
            >
              Cancel
            </button>
            {generatedContent ? (
              <>
                <button
                  type="button"
                  onClick={() => setGeneratedContent(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded transition-colors"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={handleInsert}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors"
                >
                  Insert
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className={clsx(
                  'flex items-center px-4 py-1.5 text-sm font-medium rounded transition-colors',
                  isGenerating || !prompt.trim()
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function getQuickPrompts(assetContext?: { id: string; symbol: string } | null): string[] {
  if (assetContext) {
    return [
      `Summarize the bull case for ${assetContext.symbol}`,
      `What are the key risks?`,
      `Compare to competitors`,
      `Recent developments`
    ]
  }
  return [
    'Summarize this content',
    'Expand on this point',
    'List key takeaways',
    'Add supporting details'
  ]
}
