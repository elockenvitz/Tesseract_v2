/**
 * Trade Sheet Reconciliation Service
 *
 * Trade Sheets are SNAPSHOT ARTIFACTS ONLY — they do not create decision state.
 *
 * Committing a trade sheet:
 * 1. Transitions the sheet from draft → committed (immutable snapshot)
 * 2. Does NOT auto-resolve decision requests
 * 3. Does NOT advance trade idea outcomes
 *
 * All trade commitments must go through the Trade Book (accepted_trades).
 * Decision requests are resolved when accepted_trades are created, not when
 * trade sheets are committed.
 *
 * DEPRECATED BEHAVIOR (removed in trade-book-consolidation refactor):
 * - reconcileTradeSheetDecisions() no longer resolves decision_requests
 * - advanceTradeIdeas() no longer moves trade ideas to 'accepted'
 * - commitTradeSheet() only finalizes the snapshot artifact
 */

import { supabase } from '../supabase'

interface CommitResult {
  success: boolean
  tradeCount: number
}

/**
 * Commit a trade sheet: transition from draft to committed.
 *
 * This ONLY finalizes the snapshot artifact. It does not create decision state.
 * Trade commitments must go through the Trade Book (accepted_trades).
 */
export async function commitTradeSheet(
  sheetId: string,
  committedBy: string
): Promise<CommitResult> {
  const now = new Date().toISOString()

  // Fetch the sheet to get trade count for the result
  const { data: sheet, error: fetchError } = await supabase
    .from('trade_sheets')
    .select('id, variants_snapshot')
    .eq('id', sheetId)
    .single()

  if (fetchError || !sheet) {
    console.error('Failed to fetch trade sheet for commit:', fetchError)
    return { success: false, tradeCount: 0 }
  }

  // Update trade sheet status — this is the only side effect
  const { error } = await supabase
    .from('trade_sheets')
    .update({
      status: 'committed',
      committed_at: now,
      committed_by: committedBy,
    })
    .eq('id', sheetId)
    .eq('status', 'draft')

  if (error) {
    console.error('Failed to commit trade sheet:', error)
    return { success: false, tradeCount: 0 }
  }

  const variants = (sheet.variants_snapshot as any[]) || []
  return { success: true, tradeCount: variants.length }
}
