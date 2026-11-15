import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Sparkles, Camera, Image as ImageIcon, Link, FileText, BarChart3,
  Table2, ListChecks, Calendar, Hash, HelpCircle, Minus, LucideIcon,
  TrendingUp, Activity, LineChart, Lock, Users, Building2, Search
} from 'lucide-react'

/**
 * The character that starts a command, in one place.
 *
 * It was a literal `.`, written out in every regex, every display name and
 * every parse branch in this file -- around twenty copies. Changing it meant
 * finding all of them, and the ones in the DISPLAY names were a separate
 * list from the ones in the PARSER, so the menu could have advertised one
 * trigger while the editor listened for another.
 *
 * Imported from `lib/ai/slash-commands` so the editor and the chat composer
 * cannot disagree about what the reader types. That module is pure -- no
 * TipTap, no React -- so importing it here costs nothing.
 *
 * The dots INSIDE an id (`chart.price`) are untouched. They are namespace
 * separators, and `/chart/price` would read as a URL path, which is one of
 * the things the trigger must never fire on.
 */
import { SLASH } from '../../../lib/ai/slash-commands'

/* The plugin key is internal state, not a user-facing name, so it keeps its
   old value: renaming it would invalidate nothing and risk nothing being
   found by name at runtime. */
const DotCommandPluginKey = new PluginKey('dotCommand')

export interface DotCommandItem {
  id: string
  name: string
  description: string
  icon: LucideIcon
  color: string
  category: 'ai' | 'capture' | 'data' | 'chart' | 'content' | 'template' | 'visibility' | 'other'
}

const DOT_COMMANDS: DotCommandItem[] = [
  // AI commands
  { id: 'ai', name: `${SLASH}AI`, description: 'Generate content with AI', icon: Sparkles, color: 'text-purple-600', category: 'ai' },
  { id: 'ai.claude', name: `${SLASH}AI.claude`, description: 'Generate with Claude', icon: Sparkles, color: 'text-purple-600', category: 'ai' },
  { id: 'ai.gpt', name: `${SLASH}AI.gpt`, description: 'Generate with GPT', icon: Sparkles, color: 'text-purple-600', category: 'ai' },

  // Capture commands
  { id: 'capture', name: `${SLASH}capture`, description: 'Capture a platform element', icon: Camera, color: 'text-violet-600', category: 'capture' },
  { id: 'screenshot', name: `${SLASH}screenshot`, description: 'Take a screenshot', icon: ImageIcon, color: 'text-amber-600', category: 'capture' },
  { id: 'embed', name: `${SLASH}embed`, description: 'Embed a URL', icon: Link, color: 'text-blue-600', category: 'capture' },

  // Data commands
  { id: 'price', name: `${SLASH}price`, description: 'Current stock price', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'volume', name: `${SLASH}volume`, description: 'Trading volume', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'marketcap', name: `${SLASH}marketcap`, description: 'Market capitalization', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'change', name: `${SLASH}change`, description: 'Price change %', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'pe', name: `${SLASH}pe`, description: 'P/E ratio', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'dividend', name: `${SLASH}dividend`, description: 'Dividend yield', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'data', name: `${SLASH}data`, description: 'Insert live data', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'table', name: `${SLASH}table`, description: 'Insert a data table', icon: Table2, color: 'text-emerald-600', category: 'data' },
  { id: 'metric', name: `${SLASH}metric`, description: 'Insert a metric', icon: BarChart3, color: 'text-emerald-600', category: 'data' },

  // Chart commands. The dot INSIDE an id is a namespace separator, not a
  // trigger: `/chart/price` would read as a URL path, which is one of the
  // things the trigger must never fire on.
  { id: 'chart', name: `${SLASH}chart`, description: 'Insert an embedded chart', icon: LineChart, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.price', name: `${SLASH}chart.price`, description: 'Price chart', icon: TrendingUp, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.volume', name: `${SLASH}chart.volume`, description: 'Volume chart', icon: BarChart3, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.performance', name: `${SLASH}chart.performance`, description: 'Performance chart (%)', icon: Activity, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.comparison', name: `${SLASH}chart.comparison`, description: 'Multi-asset comparison', icon: LineChart, color: 'text-cyan-600', category: 'chart' },
  { id: 'chart.technicals', name: `${SLASH}chart.technicals`, description: 'Chart with indicators', icon: Activity, color: 'text-cyan-600', category: 'chart' },

  // Content commands
  { id: 'task', name: `${SLASH}task`, description: 'Add a task', icon: ListChecks, color: 'text-cyan-600', category: 'content' },
  { id: 'event', name: `${SLASH}event`, description: 'Add an event', icon: Calendar, color: 'text-pink-600', category: 'content' },
  { id: 'note', name: `${SLASH}note`, description: 'Link to a note', icon: FileText, color: 'text-orange-600', category: 'content' },
  { id: 'link', name: `${SLASH}link`, description: 'Insert a link', icon: Link, color: 'text-blue-600', category: 'content' },

  // Visibility commands
  { id: 'private', name: `${SLASH}private`, description: 'Mark as private (only you)', icon: Lock, color: 'text-amber-600', category: 'visibility' },
  { id: 'team', name: `${SLASH}team`, description: 'Visible to team only', icon: Users, color: 'text-blue-600', category: 'visibility' },
  { id: 'portfolio', name: `${SLASH}portfolio`, description: 'Visible to portfolio members', icon: Building2, color: 'text-purple-600', category: 'visibility' },

  // Template commands are dynamically loaded from database (see getFilteredItems)

  // Other
  { id: 'toc', name: `${SLASH}toc`, description: 'Table of contents', icon: Hash, color: 'text-indigo-600', category: 'other' },
  { id: 'divider', name: `${SLASH}divider`, description: 'Insert a divider', icon: Minus, color: 'text-gray-500', category: 'other' },
  { id: 'help', name: `${SLASH}help`, description: 'Show all commands', icon: HelpCircle, color: 'text-gray-600', category: 'other' },
]

