import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Zap, TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, Sparkles,
  Link, X, Hash, AtSign, Globe, Users, Lock, Send, Loader2, ChevronDown
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clsx } from 'clsx'

type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited' | null
type SourceType = 'news_article' | 'headline' | 'research' | 'earnings' | 'price_move' | 'social_media' | 'conversation' | 'idea' | 'general' | 'other'
type Visibility = 'private' | 'team' | 'public'

interface QuickThoughtCaptureProps {
  onSuccess?: () => void
  onCancel?: () => void
  initialContent?: string
  initialSourceUrl?: string
  initialSourceTitle?: string
  initialAssetId?: string
  compact?: boolean
  autoFocus?: boolean
  placeholder?: string
}

const sentimentOptions: { value: Sentiment; label: string; icon: typeof TrendingUp; color: string }[] = [
  { value: 'bullish', label: 'Bullish', icon: TrendingUp, color: 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100' },
  { value: 'bearish', label: 'Bearish', icon: TrendingDown, color: 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100' },
  { value: 'neutral', label: 'Neutral', icon: Minus, color: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
  { value: 'curious', label: 'Curious', icon: HelpCircle, color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
  { value: 'concerned', label: 'Concerned', icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { value: 'excited', label: 'Excited', icon: Sparkles, color: 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100' },
]

const sourceTypeOptions: { value: SourceType; label: string }[] = [
  { value: 'general', label: 'General thought' },
  { value: 'news_article', label: 'News article' },
  { value: 'headline', label: 'Headline' },
  { value: 'research', label: 'Research' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'price_move', label: 'Price move' },
  { value: 'social_media', label: 'Social media' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'idea', label: 'Investment idea' },
  { value: 'other', label: 'Other' },
]

const visibilityOptions: { value: Visibility; label: string; icon: typeof Lock; description: string }[] = [
  { value: 'private', label: 'Private', icon: Lock, description: 'Only you can see this' },
  { value: 'team', label: 'Team', icon: Users, description: 'Visible to your team' },
  { value: 'public', label: 'Public', icon: Globe, description: 'Visible to everyone' },
]

export function QuickThoughtCapture({
  onSuccess,
  onCancel,
  initialContent = '',
  initialSourceUrl = '',
  initialSourceTitle = '',
  initialAssetId,
  compact = false,
  autoFocus = false,
  placeholder = "What's on your mind? Capture a quick thought..."
}: QuickThoughtCaptureProps) {
  const [content, setContent] = useState(initialContent)
  const [sentiment, setSentiment] = useState<Sentiment>(null)
  const [sourceType, setSourceType] = useState<SourceType>('general')
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl)
  const [sourceTitle, setSourceTitle] = useState(initialSourceTitle)
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [content])

  const createThought = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('quick_thoughts')
        .insert({
          created_by: user.id,
          content: content.trim(),
          sentiment,
          source_type: sourceType,
          source_url: sourceUrl || null,
          source_title: sourceTitle || null,
          asset_id: initialAssetId || null,
          tags: tags.length > 0 ? tags : null,
          visibility,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
      setContent('')
      setSentiment(null)
      setSourceType('general')
      setSourceUrl('')
      setSourceTitle('')
      setTags([])
      setShowAdvanced(false)
      onSuccess?.()
    },
  })

  const handleSubmit = () => {
    if (!content.trim()) return
    createThought.mutate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  const currentVisibility = visibilityOptions.find(v => v.value === visibility)!

  return (
    <div className={clsx(
      "bg-white rounded-lg border border-gray-200 shadow-sm",
      compact ? "p-3" : "p-4"
    )}>
      {/* Main input */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={clsx(
            "w-full resize-none border-0 focus:ring-0 text-gray-900 placeholder-gray-400",
            compact ? "text-sm min-h-[60px]" : "text-base min-h-[80px]"
          )}
          rows={compact ? 2 : 3}
        />
      </div>

      {/* Sentiment buttons */}
      <div className="flex flex-wrap gap-1.5 mt-3 mb-3">
        {sentimentOptions.map((option) => {
          const Icon = option.icon
          const isSelected = sentiment === option.value
          return (
            <button
              key={option.value}
              onClick={() => setSentiment(isSelected ? null : option.value)}
              className={clsx(
                "flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border transition-all",
                isSelected ? option.color : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      {/* Advanced options toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-gray-500 hover:text-gray-700 flex items-center space-x-1 mb-3"
      >
        <ChevronDown className={clsx("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
        <span>{showAdvanced ? 'Hide options' : 'More options'}</span>
      </button>

      {/* Advanced options */}
      {showAdvanced && (
        <div className="space-y-3 mb-3 p-3 bg-gray-50 rounded-lg">
          {/* Source type */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Source Type</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {sourceTypeOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {/* Source URL */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              <Link className="h-3 w-3 inline mr-1" />
              Source URL (optional)
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Source Title */}
          {sourceUrl && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Source Title</label>
              <input
                type="text"
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="Article or headline title..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              <Hash className="h-3 w-3 inline mr-1" />
              Tags
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-700"
                >
                  #{tag}
                  <button onClick={() => removeTag(tag)} className="ml-1 hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex space-x-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="Add a tag..."
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={addTag}
                disabled={!tagInput.trim()}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer with visibility and submit */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        {/* Visibility selector */}
        <div className="relative">
          <button
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            className="flex items-center space-x-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
          >
            <currentVisibility.icon className="h-3.5 w-3.5" />
            <span>{currentVisibility.label}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showVisibilityMenu && (
            <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-10">
              {visibilityOptions.map(option => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      setVisibility(option.value)
                      setShowVisibilityMenu(false)
                    }}
                    className={clsx(
                      "w-full flex items-start space-x-2 px-3 py-2 text-left hover:bg-gray-50",
                      visibility === option.value && "bg-gray-50"
                    )}
                  >
                    <Icon className="h-4 w-4 text-gray-500 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{option.label}</div>
                      <div className="text-xs text-gray-500">{option.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || createThought.isPending}
            className={clsx(
              "flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
              content.trim()
                ? "bg-primary-600 text-white hover:bg-primary-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            {createThought.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>Capture</span>
          </button>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="text-[10px] text-gray-400 text-right mt-1">
        Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Cmd+Enter</kbd> to capture
      </div>
    </div>
  )
}
