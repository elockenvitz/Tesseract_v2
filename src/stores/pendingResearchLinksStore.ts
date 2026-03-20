/**
 * Pending Research Links Store
 *
 * Holds linking context when a user creates research from the trade idea modal.
 * The modal closes, the canonical creator opens, and on save the creator calls
 * linkIfPending() to create object_links rows and clear the store.
 *
 * Flow:
 *   1. User clicks "New thought/note/prompt" in idea modal
 *   2. Store receives targets + rich context
 *   3. Modal closes
 *   4. Canonical creator opens (QuickThoughtCapture, PromptModal, NoteEditor)
 *   5. Creator renders linking banner from store context
 *   6. On save → linkIfPending() creates object_links → clears store
 *   7. On cancel/close → creator calls clear() to prevent stale links
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { LinkableEntityType } from '../lib/object-links'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingResearchTarget {
  targetType: LinkableEntityType
  targetId: string
  linkType: string
}

/** Rich context for displaying what the research will link to */
export interface PendingResearchContext {
  /** e.g. "SELL CROX" */
  ideaLabel: string
  /** e.g. "Barbero Fund" */
  portfolioName?: string
  /** e.g. "Eric Lockenvitz" */
  creatorName?: string
  /** ISO date string */
  createdAt?: string
  /** e.g. "Bear — margins declining rapidly" (if linking to a specific argument) */
  argumentLabel?: string
  /** e.g. ["CROX"] or ["V", "PYPL"] */
  assetSymbols: string[]
}

interface PendingResearchLinksState {
  targets: PendingResearchTarget[]
  context: PendingResearchContext | null

  /**
   * Set pending targets + display context. Called before launching a creator.
   */
  setPending: (targets: PendingResearchTarget[], context: PendingResearchContext) => void

  /** Clear all pending state. Call on creator cancel/close. */
  clear: () => void

  /** Whether there are pending links. */
  hasPending: () => boolean

  /**
   * Called by canonical creators on success. Creates object_links rows
   * for each target, then clears the store. Returns count of links created.
   */
  linkIfPending: (params: {
    sourceType: LinkableEntityType
    sourceId: string
    userId: string
  }) => Promise<number>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePendingResearchLinksStore = create<PendingResearchLinksState>((set, get) => ({
  targets: [],
  context: null,

  setPending: (targets, context) => set({ targets, context }),

  clear: () => set({ targets: [], context: null }),

  hasPending: () => get().targets.length > 0,

  linkIfPending: async ({ sourceType, sourceId, userId }) => {
    const { targets } = get()
    if (targets.length === 0) return 0

    let linked = 0
    for (const target of targets) {
      try {
        const { error } = await supabase
          .from('object_links')
          .upsert({
            source_type: sourceType,
            source_id: sourceId,
            target_type: target.targetType,
            target_id: target.targetId,
            link_type: target.linkType,
            is_auto: false,
            context: null,
            created_by: userId,
          }, {
            onConflict: 'source_type,source_id,target_type,target_id,link_type',
          })

        if (!error) linked++
      } catch (err) {
        console.error('[pendingResearchLinks] Failed to create link:', err)
      }
    }

    set({ targets: [], context: null })
    return linked
  },
}))
