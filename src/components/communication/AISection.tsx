import { useState, useRef, useEffect } from 'react'
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
  ChevronDown
} from 'lucide-react'
import { useAI, useAISuggestions, type AIContext } from '../../hooks/useAI'
import { useAIConfig, AI_MODELS, AI_PROVIDERS, type AIProvider } from '../../hooks/useAIConfig'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import ReactMarkdown from 'react-markdown'

interface AISectionProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  context?: AIContext
  onOpenSettings?: () => void
}

export function AISection({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  context,
  onOpenSettings
}: AISectionProps) {
  const {
    messages,
    context: activeContext,
    isConfigured,
    configMode,
    sendMessage,
    clearConversation,
    updateContext,
    clearContext,
    isLoading,
    error,
  } = useAI(context)

  const { effectiveConfig, userConfig, updateConfig } = useAIConfig()
  const suggestions = useAISuggestions(activeContext)

  const [input, setInput] = useState('')
  const [showModelSelector, setShowModelSelector] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Current model from user config or default
  const currentProvider = (userConfig?.byok_provider || effectiveConfig.provider || 'anthropic') as AIProvider
  const currentModel = userConfig?.byok_model || effectiveConfig.model || AI_MODELS[currentProvider]?.[0]?.id

  // Get the display name for current model
  const currentModelInfo = AI_MODELS[currentProvider]?.find(m => m.id === currentModel)
  const currentProviderInfo = AI_PROVIDERS.find(p => p.id === currentProvider)

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
    updateConfig({ byok_model: model })
    setShowModelSelector(false)
  }

  // Update context when prop changes
  useEffect(() => {
    if (context && (context.type !== activeContext.type || context.id !== activeContext.id)) {
      updateContext(context)
    }
  }, [context, activeContext, updateContext])

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

  return (
    <div className="flex flex-col h-full">
      {/* Context Bar */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {activeContext.type ? (
              <>
                <MessageSquare className="h-4 w-4 text-primary-500" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Context: {activeContext.title || `${activeContext.type} ${activeContext.id?.slice(0, 8)}`}
                </span>
              </>
            ) : (
              <>
                <Bot className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  General Chat
                </span>
              </>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {activeContext.type && (
              <button
                onClick={clearContext}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 flex items-center"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </button>
            )}
            {messages.length > 0 && (
              <button
                onClick={clearConversation}
                className="text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 flex items-center"
                title="Clear conversation"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-100 to-purple-100 dark:from-primary-900/30 dark:to-purple-900/30 rounded-full flex items-center justify-center mb-3">
              <Sparkles className="h-6 w-6 text-primary-500" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {activeContext.type
                ? `Ask me anything about this ${activeContext.type}`
                : 'How can I help with your research?'}
            </p>

            {/* Suggestions */}
            <div className="space-y-2 w-full max-w-xs">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={clsx(
                  'flex',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={clsx(
                    'max-w-[85%] rounded-lg px-4 py-3',
                    message.role === 'user'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  )}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                  <p className={clsx(
                    'text-xs mt-2',
                    message.role === 'user' ? 'text-primary-200' : 'text-gray-500 dark:text-gray-400'
                  )}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
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
              placeholder={activeContext.type ? `Ask about ${activeContext.title || 'this ' + activeContext.type}...` : 'Ask anything...'}
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
              onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              disabled={configMode === 'platform'}
            >
              <div className={clsx(
                'w-3 h-3 rounded-sm bg-gradient-to-br',
                currentProviderInfo?.color || 'from-gray-400 to-gray-600'
              )} />
              <span className="font-medium">{currentModelInfo?.name || currentModel}</span>
              {configMode !== 'platform' && <ChevronDown className="h-3 w-3" />}
            </button>

            {/* Model Selector Dropdown */}
            {showModelSelector && configMode !== 'platform' && (
              <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
                {AI_PROVIDERS.map((provider) => (
                  <div key={provider.id}>
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex items-center space-x-2">
                        <div className={clsx('w-4 h-4 rounded bg-gradient-to-br', provider.color)} />
                        <span className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</span>
                        {provider.recommended && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                            Recommended
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="py-1">
                      {AI_MODELS[provider.id]?.map((model) => (
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
                ))}
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
    </div>
  )
}
