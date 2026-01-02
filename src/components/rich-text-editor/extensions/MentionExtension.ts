import { Node, mergeAttributes } from '@tiptap/core'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import Suggestion, { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import React from 'react'
import ReactDOM from 'react-dom/client'

// Unique plugin key for mentions
const MentionPluginKey = new PluginKey('mention')

export interface MentionItem {
  id: string
  name: string
  email?: string
  avatar?: string
}

interface MentionNodeAttrs {
  id: string
  label: string
}

export const MentionExtension = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onSelect: undefined as ((mention: MentionItem) => void) | undefined,
      suggestion: {
        char: '@',
        command: ({ editor, range, props }: any) => {
          // Call onSelect callback if provided
          if (this.options.onSelect) {
            this.options.onSelect({
              id: props.id,
              name: props.label,
              email: undefined
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
        renderHTML: (attributes: MentionNodeAttrs) => ({
          'data-id': attributes.id
        })
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: MentionNodeAttrs) => ({
          'data-label': attributes.label
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
        { 'data-type': this.name, class: 'mention' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `@${node.attrs.label}`
    ]
  },

  renderText({ node }) {
    return `@${node.attrs.label}`
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false
          const { selection } = state
          const { empty, anchor } = selection

          if (!empty) {
            return false
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true
              tr.insertText(
                this.options.suggestion.char || '',
                pos,
                pos + node.nodeSize
              )

              return false
            }
          })

          return isMention
        })
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: MentionPluginKey,
        ...this.options.suggestion
      })
    ]
  }
})

// Mention List Component for the dropdown
export class MentionList {
  private element: HTMLDivElement
  private root: ReactDOM.Root
  private props: SuggestionProps<MentionItem>
  private selectedIndex: number = 0
  private popup: TippyInstance | null = null

  constructor(props: SuggestionProps<MentionItem>) {
    this.props = props
    this.element = document.createElement('div')
    this.element.className = 'mention-list-wrapper'
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

  updateProps(props: SuggestionProps<MentionItem>) {
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
        this.props.command({ id: item.id, label: item.name })
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
      React.createElement(MentionListComponent, {
        items,
        selectedIndex,
        onSelect: (item: MentionItem) => {
          this.props.command({ id: item.id, label: item.name })
        }
      })
    )
  }

  destroy() {
    this.popup?.destroy()
    this.root.unmount()
  }
}

// React component for the mention list
interface MentionListComponentProps {
  items: MentionItem[]
  selectedIndex: number
  onSelect: (item: MentionItem) => void
}

function MentionListComponent({ items, selectedIndex, onSelect }: MentionListComponentProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm text-gray-500'
    }, 'No users found')
  }

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[200px] max-h-[300px] overflow-y-auto'
  }, items.map((item, index) =>
    React.createElement('button', {
      key: item.id,
      className: `w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
        index === selectedIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50'
      }`,
      onClick: () => onSelect(item)
    }, [
      React.createElement('div', {
        key: 'avatar',
        className: 'w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-medium text-sm'
      }, item.avatar ? React.createElement('img', {
        src: item.avatar,
        className: 'w-8 h-8 rounded-full object-cover'
      }) : item.name.charAt(0).toUpperCase()),
      React.createElement('div', {
        key: 'info',
        className: 'flex-1 min-w-0'
      }, [
        React.createElement('div', {
          key: 'name',
          className: 'text-sm font-medium text-gray-900 truncate'
        }, item.name),
        item.email && React.createElement('div', {
          key: 'email',
          className: 'text-xs text-gray-500 truncate'
        }, item.email)
      ])
    ])
  ))
}
