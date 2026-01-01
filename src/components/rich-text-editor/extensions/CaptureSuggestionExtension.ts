import { Extension } from '@tiptap/core'

// This extension provides insert commands for captures
// Command detection is handled by DotCommandSuggestionExtension

export interface CaptureSuggestionOptions {
  // Options kept for compatibility but not used for detection
}

export const CaptureSuggestionExtension = Extension.create<CaptureSuggestionOptions>({
  name: 'captureSuggestion',

  addOptions() {
    return {
      onCaptureCommand: undefined,
      onScreenshotCommand: undefined,
      onEmbedCommand: undefined
    }
  },

  addCommands() {
    return {
      insertCaptureFromPicker: (attrs: {
        captureType: 'entity_live' | 'entity_static'
        entityType: string
        entityId: string
        entityDisplay: string
        displayTitle?: string
        snapshotData?: Record<string, any>
        snapshotAt?: string
      }) => ({ commands }) => {
        return commands.insertContent({
          type: 'capture',
          attrs: {
            captureType: attrs.captureType,
            entityType: attrs.entityType,
            entityId: attrs.entityId,
            entityDisplay: attrs.entityDisplay,
            displayTitle: attrs.displayTitle || attrs.entityDisplay,
            snapshotData: attrs.snapshotData || null,
            snapshotAt: attrs.snapshotAt || null
          }
        })
      },
      insertScreenshotCapture: (attrs: {
        screenshotPath: string
        screenshotSourceUrl?: string
        displayTitle?: string
        screenshotNotes?: string
        screenshotTags?: string[]
      }) => ({ commands }) => {
        return commands.insertContent({
          type: 'capture',
          attrs: {
            captureType: 'screenshot',
            screenshotPath: attrs.screenshotPath,
            screenshotSourceUrl: attrs.screenshotSourceUrl || '',
            displayTitle: attrs.displayTitle || 'Screenshot',
            screenshotNotes: attrs.screenshotNotes || '',
            screenshotTags: attrs.screenshotTags || []
          }
        })
      },
      insertEmbedCapture: (attrs: {
        externalUrl: string
        externalTitle?: string
        externalDescription?: string
        externalImageUrl?: string
        externalFaviconUrl?: string
      }) => ({ commands }) => {
        return commands.insertContent({
          type: 'capture',
          attrs: {
            captureType: 'embed',
            externalUrl: attrs.externalUrl,
            externalTitle: attrs.externalTitle || '',
            externalDescription: attrs.externalDescription || '',
            externalImageUrl: attrs.externalImageUrl || '',
            externalFaviconUrl: attrs.externalFaviconUrl || '',
            displayTitle: attrs.externalTitle || new URL(attrs.externalUrl).hostname
          }
        })
      }
    }
  },

  addProseMirrorPlugins() {
    // Note: Command detection is now handled by DotCommandSuggestionExtension
    // This extension only provides the insert commands
    return []
  }
})

// Augment the Commands interface for type safety
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    captureSuggestion: {
      insertCaptureFromPicker: (attrs: {
        captureType: 'entity_live' | 'entity_static'
        entityType: string
        entityId: string
        entityDisplay: string
        displayTitle?: string
        snapshotData?: Record<string, any>
        snapshotAt?: string
      }) => ReturnType
      insertScreenshotCapture: (attrs: {
        screenshotPath: string
        screenshotSourceUrl?: string
        displayTitle?: string
        screenshotNotes?: string
        screenshotTags?: string[]
      }) => ReturnType
      insertEmbedCapture: (attrs: {
        externalUrl: string
        externalTitle?: string
        externalDescription?: string
        externalImageUrl?: string
        externalFaviconUrl?: string
      }) => ReturnType
    }
  }
}

export default CaptureSuggestionExtension
