import { create } from 'zustand'

export type InspectableItemType = 'quick_thought' | 'trade_idea' | 'note' | 'thesis_update' | 'insight'

export interface SelectedItem {
  type: InspectableItemType
  id: string
}

export type SidebarMode = 'capture' | 'inspect'

interface SidebarState {
  // State
  sidebarOpen: boolean
  sidebarMode: SidebarMode
  selectedItem: SelectedItem | null

  // Actions
  openCaptureSidebar: () => void
  openInspector: (type: InspectableItemType, id: string) => void
  closeSidebar: () => void
  backToCapture: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  // Initial state
  sidebarOpen: false,
  sidebarMode: 'capture',
  selectedItem: null,

  // Open sidebar in capture mode (default Quick Ideas view)
  openCaptureSidebar: () => set({
    sidebarOpen: true,
    sidebarMode: 'capture',
    selectedItem: null
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
    // Keep mode and item for potential re-open
  }),

  // Go back from inspect mode to capture mode
  backToCapture: () => set({
    sidebarMode: 'capture',
    selectedItem: null
    // Keep sidebar open
  })
}))
