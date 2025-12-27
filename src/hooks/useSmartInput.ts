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
  DataFunctionType
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

    // Check for .AI prompt mode FIRST (special case - space is part of the trigger)
    // Look for ".ai " or ".ai" followed by text anywhere in beforeCursor
    if (enableAI) {
      const aiMatch = beforeCursor.match(/\.ai(\s+.*)?$/i)
      if (aiMatch) {
        const dotPos = beforeCursor.length - aiMatch[0].length
        const afterDotAI = aiMatch[1] || '' // The space and text after .ai, or empty

        if (afterDotAI.length > 0) {
          // Has space - this is AI prompt mode with potential prompt text
          const promptText = afterDotAI.trimStart() // Remove the leading space
          return { type: 'ai', query: promptText, position: dotPos }
        } else {
          // Just ".ai" without space - show hint dropdown
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

      // .data functions - show suggestions as user types
      if (enableDataFunctions && assetContext) {
        const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data']
        // Show data picker if typing any prefix that could match a data command
        if (cmd.length > 0 && dataCommands.some(d => d.startsWith(cmd) || cmd.startsWith(d))) {
          return { type: 'data', query: cmd, position: lastDot }
        }
      }
    }

    return null
  }, [enableMentions, enableHashtags, enableTemplates, enableAI, enableDataFunctions, assetContext])

  // Calculate dropdown position based on cursor - returns viewport coordinates for fixed positioning
  const calculateDropdownPosition = useCallback((textarea: HTMLTextAreaElement, triggerPos: number) => {
    const textareaRect = textarea.getBoundingClientRect()
    const computed = getComputedStyle(textarea)
    const lineHeight = parseInt(computed.lineHeight) || 20
    const paddingTop = parseInt(computed.paddingTop) || 0
    const paddingLeft = parseInt(computed.paddingLeft) || 0

    // Get text before trigger to count lines and calculate position
    const textBeforeTrigger = textarea.value.substring(0, triggerPos)
    const lines = textBeforeTrigger.split('\n')
    const currentLineNumber = lines.length - 1
    const currentLineText = lines[lines.length - 1]

    // Calculate vertical position: textarea top + padding + (line number * line height) - scroll + one line down
    const top = textareaRect.top + paddingTop + (currentLineNumber * lineHeight) - textarea.scrollTop + lineHeight + 4

    // Calculate horizontal position based on character position in current line
    // Create a temporary span to measure text width
    const measureSpan = document.createElement('span')
    measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre;
      font-family: ${computed.fontFamily};
      font-size: ${computed.fontSize};
      font-weight: ${computed.fontWeight};
      letter-spacing: ${computed.letterSpacing};
    `
    measureSpan.textContent = currentLineText
    document.body.appendChild(measureSpan)
    const textWidth = measureSpan.getBoundingClientRect().width
    document.body.removeChild(measureSpan)

    const left = textareaRect.left + paddingLeft + Math.min(textWidth, textareaRect.width - 40)

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
      // Special handling for AI prompt mode
      if (trigger.type === 'ai') {
        // Check if user has typed ".ai " (with space) - enter AI prompt mode
        const textFromTrigger = newValue.substring(trigger.position, newCursorPos).toLowerCase()
        const hasSpace = textFromTrigger.match(/^\.ai\s/)

        if (hasSpace) {
          console.log('[SmartInput] Entering AI prompt mode, startPos:', trigger.position)
          setIsAIPromptMode(true)
          setAIPromptStartPos(trigger.position)
          setActiveDropdown(null) // No dropdown for AI - typing inline
          setDropdownQuery(trigger.query)
        } else {
          // Just typed ".ai" without space - show hint
          setActiveDropdown('ai')
          setDropdownQuery('')
          setTriggerPosition(trigger.position)
          if (textareaRef.current) {
            setDropdownPosition(calculateDropdownPosition(textareaRef.current, trigger.position))
          }
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
        // Check if the .AI prefix is still there
        if (!textFromAIStart.toLowerCase().startsWith('.ai ')) {
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

  // Get current AI prompt text (text after ".AI " up to cursor)
  const aiPromptText = useMemo(() => {
    if (!isAIPromptMode) return ''

    // Get text from AI start to cursor position
    const textToCursor = value.substring(aiPromptStartPos, cursorPosition)
    console.log('[SmartInput] aiPromptText calc - textToCursor:', textToCursor)

    // Remove the ".ai " prefix to get just the prompt
    const afterDotAI = textToCursor.replace(/^\.ai\s+/i, '')
    console.log('[SmartInput] aiPromptText result:', afterDotAI)

    return afterDotAI
  }, [isAIPromptMode, value, aiPromptStartPos, cursorPosition])

  // Submit AI prompt
  const submitAIPrompt = useCallback(async () => {
    console.log('[SmartInput] submitAIPrompt called, isAIPromptMode:', isAIPromptMode, 'aiPromptText:', aiPromptText)
    if (!isAIPromptMode || !aiPromptText.trim()) {
      console.log('[SmartInput] submitAIPrompt early return - mode:', isAIPromptMode, 'text:', aiPromptText)
      return
    }

    setIsAILoading(true)
    setAIError(null)
    console.log('[SmartInput] Starting AI request...')

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
      console.log('[SmartInput] AI Mode - Key pressed:', e.key, 'aiPromptText:', aiPromptText)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        console.log('[SmartInput] Enter pressed, prompt:', aiPromptText)
        if (aiPromptText.trim()) {
          console.log('[SmartInput] Calling submitAIPrompt')
          submitAIPrompt()
        } else {
          console.log('[SmartInput] aiPromptText is empty, not submitting')
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

    const suggestions = activeDropdown === 'mention' ? userResults :
                       activeDropdown === 'cashtag' ? assetResults :
                       activeDropdown === 'hashtag' ? entityResults :
                       activeDropdown === 'template' ? templateSuggestions : []

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
    userResults,
    assetResults,
    entityResults,
    templateSuggestions,
    selectedIndex,
    selectMention,
    selectCashtag,
    selectReference,
    selectTemplate,
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
    submitAIPrompt,
    cancelAIPrompt,
    closeDropdown,
    setSelectedIndex,

    // Refs
    textareaRef,

    // Metadata
    metadata
  }
}
