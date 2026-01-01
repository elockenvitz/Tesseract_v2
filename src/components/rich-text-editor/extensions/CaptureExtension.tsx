import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CaptureView } from './capture/CaptureView'
import type { CaptureType, CaptureEntityType } from '../../../types/capture'

/**
 * CaptureExtension - TipTap node for embedded captures
 *
 * Supports:
 * - entity_live: Live reference to internal platform entity
 * - entity_static: Static snapshot with diff against current
 * - screenshot: Screen capture with source metadata
 * - embed: External URL with rich preview
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    capture: {
      insertCapture: (attrs: Partial<CaptureNodeAttrs>) => ReturnType
    }
  }
}

export interface CaptureNodeAttrs {
  captureId: string | null
  captureType: CaptureType

  // Entity reference
  entityType: CaptureEntityType | null
  entityId: string | null
  entityDisplay: string

  // Static snapshot
  snapshotData: Record<string, any> | null
  snapshotAt: string | null

  // External embed
  externalUrl: string
  externalTitle: string
  externalDescription: string
  externalImageUrl: string
  externalFaviconUrl: string

  // Screenshot
  screenshotPath: string
  screenshotSourceUrl: string
  screenshotNotes: string
  screenshotTags: string[]

  // Display
  displayTitle: string
  isExpanded: boolean
  previewWidth: number
  previewHeight: number

  // Context (where this capture is embedded)
  contextType: string
  contextId: string
}

export const CaptureExtension = Node.create({
  name: 'capture',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      captureId: {
        default: null,
        parseHTML: element => element.getAttribute('data-capture-id'),
        renderHTML: attributes => attributes.captureId ? { 'data-capture-id': attributes.captureId } : {}
      },
      captureType: {
        default: 'entity_live',
        parseHTML: element => element.getAttribute('data-capture-type') || 'entity_live',
        renderHTML: attributes => ({ 'data-capture-type': attributes.captureType })
      },

      // Entity reference
      entityType: {
        default: null,
        parseHTML: element => element.getAttribute('data-entity-type'),
        renderHTML: attributes => attributes.entityType ? { 'data-entity-type': attributes.entityType } : {}
      },
      entityId: {
        default: null,
        parseHTML: element => element.getAttribute('data-entity-id'),
        renderHTML: attributes => attributes.entityId ? { 'data-entity-id': attributes.entityId } : {}
      },
      entityDisplay: {
        default: '',
        parseHTML: element => element.getAttribute('data-entity-display') || '',
        renderHTML: attributes => attributes.entityDisplay ? { 'data-entity-display': attributes.entityDisplay } : {}
      },

      // Static snapshot
      snapshotData: {
        default: null,
        parseHTML: element => {
          const data = element.getAttribute('data-snapshot-data')
          return data ? JSON.parse(data) : null
        },
        renderHTML: attributes => attributes.snapshotData ? { 'data-snapshot-data': JSON.stringify(attributes.snapshotData) } : {}
      },
      snapshotAt: {
        default: null,
        parseHTML: element => element.getAttribute('data-snapshot-at'),
        renderHTML: attributes => attributes.snapshotAt ? { 'data-snapshot-at': attributes.snapshotAt } : {}
      },

      // External embed
      externalUrl: {
        default: '',
        parseHTML: element => element.getAttribute('data-external-url') || '',
        renderHTML: attributes => attributes.externalUrl ? { 'data-external-url': attributes.externalUrl } : {}
      },
      externalTitle: {
        default: '',
        parseHTML: element => element.getAttribute('data-external-title') || '',
        renderHTML: attributes => attributes.externalTitle ? { 'data-external-title': attributes.externalTitle } : {}
      },
      externalDescription: {
        default: '',
        parseHTML: element => element.getAttribute('data-external-description') || '',
        renderHTML: attributes => attributes.externalDescription ? { 'data-external-description': attributes.externalDescription } : {}
      },
      externalImageUrl: {
        default: '',
        parseHTML: element => element.getAttribute('data-external-image-url') || '',
        renderHTML: attributes => attributes.externalImageUrl ? { 'data-external-image-url': attributes.externalImageUrl } : {}
      },
      externalFaviconUrl: {
        default: '',
        parseHTML: element => element.getAttribute('data-external-favicon-url') || '',
        renderHTML: attributes => attributes.externalFaviconUrl ? { 'data-external-favicon-url': attributes.externalFaviconUrl } : {}
      },

      // Screenshot
      screenshotPath: {
        default: '',
        parseHTML: element => element.getAttribute('data-screenshot-path') || '',
        renderHTML: attributes => attributes.screenshotPath ? { 'data-screenshot-path': attributes.screenshotPath } : {}
      },
      screenshotSourceUrl: {
        default: '',
        parseHTML: element => element.getAttribute('data-screenshot-source-url') || '',
        renderHTML: attributes => attributes.screenshotSourceUrl ? { 'data-screenshot-source-url': attributes.screenshotSourceUrl } : {}
      },
      screenshotNotes: {
        default: '',
        parseHTML: element => element.getAttribute('data-screenshot-notes') || '',
        renderHTML: attributes => attributes.screenshotNotes ? { 'data-screenshot-notes': attributes.screenshotNotes } : {}
      },
      screenshotTags: {
        default: [],
        parseHTML: element => {
          const tags = element.getAttribute('data-screenshot-tags')
          return tags ? JSON.parse(tags) : []
        },
        renderHTML: attributes => attributes.screenshotTags?.length ? { 'data-screenshot-tags': JSON.stringify(attributes.screenshotTags) } : {}
      },

      // Display
      displayTitle: {
        default: '',
        parseHTML: element => element.getAttribute('data-display-title') || '',
        renderHTML: attributes => attributes.displayTitle ? { 'data-display-title': attributes.displayTitle } : {}
      },
      isExpanded: {
        default: false,
        parseHTML: element => element.getAttribute('data-is-expanded') === 'true',
        renderHTML: attributes => attributes.isExpanded ? { 'data-is-expanded': 'true' } : {}
      },
      previewWidth: {
        default: 400,
        parseHTML: element => parseInt(element.getAttribute('data-preview-width') || '400', 10),
        renderHTML: attributes => ({ 'data-preview-width': String(attributes.previewWidth) })
      },
      previewHeight: {
        default: 200,
        parseHTML: element => parseInt(element.getAttribute('data-preview-height') || '200', 10),
        renderHTML: attributes => ({ 'data-preview-height': String(attributes.previewHeight) })
      },

      // Context
      contextType: {
        default: '',
        parseHTML: element => element.getAttribute('data-context-type') || '',
        renderHTML: attributes => attributes.contextType ? { 'data-context-type': attributes.contextType } : {}
      },
      contextId: {
        default: '',
        parseHTML: element => element.getAttribute('data-context-id') || '',
        renderHTML: attributes => attributes.contextId ? { 'data-context-id': attributes.contextId } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="capture"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs.displayTitle || node.attrs.entityDisplay || 'Capture'
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'capture' }), title]
  },

  renderText({ node }) {
    const type = node.attrs.captureType
    const title = node.attrs.displayTitle || node.attrs.entityDisplay

    switch (type) {
      case 'entity_live':
        return `[Live: ${title}]`
      case 'entity_static':
        return `[Snapshot: ${title} (${node.attrs.snapshotAt})]`
      case 'screenshot':
        return `[Screenshot: ${title}]`
      case 'embed':
        return `[Embed: ${node.attrs.externalUrl}]`
      default:
        return '[Capture]'
    }
  },

  addCommands() {
    return {
      insertCapture:
        (attrs: Partial<CaptureNodeAttrs>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs
          })
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CaptureView)
  }
})

export default CaptureExtension
