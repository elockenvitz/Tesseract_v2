import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Sparkles, Camera, Image as ImageIcon, Link, FileText, BarChart3,
  Table2, ListChecks, Calendar, Hash, HelpCircle, Minus, LucideIcon
} from 'lucide-react'

const DotCommandPluginKey = new PluginKey('dotCommand')

export interface DotCommandItem {
  id: string
  name: string
  description: string
  icon: LucideIcon
  color: string
  category: 'ai' | 'capture' | 'data' | 'content' | 'template' | 'other'
}

const DOT_COMMANDS: DotCommandItem[] = [
  // AI commands
  { id: 'ai', name: '.AI', description: 'Generate content with AI', icon: Sparkles, color: 'text-purple-600', category: 'ai' },
  { id: 'ai.claude', name: '.AI.claude', description: 'Generate with Claude', icon: Sparkles, color: 'text-purple-600', category: 'ai' },
  { id: 'ai.gpt', name: '.AI.gpt', description: 'Generate with GPT', icon: Sparkles, color: 'text-purple-600', category: 'ai' },

  // Capture commands
  { id: 'capture', name: '.capture', description: 'Capture a platform element', icon: Camera, color: 'text-violet-600', category: 'capture' },
  { id: 'screenshot', name: '.screenshot', description: 'Take a screenshot', icon: ImageIcon, color: 'text-amber-600', category: 'capture' },
  { id: 'embed', name: '.embed', description: 'Embed a URL', icon: Link, color: 'text-blue-600', category: 'capture' },

  // Data commands
  { id: 'price', name: '.price', description: 'Current stock price', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'volume', name: '.volume', description: 'Trading volume', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'marketcap', name: '.marketcap', description: 'Market capitalization', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'change', name: '.change', description: 'Price change %', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'pe', name: '.pe', description: 'P/E ratio', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'dividend', name: '.dividend', description: 'Dividend yield', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'data', name: '.data', description: 'Insert live data', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'table', name: '.table', description: 'Insert a data table', icon: Table2, color: 'text-emerald-600', category: 'data' },
  { id: 'chart', name: '.chart', description: 'Insert a chart', icon: BarChart3, color: 'text-emerald-600', category: 'data' },
  { id: 'metric', name: '.metric', description: 'Insert a metric', icon: BarChart3, color: 'text-emerald-600', category: 'data' },

  // Content commands
  { id: 'task', name: '.task', description: 'Add a task', icon: ListChecks, color: 'text-cyan-600', category: 'content' },
  { id: 'event', name: '.event', description: 'Add an event', icon: Calendar, color: 'text-pink-600', category: 'content' },
  { id: 'note', name: '.note', description: 'Link to a note', icon: FileText, color: 'text-orange-600', category: 'content' },
  { id: 'link', name: '.link', description: 'Insert a link', icon: Link, color: 'text-blue-600', category: 'content' },

  // Template commands are dynamically loaded from database (see getFilteredItems)

  // Other
  { id: 'toc', name: '.toc', description: 'Table of contents', icon: Hash, color: 'text-indigo-600', category: 'other' },
  { id: 'divider', name: '.divider', description: 'Insert a divider', icon: Minus, color: 'text-gray-500', category: 'other' },
  { id: 'help', name: '.help', description: 'Show all commands', icon: HelpCircle, color: 'text-gray-600', category: 'other' },
]

export interface TemplateWithShortcut {
  id: string
  name: string
  shortcut: string
  content: string
}

export interface DotCommandSuggestionOptions {
  onAICommand?: (model?: string) => void
  onCaptureCommand?: () => void
  onScreenshotCommand?: () => void
  onEmbedCommand?: () => void
  onDataCommand?: (type: string, symbol?: string) => void
  onTemplateCommand?: (templateShortcut: string, templateId: string) => void
  onTaskCommand?: () => void
  onEventCommand?: () => void
  onTocCommand?: () => void
  onDividerCommand?: () => void
  onHelpCommand?: () => void
  templates?: TemplateWithShortcut[]
}

