import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, Sparkles, AlertCircle, FileText } from 'lucide-react'
import { useSmartInput } from '../../hooks/useSmartInput'
import { SmartInputDropdown } from './SmartInputDropdown'
import { MentionSuggestions } from './MentionSuggestions'
import { HashtagSuggestions } from './HashtagSuggestions'
import { TemplateSuggestions } from './TemplateSuggestions'
import { DataFunctionPicker } from './DataFunctionPicker'
import { SmartInputMetadata, DataFunctionType } from './types'

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
      isAILoading,
      aiError,
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
        setValue(newValue)
        // Set cursor position after inserted text
        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(start + text.length, start + text.length)
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

    // Render styled content with colored mentions, cashtags, hashtags
    // This overlay matches the textarea text exactly, just with colors applied
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

        // Style the matched tag
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
              'w-full p-3 border rounded-lg resize-none',
              'focus:outline-none focus:ring-2 focus:border-transparent',
              'disabled:bg-gray-100 disabled:cursor-not-allowed',
              isAIPromptMode
                ? 'border-purple-300 focus:ring-purple-500 pt-12 caret-purple-600'
                : isTemplateFillMode
                  ? 'border-blue-300 focus:ring-blue-500 pt-12'
                  : 'border-gray-300 focus:ring-primary-500',
              isAILoading && 'opacity-75',
              aiError && 'pt-12',
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

        {/* AI Hint Dropdown - shows when user types .ai but hasn't added space */}
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
              <p className="text-gray-600 text-xs">
                Press <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">Space</span> to start typing your prompt
              </p>
            </div>
          </SmartInputDropdown>
        )}

        {/* Helper text */}
        <div className="mt-1 text-xs text-gray-400">
          {isAIPromptMode ? (
            <span className="text-purple-500">
              Type your prompt and press Enter to generate AI summary
            </span>
          ) : (
            <>
              <span className="mr-3">@mention</span>
              <span className="mr-3">$asset</span>
              <span className="mr-3">#reference</span>
              {enableTemplates && <span className="mr-3">.template</span>}
              {enableDataFunctions && assetContext && <span className="mr-3">.price</span>}
              {enableAI && <span>.AI</span>}
            </>
          )}
        </div>
      </div>
    )
  }
)
