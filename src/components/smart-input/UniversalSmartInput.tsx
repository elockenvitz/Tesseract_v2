import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { clsx } from 'clsx'
import { Loader2, Sparkles, AlertCircle, FileText, BarChart3, TrendingUp, LineChart, Activity, Lock, Users, Building2, type LucideIcon } from 'lucide-react'
import { useSmartInput } from '../../hooks/useSmartInput'
import { SmartInputDropdown } from './SmartInputDropdown'
import { MentionSuggestions } from './MentionSuggestions'
import { HashtagSuggestions } from './HashtagSuggestions'
import { TemplateSuggestions } from './TemplateSuggestions'
import { DataFunctionPicker } from './DataFunctionPicker'
import { VisibilityPicker } from './VisibilityPicker'
import { SmartInputMetadata, DataFunctionType, VisibilityType, AI_MODELS } from './types'
import { useAuth } from '../../hooks/useAuth'

// ---------------------------------------------------------------------------
// HTML → plain text with formatting (for paste from rich sources)
// ---------------------------------------------------------------------------

function htmlToMarkdownText(node: Node, listPrefix = ''): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\r/g, '')
  }

  const el = node as HTMLElement
  const tag = el.tagName?.toLowerCase()
  const children = Array.from(el.childNodes)
  const inner = (prefix = '') => children.map(c => htmlToMarkdownText(c, prefix)).join('')

  switch (tag) {
    case 'br': return '\n'
    case 'p':
    case 'div': {
      const t = inner(listPrefix).trim()
      return t ? t + '\n' : ''
    }
    case 'h1': case 'h2': case 'h3': case 'h4':
      return inner().trim() + '\n'
    case 'ul':
      return children
        .filter(c => (c as HTMLElement).tagName?.toLowerCase() === 'li')
        .map(c => htmlToMarkdownText(c, '- ')).join('')
    case 'ol':
      return children
        .filter(c => (c as HTMLElement).tagName?.toLowerCase() === 'li')
        .map((c, i) => htmlToMarkdownText(c, `${i + 1}. `)).join('')
    case 'li':
      return listPrefix + inner().replace(/\n+$/, '').trim() + '\n'
    case 'strong': case 'b': return '**' + inner().trim() + '**'
    case 'em': case 'i': return '*' + inner().trim() + '*'
    case 'a': return inner().trim()
    case 'style': case 'script': return ''
    default: return inner(listPrefix)
  }
}

function cleanPastedText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')  // collapse 3+ newlines to 2
    .replace(/^\n+/, '')          // trim leading newlines
    .replace(/\n+$/, '')          // trim trailing newlines
}

export interface UniversalSmartInputProps {
  value: string
  onChange: (value: string, metadata: SmartInputMetadata) => void
  placeholder?: string
  className?: string
  textareaClassName?: string
  disabled?: boolean
  rows?: number
  minHeight?: string

  // Feature toggles
  enableMentions?: boolean
  enableHashtags?: boolean
  enableTemplates?: boolean
  enableDataFunctions?: boolean
  enableAI?: boolean

  // Context
  assetContext?: { id: string; symbol: string } | null

  // Callbacks
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  // Called when .AI is triggered - parent can open AI pane instead of modal
  onOpenAIPane?: (insertCallback: (prompt: string, summary: string, fullContent: string) => void) => void
}

export interface UniversalSmartInputRef {
  focus: () => void
  blur: () => void
  getValue: () => string
  getMetadata: () => SmartInputMetadata
  getTextarea: () => HTMLTextAreaElement | null
  insertText: (text: string) => void
  insertAISummary: (prompt: string, summary: string) => void
}

