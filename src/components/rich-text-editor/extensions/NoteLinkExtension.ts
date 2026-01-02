import { Node, mergeAttributes } from '@tiptap/core'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import Suggestion, { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { PluginKey, Plugin } from '@tiptap/pm/state'
import React from 'react'
import ReactDOM from 'react-dom/client'

// Unique plugin key for note links
const NoteLinkPluginKey = new PluginKey('noteLink')

export interface NoteLinkItem {
  id: string
  title: string
  entityType: 'asset' | 'portfolio' | 'theme'
  entityId: string
  entityName: string
  noteType?: string
  updatedAt?: string
}

interface NoteLinkNodeAttrs {
  id: string
  title: string
  entityType: string
  entityId: string
}

export const NoteLinkExtension = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onSelect: undefined as ((note: NoteLinkItem) => void) | undefined,
      onNavigate: undefined as ((note: NoteLinkItem) => void) | undefined,
      suggestion: {
        char: '[[',
        pluginKey: NoteLinkPluginKey
      } as Partial<SuggestionOptions>
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-note-id'),
        renderHTML: (attributes: NoteLinkNodeAttrs) => ({
          'data-note-id': attributes.id
        })
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-title'),
        renderHTML: (attributes: NoteLinkNodeAttrs) => ({
          'data-title': attributes.title
        })
      },
      entityType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-entity-type'),
        renderHTML: (attributes: NoteLinkNodeAttrs) => ({
          'data-entity-type': attributes.entityType
        })
      },
      entityId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-entity-id'),
        renderHTML: (attributes: NoteLinkNodeAttrs) => ({
          'data-entity-id': attributes.entityId
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
        {
          'data-type': this.name,
          class: 'note-link',
          style: 'cursor: pointer;'
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `📝 ${node.attrs.title}`
    ]
  },

  renderText({ node }) {
    return `[[${node.attrs.title}]]`
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isNoteLink = false
          const { selection } = state
          const { empty, anchor } = selection

          if (!empty) {
            return false
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isNoteLink = true
              tr.insertText(
                this.options.suggestion.char || '',
                pos,
                pos + node.nodeSize
              )

              return false
            }
          })

          return isNoteLink
        })
    }
  },

  addProseMirrorPlugins() {
    const onNavigate = this.options.onNavigate

    return [
      Suggestion({
        editor: this.editor,
        pluginKey: NoteLinkPluginKey,
        ...this.options.suggestion
      }),
      // Click handler plugin
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        props: {
          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement
            const noteLink = target.closest('[data-type="noteLink"]')

            if (noteLink && onNavigate) {
              const noteId = noteLink.getAttribute('data-note-id')
              const title = noteLink.getAttribute('data-title')
              const entityType = noteLink.getAttribute('data-entity-type') as 'asset' | 'portfolio' | 'theme'
              const entityId = noteLink.getAttribute('data-entity-id')

              if (noteId && entityType && entityId) {
                onNavigate({
                  id: noteId,
                  title: title || 'Untitled',
                  entityType,
                  entityId,
                  entityName: ''
                })
                return true
              }
            }
            return false
          }
        }
      })
    ]
  }
})

// Note Link List Component for the dropdown
export class NoteLinkList {
  private element: HTMLDivElement
  private root: ReactDOM.Root
  private props: SuggestionProps<NoteLinkItem>
  private selectedIndex: number = 0
  private popup: TippyInstance | null = null

  constructor(props: SuggestionProps<NoteLinkItem>) {
    this.props = props
    this.element = document.createElement('div')
    this.element.className = 'note-link-list-wrapper'
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

  updateProps(props: SuggestionProps<NoteLinkItem>) {
    this.props = props

    // Check if the suggestion has been cancelled (no valid clientRect)
    const rect = this.props.clientRect?.()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      this.destroy()
      return
    }

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
        this.props.command({
          id: item.id,
          title: item.title,
          entityType: item.entityType,
          entityId: item.entityId,
          entityName: item.entityName
        })
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
      React.createElement(NoteLinkListComponent, {
        items,
        selectedIndex,
        onSelect: (item: NoteLinkItem) => {
          this.props.command({
            id: item.id,
            title: item.title,
            entityType: item.entityType,
            entityId: item.entityId,
            entityName: item.entityName
          })
        }
      })
    )
  }

  destroy() {
    if (this.popup) {
      this.popup.hide()
      this.popup.destroy()
      this.popup = null
    }
    try {
      this.root.unmount()
    } catch (e) {
      // Ignore unmount errors
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }
}

// React component for the note link list
interface NoteLinkListComponentProps {
  items: NoteLinkItem[]
  selectedIndex: number
  onSelect: (item: NoteLinkItem) => void
}

function NoteLinkListComponent({ items, selectedIndex, onSelect }: NoteLinkListComponentProps) {
  if (items.length === 0) {
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow-xl border border-gray-200 p-3 text-sm text-gray-500'
    }, 'No notes found')
  }

  return React.createElement('div', {
    className: 'bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[300px] max-h-[300px] overflow-y-auto'
  }, items.map((item, index) =>
    React.createElement('button', {
      key: item.id,
      className: `w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
        index === selectedIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
      }`,
      onClick: () => onSelect(item)
    }, [
      React.createElement('div', {
        key: 'icon',
        className: 'w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-sm'
      }, '📝'),
      React.createElement('div', {
        key: 'info',
        className: 'flex-1 min-w-0'
      }, [
        React.createElement('div', {
          key: 'title',
          className: 'text-sm font-medium text-gray-900 truncate'
        }, item.title),
        React.createElement('div', {
          key: 'meta',
          className: 'flex items-center gap-2 text-xs text-gray-500'
        }, [
          React.createElement('span', {
            key: 'entity',
            className: 'capitalize'
          }, `${item.entityType}: ${item.entityName}`),
          item.noteType && React.createElement('span', {
            key: 'type',
            className: 'px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 capitalize'
          }, item.noteType)
        ])
      ])
    ])
  ))
}
