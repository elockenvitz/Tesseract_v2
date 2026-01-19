import { useState, useRef, useCallback, useMemo, ChangeEvent, KeyboardEvent } from 'react'
import { useEntitySearch, EntitySearchResult, EntityType } from './useEntitySearch'
import { useTemplates, Template } from './useTemplates'
import { supabase } from '../lib/supabase'
import {
  TriggerType,
  TriggerInfo,
  SmartInputMetadata,
  DropdownPosition,
  formatMention,
  formatReference,
  formatCashtag,
  formatDataSnapshot,
  formatDataLive,
  formatAIContent,
  formatVisibilityStart,
  formatVisibilityEnd,
  DataFunctionType,
  VisibilityType,
  AI_MODELS
} from '../components/smart-input/types'

interface UseSmartInputOptions {
  initialValue?: string
  enableMentions?: boolean
  enableHashtags?: boolean
  enableTemplates?: boolean
  enableDataFunctions?: boolean
  enableAI?: boolean
  assetContext?: { id: string; symbol: string } | null
  onMetadataChange?: (metadata: SmartInputMetadata) => void
}

interface UseSmartInputReturn {
  // State
  value: string
  setValue: (value: string) => void
  cursorPosition: number
  activeDropdown: TriggerType | null
  dropdownQuery: string
  dropdownPosition: DropdownPosition
  selectedIndex: number

  // AI Prompt Mode
  isAIPromptMode: boolean
  aiPromptText: string
  isAILoading: boolean
  aiError: string | null

  // Template Fill Mode
  isTemplateFillMode: boolean
  currentPlaceholderName: string | null

  // Suggestions
  userSuggestions: EntitySearchResult[]
  entitySuggestions: EntitySearchResult[]
  assetSuggestions: EntitySearchResult[]
  templateSuggestions: Template[]
  isLoadingSuggestions: boolean

  // Actions
  handleChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  selectMention: (user: EntitySearchResult) => void
  selectReference: (entity: EntitySearchResult) => void
  selectCashtag: (asset: EntitySearchResult) => void
  selectTemplate: (template: Template) => void
  insertDataValue: (dataType: DataFunctionType, mode: 'snapshot' | 'live', value?: string) => void
  insertAIContent: (prompt: string, content: string) => void
  insertVisibilityMarker: (type: VisibilityType, authorId: string, targetId?: string, targetName?: string) => void
  submitAIPrompt: () => Promise<void>
  cancelAIPrompt: () => void
  closeDropdown: () => void
  setSelectedIndex: (index: number) => void

  // Refs
  textareaRef: React.RefObject<HTMLTextAreaElement>

  // Metadata
  metadata: SmartInputMetadata
}

