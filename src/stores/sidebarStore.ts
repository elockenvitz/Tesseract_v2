import { create } from 'zustand'
import type { CapturePrefill } from '../lib/capture/prefill'

export type InspectableItemType = 'quick_thought' | 'prompt' | 'trade_idea' | 'note' | 'thesis_update' | 'insight'

export interface SelectedItem {
  type: InspectableItemType
  id: string
}

export type SidebarMode = 'capture' | 'inspect'

/**
 * One-shot capture type for auto-selecting a capture form when the sidebar opens.
 *
 * `proposal` was missing while `ThoughtsSection.handleOpenCapture` had rendered
 * its form all along -- the recommendation capture existed and could be reached
 * by hand inside the sidebar, but no surface could open directly into it. Added
 * so the four modes the sidebar actually renders are the four a caller can ask
 * for; nothing new is created by naming it.
 */
export type PendingCaptureType = 'idea' | 'trade_idea' | 'prompt' | 'proposal' | null

interface SidebarState {
  // State
  sidebarOpen: boolean
  sidebarMode: SidebarMode
  selectedItem: SelectedItem | null
  pendingCaptureType: PendingCaptureType
  /**
   * Words to open the capture form with, from whoever asked for it.
   *
   * One-shot, exactly like `pendingCaptureType`, and cleared on every path
   * that leaves the form: a draft that survived into the NEXT capture would
   * put one reader's promoted answer into an unrelated note.
   */
  pendingCapturePrefill: CapturePrefill | null

  // Actions
  openCaptureSidebar: (captureType?: PendingCaptureType, prefill?: CapturePrefill | null) => void
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
  pendingCapturePrefill: null,

  // Open sidebar in capture mode (default Quick Ideas view)
  openCaptureSidebar: (captureType, prefill) => set({
    sidebarOpen: true,
    sidebarMode: 'capture',
    selectedItem: null,
    pendingCaptureType: captureType ?? null,
    pendingCapturePrefill: prefill ?? null,
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
    pendingCapturePrefill: null,
    // Keep mode and item for potential re-open
  }),

  // Go back from inspect mode to capture mode
  backToCapture: () => set({
    sidebarMode: 'capture',
    selectedItem: null,
    pendingCaptureType: null,
    pendingCapturePrefill: null,
    // Keep sidebar open
  }),

  // Clear both one-shots once ThoughtsSection has consumed them
  clearPendingCaptureType: () => set({ pendingCaptureType: null, pendingCapturePrefill: null }),
}))
