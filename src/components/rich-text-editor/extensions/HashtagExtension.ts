import { Node, mergeAttributes } from '@tiptap/core'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import Suggestion, { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import React from 'react'
import ReactDOM from 'react-dom/client'

// Unique plugin key for hashtags
const HashtagPluginKey = new PluginKey('hashtag')

export interface HashtagItem {
  id: string
  name: string
  type: 'theme' | 'portfolio' | 'note' | 'list' | 'custom'
  description?: string
}

interface HashtagNodeAttrs {
  id: string
  label: string
  tagType: string
}

const TYPE_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  theme: { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: '#' },
  portfolio: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'P' },
  note: { bg: 'bg-gray-100', text: 'text-gray-700', icon: 'N' },
  list: { bg: 'bg-purple-100', text: 'text-purple-700', icon: 'L' },
  custom: { bg: 'bg-amber-100', text: 'text-amber-700', icon: '*' }
}

export const HashtagExtension = Node.create({
  name: 'hashtag',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onSelect: undefined as ((hashtag: HashtagItem) => void) | undefined,
      suggestion: {
        char: '#',
        command: ({ editor, range, props }: any) => {
          // Call onSelect callback if provided
          if (this.options.onSelect) {
            this.options.onSelect({
              id: props.id,
              name: props.label,
              type: props.tagType,
              description: undefined
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
        renderHTML: (attributes: HashtagNodeAttrs) => ({
          'data-id': attributes.id
        })
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: HashtagNodeAttrs) => ({
          'data-label': attributes.label
        })
      },
      tagType: {
        default: 'custom',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-tag-type'),
        renderHTML: (attributes: HashtagNodeAttrs) => ({
          'data-tag-type': attributes.tagType
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
        { 'data-type': this.name, class: 'hashtag' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `#${node.attrs.label}`
    ]
  },

  renderText({ node }) {
    return `#${node.attrs.label}`
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isHashtag = false
          const { selection } = state
          const { empty, anchor } = selection

          if (!empty) {
            return false
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isHashtag = true
              tr.insertText(
                this.options.suggestion.char || '',
                pos,
                pos + node.nodeSize
              )

              return false
            }
          })

          return isHashtag
        })
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: HashtagPluginKey,
        ...this.options.suggestion
      })
    ]
  }
})

// Hashtag List Component for the dropdown
export class HashtagList {
  private element: HTMLDivElement
  private root: ReactDOM.Root
  private props: SuggestionProps<HashtagItem>
  private selectedIndex: number = 0
  private popup: TippyInstance | null = null

  constructor(props: SuggestionProps<HashtagItem>) {
    this.props = props
    this.element = document.createElement('div')
    this.element.className = 'hashtag-list-wrapper'
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

  updateProps(props: SuggestionProps<HashtagItem>) {
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
        this.props.command({ id: item.id, label: item.name, tagType: item.type })
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
      React.createElement(HashtagListComponent, {
        items,
        selectedIndex,
        onSelect: (item: HashtagItem) => {
          this.props.command({ id: item.id, label: item.name, tagType: item.type })
        }
      })
    )
  }

  destroy() {
    this.popup?.destroy()
    this.root.unmount()
  }
}

// React component for the hashtag list
interface HashtagListComponentProps {
  items: HashtagItem[]
  selectedIndex: number
  onSelect: (item: HashtagItem) => void
}

function HashtagListComponent({ items, selectedIndex, onSelect }: HashtagListComponentProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm text-gray-500'
    }, 'No references found')
  }

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[240px] max-h-[300px] overflow-y-auto'
  }, items.map((item, index) => {
    const typeStyle = TYPE_COLORS[item.type] || TYPE_COLORS.custom

    return React.createElement('button', {
      key: item.id,
      className: `w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
        index === selectedIndex ? 'bg-amber-50 text-amber-700' : 'hover:bg-gray-50'
      }`,
      onClick: () => onSelect(item)
    }, [
      React.createElement('div', {
        key: 'icon',
        className: `w-8 h-8 rounded flex items-center justify-center font-medium text-sm ${typeStyle.bg} ${typeStyle.text}`
      }, typeStyle.icon),
      React.createElement('div', {
        key: 'info',
        className: 'flex-1 min-w-0'
      }, [
        React.createElement('div', {
          key: 'name',
          className: 'text-sm font-medium text-gray-900 truncate flex items-center gap-2'
        }, [
          React.createElement('span', { key: 'hashtag' }, `#${item.name}`),
          React.createElement('span', {
            key: 'type',
            className: `text-xs px-1.5 py-0.5 rounded ${typeStyle.bg} ${typeStyle.text}`
          }, item.type)
        ]),
        item.description && React.createElement('div', {
          key: 'description',
          className: 'text-xs text-gray-500 truncate'
        }, item.description)
      ])
    ])
  }))
}
