import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Bot,
  Send,
  X,
  Settings,
  Loader2,
  AlertCircle,
  Sparkles,
  MessageSquare,
  Trash2,
  Info,
  ChevronDown,
  Copy,
  Check,
  PanelLeftOpen,
  PanelLeftClose,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Search
} from 'lucide-react'
import { useAI, useAISuggestions, type TagRef } from '../../hooks/useAI'
import { useAIConfig, AI_MODELS, AI_PROVIDERS, type AIProvider } from '../../hooks/useAIConfig'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import { AIMessageContent } from './AIMessageContent'
import { AIConversationList } from './AIConversationList'

interface AISectionProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  // Tags pre-applied to NEW conversations created in this panel session.
  // Replaces the old `context` prop; opening AI from the AAPL page passes
  // `[{type:'asset', id:aapl_id}]` so new threads start tagged with AAPL.
  initialTags?: TagRef[]
  onOpenSettings?: () => void
}

export function AISection({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  initialTags = [],
  onOpenSettings
}: AISectionProps) {
  const {
    messages,
    tags,
    isConfigured,
    configMode,
    conversationId,
    sendMessage,
    clearConversation,
    isLoading,
    error,
    // Tag labels are still used for read-only display (e.g. "About: AAPL"
    // hint in the header) — but the user no longer adds or removes tags
    // directly. They're inferred from whatever page launched the panel.
    tagLabels,
    // Multi-conversation: list + actions
    conversations,
    isLoadingList,
    selectConversation,
    newConversation,
    renameConversation,
    archiveConversation,
    togglePin,
    deleteConversation,
  } = useAI(initialTags)

  const { effectiveConfig, updateUserPrefs } = useAIConfig()
  const suggestions = useAISuggestions(tags, tagLabels)

  const [input, setInput] = useState('')
  const [showModelSelector, setShowModelSelector] = useState(false)
  // Sidebar visibility — separate state for inline (fullscreen) vs screen
  // (compact). In fullscreen the sidebar lives alongside chat and the
  // toggle hides/shows it. In compact the AI pane is too narrow for both,
  // so the conversation list takes over the whole pane like a screen
  // switch — the user navigates back via the same toggle.
  const [showConversationList, setShowConversationList] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('ai-panel.show-conversations') !== '0'
  })
  useEffect(() => {
    try {
      localStorage.setItem('ai-panel.show-conversations', showConversationList ? '1' : '0')
    } catch { /* ignore */ }
  }, [showConversationList])

  // In compact (right-pane) mode the conversation list is its own screen.
  // When the user picks a conversation, snap back to chat automatically —
  // they almost always want to read it, not stare at the list.
  const [showListAsScreen, setShowListAsScreen] = useState(false)
  const isInlineSidebar = isFullscreen
  const handleSelectConversationFromList = (id: string) => {
    selectConversation(id)
    if (!isInlineSidebar) setShowListAsScreen(false)
  }
  const handleNewConversationFromList = () => {
    newConversation()
    if (!isInlineSidebar) setShowListAsScreen(false)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Current model — effectiveConfig already resolves: user pref →
  // org default → fallback (see useAIConfig).
  const currentProvider = (effectiveConfig.provider || 'anthropic') as AIProvider
  const currentModel = effectiveConfig.model || AI_MODELS[currentProvider]?.[0]?.id

  const currentModelInfo = AI_MODELS[currentProvider]?.find(m => m.id === currentModel)
  const currentProviderInfo = AI_PROVIDERS.find(p => p.id === currentProvider)

  // Per-user pref: any user can pick a model within the org's configured
  // provider. Cost still flows to the org's BYOK key. Disabled for
  // platform mode (the platform key choice is set globally).
  const canChangeModel = effectiveConfig.isConfigured && effectiveConfig.mode !== 'platform'

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModelChange = (model: string) => {
    if (!canChangeModel) return
    updateUserPrefs({ preferred_model: model })
    setShowModelSelector(false)
  }

  // initialTags is the only "incoming" signal now. The hook handles
  // auto-loading the most recent conversation that overlaps initialTags
  // — no parent-context-sync effect needed here.

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    sendMessage(input.trim())
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // When the AI mentions a $TICKER in its response, dispatch a CustomEvent
  // (same pattern as `open-shared-simulation` elsewhere). Any dashboard
  // listener can pick this up and open the asset tab. Until that listener
  // is wired, the pill renders but clicks are a no-op — visual win first,
  // navigation later.
  const handleTickerClick = (symbol: string) => {
    window.dispatchEvent(new CustomEvent('open-asset-by-symbol', { detail: { symbol } }))
  }

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  // Not configured state
  if (!isConfigured) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-purple-100 dark:from-primary-900/30 dark:to-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="h-8 w-8 text-primary-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              AI Assistant Not Configured
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Connect your AI provider to unlock intelligent analysis of your investment research.
            </p>

            <div className="space-y-2 text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Analyze your thesis for blind spots</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Generate outcome scenarios</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Summarize notes and discussions</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Answer research questions</span>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={onOpenSettings}
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure in Settings
            </Button>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              You'll need an API key from Anthropic, OpenAI, Google, or Perplexity. Typical usage costs $5-20/month.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Compact-mode "screen": when the user opens the conversation list and
  // we don't have room for the inline sidebar, render the list full-pane
  // and stop rendering the chat surface entirely. Done as an early return
  // so the chat tree (with its own scroll/focus state) doesn't stay
  // mounted under it.
  if (!isInlineSidebar && showListAsScreen) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <button
            onClick={() => setShowListAsScreen(false)}
            className="text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 inline-flex items-center gap-1.5 font-medium"
            title="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to chat
          </button>
          <span className="text-sm font-medium text-gray-900 dark:text-white">Conversations</span>
        </div>
        <div className="flex-1 min-h-0">
          <AIConversationList
            conversations={conversations}
            activeConversationId={conversationId}
            tagLabels={tagLabels}
            onSelect={handleSelectConversationFromList}
            onNewConversation={handleNewConversationFromList}
            onRename={renameConversation}
            onArchive={archiveConversation}
            onTogglePin={togglePin}
            onDelete={deleteConversation}
            isLoading={isLoadingList}
            fullWidth
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Inline sidebar — only shown in fullscreen, where there's room.
          Compact mode uses the screen-takeover branch above. */}
      {isInlineSidebar && showConversationList && (
        <AIConversationList
          conversations={conversations}
          activeConversationId={conversationId}
          tagLabels={tagLabels}
          onSelect={selectConversation}
          onNewConversation={newConversation}
          onRename={renameConversation}
          onArchive={archiveConversation}
          onTogglePin={togglePin}
          onDelete={deleteConversation}
          isLoading={isLoadingList}
        />
      )}

      {/* Main pane */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Minimal header — sidebar toggle only. The AI knows what page
          you're on; no need to spell it out in the chat surface. */}
      <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <button
          onClick={() => {
            if (isInlineSidebar) setShowConversationList(v => !v)
            else                 setShowListAsScreen(true)
          }}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          title={
            isInlineSidebar
              ? (showConversationList ? 'Hide conversations' : 'Show conversations')
              : 'Open conversations'
          }
        >
          {isInlineSidebar && showConversationList
            ? <PanelLeftClose className="h-4 w-4" />
            : <PanelLeftOpen  className="h-4 w-4" />}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-100 to-purple-100 dark:from-primary-900/30 dark:to-purple-900/30 rounded-full flex items-center justify-center mb-3">
              <Sparkles className="h-5 w-5 text-primary-500" />
            </div>
            {/* If the prior message failed and got popped, show the error
                here so the user knows what happened — otherwise it just
                looks like nothing happened. */}
            {error && (
              <div className="w-full max-w-sm mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-left">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700 dark:text-red-300">
                    <div className="font-medium">Couldn't get a response</div>
                    <div className="text-[11px] mt-0.5 opacity-80">
                      {error.message || 'Try again, or rephrase your question.'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* No header text — the suggestions themselves convey what
                this conversation can be about. Keeps the surface clean. */}
            <div className="space-y-2 w-full max-w-sm">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(suggestion)}
                  // Fixed height + 2-line clamp keeps every prompt button
                  // the same size whether the text is short ("Key risks?")
                  // or long ("Compare AAPL vs MSFT…"). Stops the layout
                  // jumping around when switching between asset tabs.
                  className="w-full h-[56px] flex items-center text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title={suggestion}
                >
                  <span className="line-clamp-2 leading-tight">{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <AIMessageBubble
                key={message.id}
                message={message}
                onTickerClick={handleTickerClick}
              />
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex justify-center">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 max-w-[85%]">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm text-red-700 dark:text-red-300">
                      {error.message || 'Something went wrong. Please try again.'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-end space-x-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:text-white"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="h-12 w-12 p-0 flex items-center justify-center"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Model selector and settings */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="relative" ref={modelSelectorRef}>
            <button
              onClick={() => canChangeModel && setShowModelSelector(!showModelSelector)}
              className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              disabled={!canChangeModel}
              title={
                !canChangeModel && effectiveConfig.mode === 'byok'
                  ? 'Model is set by your organization admin'
                  : undefined
              }
            >
              <div className={clsx(
                'w-3 h-3 rounded-sm bg-gradient-to-br',
                currentProviderInfo?.color || 'from-gray-400 to-gray-600'
              )} />
              <span className="font-medium">{currentModelInfo?.name || currentModel}</span>
              {canChangeModel && <ChevronDown className="h-3 w-3" />}
            </button>

            {/* Model Selector Dropdown */}
            {showModelSelector && canChangeModel && (
              <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
                {/* Only show models for the org's configured provider — if
                    Anthropic is the BYOK key, an Opus pick is fine but a
                    GPT-4o pick would 401. Today's schema supports one
                    provider per org; if/when we move to multi-provider
                    keys, expand this list to the org's enabled providers. */}
                {(() => {
                  const provider = AI_PROVIDERS.find(p => p.id === currentProvider)
                  if (!provider) return null
                  const models = AI_MODELS[provider.id] || []
                  return (
                    <div>
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-2">
                          <div className={clsx('w-4 h-4 rounded bg-gradient-to-br', provider.color)} />
                          <span className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</span>
                        </div>
                      </div>
                      <div className="py-1">
                        {models.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-400 italic">No models configured.</div>
                        ) : models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => handleModelChange(model.id)}
                            className={clsx(
                              'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                              currentModel === model.id && 'bg-primary-50 dark:bg-primary-900/20'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className={clsx(
                                'text-sm',
                                currentModel === model.id ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                              )}>
                                {model.name}
                              </span>
                              {model.recommended && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                                  Best
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{model.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
          <button
            onClick={onOpenSettings}
            className="hover:text-primary-600 dark:hover:text-primary-400 flex items-center space-x-1"
          >
            <Settings className="h-3 w-3" />
            <span>Settings</span>
          </button>
        </div>
      </div>
      </div> {/* main pane */}
    </div>
  )
}

// ─── Research trail (tool calls) ───────────────────────────────────────────
// Shows what the AI looked up while answering — collapsed by default so
// it doesn't clutter the bubble. Each tool call shows a friendly label
// + the input it used.
function ToolCallsFooter({
  toolCalls,
}: {
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result_summary?: string }>
}) {
  const [open, setOpen] = useState(false)

  const friendlyLabel = (name: string, input: Record<string, unknown>): string => {
    if (name === 'get_asset')         return `Looked up ${String(input.symbol || '').toUpperCase()}`
    if (name === 'search_assets')     return `Searched assets: "${String(input.query || '')}"`
    if (name === 'get_portfolio')     return `Pulled portfolio: ${String(input.name_or_id || '')}`
    if (name === 'get_theme')         return `Pulled theme: ${String(input.name_or_id || '')}`
    if (name === 'search_team_notes') return `Searched notes: "${String(input.query || '')}"`
    return name
  }

  return (
    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        title={open ? 'Hide research' : 'Show research'}
      >
        <Search className="w-3 h-3" />
        Research ({toolCalls.length})
        <ChevronRight className={clsx('w-3 h-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {toolCalls.map((tc, i) => (
            <li key={i} className="text-[11px] text-gray-700 dark:text-gray-300 pl-1 border-l-2 border-amber-300 dark:border-amber-700">
              <div className="font-medium">{friendlyLabel(tc.name, tc.input)}</div>
              {tc.result_summary && (
                <div className="text-gray-500 dark:text-gray-400 italic truncate" title={tc.result_summary}>
                  ↳ {tc.result_summary.slice(0, 140)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Citations footer ──────────────────────────────────────────────────────
// Shown beneath an assistant message that included Anthropic citations.
// Groups citations by document and shows the verbatim snippets the model
// drew from. Collapsed by default to keep messages compact.
function CitationsFooter({
  citations,
}: {
  citations: Array<{ document_title: string; cited_text: string }>
}) {
  const [open, setOpen] = useState(false)

  // Group snippets by document title — same doc cited multiple times
  // collapses into one entry with multiple snippets.
  const grouped = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of citations) {
      const list = m.get(c.document_title) || []
      list.push(c.cited_text)
      m.set(c.document_title, list)
    }
    return [...m.entries()]
  }, [citations])

  return (
    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        title={open ? 'Hide sources' : 'Show sources'}
      >
        <BookOpen className="w-3 h-3" />
        {grouped.length} source{grouped.length === 1 ? '' : 's'}
        <ChevronRight className={clsx('w-3 h-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {grouped.map(([title, snippets]) => (
            <li key={title} className="text-[11px]">
              <div className="font-semibold text-gray-700 dark:text-gray-300">{title}</div>
              <ul className="ml-3 space-y-0.5 mt-0.5">
                {snippets.map((s, i) => (
                  <li key={i} className="text-gray-600 dark:text-gray-400 italic border-l-2 border-gray-300 dark:border-gray-600 pl-2">
                    "{s.length > 200 ? s.slice(0, 200) + '…' : s}"
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Message bubble with copy + clickable $TICKERs + model badge ───────────
function AIMessageBubble({
  message,
  onTickerClick,
}: {
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
    model?: string | null
    citations?: Array<{ document_title: string; cited_text: string }>
    tool_calls?: Array<{ name: string; input: Record<string, unknown>; result_summary?: string }>
  }
  onTickerClick: (symbol: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const isAssistant = message.role === 'assistant'

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore clipboard errors (iframe / permission)
    }
  }

  // Look up the model's display name from the AI_MODELS catalog. Falls
  // back to the raw id if the model isn't in the catalog (e.g., legacy
  // model logged before the catalog was updated).
  const modelLabel = (() => {
    if (!message.model) return null
    for (const list of Object.values(AI_MODELS)) {
      const found = list.find(m => m.id === message.model)
      if (found) return found.name
    }
    return message.model
  })()

  return (
    <div className={clsx('flex group', isAssistant ? 'justify-start' : 'justify-end')}>
      <div
        className={clsx(
          'relative max-w-[85%] rounded-lg px-4 py-3',
          isAssistant
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
            : 'bg-primary-600 text-white'
        )}
      >
        {isAssistant ? (
          <AIMessageContent content={message.content} onTickerClick={onTickerClick} />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        )}

        {/* Research trail — tool calls the model made while answering.
            Shows the user "what did the AI go look up to give me this?". */}
        {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
          <ToolCallsFooter toolCalls={message.tool_calls} />
        )}

        {/* Sources footer — only assistant messages with citations.
            Shows which context documents the model drew from, with the
            specific text it cited. Group by document so the same doc
            cited 4 times collapses into one entry with multiple snippets. */}
        {isAssistant && message.citations && message.citations.length > 0 && (
          <CitationsFooter citations={message.citations} />
        )}

        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <p
              className={clsx(
                'text-[11px] shrink-0',
                isAssistant ? 'text-gray-500 dark:text-gray-400' : 'text-primary-200'
              )}
            >
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            {isAssistant && modelLabel && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 truncate"
                title={message.model || undefined}
              >
                {modelLabel}
              </span>
            )}
          </div>
          {isAssistant && (
            <button
              type="button"
              onClick={handleCopyMessage}
              className={clsx(
                'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded shrink-0',
                'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                'hover:bg-gray-200 dark:hover:bg-gray-700',
                'opacity-0 group-hover:opacity-100 transition-opacity'
              )}
              title="Copy response"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