export const DotCommandSuggestionExtension = Extension.create<DotCommandSuggestionOptions>({
  name: 'dotCommandSuggestion',

  addOptions() {
    return {
      onAICommand: undefined,
      onCaptureCommand: undefined,
      onScreenshotCommand: undefined,
      onEmbedCommand: undefined,
      onDataCommand: undefined,
      onTemplateCommand: undefined,
      onTaskCommand: undefined,
      onEventCommand: undefined,
      onTocCommand: undefined,
      onDividerCommand: undefined,
      onHelpCommand: undefined,
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

    const getFilteredItems = (query: string): DotCommandItem[] => {
      const lowerQuery = query.toLowerCase()

      // Get base commands (excluding hardcoded templates)
      const baseCommands = DOT_COMMANDS.filter(cmd => !cmd.id.startsWith('template.'))

      // Create dynamic template commands from provided templates
      const templateCommands: DotCommandItem[] = (options.templates || []).map(template => ({
        id: `template.${template.shortcut}`,
        name: `.template.${template.shortcut}`,
        description: template.name,
        icon: FileText,
        color: 'text-orange-600',
        category: 'template' as const
      }))

      // Combine all commands
      const allCommands = [...baseCommands, ...templateCommands]

      return allCommands.filter(cmd => {
        const cmdLower = cmd.name.toLowerCase().slice(1)
        return cmdLower.startsWith(lowerQuery) ||
          cmdLower.includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery)
      }).slice(0, 10)
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
        case 'chart':
        case 'metric':
          options.onDataCommand?.(commandId, symbol)
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

    const showPopup = (view: EditorView, pos: number, items: DotCommandItem[], onSelect: (item: DotCommandItem) => void) => {
      if (popup) {
        // Update existing popup position and content
        const coords = view.coordsAtPos(pos)
        popup.setProps({
          getReferenceClientRect: () => ({
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            right: coords.left,
            width: 0,
            height: coords.bottom - coords.top,
            x: coords.left,
            y: coords.top,
            toJSON: () => ({})
          })
        })
        renderPopup(items, onSelect)
        return
      }

      // Create new popup
      popupElement = document.createElement('div')
      reactRoot = ReactDOM.createRoot(popupElement)
      renderPopup(items, onSelect)

      const coords = view.coordsAtPos(pos)
      popup = tippy(document.body, {
        getReferenceClientRect: () => ({
          top: coords.top,
          bottom: coords.bottom,
          left: coords.left,
          right: coords.left,
          width: 0,
          height: coords.bottom - coords.top,
          x: coords.left,
          y: coords.top,
          toJSON: () => ({})
        }),
        appendTo: () => document.body,
        content: popupElement,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        animation: 'shift-away',
        maxWidth: 'none',
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

      // Find dot command pattern at end of text
      const match = textBefore.match(/\.([a-zA-Z0-9.]*)$/)
      if (!match) return null

      // Check that the dot is at start or after whitespace
      const dotIndex = textBefore.length - match[0].length
      if (dotIndex > 0 && !/\s/.test(textBefore[dotIndex - 1])) return null

      const nodeStart = pos - $pos.parentOffset
      return {
        query: match[1],
        start: nodeStart + dotIndex
      }
    }

    // Parse complete command from text
    const parseCommand = (text: string): { commandId: string; symbol?: string } | null => {
      const dataCommands = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend', 'data', 'table', 'chart', 'metric']
      for (const cmd of dataCommands) {
        const symbolMatch = text.match(new RegExp(`\\.${cmd}\\.([A-Z0-9]+)$`, 'i'))
        if (symbolMatch) {
          return { commandId: cmd, symbol: symbolMatch[1].toUpperCase() }
        }
        const plainMatch = text.match(new RegExp(`\\.${cmd}$`, 'i'))
        if (plainMatch) {
          return { commandId: cmd }
        }
      }

      if (/\.ai\.claude$/i.test(text)) return { commandId: 'ai.claude' }
      if (/\.ai\.gpt$/i.test(text)) return { commandId: 'ai.gpt' }
      if (/\.ai$/i.test(text)) return { commandId: 'ai' }

      // Dynamic template commands from provided templates
      const templateShortcuts = (options.templates || []).map(t => t.shortcut)
      for (const shortcut of templateShortcuts) {
        if (new RegExp(`\\.template\\.${shortcut}$`, 'i').test(text)) {
          return { commandId: `template.${shortcut}` }
        }
      }

      const otherCommands = ['capture', 'screenshot', 'embed', 'task', 'event', 'note', 'link', 'toc', 'divider', 'help']
      for (const cmd of otherCommands) {
        if (new RegExp(`\\.${cmd}$`, 'i').test(text)) {
          return { commandId: cmd }
        }
      }

      return null
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
                const items = getFilteredItems(cmdInfo.query)
                const exactMatch = items.find(item =>
                  item.name.toLowerCase().slice(1) === cmdInfo.query.toLowerCase()
                )
                if (exactMatch) {
                  closePopup()
                  view.dispatch(view.state.tr.delete(cmdInfo.start, from))
                  executeCommand(exactMatch.id)
                  return true
                }

                // Check for data command with symbol (e.g., price.AAPL)
                const parsed = parseCommand('.' + cmdInfo.query)
                if (parsed) {
                  closePopup()
                  view.dispatch(view.state.tr.delete(cmdInfo.start, from))
                  executeCommand(parsed.commandId, parsed.symbol)
                  return true
                }
              }
              closePopup()
              return false
            }

            return false
          },

          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            // Check if we have a command query
            const cmdInfo = getCommandQuery(view)

            if (!cmdInfo) {
              if (popup) closePopup()
              return false
            }

            const items = getFilteredItems(cmdInfo.query)

            // Handle navigation and selection
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
              return
            }

            const items = getFilteredItems(cmdInfo.query)

            if (items.length === 0) {
              if (popup) closePopup()
              return
            }

            // Ensure selectedIndex is valid
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

  const categories = ['ai', 'capture', 'data', 'content', 'template', 'other'] as const
  const categoryLabels: Record<string, string> = {
    ai: 'AI', capture: 'Capture', data: 'Data', content: 'Content', template: 'Templates', other: 'Other'
  }

  let globalIndex = 0

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[280px] max-h-[320px] overflow-y-auto'
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
          className: `w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
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

export default DotCommandSuggestionExtension
