import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { CaptureMode, CaptureEntityType } from '../types/capture'

// Information about what was captured
export interface CapturedElement {
  // The DOM element that was clicked
  element: HTMLElement
  // Bounding rect at time of capture
  rect: DOMRect
  // Auto-detected entity info (if available from data attributes)
  detectedType?: CaptureEntityType
  detectedId?: string
  detectedTitle?: string
  // Screenshot of the element (data URL)
  screenshot?: string
}

// Callback to insert capture into the editor
export type InsertCaptureCallback = (capture: {
  captureType: 'entity_live' | 'entity_static'
  entityType: CaptureEntityType
  entityId: string
  entityDisplay: string
  snapshotData?: Record<string, any>
}) => void

interface CaptureContextValue {
  // Is capture mode currently active?
  isCaptureModeActive: boolean
  // Start capture mode (called when user types .capture)
  startCaptureMode: (onInsert: InsertCaptureCallback) => void
  // End capture mode without capturing
  cancelCaptureMode: () => void
  // Called when user clicks on an element to capture
  captureElement: (element: HTMLElement) => void
  // The captured element info (shown in config modal)
  capturedElement: CapturedElement | null
  // Clear captured element (close config modal)
  clearCapturedElement: () => void
  // Complete the capture with selected options
  completeCapture: (
    entityType: CaptureEntityType,
    entityId: string,
    entityDisplay: string,
    mode: CaptureMode,
    snapshotData?: Record<string, any>
  ) => void
}

const CaptureContext = createContext<CaptureContextValue | null>(null)

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const [isCaptureModeActive, setIsCaptureModeActive] = useState(false)
  const [capturedElement, setCapturedElement] = useState<CapturedElement | null>(null)
  const insertCallbackRef = useRef<InsertCaptureCallback | null>(null)

  // Start capture mode
  const startCaptureMode = useCallback((onInsert: InsertCaptureCallback) => {
    insertCallbackRef.current = onInsert
    setIsCaptureModeActive(true)
    setCapturedElement(null)
  }, [])

  // Cancel capture mode
  const cancelCaptureMode = useCallback(() => {
    setIsCaptureModeActive(false)
    setCapturedElement(null)
    insertCallbackRef.current = null
  }, [])

  // Try to detect entity info from element's data attributes
  const detectEntityFromElement = (element: HTMLElement): Partial<CapturedElement> => {
    // Walk up the DOM tree looking for capturable data attributes
    let current: HTMLElement | null = element
    while (current) {
      // Check for data-entity-type and data-entity-id attributes
      const entityType = current.dataset.entityType as CaptureEntityType | undefined
      const entityId = current.dataset.entityId
      const entityTitle = current.dataset.entityTitle || current.dataset.title

      if (entityType && entityId) {
        return {
          detectedType: entityType,
          detectedId: entityId,
          detectedTitle: entityTitle
        }
      }

      // Also check for common patterns in the codebase
      // Asset cards often have data-asset-id
      if (current.dataset.assetId) {
        return {
          detectedType: 'asset',
          detectedId: current.dataset.assetId,
          detectedTitle: current.dataset.symbol || current.dataset.assetName
        }
      }

      // Portfolio items
      if (current.dataset.portfolioId) {
        return {
          detectedType: 'portfolio',
          detectedId: current.dataset.portfolioId,
          detectedTitle: current.dataset.portfolioName
        }
      }

      // Notes
      if (current.dataset.noteId) {
        return {
          detectedType: 'note',
          detectedId: current.dataset.noteId,
          detectedTitle: current.dataset.noteTitle
        }
      }

      // Theme
      if (current.dataset.themeId) {
        return {
          detectedType: 'theme',
          detectedId: current.dataset.themeId,
          detectedTitle: current.dataset.themeName
        }
      }

      // Workflow
      if (current.dataset.workflowId) {
        return {
          detectedType: 'workflow',
          detectedId: current.dataset.workflowId,
          detectedTitle: current.dataset.workflowName
        }
      }

      // Project
      if (current.dataset.projectId) {
        return {
          detectedType: 'project',
          detectedId: current.dataset.projectId,
          detectedTitle: current.dataset.projectName
        }
      }

      current = current.parentElement
    }

    return {}
  }

  // Capture an element
  const captureElement = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const detected = detectEntityFromElement(element)

    setCapturedElement({
      element,
      rect,
      ...detected
    })

    // Don't exit capture mode yet - wait for user to configure
  }, [])

  // Clear captured element
  const clearCapturedElement = useCallback(() => {
    setCapturedElement(null)
  }, [])

  // Complete the capture
  const completeCapture = useCallback((
    entityType: CaptureEntityType,
    entityId: string,
    entityDisplay: string,
    mode: CaptureMode,
    snapshotData?: Record<string, any>
  ) => {
    if (insertCallbackRef.current) {
      insertCallbackRef.current({
        captureType: mode === 'live' ? 'entity_live' : 'entity_static',
        entityType,
        entityId,
        entityDisplay,
        snapshotData
      })
    }

    // Reset state
    setIsCaptureModeActive(false)
    setCapturedElement(null)
    insertCallbackRef.current = null
  }, [])

  return (
    <CaptureContext.Provider
      value={{
        isCaptureModeActive,
        startCaptureMode,
        cancelCaptureMode,
        captureElement,
        capturedElement,
        clearCapturedElement,
        completeCapture
      }}
    >
      {children}
    </CaptureContext.Provider>
  )
}

export function useCaptureMode() {
  const context = useContext(CaptureContext)
  if (!context) {
    throw new Error('useCaptureMode must be used within a CaptureProvider')
  }
  return context
}

export default CaptureContext
