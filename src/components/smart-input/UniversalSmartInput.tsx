import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { clsx } from 'clsx'
import { Loader2, Sparkles, AlertCircle, FileText } from 'lucide-react'
import { useSmartInput } from '../../hooks/useSmartInput'
import { SmartInputDropdown } from './SmartInputDropdown'
import { MentionSuggestions } from './MentionSuggestions'
import { HashtagSuggestions } from './HashtagSuggestions'
import { TemplateSuggestions } from './TemplateSuggestions'
import { DataFunctionPicker } from './DataFunctionPicker'
import { VisibilityPicker } from './VisibilityPicker'
import { SmartInputMetadata, DataFunctionType, VisibilityType, AI_MODELS } from './types'
import { useAuth } from '../../hooks/useAuth'

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

    // Sync external value changes
    React.useEffect(() => {
      if (externalValue !== value) {
        setValue(externalValue)
      }
    }, [externalValue])

    // Notify parent of changes
    React.useEffect(() => {
      if (value !== externalValue) {
        onChange(value, metadata)
      }
    }, [value, metadata])

    // AI is now handled inline - no modal needed
    // The hint dropdown shows when user types .ai (without space)
    // When user adds a space, isAIPromptMode activates for inline typing

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

    // Combined key down handler
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      internalKeyDown(e)
      externalKeyDown?.(e)
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

    // Render styled content with colored mentions, cashtags, hashtags
    // This overlay matches the textarea text exactly, just with colors applied
    // Note: We only style simple tokens that don't change text length (@, $, #)
    // Markdown formatting (==, **, etc.) is not styled here to avoid alignment issues
    const renderStyledContent = (text: string) => {
      // Pattern to match:
      // - $SYMBOL (cashtags - green) - uppercase letters/numbers
      // - @PascalCase (mentions - blue) - starts with capital, mixed case
      // - #PascalCase (references - yellow) - starts with capital, mixed case
      const pattern = /(\$[A-Z0-9.]+)|(@[A-Z][a-zA-Z0-9]*)|(#[A-Z][a-zA-Z0-9]*)/g

      const parts: React.ReactNode[] = []
      let lastIndex = 0
      let match

      while ((match = pattern.exec(text)) !== null) {
        // Add text before the match (normal black text)
        if (match.index > lastIndex) {
          parts.push(
            <span key={`text-${lastIndex}`}>
              {text.substring(lastIndex, match.index)}
            </span>
          )
        }

        // Style the matched element
        if (match[1]) {
          // Cashtag: $SYMBOL in green
          parts.push(
            <span key={`cashtag-${match.index}`} className="text-green-600 font-medium">
              {match[1]}
            </span>
          )
        } else if (match[2]) {
          // Mention: @PascalCase in blue
          parts.push(
            <span key={`mention-${match.index}`} className="text-blue-600 font-medium">
              {match[2]}
            </span>
          )
        } else if (match[3]) {
          // Hashtag: #PascalCase in yellow
          parts.push(
            <span key={`hashtag-${match.index}`} className="text-yellow-600 font-medium">
              {match[3]}
            </span>
          )
        }

        lastIndex = match.index + match[0].length
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(
          <span key={`text-end`}>
            {text.substring(lastIndex)}
          </span>
        )
      }

      return parts.length > 0 ? parts : <span>{text}</span>
    }

    // Check if content has any styled elements
    const hasStyledContent = /(\$[A-Z0-9.]+)|(@[A-Z][a-zA-Z0-9]*)|(#[A-Z][a-zA-Z0-9]*)/.test(value)

    return (
      <div className={clsx('relative', className)}>
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
          {/* Smart Input Overlay - shows styled mentions, cashtags, hashtags */}
          {!isAIPromptMode && hasStyledContent && (
            <div
              className="absolute inset-0 p-3 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-gray-900"
              style={{
                minHeight,
                paddingTop: isTemplateFillMode ? '48px' : undefined,
                fontFamily: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
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

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            disabled={disabled || isAILoading}
            rows={rows}
            className={clsx(
              'w-full resize-none',
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
              // Make textarea text transparent when overlay is active so styled content shows through
              color: (isAIPromptMode || hasStyledContent) ? 'transparent' : undefined,
              background: isAIPromptMode ? 'transparent' : undefined,
              caretColor: isAIPromptMode ? '#9333ea' : hasStyledContent ? '#111827' : undefined,
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

        {activeDropdown === 'data' && assetContext && (
          <SmartInputDropdown
            isOpen={true}
            type="data"
            position={dropdownPosition}
            onClose={closeDropdown}
          >
            <DataFunctionPicker
              query={dropdownQuery}
              assetContext={assetContext}
              onSelect={handleDataSelect}
              onClose={closeDropdown}
            />
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
