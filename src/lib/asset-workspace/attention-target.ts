import type { WorkspaceDestination, SignalFocus } from './context'

/**
 * Where an attention signal takes the reader, as a plain description the Asset
 * page applies with its EXISTING navigation (sub-page + Research mode + an
 * anchor the render already has). No new routing, no engine.
 */
export interface AttentionTarget {
  subPage: WorkspaceDestination
  /** Research view mode to force, when the target is inside Research. */
  researchMode?: 'all' | 'references'
  /** An existing research anchor to scroll to. */
  anchor?: 'thesis' | 'risks' | 'targets' | 'rating' | 'case'
  /**
   * True when the exact thing has no deep-linked surface on the Asset page and
   * we used the nearest truthful context instead — so the UI can say so rather
   * than pretend it landed where asked.
   */
  approximate?: boolean
}

/**
 * Pure mapping from a signal's `focus` (and its page `destination` as the
 * fallback) to a navigation target. Never redirects to an unrelated page: a
 * signal with no precise focus lands on the page it already names.
 */
export function attentionTarget(destination: WorkspaceDestination, focus?: SignalFocus): AttentionTarget {
  switch (focus?.kind) {
    case 'decision':
      // Grouped or single waiting requests both open the Decisions sub-page.
      return { subPage: 'decisions' }
    case 'research-section':
      return { subPage: 'research', researchMode: 'all', anchor: focus.anchor }
    case 'research-evidence':
      return { subPage: 'research', researchMode: 'references' }
    case 'coverage':
      // Coverage assignment has no deep-linked surface on the Asset page; the
      // Snapshot states coverage, which is the nearest truthful context.
      return { subPage: 'snapshot', approximate: true }
    default:
      return { subPage: destination }
  }
}
