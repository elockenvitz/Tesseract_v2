import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import React from 'react'

/**
 * VisibilityBlockExtension - TipTap node for content with visibility restrictions
 *
 * Allows users to wrap text/content with visibility tags:
 * - private: Only the author can see this content
 * - team: Only members of a specific team can see this content
 * - portfolio: Only members with access to a specific portfolio can see this
 */

export type VisibilityType = 'private' | 'team' | 'portfolio'

export interface VisibilityBlockAttrs {
  visibilityType: VisibilityType
  targetId: string | null // team_id or portfolio_id for team/portfolio types
  targetName: string // Display name for the target (e.g., "Tech Portfolio")
  authorId: string | null // User who created this block
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    visibilityBlock: {
      setVisibilityBlock: (attrs: Partial<VisibilityBlockAttrs>) => ReturnType
      toggleVisibilityBlock: (attrs: Partial<VisibilityBlockAttrs>) => ReturnType
      insertVisibilityBlock: (attrs: Partial<VisibilityBlockAttrs>) => ReturnType
      unsetVisibilityBlock: () => ReturnType
    }
  }
}

// React component for rendering the visibility block in the editor
const VisibilityBlockView: React.FC<{
  node: any
  updateAttributes: (attrs: Partial<VisibilityBlockAttrs>) => void
  deleteNode: () => void
  selected: boolean
}> = ({ node, updateAttributes, deleteNode, selected }) => {
  const { visibilityType, targetName } = node.attrs as VisibilityBlockAttrs

  const getVisibilityConfig = () => {
    switch (visibilityType) {
      case 'private':
        return {
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ),
          label: 'Private',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-300',
          textColor: 'text-amber-700',
          badgeBg: 'bg-amber-100'
        }
      case 'team':
        return {
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          ),
          label: targetName || 'Team Only',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-300',
          textColor: 'text-blue-700',
          badgeBg: 'bg-blue-100'
        }
      case 'portfolio':
        return {
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          ),
          label: targetName || 'Portfolio Only',
          bgColor: 'bg-purple-50',
          borderColor: 'border-purple-300',
          textColor: 'text-purple-700',
          badgeBg: 'bg-purple-100'
        }
      default:
        return {
          icon: null,
          label: 'Restricted',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-300',
          textColor: 'text-gray-700',
          badgeBg: 'bg-gray-100'
        }
    }
  }

  const config = getVisibilityConfig()

  return (
    <NodeViewWrapper className="visibility-block-wrapper my-2">
      <div
        className={`
          relative rounded-lg border-l-4 ${config.borderColor} ${config.bgColor}
          ${selected ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}
        `}
      >
        {/* Header badge */}
        <div className={`
          absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-xs font-medium
          flex items-center gap-1 ${config.badgeBg} ${config.textColor}
        `}>
          {config.icon}
          <span>{config.label}</span>
        </div>

        {/* Remove button */}
        <button
          onClick={deleteNode}
          className="absolute -top-2 right-2 p-0.5 rounded-full bg-white border border-gray-200
                     text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
          title="Remove visibility restriction"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content area */}
        <div className="pt-4 pb-2 px-3">
          <NodeViewContent className="visibility-block-content" />
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const VisibilityBlockExtension = Node.create<{}>({
  name: 'visibilityBlock',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      visibilityType: {
        default: 'private',
        parseHTML: element => element.getAttribute('data-visibility-type') || 'private',
        renderHTML: attributes => ({ 'data-visibility-type': attributes.visibilityType })
      },
      targetId: {
        default: null,
        parseHTML: element => element.getAttribute('data-target-id'),
        renderHTML: attributes => attributes.targetId ? { 'data-target-id': attributes.targetId } : {}
      },
      targetName: {
        default: '',
        parseHTML: element => element.getAttribute('data-target-name') || '',
        renderHTML: attributes => attributes.targetName ? { 'data-target-name': attributes.targetName } : {}
      },
      authorId: {
        default: null,
        parseHTML: element => element.getAttribute('data-author-id'),
        renderHTML: attributes => attributes.authorId ? { 'data-author-id': attributes.authorId } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="visibility-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'visibility-block' }), 0]
  },

  addCommands() {
    return {
      setVisibilityBlock:
        (attrs: Partial<VisibilityBlockAttrs>) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attrs)
        },
      toggleVisibilityBlock:
        (attrs: Partial<VisibilityBlockAttrs>) =>
        ({ commands, state, chain }) => {
          const { selection } = state
          const { empty } = selection

          // If there's a selection, try to wrap it
          if (!empty) {
            return commands.toggleWrap(this.name, attrs)
          }

          // If no selection, insert a new visibility block with empty paragraph
          return chain()
            .insertContent({
              type: this.name,
              attrs,
              content: [{ type: 'paragraph' }]
            })
            .run()
        },
      insertVisibilityBlock:
        (attrs: Partial<VisibilityBlockAttrs>) =>
        ({ tr, dispatch, state, editor }) => {
          console.log('[VisibilityBlock] insertVisibilityBlock command called')
          if (dispatch) {
            const node = state.schema.nodes.visibilityBlock.create(
              attrs,
              state.schema.nodes.paragraph.create()
            )

            // Insert at current position
            const pos = state.selection.from
            console.log('[VisibilityBlock] inserting at pos:', pos)
            tr.insert(pos, node)

            // The visibilityBlock node structure is:
            // visibilityBlock (1) > paragraph (1) > text position (1)
            // So cursor should be at pos + 2 (after block open + after paragraph open)
            const cursorPos = pos + 2
            console.log('[VisibilityBlock] setting cursor to:', cursorPos, 'doc size:', tr.doc.content.size)

            try {
              tr.setSelection(TextSelection.create(tr.doc, cursorPos))
              console.log('[VisibilityBlock] selection set successfully')
            } catch (e) {
              console.error('[VisibilityBlock] error setting selection:', e)
              // Fallback: try to select at end of inserted content
              const endPos = pos + node.nodeSize - 1
              tr.setSelection(TextSelection.create(tr.doc, endPos))
            }

            dispatch(tr)

            // Force focus after dispatch
            setTimeout(() => {
              editor.commands.focus()
            }, 0)
          }
          return true
        },
      unsetVisibilityBlock:
        () =>
        ({ commands }) => {
          return commands.lift(this.name)
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl+Shift+P for private
      'Mod-Shift-p': () => this.editor.commands.toggleVisibilityBlock({ visibilityType: 'private' })
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(VisibilityBlockView)
  }
})

