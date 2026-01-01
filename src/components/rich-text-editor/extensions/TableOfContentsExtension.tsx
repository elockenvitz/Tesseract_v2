import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import React, { useState, useEffect, useCallback } from 'react'
import { List, RefreshCw, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

interface TocItem {
  id: string
  level: number
  text: string
}

function TableOfContentsView({ editor, node, updateAttributes, selected }: NodeViewProps) {
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Extract headings from the document
  const extractHeadings = useCallback(() => {
    if (!editor) return

    const headings: TocItem[] = []
    const doc = editor.state.doc

    doc.descendants((docNode: any, pos: number) => {
      if (docNode.type.name === 'heading') {
        const id = `heading-${pos}`
        headings.push({
          id,
          level: docNode.attrs.level,
          text: docNode.textContent
        })
      }
    })

    setTocItems(headings)
  }, [editor])

  // Extract on mount and when document changes
  useEffect(() => {
    extractHeadings()

    // Listen for document updates
    const updateHandler = () => extractHeadings()
    editor.on('update', updateHandler)

    return () => {
      editor.off('update', updateHandler)
    }
  }, [editor, extractHeadings])

  const scrollToHeading = (id: string) => {
    const pos = parseInt(id.replace('heading-', ''))
    editor.chain().focus().setTextSelection(pos).run()

    // Also try to scroll the element into view
    setTimeout(() => {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        const element = range.startContainer.parentElement
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }

  const getIndent = (level: number) => {
    return (level - 1) * 16
  }

  const title = node.attrs.title || 'Table of Contents'
  const showNumbers = node.attrs.showNumbers ?? true

  const getNumbering = (index: number, level: number) => {
    if (!showNumbers) return ''
    const sameLevelItems = tocItems.slice(0, index + 1).filter(item => item.level === level)
    return `${sameLevelItems.length}. `
  }

  return (
    <NodeViewWrapper className="toc-wrapper my-4" data-drag-handle>
      <div
        className={clsx(
          'rounded-lg border bg-gray-50 overflow-hidden',
          selected ? 'ring-2 ring-primary-500 border-primary-300' : 'border-gray-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-gray-600" />
            <input
              type="text"
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              className="text-sm font-semibold text-gray-800 bg-transparent border-none outline-none"
              placeholder="Table of Contents"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={extractHeadings}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronRight className={clsx('w-3.5 h-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
            </button>
          </div>
        </div>

        {/* Content */}
        {!isCollapsed && (
          <div className="px-4 py-3">
            {tocItems.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No headings found. Add headings (H1, H2, H3) to your document.
              </p>
            ) : (
              <ul className="space-y-1">
                {tocItems.map((item, index) => (
                  <li
                    key={item.id}
                    style={{ paddingLeft: getIndent(item.level) }}
                  >
                    <button
                      onClick={() => scrollToHeading(item.id)}
                      className={clsx(
                        'text-left text-sm hover:text-primary-600 hover:underline transition-colors w-full truncate',
                        item.level === 1 && 'font-semibold text-gray-900',
                        item.level === 2 && 'font-medium text-gray-800',
                        item.level === 3 && 'text-gray-600'
                      )}
                    >
                      {getNumbering(index, item.level)}{item.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Options */}
        {!isCollapsed && (
          <div className="px-4 py-2 bg-gray-100 border-t border-gray-200 flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showNumbers}
                onChange={(e) => updateAttributes({ showNumbers: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Show numbers
            </label>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// TipTap Extension
export const TableOfContentsExtension = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: 'Table of Contents' },
      showNumbers: { default: true }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents' }), 'Table of Contents']
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView)
  }
})

export default TableOfContentsExtension