export interface TemplateWithShortcut {
  id: string
  name: string
  shortcut: string
  content: string
}

export interface AssetSearchResult {
  id: string
  symbol: string
  companyName: string
  price?: number
  change?: number
}

export interface DotCommandSuggestionOptions {
  onAICommand?: (model?: string) => void
  onCaptureCommand?: () => void
  onScreenshotCommand?: () => void
  onEmbedCommand?: () => void
  onDataCommand?: (type: string, symbol?: string) => void
  onChartCommand?: (chartType: string, symbol?: string) => void
  onTemplateCommand?: (templateShortcut: string, templateId: string) => void
  onTaskCommand?: () => void
  onEventCommand?: () => void
  onTocCommand?: () => void
  onDividerCommand?: () => void
  onHelpCommand?: () => void
  onVisibilityCommand?: (type: 'private' | 'team' | 'portfolio', targetId?: string, targetName?: string) => void
  onAssetSearch?: (query: string) => Promise<AssetSearchResult[]>
  templates?: TemplateWithShortcut[]
}

export const DotCommandSuggestionExtension = Extension.create<DotCommandSuggestionOptions>({
  name: 'dotCommandSuggestion',

  onCreate() {
  },

  addOptions() {
    return {
      onAICommand: undefined,
      onCaptureCommand: undefined,
      onScreenshotCommand: undefined,
      onEmbedCommand: undefined,
      onDataCommand: undefined,
      onChartCommand: undefined,
      onTemplateCommand: undefined,
      onTaskCommand: undefined,
      onEventCommand: undefined,
      onTocCommand: undefined,
      onDividerCommand: undefined,
      onHelpCommand: undefined,
      onVisibilityCommand: undefined,
      onAssetSearch: undefined,
      templates: [],
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor

    let popup: TippyInstance | null = null
    let popupElement: HTMLDivElement | null = null
    let reactRoot: ReactDOM.Root | null = null
    let triggerPos: number = 0
    let selectedIndex: number = 0

    // Symbol mode: commands that accept a trailing .SYMBOL
    const SYMBOL_COMMANDS = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data', 'table', 'metric', 'chart', 'chart.price', 'chart.volume', 'chart.performance', 'chart.comparison', 'chart.technicals']

    // Detect if query is in "symbol mode" (e.g. "chart." or "price.AA")
    // Returns { commandId, symbolQuery } or null
    const detectSymbolMode = (query: string): { commandId: string; symbolQuery: string } | null => {
      // Try longest matches first (chart.price.X before chart.X)
      const sorted = [...SYMBOL_COMMANDS].sort((a, b) => b.length - a.length)
      for (const cmd of sorted) {
        const prefix = cmd + '.'
        if (query.toLowerCase().startsWith(prefix)) {
          return { commandId: cmd, symbolQuery: query.slice(prefix.length) }
        }
      }
      return null
    }

    // Asset search state
    let assetResults: AssetSearchResult[] = []
    let assetSearchPending = false
    let currentSymbolMode: { commandId: string; symbolQuery: string } | null = null

    const getFilteredItems = (query: string): DotCommandItem[] => {
      const lowerQuery = query.toLowerCase()
      // Get base commands (excluding hardcoded templates)
      const baseCommands = DOT_COMMANDS.filter(cmd => !cmd.id.startsWith('template.'))
      // Create dynamic template commands from provided templates
      const templateCommands: DotCommandItem[] = (options.templates || []).map(template => ({
        id: `template.${template.shortcut}`,
        name: `${SLASH}template.${template.shortcut}`,
        description: template.name,
        icon: FileText,
        color: 'text-orange-600',
        category: 'template' as const
      }))

      // Combine all commands
      const allCommands = [...baseCommands, ...templateCommands]

      const filtered = allCommands.filter(cmd => {
        const cmdLower = cmd.name.toLowerCase().slice(1)
        return cmdLower.startsWith(lowerQuery) ||
          cmdLower.includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery)
      }).slice(0, 10)
      return filtered
    }

    const executeCommand = (commandId: string, symbol?: string) => {
      switch (commandId) {
        case 'ai':
          options.onAICommand?.()
          break
        case 'ai.claude':
          options.onAICommand?.('claude')
          break
        case 'ai.gpt':
          options.onAICommand?.('gpt')
          break
        case 'capture':
          options.onCaptureCommand?.()
          break
        case 'screenshot':
          options.onScreenshotCommand?.()
          break
        case 'embed':
          options.onEmbedCommand?.()
          break
        case 'price':
        case 'volume':
        case 'marketcap':
        case 'change':
        case 'pe':
        case 'dividend':
        case 'data':
        case 'table':
        case 'metric':
          options.onDataCommand?.(commandId, symbol)
          break
        case 'chart':
        case 'chart.price':
        case 'chart.volume':
        case 'chart.performance':
        case 'chart.comparison':
        case 'chart.technicals':
          // For plain 'chart' command, default to 'price'; otherwise extract the type
          const chartType = commandId === 'chart' ? 'price' : commandId.replace('chart.', '')
          options.onChartCommand?.(chartType, symbol)
          break
        case 'task':
          options.onTaskCommand?.()
          break
        case 'event':
          options.onEventCommand?.()
          break
        case 'toc':
          options.onTocCommand?.()
          break
        case 'divider':
          editor.chain().focus().setHorizontalRule().run()
          break
        case 'help':
          options.onHelpCommand?.()
          break
        case 'private':
          options.onVisibilityCommand?.('private')
          break
        case 'team':
          options.onVisibilityCommand?.('team')
          break
        case 'portfolio':
          options.onVisibilityCommand?.('portfolio')
          break
        default:
          // Handle dynamic template commands (template.{shortcut})
          if (commandId.startsWith('template.')) {
            const shortcut = commandId.replace('template.', '')
            const template = (options.templates || []).find(t => t.shortcut === shortcut)
            if (template) {
              options.onTemplateCommand?.(shortcut, template.id)
            }
          }
          break
      }
    }

    const closePopup = () => {
      popup?.destroy()
      popup = null
      if (reactRoot) {
        reactRoot.unmount()
        reactRoot = null
      }
      popupElement = null
      triggerPos = 0
      selectedIndex = 0
      currentView = null
      currentDotPos = 0
    }

    const renderPopup = (items: DotCommandItem[], onSelect: (item: DotCommandItem) => void) => {
      if (!popupElement || !reactRoot) return
      reactRoot.render(
        React.createElement(DotCommandList, {
          items,
          selectedIndex,
          onSelect
        })
      )
    }

    const renderAssetPopup = (assets: AssetSearchResult[], commandLabel: string, onSelect: (asset: AssetSearchResult) => void) => {
      if (!popupElement || !reactRoot) return
      reactRoot.render(
        React.createElement(AssetSearchList, {
          items: assets,
          selectedIndex,
          commandLabel,
          onSelect
        })
      )
    }

    // Ref to the current editor view so getReferenceClientRect can always
    // read the latest cursor position dynamically.
    let currentView: EditorView | null = null
    let currentDotPos: number = 0

    const getDotRect = (): DOMRect => {
      if (!currentView) {
        return new DOMRect(0, 0, 0, 0)
      }
      // Use the dot position for horizontal placement so the popup
      // anchors to where the command starts, not where the cursor is now.
      const coords = currentView.coordsAtPos(currentDotPos)

      // Fallback: if coordsAtPos returns zeros (element not in view),
      // use the DOM selection range instead.
      if (coords.top === 0 && coords.left === 0) {
        const domSel = window.getSelection()
        if (domSel && domSel.rangeCount > 0) {
          const range = domSel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          if (rect.top !== 0 || rect.left !== 0) {
            return rect
          }
        }
      }

      return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
    }

    const showPopup = (view: EditorView, pos: number, items: DotCommandItem[], onSelect: (item: DotCommandItem) => void) => {
      currentView = view
      currentDotPos = pos

      if (popup) {
        // Update existing popup — getReferenceClientRect reads currentView/currentDotPos dynamically
        popup.popperInstance?.update()
        renderPopup(items, onSelect)
        return
      }

      // Create new popup
      popupElement = document.createElement('div')
      reactRoot = ReactDOM.createRoot(popupElement)
      renderPopup(items, onSelect)

      popup = tippy(document.body, {
        getReferenceClientRect: getDotRect,
        appendTo: () => document.body,
        content: popupElement,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        animation: 'shift-away',
        maxWidth: 'none',
      // A 280px popup anchored to the caret runs off a 390px screen the moment
      // the caret passes the midpoint. Popper is told to shift it back into the
      // viewport rather than letting it hang past the edge.
      popperOptions: {
        modifiers: [
          { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8 } },
          { name: 'flip', options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] } },
        ],
      },
        offset: [0, 8]
      })
    }

    // Get the current command query from the editor
    const getCommandQuery = (view: EditorView): { query: string; start: number } | null => {
      const { state } = view
      const { selection } = state
      const pos = selection.from
      const $pos = state.doc.resolve(pos)
      const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, '')

      /*
       * A slash command at the caret, and nothing else.
       *
       * Two rules, and between them they keep out everything a reader
       * writes that merely contains a slash. Each has a case in
       * `slash-commands.test.ts`.
       *
       * A LETTER must follow the slash. That excludes a date fragment
       * (`/2026`), arithmetic (`10/2`, `/ 50`) and a doubled slash.
       *
       * The slash must be at the start of the block or after whitespace.
       * That excludes a ratio (`P/E`, `debt/equity`), a URL
       * (`https://example.com/path` -- every slash in it is mid-token) and
       * any word a reader has already written a slash into.
       *
       * Both are necessary. Dropping the first fires on `12/2026`; dropping
       * the second fires on the `/path` in every link.
       */
      const match = textBefore.match(/\/([a-zA-Z][a-zA-Z0-9.]*)$/)
      if (!match) {
        return null
      }

      const triggerIndex = textBefore.length - match[0].length
      if (triggerIndex > 0 && !/\s/.test(textBefore[triggerIndex - 1])) {
        return null
      }
      const dotIndex = triggerIndex

      const nodeStart = pos - $pos.parentOffset
      return {
        query: match[1],
        start: nodeStart + dotIndex
      }
    }

    /*
     * Parse a complete command from text.
     *
     * `T` is the trigger, escaped for a regex, and every pattern below
     * anchors on it. The dots that remain are separators INSIDE an id --
     * `/chart.price.AAPL` is trigger, id, symbol -- which is why only the
     * leading one changed.
     */
    const T = `\\${SLASH}`
    const parseCommand = (text: string): { commandId: string; symbol?: string } | null => {
      const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data', 'table', 'chart', 'metric']
      for (const cmd of dataCommands) {
        const symbolMatch = text.match(new RegExp(`${T}${cmd}\\.([A-Z0-9]+)$`, 'i'))
        if (symbolMatch) {
          return { commandId: cmd, symbol: symbolMatch[1].toUpperCase() }
        }
        const plainMatch = text.match(new RegExp(`${T}${cmd}$`, 'i'))
        if (plainMatch) {
          return { commandId: cmd }
        }
      }

      if (new RegExp(`${T}ai\\.claude$`, 'i').test(text)) return { commandId: 'ai.claude' }
      if (new RegExp(`${T}ai\\.gpt$`, 'i').test(text)) return { commandId: 'ai.gpt' }
      if (new RegExp(`${T}ai$`, 'i').test(text)) return { commandId: 'ai' }

      // Chart commands with optional symbol (e.g., /chart.price.AAPL)
      const chartTypes = ['price', 'volume', 'performance', 'comparison', 'technicals']
      for (const ctype of chartTypes) {
        const chartSymbolMatch = text.match(new RegExp(`${T}chart\\.${ctype}\\.([A-Z0-9]+)$`, 'i'))
        if (chartSymbolMatch) {
          return { commandId: `chart.${ctype}`, symbol: chartSymbolMatch[1].toUpperCase() }
        }
        if (new RegExp(`${T}chart\\.${ctype}$`, 'i').test(text)) {
          return { commandId: `chart.${ctype}` }
        }
      }
      // Plain /chart command
      const chartPlainMatch = text.match(new RegExp(`${T}chart\\.([A-Z0-9]+)$`, 'i'))
      if (chartPlainMatch) {
        return { commandId: 'chart', symbol: chartPlainMatch[1].toUpperCase() }
      }
      if (new RegExp(`${T}chart$`, 'i').test(text)) return { commandId: 'chart' }

      // Dynamic template commands from provided templates
      const templateShortcuts = (options.templates || []).map(t => t.shortcut)
      for (const shortcut of templateShortcuts) {
        if (new RegExp(`${T}template\\.${shortcut}$`, 'i').test(text)) {
          return { commandId: `template.${shortcut}` }
        }
      }

      const otherCommands = ['capture', 'screenshot', 'embed', 'task', 'event', 'note', 'link', 'toc', 'divider', 'help', 'private', 'team', 'portfolio']
      for (const cmd of otherCommands) {
        if (new RegExp(`${T}${cmd}$`, 'i').test(text)) {
          return { commandId: cmd }
        }
      }

      return null
    }

    // Helper to select an asset in symbol mode
    const handleAssetSelect = (view: EditorView, cmdStart: number, commandId: string, asset: AssetSearchResult) => {
      closePopup()
      currentSymbolMode = null
      view.dispatch(view.state.tr.delete(cmdStart, view.state.selection.from))
      executeCommand(commandId, asset.symbol)
    }

    // Trigger async asset search and update popup
    const triggerAssetSearch = (view: EditorView, cmdStart: number, symbolMode: { commandId: string; symbolQuery: string }) => {
      if (!options.onAssetSearch || assetSearchPending) return
      assetSearchPending = true
      currentSymbolMode = symbolMode
      options.onAssetSearch(symbolMode.symbolQuery).then(results => {
        assetSearchPending = false
        assetResults = results
        // Check we're still in the same symbol mode
        if (!currentSymbolMode || currentSymbolMode.commandId !== symbolMode.commandId) return

        if (selectedIndex >= results.length) selectedIndex = 0

        const cmdLabel = `.${symbolMode.commandId}`

        if (results.length === 0 && !symbolMode.symbolQuery) {
          // Just entered symbol mode with empty query — show prompt
          showPopup(view, cmdStart, [], () => {})
          if (popupElement && reactRoot) {
            reactRoot.render(
              React.createElement(AssetSearchList, {
                items: [],
                selectedIndex: 0,
                commandLabel: cmdLabel,
                onSelect: () => {}
              })
            )
          }
          return
        }

        if (results.length === 0) {
          if (popup) closePopup()
          return
        }

        showPopup(view, cmdStart, [] as DotCommandItem[], () => {})
        renderAssetPopup(results, cmdLabel, (asset) => {
          handleAssetSelect(view, cmdStart, symbolMode.commandId, asset)
        })
      }).catch(() => {
        assetSearchPending = false
      })
    }

    return [
      new Plugin({
        key: DotCommandPluginKey,
        props: {
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
            // Handle space - this activates commands
            if (text === ' ') {
              const cmdInfo = getCommandQuery(view)
              if (cmdInfo && cmdInfo.query.length > 0) {
                // If in symbol mode and an asset is selected, pick it
                if (currentSymbolMode && assetResults.length > 0) {
                  const asset = assetResults[selectedIndex]
                  if (asset) {
                    handleAssetSelect(view, cmdInfo.start, currentSymbolMode.commandId, asset)
                    return true
                  }
                }

                const items = getFilteredItems(cmdInfo.query)
                const exactMatch = items.find(item =>
                  item.name.toLowerCase().slice(1) === cmdInfo.query.toLowerCase()
                )
                if (exactMatch) {
                  closePopup()
                  currentSymbolMode = null
                  view.dispatch(view.state.tr.delete(cmdInfo.start, from))
                  executeCommand(exactMatch.id)
                  return true
                }

                // Check for data command with symbol (e.g., price.AAPL)
                /* `cmdInfo.query` is what follows the trigger, so the
                   trigger is put back before parsing. */
                const parsed = parseCommand(SLASH + cmdInfo.query)
                if (parsed) {
                  closePopup()
                  currentSymbolMode = null
                  view.dispatch(view.state.tr.delete(cmdInfo.start, from))
                  executeCommand(parsed.commandId, parsed.symbol)
                  return true
                }
              }
              closePopup()
              currentSymbolMode = null
              return false
            }

            return false
          },

          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            // Check if we have a command query
            const cmdInfo = getCommandQuery(view)

            if (!cmdInfo) {
              if (popup) closePopup()
              currentSymbolMode = null
              return false
            }

            // Symbol mode keyboard handling
            const symbolMode = detectSymbolMode(cmdInfo.query)
            if (symbolMode && popup && assetResults.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                selectedIndex = Math.min(assetResults.length - 1, selectedIndex + 1)
                renderAssetPopup(assetResults, `.${symbolMode.commandId}`, (asset) => {
                  handleAssetSelect(view, cmdInfo.start, symbolMode.commandId, asset)
                })
                return true
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                selectedIndex = Math.max(0, selectedIndex - 1)
                renderAssetPopup(assetResults, `.${symbolMode.commandId}`, (asset) => {
                  handleAssetSelect(view, cmdInfo.start, symbolMode.commandId, asset)
                })
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const asset = assetResults[selectedIndex]
                if (asset) {
                  handleAssetSelect(view, cmdInfo.start, symbolMode.commandId, asset)
                }
                return true
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                closePopup()
                currentSymbolMode = null
                return true
              }
              return false
            }

            // Normal command mode keyboard handling
            const items = getFilteredItems(cmdInfo.query)

            if (items.length > 0 && popup) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                selectedIndex = Math.min(items.length - 1, selectedIndex + 1)
                renderPopup(items, (item) => {
                  closePopup()
                  view.dispatch(view.state.tr.delete(cmdInfo.start, view.state.selection.from))
                  executeCommand(item.id)
                })
                return true
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                selectedIndex = Math.max(0, selectedIndex - 1)
                renderPopup(items, (item) => {
                  closePopup()
                  view.dispatch(view.state.tr.delete(cmdInfo.start, view.state.selection.from))
                  executeCommand(item.id)
                })
                return true
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const item = items[selectedIndex]
                if (item) {
                  closePopup()
                  view.dispatch(view.state.tr.delete(cmdInfo.start, view.state.selection.from))
                  executeCommand(item.id)
                }
                return true
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                closePopup()
                return true
              }
            }

            return false
          },
        },
        view(editorView) {
          const updateHandler = () => {
            const cmdInfo = getCommandQuery(editorView)

            if (!cmdInfo) {
              if (popup) closePopup()
              currentSymbolMode = null
              return
            }

            // Check for symbol mode first (e.g., "chart." or "price.AA")
            const symbolMode = detectSymbolMode(cmdInfo.query)
            if (symbolMode) {
              triggerPos = cmdInfo.start
              triggerAssetSearch(editorView, cmdInfo.start, symbolMode)
              return
            }

            // Normal command mode
            currentSymbolMode = null
            assetResults = []

            const items = getFilteredItems(cmdInfo.query)

            if (items.length === 0) {
              if (popup) closePopup()
              return
            }

            if (selectedIndex >= items.length) {
              selectedIndex = 0
            }

            triggerPos = cmdInfo.start

            showPopup(editorView, cmdInfo.start, items, (item) => {
              closePopup()
              editorView.dispatch(editorView.state.tr.delete(cmdInfo.start, editorView.state.selection.from))
              executeCommand(item.id)
            })
          }

          return {
            update: updateHandler,
            destroy() {
              closePopup()
            }
          }
        }
      })
    ]
  }
})