export function useSmartInput({
  initialValue = '',
  enableMentions = true,
  enableHashtags = true,
  enableTemplates = true,
  enableDataFunctions = true,
  enableAI = true,
  assetContext,
  onMetadataChange
}: UseSmartInputOptions = {}): UseSmartInputReturn {
  const [value, setValue] = useState(initialValue)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeDropdown, setActiveDropdown] = useState<TriggerType | null>(null)
  const [dropdownQuery, setDropdownQuery] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({ top: 0, left: 0 })
  const [triggerPosition, setTriggerPosition] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // AI Prompt Mode state
  const [isAIPromptMode, setIsAIPromptMode] = useState(false)
  const [aiPromptStartPos, setAIPromptStartPos] = useState(0)
  const [selectedAIModel, setSelectedAIModel] = useState<string>('claude') // Default model
  const [isAILoading, setIsAILoading] = useState(false)
  const [aiError, setAIError] = useState<string | null>(null)

  // Template Fill Mode state - for navigating through {{placeholders}}
  const [isTemplateFillMode, setIsTemplateFillMode] = useState(false)
  const [templatePlaceholders, setTemplatePlaceholders] = useState<{ start: number; end: number; name: string }[]>([])
  const [currentPlaceholderIndex, setCurrentPlaceholderIndex] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Metadata tracking
  const [metadata, setMetadata] = useState<SmartInputMetadata>({
    mentions: [],
    references: [],
    dataSnapshots: [],
    aiGeneratedRanges: []
  })

  // Search hooks
  const { results: userResults, isLoading: isLoadingUsers } = useEntitySearch({
    query: dropdownQuery,
    types: ['user'],
    enabled: activeDropdown === 'mention' && enableMentions
  })

  // $ for assets only
  const { results: assetResults, isLoading: isLoadingAssets } = useEntitySearch({
    query: dropdownQuery,
    types: ['asset'],
    enabled: activeDropdown === 'cashtag' && enableHashtags
  })

  // # for other entities (not assets)
  const { results: entityResults, isLoading: isLoadingEntities } = useEntitySearch({
    query: dropdownQuery,
    types: ['theme', 'portfolio', 'note', 'workflow', 'list'],
    enabled: activeDropdown === 'hashtag' && enableHashtags
  })

  const { templates, searchTemplates } = useTemplates()

  // Template suggestions
  const templateSuggestions = useMemo(() => {
    if (activeDropdown !== 'template' || !enableTemplates) return []
    return searchTemplates(dropdownQuery).slice(0, 10)
  }, [activeDropdown, dropdownQuery, searchTemplates, enableTemplates])

  // Detect trigger in text
  const detectTrigger = useCallback((text: string, cursorPos: number): TriggerInfo | null => {
    const beforeCursor = text.substring(0, cursorPos)

    // Check for .AI prompt mode FIRST (special case)
    // Supports: .AI, .AI., .AI.claude, .AI.claude prompt text, .AI prompt text
    if (enableAI) {
      // Match .ai optionally followed by .modelname and optionally followed by space+prompt
      const aiMatch = beforeCursor.match(/\.ai(\.([a-z0-9]+))?(\s+.*)?$/i)
      if (aiMatch) {
        const dotPos = beforeCursor.length - aiMatch[0].length
        const modelName = aiMatch[2] || '' // e.g., "claude", "gpt"
        const afterModel = aiMatch[3] || '' // The space and text after model, or empty

        if (afterModel.length > 0) {
          // Has space after model - this is AI prompt mode with potential prompt text
          const promptText = afterModel.trimStart()
          return { type: 'ai', query: promptText, position: dotPos, model: modelName || undefined }
        } else if (aiMatch[1]) {
          // Has dot after .AI (typing model name) - show model dropdown
          return { type: 'ai-model', query: modelName, position: dotPos }
        } else {
          // Just ".ai" without anything - show hint dropdown
          return { type: 'ai', query: '', position: dotPos }
        }
      }
    }

    const lastSpace = Math.max(
      beforeCursor.lastIndexOf(' '),
      beforeCursor.lastIndexOf('\n'),
      -1
    )

    const lastAt = beforeCursor.lastIndexOf('@')
    const lastHash = beforeCursor.lastIndexOf('#')
    const lastDollar = beforeCursor.lastIndexOf('$')
    const lastDot = beforeCursor.lastIndexOf('.')

    // Check @mentions
    if (enableMentions && lastAt > lastSpace && lastAt !== -1) {
      return {
        type: 'mention',
        query: beforeCursor.substring(lastAt + 1),
        position: lastAt
      }
    }

    // Check $cashtags (assets)
    if (enableHashtags && lastDollar > lastSpace && lastDollar !== -1) {
      return {
        type: 'cashtag',
        query: beforeCursor.substring(lastDollar + 1),
        position: lastDollar
      }
    }

    // Check #hashtags (other entities - themes, portfolios, notes, etc.)
    if (enableHashtags && lastHash > lastSpace && lastHash !== -1) {
      return {
        type: 'hashtag',
        query: beforeCursor.substring(lastHash + 1),
        position: lastHash
      }
    }

    // Check .commands
    if (lastDot > lastSpace && lastDot !== -1) {
      const cmd = beforeCursor.substring(lastDot + 1).toLowerCase()

      // .template or .t
      if (enableTemplates && (cmd.startsWith('template') || cmd === 't')) {
        const query = cmd.replace(/^template\s*/, '').replace(/^t\s*/, '')
        return { type: 'template', query, position: lastDot }
      }

      // .visibility commands - .private, .team, .portfolio (check BEFORE data commands since 'p' matches both 'private' and 'price')
      const visibilityCommands = ['private', 'team', 'portfolio']
      if (cmd.length > 0 && visibilityCommands.some(v => v.startsWith(cmd) || cmd.startsWith(v))) {
        return { type: 'visibility', query: cmd, position: lastDot }
      }

      // .data functions - show suggestions as user types
      if (enableDataFunctions && assetContext) {
        const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data']
        // Show data picker if typing any prefix that could match a data command
        if (cmd.length > 0 && dataCommands.some(d => d.startsWith(cmd) || cmd.startsWith(d))) {
          return { type: 'data', query: cmd, position: lastDot }
        }
      }

      // .capture, .screenshot, .embed commands
      const captureCommands = ['capture', 'screenshot', 'embed']
      if (cmd.length > 0 && captureCommands.some(c => c.startsWith(cmd) || cmd.startsWith(c))) {
        // Handle .embed with URL argument
        if (cmd.startsWith('embed')) {
          const embedMatch = beforeCursor.match(/\.embed\s+(https?:\/\/[^\s]*)?$/i)
          if (embedMatch) {
            return { type: 'embed', query: embedMatch[1] || '', position: lastDot }
          }
          // Just .embed without space yet
          return { type: 'embed', query: '', position: lastDot }
        }
        // .screenshot
        if (cmd.startsWith('screen')) {
          return { type: 'screenshot', query: cmd, position: lastDot }
        }
        // .capture
        return { type: 'capture', query: cmd, position: lastDot }
      }
    }

    return null
  }, [enableMentions, enableHashtags, enableTemplates, enableAI, enableDataFunctions, assetContext])

  // Calculate dropdown position based on cursor - returns viewport coordinates for fixed positioning
  const calculateDropdownPosition = useCallback((textarea: HTMLTextAreaElement, triggerPos: number) => {
    const textareaRect = textarea.getBoundingClientRect()
    const computed = getComputedStyle(textarea)
    const paddingLeft = parseInt(computed.paddingLeft) || 0

    // Fixed dropdown dimensions for consistent positioning
    const dropdownHeight = 220 // Header (36px) + content (192px)
    const dropdownWidth = 288 // w-72 = 18rem = 288px
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Calculate available space above and below the ENTIRE textarea
    const spaceAboveTextarea = textareaRect.top
    const spaceBelowTextarea = viewportHeight - textareaRect.bottom

    let top: number
    if (spaceBelowTextarea >= dropdownHeight + 8) {
      // Enough space below textarea - position below it
      top = textareaRect.bottom + 4
    } else if (spaceAboveTextarea >= dropdownHeight + 8) {
      // Not enough below but enough above - position above textarea
      top = textareaRect.top - dropdownHeight - 4
    } else {
      // Limited space - prefer above to not cover typing
      top = Math.max(8, textareaRect.top - dropdownHeight - 4)
    }

    // Ensure top stays within viewport bounds
    top = Math.max(8, Math.min(top, viewportHeight - dropdownHeight - 8))

    // Calculate horizontal position - align with start of textarea for cleaner look
    let left = textareaRect.left + paddingLeft

    // If dropdown would go off right edge, move it left
    if (left + dropdownWidth > viewportWidth - 16) {
      left = viewportWidth - dropdownWidth - 16
    }

    // Ensure left is not negative
    if (left < 8) {
      left = 8
    }

    return { top, left }
  }, [])

  // Look up asset by exact symbol match
  const lookupAssetBySymbol = useCallback(async (symbol: string): Promise<{ id: string; symbol: string } | null> => {
    const { data: assets } = await supabase
      .from('assets')
      .select('id, symbol')
      .ilike('symbol', symbol)
      .limit(1)

    if (assets && assets.length > 0) {
      return assets[0]
    }
    return null
  }, [])

  // Handle text change
  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPos = e.target.selectionStart

    setValue(newValue)
    setCursorPosition(newCursorPos)

    // Check for space-to-activate cashtag pattern: $SYMBOL followed by space
    // When space is typed after $SYMBOL, validate the asset and add to metadata
    // The text stays as $SYMBOL (no ID inline) - styled by overlay
    if (newValue[newCursorPos - 1] === ' ') {
      const beforeSpace = newValue.substring(0, newCursorPos - 1)

      // Check for visibility command pattern: .private, .team, .portfolio followed by space
      const visibilityMatch = beforeSpace.match(/\.(private|team|portfolio)$/i)
      if (visibilityMatch) {
        const visType = visibilityMatch[1].toLowerCase() as VisibilityType
        // Find the position of the dot
        const dotPos = beforeSpace.length - visibilityMatch[0].length

        // We need the user's ID for private visibility
        // This will be handled by the component that uses this hook
        // For now, just close dropdown - the actual insertion will be handled via the picker
        // But if user typed the full command + space, auto-insert
        const startTag = formatVisibilityStart(visType, '', undefined, undefined)
        const endTag = formatVisibilityEnd(visType)

        const before = newValue.substring(0, dotPos)
        const after = newValue.substring(newCursorPos)
        const newContent = before + startTag + endTag + after
        const insertCursorPos = before.length + startTag.length

        setValue(newContent)
        setCursorPosition(insertCursorPos)
        setActiveDropdown(null)
        setDropdownQuery('')

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(insertCursorPos, insertCursorPos)
          }
        }, 0)
        return
      }

      // Look for $SYMBOL pattern at the end (symbol is uppercase letters/numbers)
      const cashtagMatch = beforeSpace.match(/\$([A-Z0-9.]+)$/)

      if (cashtagMatch) {
        const symbol = cashtagMatch[1]

        // Look up the asset to validate and add to metadata
        lookupAssetBySymbol(symbol).then(asset => {
          if (asset) {
            // Add to metadata for tracking (text stays as $SYMBOL)
            setMetadata(prev => {
              // Check if already in references
              const exists = prev.references.some(r => r.id === asset.id && r.type === 'asset')
              if (exists) return prev
              return {
                ...prev,
                references: [...prev.references, { type: 'asset', id: asset.id, display: asset.symbol }]
              }
            })
          }
        })

        // Close any dropdown since we just typed a space
        setActiveDropdown(null)
        setDropdownQuery('')
        return
      }
    }

    // Detect triggers
    const trigger = detectTrigger(newValue, newCursorPos)

    if (trigger) {
      // Special handling for AI prompt mode and model selection
      if (trigger.type === 'ai') {
        // Check if we have actual prompt text (space was typed after .AI or .AI.model)
        const textFromTrigger = newValue.substring(trigger.position, newCursorPos).toLowerCase()
        const hasSpaceAfterTrigger = textFromTrigger.match(/^\.ai(\.[a-z0-9]+)?\s/)

        if (hasSpaceAfterTrigger) {
          // Space was typed - enter AI prompt mode
          setIsAIPromptMode(true)
          setAIPromptStartPos(trigger.position)
          if (trigger.model) {
            setSelectedAIModel(trigger.model)
          }
          setActiveDropdown(null) // No dropdown for AI - typing inline
          setDropdownQuery(trigger.query)
        } else {
          // Just ".AI" without space - show hint dropdown
          setActiveDropdown('ai')
          setDropdownQuery('')
          setTriggerPosition(trigger.position)
          if (textareaRef.current) {
            setDropdownPosition(calculateDropdownPosition(textareaRef.current, trigger.position))
          }
        }
      } else if (trigger.type === 'ai-model') {
        // Typing model name after .AI. - show model dropdown
        setActiveDropdown('ai-model')
        setDropdownQuery(trigger.query)
        setTriggerPosition(trigger.position)
        setSelectedIndex(0)
        if (textareaRef.current) {
          setDropdownPosition(calculateDropdownPosition(textareaRef.current, trigger.position))
        }
      } else {
        // Exit AI prompt mode if user is now triggering something else
        if (isAIPromptMode) {
          setIsAIPromptMode(false)
        }
        setActiveDropdown(trigger.type)
        setDropdownQuery(trigger.query)
        setTriggerPosition(trigger.position)
        setSelectedIndex(0)

        if (textareaRef.current) {
          setDropdownPosition(calculateDropdownPosition(textareaRef.current, trigger.position))
        }
      }
    } else {
      // Check if we're still in AI prompt mode (no new trigger but still typing after .AI)
      if (isAIPromptMode) {
        const textFromAIStart = newValue.substring(aiPromptStartPos)
        // Check if the .AI prefix is still there (with optional model)
        if (!textFromAIStart.toLowerCase().match(/^\.ai(\.[a-z0-9]+)?\s/)) {
          setIsAIPromptMode(false)
        }
      }
      setActiveDropdown(null)
      setDropdownQuery('')
    }
  }, [detectTrigger, calculateDropdownPosition, isAIPromptMode, aiPromptStartPos, lookupAssetBySymbol])

  // Insert text at trigger position
  const insertAtTrigger = useCallback((insertText: string) => {
    const before = value.substring(0, triggerPosition)
    const after = value.substring(cursorPosition)
    const newValue = before + insertText + ' ' + after
    const newCursorPos = before.length + insertText.length + 1

    setValue(newValue)
    setCursorPosition(newCursorPos)
    setActiveDropdown(null)
    setDropdownQuery('')

    // Refocus textarea and set cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }, [value, triggerPosition, cursorPosition])

  // Convert "Large Cap Growth" to "LargeCapGrowth" (PascalCase)
  const toPascalCase = (str: string) => {
    return str
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
  }

  // Select mention - inserts @PascalCaseName
  const selectMention = useCallback((user: EntitySearchResult) => {
    const displayName = user.title
    const mentionText = `@${toPascalCase(displayName)}`
    insertAtTrigger(mentionText)

    // Update metadata with user reference
    setMetadata(prev => ({
      ...prev,
      mentions: [...prev.mentions, { userId: user.id, displayName }]
    }))
  }, [insertAtTrigger])

  // Select reference (# for non-asset entities) - inserts #PascalCaseName
  const selectReference = useCallback((entity: EntitySearchResult) => {
    const refText = `#${toPascalCase(entity.title)}`
    insertAtTrigger(refText)

    // Update metadata with entity reference
    setMetadata(prev => ({
      ...prev,
      references: [...prev.references, { type: entity.type, id: entity.id, display: entity.title }]
    }))
  }, [insertAtTrigger])

  // Select cashtag ($ for assets) - inserts $SYMBOL (not full ID format)
  const selectCashtag = useCallback((asset: EntitySearchResult) => {
    // Insert just $SYMBOL - the overlay will style it green
    const cashtagText = `$${asset.title}`
    insertAtTrigger(cashtagText)

    // Update metadata with asset reference
    setMetadata(prev => ({
      ...prev,
      references: [...prev.references, { type: 'asset', id: asset.id, display: asset.title }]
    }))
  }, [insertAtTrigger])

  // Select template - with placeholder navigation
  const selectTemplate = useCallback((template: Template) => {
    const content = template.content
    const before = value.substring(0, triggerPosition)
    const after = value.substring(cursorPosition)
    const newValue = before + content + ' ' + after
    const insertStartPos = before.length

    setValue(newValue)
    setActiveDropdown(null)
    setDropdownQuery('')

    // Find all {{placeholder}} patterns in the inserted content
    const placeholderRegex = /\{\{([^}]+)\}\}/g
    const placeholders: { start: number; end: number; name: string }[] = []
    let match

    while ((match = placeholderRegex.exec(content)) !== null) {
      placeholders.push({
        start: insertStartPos + match.index,
        end: insertStartPos + match.index + match[0].length,
        name: match[1]
      })
    }

    if (placeholders.length > 0) {
      // Enter template fill mode
      setIsTemplateFillMode(true)
      setTemplatePlaceholders(placeholders)
      setCurrentPlaceholderIndex(0)

      // Select the first placeholder
      const firstPlaceholder = placeholders[0]
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(firstPlaceholder.start, firstPlaceholder.end)
        }
      }, 0)
    } else {
      // No placeholders - just set cursor after inserted content
      const newCursorPos = insertStartPos + content.length + 1
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    }
  }, [value, triggerPosition, cursorPosition])

  // Insert data value
  const insertDataValue = useCallback((
    dataType: DataFunctionType,
    mode: 'snapshot' | 'live',
    value?: string
  ) => {
    if (!assetContext) return

    let insertText: string
    if (mode === 'snapshot' && value) {
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      insertText = formatDataSnapshot(dataType, value, date)
    } else {
      insertText = formatDataLive(dataType, assetContext.id)
    }

    insertAtTrigger(insertText)
  }, [assetContext, insertAtTrigger])

  // Insert AI content
  const insertAIContent = useCallback((prompt: string, content: string) => {
    const aiText = formatAIContent(prompt, content)

    // If in AI prompt mode, replace from aiPromptStartPos to cursor
    if (isAIPromptMode) {
      const before = value.substring(0, aiPromptStartPos)
      const after = value.substring(cursorPosition)
      const newValue = before + aiText + ' ' + after
      const newCursorPos = before.length + aiText.length + 1

      setValue(newValue)
      setCursorPosition(newCursorPos)
      setIsAIPromptMode(false)

      // Refocus textarea and set cursor
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    } else {
      insertAtTrigger(aiText)
    }

    // Update metadata
    setMetadata(prev => ({
      ...prev,
      aiGeneratedRanges: [...prev.aiGeneratedRanges, {
        prompt,
        content,
        startPos: isAIPromptMode ? aiPromptStartPos : triggerPosition,
        endPos: (isAIPromptMode ? aiPromptStartPos : triggerPosition) + aiText.length
      }]
    }))
  }, [insertAtTrigger, triggerPosition, isAIPromptMode, aiPromptStartPos, value, cursorPosition])

  // Insert visibility marker around selected text or at cursor
  const insertVisibilityMarker = useCallback((
    type: VisibilityType,
    authorId: string,
    targetId?: string,
    targetName?: string
  ) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const startTag = formatVisibilityStart(type, authorId, targetId, targetName)
    const endTag = formatVisibilityEnd(type)

    // Check if there's selected text to wrap
    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    const hasSelection = selectionStart !== selectionEnd

    // Remove the trigger text (.private, .team, .portfolio)
    const before = value.substring(0, triggerPosition)
    const afterTrigger = value.substring(cursorPosition)

    if (hasSelection) {
      // If user selected text before typing trigger, we need to handle differently
      // For now, just insert at trigger position
      const newValue = before + startTag + endTag + afterTrigger
      const newCursorPos = before.length + startTag.length // Place cursor between tags

      setValue(newValue)
      setCursorPosition(newCursorPos)
      setActiveDropdown(null)
      setDropdownQuery('')

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    } else {
      // No selection - insert markers with cursor in between
      const newValue = before + startTag + endTag + afterTrigger
      const newCursorPos = before.length + startTag.length // Place cursor between tags

      setValue(newValue)
      setCursorPosition(newCursorPos)
      setActiveDropdown(null)
      setDropdownQuery('')

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    }
  }, [value, triggerPosition, cursorPosition])

  // Get current AI prompt text (text after ".AI " up to cursor)
  const aiPromptText = useMemo(() => {
    if (!isAIPromptMode) return ''

    // Get text from AI start to cursor position
    const textToCursor = value.substring(aiPromptStartPos, cursorPosition)

    // Remove the ".ai " prefix to get just the prompt
    const afterDotAI = textToCursor.replace(/^\.ai\s+/i, '')

    return afterDotAI
  }, [isAIPromptMode, value, aiPromptStartPos, cursorPosition])

  // Submit AI prompt
  const submitAIPrompt = useCallback(async () => {
    if (!isAIPromptMode || !aiPromptText.trim()) {
      return
    }

    setIsAILoading(true)
    setAIError(null)

    try {
      // Import supabase and call AI
      const { supabase } = await import('../lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated. Please log in to use AI features.')
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
            message: `Please provide a brief, concise summary (2-3 sentences max) for this request: ${aiPromptText}`,
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
        const errorMsg = errorData.error || 'Failed to generate content'
        // Check for common API key errors
        if (errorMsg.includes('API key') || errorMsg.includes('not configured') || errorMsg.includes('ANTHROPIC')) {
          throw new Error('AI is not configured. Please add your API key in settings.')
        }
        throw new Error(errorMsg)
      }

      const data = await response.json()
      const summary = data.response

      // Insert the AI content
      insertAIContent(aiPromptText, summary)
    } catch (error) {
      console.error('AI prompt error:', error)
      const message = error instanceof Error ? error.message : 'An error occurred'
      setAIError(message)
      // Auto-clear error after 5 seconds
      setTimeout(() => setAIError(null), 5000)
    } finally {
      setIsAILoading(false)
    }
  }, [isAIPromptMode, aiPromptText, assetContext, insertAIContent])

  // Cancel AI prompt mode
  const cancelAIPrompt = useCallback(() => {
    setIsAIPromptMode(false)
    // Optionally remove the ".AI " text
  }, [])

  // Select AI model from dropdown - inserts .AI.modelname and enters prompt mode
  const selectAIModel = useCallback((modelId: string) => {
    const insertText = `.AI.${modelId} `
    const before = value.substring(0, triggerPosition)
    const after = value.substring(cursorPosition)
    const newValue = before + insertText + after
    const newCursorPos = before.length + insertText.length

    setValue(newValue)
    setCursorPosition(newCursorPos)
    setSelectedAIModel(modelId)
    setIsAIPromptMode(true)
    setAIPromptStartPos(triggerPosition)
    setActiveDropdown(null)
    setDropdownQuery('')

    // Refocus textarea and set cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }, [value, triggerPosition, cursorPosition])

  // Navigate to next placeholder in template fill mode
  const goToNextPlaceholder = useCallback(() => {
    if (!isTemplateFillMode || templatePlaceholders.length === 0) return false

    const nextIndex = currentPlaceholderIndex + 1
    if (nextIndex >= templatePlaceholders.length) {
      // No more placeholders - exit template fill mode
      setIsTemplateFillMode(false)
      setTemplatePlaceholders([])
      setCurrentPlaceholderIndex(0)
      return false
    }

    // Find the next placeholder in the current value
    // We need to re-find it because previous replacements may have shifted positions
    const placeholderRegex = /\{\{([^}]+)\}\}/g
    const placeholders: { start: number; end: number; name: string }[] = []
    let match

    while ((match = placeholderRegex.exec(value)) !== null) {
      placeholders.push({
        start: match.index,
        end: match.index + match[0].length,
        name: match[1]
      })
    }

    if (placeholders.length === 0) {
      // No more placeholders in the text
      setIsTemplateFillMode(false)
      setTemplatePlaceholders([])
      setCurrentPlaceholderIndex(0)
      return false
    }

    // Update placeholders and move to the next one (which is now index 0 after replacement)
    setTemplatePlaceholders(placeholders)
    setCurrentPlaceholderIndex(0)

    // Select the next placeholder
    const nextPlaceholder = placeholders[0]
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextPlaceholder.start, nextPlaceholder.end)
      }
    }, 0)

    return true
  }, [isTemplateFillMode, templatePlaceholders, currentPlaceholderIndex, value])

  // Exit template fill mode
  const exitTemplateFillMode = useCallback(() => {
    setIsTemplateFillMode(false)
    setTemplatePlaceholders([])
    setCurrentPlaceholderIndex(0)
  }, [])

  // Close dropdown
  const closeDropdown = useCallback(() => {
    setActiveDropdown(null)
    setDropdownQuery('')
  }, [])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle template fill mode - Tab to next placeholder, Escape to exit
    if (isTemplateFillMode) {
      if (e.key === 'Tab') {
        e.preventDefault()
        goToNextPlaceholder()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        exitTemplateFillMode()
        return
      }
      // Let other keys pass through for typing (which replaces selection)
    }

    // Handle AI prompt mode
    if (isAIPromptMode) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (aiPromptText.trim()) {
          submitAIPrompt()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelAIPrompt()
        return
      }
      // Let other keys pass through for typing
      return
    }

    if (!activeDropdown) return

    // Get filtered AI models for ai-model dropdown
    const filteredAIModels = AI_MODELS.filter(m =>
      m.id.toLowerCase().includes(dropdownQuery.toLowerCase())
    )

    const suggestions = activeDropdown === 'mention' ? userResults :
                       activeDropdown === 'cashtag' ? assetResults :
                       activeDropdown === 'hashtag' ? entityResults :
                       activeDropdown === 'template' ? templateSuggestions :
                       activeDropdown === 'ai-model' ? filteredAIModels : []

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1))
        break

      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break

      case 'Enter':
      case 'Tab':
        if (suggestions.length > 0) {
          e.preventDefault()
          const selected = suggestions[selectedIndex]
          if (activeDropdown === 'mention') {
            selectMention(selected as EntitySearchResult)
          } else if (activeDropdown === 'cashtag') {
            selectCashtag(selected as EntitySearchResult)
          } else if (activeDropdown === 'hashtag') {
            selectReference(selected as EntitySearchResult)
          } else if (activeDropdown === 'template') {
            selectTemplate(selected as Template)
          } else if (activeDropdown === 'ai-model') {
            selectAIModel((selected as typeof AI_MODELS[0]).id)
          }
        }
        break

      case 'Escape':
        e.preventDefault()
        closeDropdown()
        break
    }
  }, [
    activeDropdown,
    dropdownQuery,
    userResults,
    assetResults,
    entityResults,
    templateSuggestions,
    selectedIndex,
    selectMention,
    selectCashtag,
    selectReference,
    selectTemplate,
    selectAIModel,
    closeDropdown,
    isAIPromptMode,
    aiPromptText,
    submitAIPrompt,
    cancelAIPrompt,
    isTemplateFillMode,
    goToNextPlaceholder,
    exitTemplateFillMode
  ])

  return {
    // State
    value,
    setValue,
    cursorPosition,
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

    // Template Fill Mode
    isTemplateFillMode,
    currentPlaceholderName: isTemplateFillMode && templatePlaceholders.length > 0
      ? templatePlaceholders[currentPlaceholderIndex]?.name || null
      : null,

    // Suggestions
    userSuggestions: userResults,
    entitySuggestions: entityResults,
    assetSuggestions: assetResults,
    templateSuggestions,
    isLoadingSuggestions: isLoadingUsers || isLoadingEntities || isLoadingAssets,

    // Actions
    handleChange,
    handleKeyDown,
    selectMention,
    selectReference,
    selectCashtag,
    selectTemplate,
    insertDataValue,
    insertAIContent,
    insertVisibilityMarker,
    submitAIPrompt,
    cancelAIPrompt,
    selectAIModel,
    closeDropdown,
    setSelectedIndex,

    // Refs
    textareaRef,

    // Metadata
    metadata
  }
}
