import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const DotCommandPluginKey = new PluginKey('dot-command-highlight')

// All dot commands with their colors (just text color, no background)
const DOT_COMMAND_COLORS: Record<string, string> = {
  // Capture commands
  capture: 'text-violet-600',
  screenshot: 'text-amber-600',
  embed: 'text-blue-600',
  // Data commands
  price: 'text-emerald-600',
  volume: 'text-emerald-600',
  marketcap: 'text-emerald-600',
  change: 'text-emerald-600',
  pe: 'text-emerald-600',
  dividend: 'text-emerald-600',
  data: 'text-emerald-600',
  table: 'text-emerald-600',
  chart: 'text-emerald-600',
  metric: 'text-emerald-600',
  // Content commands
  task: 'text-cyan-600',
  event: 'text-pink-600',
  note: 'text-orange-600',
  link: 'text-blue-600',
  template: 'text-orange-600',
  // Other
  ai: 'text-purple-600',
  help: 'text-gray-600',
  toc: 'text-indigo-600',
  divider: 'text-gray-500',
}

// Data commands that can have a symbol suffix like .price.AAPL
const DATA_COMMANDS = ['price', 'volume', 'marketcap', 'change', 'pe', 'dividend']

export interface DotCommandOptions {
  onCaptureClick?: () => void
  onScreenshotClick?: () => void
  onEmbedClick?: (url?: string) => void
}

export const DotCommandExtension = Extension.create<DotCommandOptions>({
  name: 'dotCommand',

  addOptions() {
    return {
      onCaptureClick: undefined,
      onScreenshotClick: undefined,
      onEmbedClick: undefined
    }
  },

  addProseMirrorPlugins() {
    const { onCaptureClick, onScreenshotClick, onEmbedClick } = this.options

    return [
      new Plugin({
        key: DotCommandPluginKey,
        state: {
          init(_, { doc, selection }) {
            return findDotCommands(doc, selection.from)
          },
          apply(tr, oldDecorations, oldState, newState) {
            if (tr.docChanged || tr.selectionSet) {
              return findDotCommands(tr.doc, newState.selection.from)
            }
            return oldDecorations
          }
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleClick(view, pos, event) {
            const decorations = this.getState(view.state)
            if (!decorations) return false

            // Check if click is on a dot command decoration
            const found = decorations.find(pos, pos)
            if (found.length > 0) {
              const decoration = found[0]
              const spec = (decoration as any).spec

              // Only handle clicks for capture-related commands
              if (spec?.type === 'capture' && onCaptureClick) {
                event.preventDefault()
                onCaptureClick()
                return true
              }
              if (spec?.type === 'screenshot' && onScreenshotClick) {
                event.preventDefault()
                onScreenshotClick()
                return true
              }
              if (spec?.type === 'embed' && onEmbedClick) {
                event.preventDefault()
                onEmbedClick(spec.url)
                return true
              }
            }
            // Always return false for other commands to not block normal behavior
            return false
          }
        }
      })
    ]
  }
})

function findDotCommands(doc: any, cursorPos: number): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return

    const text = node.text || ''

    // First, match data commands with symbol suffix like .price.AAPL
    const dataPattern = new RegExp(
      `\\.(${DATA_COMMANDS.join('|')})\\.([A-Z0-9]+)(?=\\s|$|[.,;:!?)])`,
      'gi'
    )

    let match
    while ((match = dataPattern.exec(text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length

      // Skip if cursor is right at the end (user is still typing)
      if (cursorPos === to) continue

      const cmdName = match[1].toLowerCase()
      const color = DOT_COMMAND_COLORS[cmdName] || 'text-emerald-600'

      decorations.push(
        Decoration.inline(from, to, {
          class: `dot-command font-semibold ${color}`,
          'data-dot-command': cmdName,
          'data-symbol': match[2].toUpperCase()
        }, {
          type: cmdName,
          symbol: match[2].toUpperCase()
        })
      )
    }

    // Then match regular .command patterns (not already matched as data+symbol)
    const pattern = /\.([a-zA-Z][a-zA-Z0-9_]*)(?=\s|$|[.,;:!?)])/g

    while ((match = pattern.exec(text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length

      // Skip if cursor is right at the end of this command (user is still typing)
      if (cursorPos === to) continue

      // Skip if this position is already decorated (data command with symbol)
      const alreadyDecorated = decorations.some(d => {
        const spec = (d as any).from
        return spec === from
      })
      if (alreadyDecorated) continue

      const cmdName = match[1].toLowerCase()

      // Skip data commands without symbol - they need a symbol to be complete
      if (DATA_COMMANDS.includes(cmdName)) continue

      // Get color for this command (default to gray if unknown)
      const color = DOT_COMMAND_COLORS[cmdName] || 'text-gray-500'

      // Check if this is a clickable command
      const isClickable = ['capture', 'screenshot', 'embed'].includes(cmdName)

      decorations.push(
        Decoration.inline(from, to, {
          class: `dot-command font-semibold ${color}${isClickable ? ' cursor-pointer' : ''}`,
          'data-dot-command': cmdName
        }, {
          type: cmdName
        })
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}

export default DotCommandExtension