interface DotCommandListProps {
  items: DotCommandItem[]
  selectedIndex: number
  onSelect: (item: DotCommandItem) => void
}

function DotCommandList({ items, selectedIndex, onSelect }: DotCommandListProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm text-gray-500'
    }, 'No commands found')
  }

  const categories = ['ai', 'capture', 'data', 'chart', 'content', 'visibility', 'template', 'other'] as const
  const categoryLabels: Record<string, string> = {
    ai: 'AI', capture: 'Capture', data: 'Data', chart: 'Charts', content: 'Content', visibility: 'Visibility', template: 'Templates', other: 'Other'
  }

  let globalIndex = 0

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[240px] max-w-[calc(100vw-1rem)] max-h-[320px] overflow-y-auto'
  }, categories.map(category => {
    const categoryItems = items.filter(item => item.category === category)
    if (categoryItems.length === 0) return null

    return React.createElement('div', { key: category }, [
      React.createElement('div', {
        key: `label-${category}`,
        className: 'px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider'
      }, categoryLabels[category]),
      ...categoryItems.map(item => {
        const itemIndex = globalIndex++
        const Icon = item.icon
        return React.createElement('button', {
          key: item.id,
          className: `w-full px-3 py-2.5 min-h-[44px] text-left flex items-center gap-3 transition-colors ${
            itemIndex === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
          }`,
          onClick: () => onSelect(item)
        }, [
          React.createElement('div', {
            key: 'icon',
            className: `w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center ${item.color}`
          }, React.createElement(Icon, { className: 'w-4 h-4' })),
          React.createElement('div', {
            key: 'info',
            className: 'flex-1 min-w-0'
          }, [
            React.createElement('div', {
              key: 'name',
              className: `text-sm font-medium ${itemIndex === selectedIndex ? 'text-primary-700' : 'text-gray-900'}`
            }, item.name),
            React.createElement('div', {
              key: 'desc',
              className: 'text-xs text-gray-500 truncate'
            }, item.description)
          ])
        ])
      })
    ])
  }))
}