export default VisibilityBlockExtension

/**
 * Utility function to filter content based on viewer's access
 * Used when rendering content for users who may not have access to all visibility blocks
 */
export function filterContentByVisibility(
  content: string,
  viewerId: string,
  viewerTeamIds: string[],
  viewerPortfolioIds: string[]
): string {
  // Parse the HTML content
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/html')

  // Find all visibility blocks
  const visibilityBlocks = doc.querySelectorAll('[data-type="visibility-block"]')

  visibilityBlocks.forEach(block => {
    const visibilityType = block.getAttribute('data-visibility-type')
    const targetId = block.getAttribute('data-target-id')
    const authorId = block.getAttribute('data-author-id')

    let hasAccess = false

    switch (visibilityType) {
      case 'private':
        // Only the author can see private content
        hasAccess = authorId === viewerId
        break
      case 'team':
        // Check if viewer is a member of the team
        hasAccess = targetId ? viewerTeamIds.includes(targetId) : false
        break
      case 'portfolio':
        // Check if viewer has access to the portfolio
        hasAccess = targetId ? viewerPortfolioIds.includes(targetId) : false
        break
      default:
        hasAccess = false
    }

    if (!hasAccess) {
      // Remove the block entirely if viewer doesn't have access
      block.remove()
    } else {
      // If viewer has access, unwrap the content (remove the visibility wrapper but keep content)
      const parent = block.parentNode
      if (parent) {
        while (block.firstChild) {
          parent.insertBefore(block.firstChild, block)
        }
        block.remove()
      }
    }
  })

  return doc.body.innerHTML
}
