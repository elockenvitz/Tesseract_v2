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

  // Symbol mode state — for .chart.AAPL, .price.MSFT etc.
  const [symbolModeCommand, setSymbolModeCommand] = useState<string | null>(null) // e.g., 'chart', 'chart.price', 'price'
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('')

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

  // Symbol mode asset search (for .chart.AA, .price.MS etc.)
  const { results: symbolAssetResults, isLoading: isLoadingSymbolAssets } = useEntitySearch({
    query: symbolSearchQuery,
    types: ['asset'],
    enabled: !!symbolModeCommand && symbolSearchQuery.length >= 1
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

    // Check .commands — find the command-starting dot (after whitespace or at start),
    // not the last dot, so multi-dot commands like .chart.aapl work correctly.
    // Scan backwards from cursor to find a dot preceded by whitespace or at position 0.
    let cmdDot = -1
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const ch = beforeCursor[i]
      if (ch === ' ' || ch === '\n') break // hit whitespace before finding a dot
      if (ch === '.' && (i === 0 || /\s/.test(beforeCursor[i - 1]))) {
        cmdDot = i
        break
      }
    }
    if (cmdDot === -1 && lastDot > lastSpace && lastDot !== -1) {
      cmdDot = lastDot // fallback for simple single-dot commands
    }

    if (cmdDot !== -1 && cmdDot > lastSpace) {
      const cmd = beforeCursor.substring(cmdDot + 1).toLowerCase()

      // Require at least one letter after the dot — a bare "." is punctuation, not a command
      if (cmd.length === 0 || !/^[a-zA-Z]/.test(cmd)) {
        return null
      }

      // .template or .t
      if (enableTemplates && (cmd.startsWith('template') || cmd === 't')) {
        const query = cmd.replace(/^template\s*/, '').replace(/^t\s*/, '')
        return { type: 'template', query, position: cmdDot }
      }

      // .visibility commands - .private, .team, .portfolio (check BEFORE data commands since 'p' matches both 'private' and 'price')
      const visibilityCommands = ['private', 'team', 'portfolio']
      if (cmd.length > 0 && visibilityCommands.some(v => v.startsWith(cmd) || cmd.startsWith(v))) {
        return { type: 'visibility', query: cmd, position: cmdDot }
      }

      // .chart commands — work with or without assetContext via .chart.SYMBOL syntax
      if (enableDataFunctions) {
        const chartPrefixes = ['chart', 'chart.price', 'chart.volume', 'chart.performance', 'chart.comparison', 'chart.technicals']
        if (cmd.length > 0 && (chartPrefixes.some(c => c.startsWith(cmd) || cmd.startsWith(c)))) {
          return { type: 'chart', query: cmd, position: cmdDot }
        }
      }

      // .data functions - show suggestions as user types
      if (enableDataFunctions && assetContext) {
        const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data']
        // Show data picker if typing any prefix that could match a data command
        if (cmd.length > 0 && dataCommands.some(d => d.startsWith(cmd) || cmd.startsWith(d))) {
          return { type: 'data', query: cmd, position: cmdDot }
        }
      }

      // .data functions without asset context — allow .price.AAPL syntax
      if (enableDataFunctions && !assetContext) {
        const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data']
        if (cmd.length > 0 && dataCommands.some(d => d.startsWith(cmd) || cmd.startsWith(d))) {
          return { type: 'data', query: cmd, position: cmdDot }
        }
      }

      // .capture, .screenshot, .embed commands
      const captureCommands = ['capture', 'screenshot', 'embed']
      if (cmd.length > 0 && captureCommands.some(c => c.startsWith(cmd) || cmd.startsWith(c))) {
        // Handle .embed with URL argument
        if (cmd.startsWith('embed')) {
          const embedMatch = beforeCursor.match(/\.embed\s+(https?:\/\/[^\s]*)?$/i)
          if (embedMatch) {
            return { type: 'embed', query: embedMatch[1] || '', position: cmdDot }
          }
          // Just .embed without space yet
          return { type: 'embed', query: '', position: cmdDot }
        }
        // .screenshot
        if (cmd.startsWith('screen')) {
          return { type: 'screenshot', query: cmd, position: cmdDot }
        }
        // .capture
        return { type: 'capture', query: cmd, position: cmdDot }
      }

      // Fallback: show dot command menu for any unrecognized prefix (including empty)
      if (enableDataFunctions) {
        return { type: 'chart', query: cmd, position: cmdDot }
      }
    }

    return null
  }, [enableMentions, enableHashtags, enableTemplates, enableAI, enableDataFunctions, assetContext])

  // Calculate dropdown position relative to the textarea.
  // Always positions above the textarea to never cover what the user is typing.
  const calculateDropdownPosition = useCallback((textarea: HTMLTextAreaElement, _triggerPos: number) => {
    const dropdownHeight = 220
    const dropdownWidth = 288
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const textareaRect = textarea.getBoundingClientRect()
    const computed = getComputedStyle(textarea)
    const paddingLeft = parseInt(computed.paddingLeft) || 0

    // Always show above the textarea so we never cover the text being typed
    let top = textareaRect.top - dropdownHeight - 6

    // If not enough room above, show below the textarea as fallback
    if (top < 8) {
      top = textareaRect.bottom + 6
    }

    top = Math.max(8, Math.min(top, viewportHeight - dropdownHeight - 8))

    let left = textareaRect.left + paddingLeft
    if (left + dropdownWidth > viewportWidth - 16) left = viewportWidth - dropdownWidth - 16
    if (left < 8) left = 8

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

      // Check for .chart.SYMBOL or .chart.type.SYMBOL pattern followed by space
      const chartMatch = beforeSpace.match(/\.(chart(?:\.(?:price|volume|performance|comparison|technicals))?)\.([A-Z0-9.]+)$/i)
      if (chartMatch && enableDataFunctions) {
        const chartCmd = chartMatch[1].toLowerCase()
        const symbol = chartMatch[2].toUpperCase()
        const dotPos = beforeSpace.length - chartMatch[0].length
        const chartType = chartCmd === 'chart' ? 'price' : chartCmd.replace('chart.', '')
        const formatted = `.chart[${chartType}:${symbol}]`

        const before = newValue.substring(0, dotPos)
        const after = newValue.substring(newCursorPos)
        const newContent = before + formatted + ' ' + after
        const insertCursorPos = before.length + formatted.length + 1

        setValue(newContent)
        setCursorPosition(insertCursorPos)
        setActiveDropdown(null)
        setDropdownQuery('')
        setSymbolModeCommand(null)
        setSymbolSearchQuery('')

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(insertCursorPos, insertCursorPos)
          }
        }, 0)
        return
      }

      // Check for .price.SYMBOL, .pe.SYMBOL etc. (data command with inline symbol)
      const dataSymbolMatch = beforeSpace.match(/\.(price|volume|marketcap|change|pe|dividend)\.([A-Z0-9.]+)$/i)
      if (dataSymbolMatch && enableDataFunctions) {
        const dataType = dataSymbolMatch[1].toLowerCase()
        const symbol = dataSymbolMatch[2].toUpperCase()
        const dotPos = beforeSpace.length - dataSymbolMatch[0].length

        // Look up asset to get ID for live format
        lookupAssetBySymbol(symbol).then(asset => {
          if (asset) {
            const dtMap: Record<string, string> = { pe: 'pe_ratio', dividend: 'dividend_yield' }
            const formatted = `.data[${dtMap[dataType] || dataType}:live:${asset.id}]`
            const currentVal = textareaRef.current?.value || ''
            const before = currentVal.substring(0, dotPos)
            const after = currentVal.substring(dotPos + dataSymbolMatch[0].length + 1) // +1 for space
            const newContent = before + formatted + ' ' + after
            const newPos = before.length + formatted.length + 1

            setValue(newContent)
            setCursorPosition(newPos)
            setTimeout(() => {
              if (textareaRef.current) {
                textareaRef.current.focus()
                textareaRef.current.setSelectionRange(newPos, newPos)
              }
            }, 0)
          }
        })

        setActiveDropdown(null)
        setDropdownQuery('')
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

        // Detect symbol mode for chart/data commands (e.g., "chart.aa" or "price.ms")
        const SYMBOL_COMMANDS = ['chart', 'chart.price', 'chart.volume', 'chart.performance', 'chart.comparison', 'chart.technicals', 'price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data']
        if ((trigger.type === 'chart' || trigger.type === 'data') && trigger.query) {
          // Sort longest first so chart.price matches before chart
          const sorted = [...SYMBOL_COMMANDS].sort((a, b) => b.length - a.length)
          for (const cmd of sorted) {
            const prefix = cmd + '.'
            if (trigger.query.toLowerCase().startsWith(prefix) || trigger.query.toLowerCase() === cmd + '.') {
              const symQuery = trigger.query.slice(prefix.length)
              setSymbolModeCommand(cmd)
              setSymbolSearchQuery(symQuery)
              setActiveDropdown(trigger.type)
              setDropdownQuery(trigger.query)
              setTriggerPosition(trigger.position)
              setSelectedIndex(0)
              if (textareaRef.current) {
                setDropdownPosition(calculateDropdownPosition(textareaRef.current, trigger.position))
              }
              return // handled
            }
          }
        }

        // Not in symbol mode — clear it
        if (symbolModeCommand) {
          setSymbolModeCommand(null)
          setSymbolSearchQuery('')
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

  // Select an asset from symbol mode search results (.chart.AAPL, .price.MSFT)
  const selectSymbolAsset = useCallback((asset: EntitySearchResult) => {
    if (!symbolModeCommand) return

    const CHART_CMDS = ['chart', 'chart.price', 'chart.volume', 'chart.performance', 'chart.comparison', 'chart.technicals']
    const isChart = CHART_CMDS.includes(symbolModeCommand)

    let formatted: string
    if (isChart) {
      const chartType = symbolModeCommand === 'chart' ? 'price' : symbolModeCommand.replace('chart.', '')
      formatted = `.chart[${chartType}:${asset.title}]`
    } else {
      // Data command
      const dtMap: Record<string, string> = { pe: 'pe_ratio', dividend: 'dividend_yield' }
      const dataType = dtMap[symbolModeCommand] || symbolModeCommand
      formatted = `.data[${dataType}:live:${asset.id}]`
    }

    const before = value.substring(0, triggerPosition)
    const after = value.substring(cursorPosition)
    const newValue = before + formatted + ' ' + after
    const newCursorPos = before.length + formatted.length + 1

    setValue(newValue)
    setCursorPosition(newCursorPos)
    setActiveDropdown(null)
    setDropdownQuery('')
    setSymbolModeCommand(null)
    setSymbolSearchQuery('')

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }, [symbolModeCommand, value, triggerPosition, cursorPosition])

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

    // Symbol mode keyboard handling (for .chart.AA, .price.MS etc.)
    if (symbolModeCommand && symbolAssetResults.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => Math.min(prev + 1, symbolAssetResults.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          return
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          const asset = symbolAssetResults[selectedIndex]
          if (asset) selectSymbolAsset(asset)
          return
        case 'Escape':
          e.preventDefault()
          closeDropdown()
          setSymbolModeCommand(null)
          setSymbolSearchQuery('')
          return
      }
    }

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
        // Always prevent Enter/Tab when a dropdown is active so it doesn't
        // propagate to external handlers (e.g., send message in DMs).
        e.preventDefault()
        if (suggestions.length > 0) {
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
    exitTemplateFillMode,
    symbolModeCommand,
    symbolAssetResults,
    selectSymbolAsset
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

    // Symbol mode (for .chart.AAPL, .price.MSFT etc.)
    symbolModeCommand,
    symbolSearchQuery,
    symbolAssetResults,
    isLoadingSymbolAssets,
    selectSymbolAsset,

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