// ─── Asset Search List (symbol mode dropdown) ──────────────────────

interface AssetSearchListProps {
  items: AssetSearchResult[]
  selectedIndex: number
  commandLabel: string
  onSelect: (asset: AssetSearchResult) => void
}

function AssetSearchList({ items, selectedIndex, commandLabel, onSelect }: AssetSearchListProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[240px] max-w-[calc(100vw-1rem)]'
    }, [
      React.createElement('div', {
        key: 'header',
        className: 'flex items-center gap-2 text-xs text-gray-400 mb-1'
      }, [
        React.createElement(Search, { key: 'icon', className: 'w-3 h-3' }),
        React.createElement('span', { key: 'label' }, `${commandLabel} — type a ticker`)
      ])
    ])
  }

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[240px] max-w-[calc(100vw-1rem)] max-h-[300px] overflow-y-auto'
  }, [
    React.createElement('div', {
      key: 'header',
      className: 'px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5'
    }, [
      React.createElement(Search, { key: 'icon', className: 'w-3 h-3' }),
      React.createElement('span', { key: 'text' }, `${commandLabel} — select ticker`)
    ]),
    ...items.map((item, index) =>
      React.createElement('button', {
        key: item.id,
        className: `w-full px-3 py-2.5 min-h-[44px] text-left flex items-center gap-3 transition-colors ${
          index === selectedIndex ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'
        }`,
        onClick: () => onSelect(item)
      }, [
        React.createElement('div', {
          key: 'symbol',
          className: 'w-12 h-8 rounded bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs shrink-0'
        }, item.symbol),
        React.createElement('div', {
          key: 'info',
          className: 'flex-1 min-w-0'
        }, [
          React.createElement('div', {
            key: 'name',
            className: 'text-sm font-medium text-gray-900 truncate'
          }, item.companyName),
          item.price !== undefined && React.createElement('div', {
            key: 'price',
            className: 'flex items-center gap-2 text-xs'
          }, [
            React.createElement('span', {
              key: 'priceValue',
              className: 'text-gray-600'
            }, `$${item.price.toFixed(2)}`),
            item.change !== undefined && React.createElement('span', {
              key: 'change',
              className: item.change >= 0 ? 'text-emerald-600' : 'text-red-600'
            }, `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%`)
          ])
        ])
      ])
    )
  ])
}

export default DotCommandSuggestionExtension
