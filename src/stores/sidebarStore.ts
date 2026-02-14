import { create } from 'zustand'

export type InspectableItemType = 'quick_thought' | 'prompt' | 'trade_idea' | 'note' | 'thesis_update' | 'insight'

export interface SelectedItem {
  type: InspectableItemType
  id: string
}

export type SidebarMode = 'capture' | 'inspect'

/** One-shot capture type for auto-selecting a capture form when the sidebar opens */
export type PendingCaptureType = 'trade_idea' | 'prompt' | null

interface SidebarState {
  // State
  sidebarOpen: boolean
  sidebarMode: SidebarMode
  selectedItem: SelectedItem | null
  pendingCaptureType: PendingCaptureType

  // Actions
  openCaptureSidebar: (captureType?: PendingCaptureType) => void
  openInspector: (type: InspectableItemType, id: string) => void
  closeSidebar: () => void
  backToCapture: () => void
  clearPendingCaptureType: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  // Initial state
  sidebarOpen: false,
  sidebarMode: 'capture',
  selectedItem: null,
  pendingCaptureType: null,

  // Open sidebar in capture mode (default Quick Ideas view)
  openCaptureSidebar: (captureType) => set({
    sidebarOpen: true,
    sidebarMode: 'capture',
    selectedItem: null,
    pendingCaptureType: captureType ?? null,
  }),

  // Open sidebar in inspect mode with a specific item
  openInspector: (type, id) => set({
    sidebarOpen: true,
    sidebarMode: 'inspect',
    selectedItem: { type, id }
  }),

  // Close the sidebar entirely
  closeSidebar: () => set({
    sidebarOpen: false,
    pendingCaptureType: null,
    // Keep mode and item for potential re-open
  }),

  // Go back from inspect mode to capture mode
  backToCapture: () => set({
    sidebarMode: 'capture',
    selectedItem: null,
    pendingCaptureType: null,
    // Keep sidebar open
  }),

  // Clear the pending capture type after ThoughtsSection has consumed it
  clearPendingCaptureType: () => set({ pendingCaptureType: null }),
}))