export const UniversalSmartInput = forwardRef<UniversalSmartInputRef, UniversalSmartInputProps>(
  function UniversalSmartInput(
    {
      value: externalValue,
      onChange,
      placeholder = 'Start typing... Use @ to mention, # to reference, . for commands',
      className,
      textareaClassName,
      disabled = false,
      rows = 4,
      minHeight = '120px',
      enableMentions = true,
      enableHashtags = true,
      enableTemplates = true,
      enableDataFunctions = true,
      enableAI = true,
      assetContext,
      onFocus,
      onBlur,
      onKeyDown: externalKeyDown,
      onOpenAIPane
    },
    ref
  ) {
    const { user } = useAuth()
    const [isFocused, setIsFocused] = React.useState(false)

    const {
      value,
      setValue,
      activeDropdown,
      dropdownQuery,
      dropdownPosition,
      selectedIndex,
      // AI Prompt Mode
      isAIPromptMode,
      aiPromptText,
      selectedAIModel,
      isAILoading,
      aiError,
      selectAIModel,
      // Template Fill Mode
      isTemplateFillMode,
      currentPlaceholderName,
      userSuggestions,
      entitySuggestions,
      assetSuggestions,
      templateSuggestions,
      isLoadingSuggestions,
      symbolModeCommand,
      symbolSearchQuery,
      symbolAssetResults,
      isLoadingSymbolAssets,
      selectSymbolAsset,
      handleChange,
      handleKeyDown: internalKeyDown,
      selectMention,
      selectReference,
      selectCashtag,
      selectTemplate,
      insertDataValue,
      insertAIContent,
      insertVisibilityMarker,
      submitAIPrompt,
      cancelAIPrompt,
      closeDropdown,
      setSelectedIndex,
      textareaRef,
      metadata
    } = useSmartInput({
      initialValue: externalValue,
      enableMentions,
      enableHashtags,
      enableTemplates,
      enableDataFunctions,
      enableAI,
      assetContext
    })

    const valueRef = useRef(value)
    valueRef.current = value

    // Sync external value changes (e.g., parent clears the input after send).
    React.useEffect(() => {
      if (externalValue !== valueRef.current) {
        setValue(externalValue)
      }
    }, [externalValue])

    // Notify parent of changes
    React.useEffect(() => {
      if (value !== externalValue) {
        onChange(value, metadata)
      }
    }, [value, metadata])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
      getValue: () => value,
      getMetadata: () => metadata,
      getTextarea: () => textareaRef.current,
      insertText: (text: string) => {
        if (!textareaRef.current) return
        const textarea = textareaRef.current
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newValue = value.substring(0, start) + text + value.substring(end)
        const newCursorPos = start + text.length

        // Call handleChange with the new value to trigger dropdown detection
        handleChange({
          target: {
            value: newValue,
            selectionStart: newCursorPos,
            selectionEnd: newCursorPos
          }
        } as React.ChangeEvent<HTMLTextAreaElement>)

        // Focus textarea after state updates
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
          }
        }, 0)
      },
      insertAISummary: (prompt: string, summary: string) => {
        insertAIContent(prompt, summary)
      }
    }))

    // Combined key down handler — skip external if internal already handled the event
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      internalKeyDown(e)
      if (!e.defaultPrevented) {
        externalKeyDown?.(e)
      }
    }

    // Handle data function selection
    const handleDataSelect = (dataType: DataFunctionType, mode: 'snapshot' | 'live', dataValue?: string) => {
      insertDataValue(dataType, mode, dataValue)
      closeDropdown()
    }

    // Handle visibility selection
    const handleVisibilitySelect = (type: VisibilityType, targetId?: string, targetName?: string) => {
      if (!user?.id) return
      insertVisibilityMarker(type, user.id, targetId, targetName)
      closeDropdown()
    }

    // Render styled content overlay. The textarea text is transparent so this
    // overlay is what the user sees. For embed tokens we render actual badges
    // instead of the raw bracket syntax.
    const renderStyledContent = (text: string) => {
      // Match cashtags, mentions, hashtags, embeds, bold, italic
      const pattern = /(\$[A-Z0-9.]+)|(@[A-Z][a-zA-Z0-9]*)|(#[A-Z][a-zA-Z0-9]*)|(\.chart\[(\w+):([A-Z0-9.]+)\])|(\.data\[(\w+):(?:snapshot|live):([^\]]+)\])|(\*\*(.+?)\*\*)|(\*(.+?)\*)/g
      const parts: React.ReactNode[] = []
      let lastIndex = 0
      let match

      while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<span key={`t-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>)
        }
        const i = match.index
        if (match[1]) {
          parts.push(<span key={`c-${i}`} className="text-green-600 font-medium">{match[1]}</span>)
        } else if (match[2]) {
          parts.push(<span key={`m-${i}`} className="text-blue-600 font-medium">{match[2]}</span>)
        } else if (match[3]) {
          parts.push(<span key={`h-${i}`} className="text-yellow-600 font-medium">{match[3]}</span>)
        } else if (match[4]) {
          parts.push(<span key={`ch-${i}`} className="bg-cyan-100 text-cyan-800 rounded-sm">{match[4]}</span>)
        } else if (match[7]) {
          parts.push(<span key={`d-${i}`} className="bg-emerald-100 text-emerald-800 rounded-sm">{match[7]}</span>)
        } else if (match[10]) {
          parts.push(<strong key={`b-${i}`}>{match[11]}</strong>)
        } else if (match[12]) {
          parts.push(<em key={`i-${i}`}>{match[13]}</em>)
        }
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) parts.push(<span key="end">{text.substring(lastIndex)}</span>)
      return parts.length > 0 ? parts : <span>{text}</span>
    }

    // Show overlay when content has any styled elements (cashtags, mentions, bold, italic, etc.)
    const hasStyledContent = /(\$[A-Z0-9.]+)|(@[A-Z][a-zA-Z0-9]*)|(#[A-Z][a-zA-Z0-9]*)|(\.chart\[)|(\.data\[)|(\*\*.+?\*\*)|(\*.+?\*)/.test(value)


    return (
      <div className={clsx('relative cursor-text', className)}>
        {/* AI Prompt Mode Indicator */}
        {isAIPromptMode && (
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 bg-purple-50 border-b border-purple-200 rounded-t-lg z-10">
            <div className="flex items-center gap-2 text-sm text-purple-700">
              <Sparkles className="w-4 h-4" />
              <span className="font-medium">AI Prompt Mode</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-purple-600">
              {isAILoading ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating...
                </span>
              ) : (
                <>
                  <span className="px-1.5 py-0.5 bg-purple-100 rounded">Enter</span> to submit
                  <span className="px-1.5 py-0.5 bg-purple-100 rounded">Esc</span> to cancel
                </>
              )}
            </div>
          </div>
        )}

        {/* AI Error Message */}
        {aiError && (
          <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 py-2 bg-red-50 border-b border-red-200 rounded-t-lg z-20">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-700">{aiError}</span>
          </div>
        )}

        {/* Template Fill Mode Indicator */}
        {isTemplateFillMode && !isAIPromptMode && (
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 bg-blue-50 border-b border-blue-200 rounded-t-lg z-10">
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <FileText className="w-4 h-4" />
              <span className="font-medium">
                Fill in: <span className="text-blue-900">{currentPlaceholderName || 'placeholder'}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <span className="px-1.5 py-0.5 bg-blue-100 rounded">Tab</span> next field
              <span className="px-1.5 py-0.5 bg-blue-100 rounded">Esc</span> to exit
            </div>
          </div>
        )}

        {/* Textarea Container with Highlight Overlay */}
        <div className="relative">
          {/* Smart Input Overlay - shows styled mentions, cashtags, hashtags, embeds */}
          {!isAIPromptMode && hasStyledContent && !isFocused && (
            <div
              className={clsx(
                'absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-gray-900 leading-relaxed',
                textareaClassName || 'p-3',
              )}
              style={{
                minHeight,
                paddingTop: isTemplateFillMode ? '48px' : undefined,
              }}
              aria-hidden="true"
            >
              {renderStyledContent(value)}
            </div>
          )}

          {/* Highlight Overlay - shows purple text for AI prompt portion only */}
          {isAIPromptMode && (
            <div
              className="absolute inset-0 p-3 pointer-events-none overflow-hidden whitespace-pre-wrap break-words"
              style={{
                minHeight,
                paddingTop: '48px', // Match pt-12 when in AI mode
                fontFamily: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
              }}
              aria-hidden="true"
            >
              {/* Render text with purple highlighting for the .AI prompt portion */}
              {(() => {
                // Find the .AI pattern and split the text
                const match = value.match(/^(.*?)(\.[aA][iI]\s+)(.*)$/s)
                if (!match) {
                  // No .AI pattern found, show all text normally
                  return <span className="text-gray-900">{value}</span>
                }

                const [, before, trigger, after] = match
                return (
                  <>
                    {/* Text before .AI - normal color */}
                    <span className="text-gray-900">{before}</span>
                    {/* The .AI trigger - purple */}
                    <span className="text-purple-600 font-medium">{trigger}</span>
                    {/* The prompt after .AI - purple with background */}
                    <span className="text-purple-600 bg-purple-100/70 rounded px-0.5">{after}</span>
                  </>
                )
              })()}
            </div>
          )}

          {/* Textarea — pad blank lines with zero-width space for caret visibility */}
          <textarea
            ref={textareaRef}
            value={value.replace(/\n\n/g, '\n\u00A0\n')}
            onChange={(e) => {
              // Strip NBSP placeholders before updating state
              const cleaned = { ...e, target: { ...e.target, value: e.target.value.replace(/\u00A0/g, ''), selectionStart: e.target.selectionStart } } as any
              handleChange(cleaned)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              // Intercept Backspace on blank lines — delete the line instead of just the NBSP
              if (e.key === 'Backspace') {
                const el = e.currentTarget
                const pos = el.selectionStart
                const displayVal = el.value
                // Find current line boundaries
                const lineStart = displayVal.lastIndexOf('\n', pos - 1) + 1
                const lineContent = displayVal.slice(lineStart, pos)
                // If current line is just NBSP (blank line placeholder), delete the whole blank line
                if (lineContent === '\u00A0' || lineContent === '') {
                  // Check if we're not at the very start
                  if (lineStart > 0) {
                    e.preventDefault()
                    // Remove one newline from the real value
                    // Map display position back to real value position
                    const beforeInReal = displayVal.slice(0, lineStart).replace(/\u00A0/g, '')
                    const afterInReal = displayVal.slice(lineStart).replace(/\u00A0/g, '')
                    // beforeInReal ends with \n, remove it
                    const newValue = beforeInReal.slice(0, -1) + afterInReal
                    const newPos = beforeInReal.length - 1
                    handleChange({ target: { value: newValue, selectionStart: newPos } } as any)
                    setTimeout(() => {
                      el.selectionStart = el.selectionEnd = newPos
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }, 0)
                    return
                  }
                }
              }
              handleKeyDown(e)
            }}
            onFocus={(e) => {
              setIsFocused(true)
              onFocus?.()
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onBlur={(e) => { setIsFocused(false); onBlur?.() }}
            onPaste={(e) => {
              const html = e.clipboardData.getData('text/html')
              if (html) {
                e.preventDefault()
                const doc = new DOMParser().parseFromString(html, 'text/html')
                const converted = cleanPastedText(htmlToMarkdownText(doc.body))
                const textarea = e.currentTarget
                const start = textarea.selectionStart
                const end = textarea.selectionEnd
                const newValue = value.slice(0, start) + converted + value.slice(end)
                handleChange({ target: { value: newValue, selectionStart: start + converted.length } } as any)
                setTimeout(() => {
                  textarea.selectionStart = textarea.selectionEnd = start + converted.length
                  textarea.style.height = 'auto'
                  textarea.style.height = `${textarea.scrollHeight}px`
                }, 0)
              }
            }}
            placeholder={placeholder}
            disabled={disabled || isAILoading}
            rows={rows}
            className={clsx(
              'w-full resize-none cursor-text leading-relaxed',
              'disabled:bg-gray-100 disabled:cursor-not-allowed',
              // Only apply default border/focus styles if no custom textareaClassName is provided
              !textareaClassName && 'p-3 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent',
              !textareaClassName && (isAIPromptMode
                ? 'border-purple-300 focus:ring-purple-500 caret-purple-600'
                : isTemplateFillMode
                  ? 'border-blue-300 focus:ring-blue-500'
                  : 'border-gray-300 focus:ring-primary-500'),
              // Special padding for header modes
              (isAIPromptMode || isTemplateFillMode || aiError) && 'pt-12',
              isAILoading && 'opacity-75',
              textareaClassName
            )}
            style={{
              minHeight,
              color: isAIPromptMode ? 'transparent'
                : (hasStyledContent && !isFocused) ? 'transparent'
                  : undefined,
              background: isAIPromptMode ? 'transparent' : undefined,
              caretColor: isAIPromptMode ? '#9333ea' : '#000000',
              lineHeight: '1.5em',
            }}
          />
        </div>


        {/* Dropdowns */}
        {activeDropdown === 'mention' && (
          <SmartInputDropdown
            isOpen={true}
            type="mention"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <MentionSuggestions
              suggestions={userSuggestions}
              isLoading={isLoadingSuggestions}
              selectedIndex={selectedIndex}
              onSelect={selectMention}
              onHover={setSelectedIndex}
            />
          </SmartInputDropdown>
        )}

        {activeDropdown === 'cashtag' && (
          <SmartInputDropdown
            isOpen={true}
            type="cashtag"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <HashtagSuggestions
              suggestions={assetSuggestions}
              isLoading={isLoadingSuggestions}
              selectedIndex={selectedIndex}
              onSelect={selectCashtag}
              onHover={setSelectedIndex}
            />
          </SmartInputDropdown>
        )}

        {activeDropdown === 'hashtag' && (
          <SmartInputDropdown
            isOpen={true}
            type="hashtag"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <HashtagSuggestions
              suggestions={entitySuggestions}
              isLoading={isLoadingSuggestions}
              selectedIndex={selectedIndex}
              onSelect={selectReference}
              onHover={setSelectedIndex}
            />
          </SmartInputDropdown>
        )}

        {activeDropdown === 'template' && (
          <SmartInputDropdown
            isOpen={true}
            type="template"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <TemplateSuggestions
              suggestions={templateSuggestions}
              selectedIndex={selectedIndex}
              onSelect={selectTemplate}
              onHover={setSelectedIndex}
            />
          </SmartInputDropdown>
        )}

        {/* Data/Chart command dropdown — unified for all states */}
        {(activeDropdown === 'chart' || activeDropdown === 'data') && (
          <SmartInputDropdown
            isOpen={true}
            type="data"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            {symbolModeCommand ? (
              /* Symbol search mode — user typed .chart. or .price. and is entering a ticker */
              <div className="min-w-[260px] max-h-[280px] overflow-y-auto py-1">
                {isLoadingSymbolAssets ? (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center">Searching...</div>
                ) : symbolAssetResults.length > 0 ? (
                  symbolAssetResults.map((asset, index) => (
                    <button
                      key={asset.id}
                      onClick={() => selectSymbolAsset(asset)}
                      className={clsx(
                        'w-full px-3 py-1.5 text-left flex items-center gap-2.5 transition-colors',
                        index === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <span className={clsx(
                        'w-14 text-center py-0.5 rounded text-[11px] font-bold shrink-0',
                        index === selectedIndex ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-700'
                      )}>
                        {asset.title}
                      </span>
                      <span className="text-sm text-gray-600 truncate">{asset.subtitle}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center">
                    {symbolSearchQuery ? 'No matches' : 'Type a ticker symbol'}
                  </div>
                )}
              </div>
            ) : assetContext && activeDropdown === 'data' ? (
              /* Has asset context on data command — show the existing data function picker */
              <DataFunctionPicker
                query={dropdownQuery}
                assetContext={assetContext}
                onSelect={handleDataSelect}
                onClose={closeDropdown}
              />
            ) : (
              /* Dot command menu — matches the TipTap notes editor dropdown exactly */
              <DotCommandMenu query={dropdownQuery} selectedIndex={selectedIndex} />
            )}
          </SmartInputDropdown>
        )}

        {/* Visibility Picker - shows when user types .private, .team, or .portfolio */}
        {activeDropdown === 'visibility' && user?.id && (
          <SmartInputDropdown
            isOpen={true}
            type="visibility"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <VisibilityPicker
              query={dropdownQuery}
              authorId={user.id}
              onSelect={handleVisibilitySelect}
              onClose={closeDropdown}
            />
          </SmartInputDropdown>
        )}

        {/* AI Hint Dropdown - shows when user types .ai but hasn't added space or model */}
        {activeDropdown === 'ai' && !isAIPromptMode && (
          <SmartInputDropdown
            isOpen={true}
            type="data"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <div className="p-3 text-sm">
              <div className="flex items-center gap-2 text-purple-700 mb-2">
                <Sparkles className="w-4 h-4" />
                <span className="font-medium">AI Prompt</span>
              </div>
              <p className="text-gray-600 text-xs mb-2">
                Press <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">Space</span> to start with default model
              </p>
              <p className="text-gray-600 text-xs">
                Or type <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">.</span> to select a model (e.g., .AI.claude)
              </p>
            </div>
          </SmartInputDropdown>
        )}

        {/* AI Model Selection Dropdown - shows when user types .AI. */}
        {activeDropdown === 'ai-model' && (
          <SmartInputDropdown
            isOpen={true}
            type="data"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <div className="py-1">
              <div className="px-3 py-1.5 text-xs text-gray-500 font-medium">Select AI Model</div>
              {AI_MODELS
                .filter(model => model.id.toLowerCase().includes(dropdownQuery.toLowerCase()))
                .map((model, index) => (
                  <button
                    key={model.id}
                    onClick={() => selectAIModel(model.id)}
                    className={clsx(
                      'w-full px-3 py-2 text-left hover:bg-purple-50 flex items-center gap-3 transition-colors',
                      index === selectedIndex && 'bg-purple-50'
                    )}
                  >
                    <div className="w-6 h-6 bg-gradient-to-r from-violet-500 to-purple-500 rounded flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[10px] font-bold">{model.id.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{model.name}</div>
                      <div className="text-xs text-gray-500 truncate">{model.description}</div>
                    </div>
                  </button>
                ))}
              {AI_MODELS.filter(model => model.id.toLowerCase().includes(dropdownQuery.toLowerCase())).length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">No matching models</div>
              )}
            </div>
          </SmartInputDropdown>
        )}

      </div>
    )
  }
)

// ─── Dot Command Menu (matches TipTap notes editor dropdown) ─────────────────

interface DotCmd {
  id: string
  name: string
  description: string
  icon: LucideIcon
  color: string
  category: 'ai' | 'data' | 'chart' | 'visibility'
}

const DOT_COMMANDS: DotCmd[] = [
  { id: 'ai', name: '.AI', description: 'Generate content with AI', icon: Sparkles, color: 'text-purple-600', category: 'ai' },

  { id: 'price', name: '.price', description: 'Current stock price', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'volume', name: '.volume', description: 'Trading volume', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'marketcap', name: '.marketcap', description: 'Market capitalization', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'change', name: '.change', description: 'Price change %', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'pe', name: '.pe', description: 'P/E ratio', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'dividend', name: '.dividend', description: 'Dividend yield', icon: BarChart3, color: 'text-emerald-600', category: 'data' },

  { id: 'chart', name: '.chart', description: 'Insert an embedded chart', icon: LineChart, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.price', name: '.chart.price', description: 'Price chart', icon: TrendingUp, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.volume', name: '.chart.volume', description: 'Volume chart', icon: BarChart3, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.performance', name: '.chart.performance', description: 'Performance chart (%)', icon: Activity, color: 'text-cyan-600', category: 'chart' },

  { id: 'private', name: '.private', description: 'Mark as private (only you)', icon: Lock, color: 'text-amber-600', category: 'visibility' },
  { id: 'team', name: '.team', description: 'Visible to team only', icon: Users, color: 'text-blue-600', category: 'visibility' },
  { id: 'portfolio', name: '.portfolio', description: 'Visible to portfolio members', icon: Building2, color: 'text-purple-600', category: 'visibility' },
]

const CATEGORY_ORDER = ['ai', 'data', 'chart', 'visibility'] as const
const CATEGORY_LABELS: Record<string, string> = { ai: 'AI', data: 'Data', chart: 'Charts', visibility: 'Visibility' }

function DotCommandMenu({ query, selectedIndex }: { query: string; selectedIndex: number }) {
  const q = query.toLowerCase()
  const filtered = DOT_COMMANDS.filter(cmd => {
    const name = cmd.name.toLowerCase().slice(1) // remove leading dot
    return !q || name.startsWith(q) || name.includes(q) || cmd.description.toLowerCase().includes(q)
  })

  if (filtered.length === 0) {
    return <div className="p-3 text-sm text-gray-500">No commands found</div>
  }

  let globalIndex = 0

  return (
    <div className="py-1 min-w-[280px] max-h-[320px] overflow-y-auto">
      {CATEGORY_ORDER.map(category => {
        const items = filtered.filter(cmd => cmd.category === category)
        if (items.length === 0) return null
        return (
          <div key={category}>
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {CATEGORY_LABELS[category]}
            </div>
            {items.map(item => {
              const itemIndex = globalIndex++
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  className={clsx(
                    'w-full px-3 py-2 flex items-center gap-3 transition-colors',
                    itemIndex === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                  )}
                >
                  <div className={clsx('w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center', item.color)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={clsx('text-sm font-medium', itemIndex === selectedIndex ? 'text-primary-700' : 'text-gray-900')}>
                      {item.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{item.description}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
