/**
 * Pending Lineage Store
 *
 * When a user triggers a "Next step" action from the Portfolio Log,
 * this store holds the parent context. The native object creator
 * (QuickThoughtCapture, PromptModal, UniversalNoteEditor, etc.)
 * checks this store on success and auto-links the newly created
 * object to its parent via object_links (link_type = 'results_in').
 *
 * Flow:
 *   1. Portfolio Log → sets pending (parentType, parentId, portfolioId)
 *   2. Portfolio Log → dispatches native launcher event
 *   3. Native creator → creates the real object
 *   4. Native creator → onSuccess checks this store
 *   5. If pending → creates object_links row → clears store
 */

import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { LinkableEntityType } from '../lib/object-links'

interface PendingLineage {
  parentType: LinkableEntityType
  parentId: string
  portfolioId: string
}

interface PendingLineageState {
  pending: PendingLineage | null
  setPending: (link: PendingLineage) => void
  clear: () => void

  /**
   * Called by native creators on success. If a pending lineage exists,
   * creates an object_links row (parent results_in child) and clears state.
   * Returns true if a link was made.
   */
  linkIfPending: (params: {
    childType: LinkableEntityType
    childId: string
    userId: string
  }) => Promise<boolean>
}

export const usePendingLineageStore = create<PendingLineageState>((set, get) => ({
  pending: null,

  setPending: (link) => set({ pending: link }),

  clear: () => set({ pending: null }),

  linkIfPending: async ({ childType, childId, userId }) => {
    const { pending } = get()
    if (!pending) return false

    try {
      const { error } = await supabase
        .from('object_links')
        .upsert({
          source_type: pending.parentType,
          source_id: pending.parentId,
          target_type: childType,
          target_id: childId,
          link_type: 'results_in',
          is_auto: false,
          context: null,
          created_by: userId,
        }, {
          onConflict: 'source_type,source_id,target_type,target_id,link_type',
        })

      if (error) throw error
      set({ pending: null })
      return true
    } catch (err) {
      console.error('Failed to create lineage link:', err)
      set({ pending: null })
      return false
    }
  },
}))
