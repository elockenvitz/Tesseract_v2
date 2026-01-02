import { Node, mergeAttributes } from '@tiptap/core'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import Suggestion, { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import React from 'react'
import ReactDOM from 'react-dom/client'

// Unique plugin key for assets
const AssetPluginKey = new PluginKey('asset')

export interface AssetItem {
  id: string
  symbol: string
  companyName: string
  price?: number
  change?: number
}

interface AssetNodeAttrs {
  id: string
  symbol: string
}

export const AssetExtension = Node.create({
  name: 'asset',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onSelect: undefined as ((asset: AssetItem) => void) | undefined,
      suggestion: {
        char: '$',
        command: ({ editor, range, props }: any) => {
          // Call onSelect callback if provided
          if (this.options.onSelect) {
            this.options.onSelect({
              id: props.id,
              symbol: props.symbol,
              companyName: ''
            })
          }

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: this.name,
                attrs: props
              },
              {
                type: 'text',
                text: ' '
              }
            ])
            .run()
        },
        allow: ({ editor, range }: any) => {
          return editor.can().insertContentAt(range, { type: this.name })
        }
      } as Partial<SuggestionOptions>
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
        renderHTML: (attributes: AssetNodeAttrs) => ({
          'data-id': attributes.id
        })
      },
      symbol: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-symbol'),
        renderHTML: (attributes: AssetNodeAttrs) => ({
          'data-symbol': attributes.symbol
        })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name, class: 'asset' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `$${node.attrs.symbol}`
    ]
  },

  renderText({ node }) {
    return `$${node.attrs.symbol}`
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isAsset = false
          const { selection } = state
          const { empty, anchor } = selection

          if (!empty) {
            return false
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isAsset = true
              tr.insertText(
                this.options.suggestion.char || '',
                pos,
                pos + node.nodeSize
              )

              return false
            }
          })

          return isAsset
        })
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: AssetPluginKey,
        ...this.options.suggestion
      })
    ]
  }
})

// Asset List Component for the dropdown
export class AssetList {
  private element: HTMLDivElement
  private root: ReactDOM.Root
  private props: SuggestionProps<AssetItem>
  private selectedIndex: number = 0
  private popup: TippyInstance | null = null

  constructor(props: SuggestionProps<AssetItem>) {
    this.props = props
    this.element = document.createElement('div')
    this.element.className = 'asset-list-wrapper'
    this.root = ReactDOM.createRoot(this.element)
    this.render()
    this.createPopup()
  }

  createPopup() {
    this.popup = tippy(document.body, {
      getReferenceClientRect: () => this.props.clientRect?.() || new DOMRect(),
      appendTo: () => document.body,
      content: this.element,
      showOnCreate: true,
      interactive: true,
      trigger: 'manual',
      placement: 'bottom-start',
      animation: 'shift-away',
      maxWidth: 'none'
    })
  }

  updateProps(props: SuggestionProps<AssetItem>) {
    this.props = props
    this.render()
    this.popup?.setProps({
      getReferenceClientRect: () => this.props.clientRect?.() || new DOMRect()
    })
  }

  onKeyDown({ event }: { event: KeyboardEvent }) {
    if (event.key === 'ArrowUp') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1)
      this.render()
      return true
    }

    if (event.key === 'ArrowDown') {
      this.selectedIndex = Math.min(this.props.items.length - 1, this.selectedIndex + 1)
      this.render()
      return true
    }

    if (event.key === 'Enter') {
      const item = this.props.items[this.selectedIndex]
      if (item) {
        this.props.command({ id: item.id, symbol: item.symbol })
      }
      return true
    }

    if (event.key === 'Escape') {
      this.destroy()
      return true
    }

    return false
  }

  render() {
    const items = this.props.items
    const selectedIndex = this.selectedIndex

    this.root.render(
      React.createElement(AssetListComponent, {
        items,
        selectedIndex,
        onSelect: (item: AssetItem) => {
          this.props.command({ id: item.id, symbol: item.symbol })
        }
      })
    )
  }

  destroy() {
    this.popup?.destroy()
    this.root.unmount()
  }
}

// React component for the asset list
interface AssetListComponentProps {
  items: AssetItem[]
  selectedIndex: number
  onSelect: (item: AssetItem) => void
}

function AssetListComponent({ items, selectedIndex, onSelect }: AssetListComponentProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm text-gray-500'
    }, 'No assets found')
  }

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[280px] max-h-[300px] overflow-y-auto'
  }, items.map((item, index) =>
    React.createElement('button', {
      key: item.id,
      className: `w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
        index === selectedIndex ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'
      }`,
      onClick: () => onSelect(item)
    }, [
      React.createElement('div', {
        key: 'symbol',
        className: 'w-12 h-8 rounded bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm'
      }, `$${item.symbol}`),
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
  ))
}
