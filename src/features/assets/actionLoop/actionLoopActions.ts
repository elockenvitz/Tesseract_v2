/**
 * actionLoopActions — Dispatcher for Action Loop CTA buttons.
 *
 * Maps actionKey strings from the evaluator to concrete navigation,
 * event dispatches, or modal opens. Keeps the evaluator pure and
 * the UI component thin.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionContext {
  assetId: string
  assetSymbol?: string
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function dispatchAction(actionKey: string, ctx: ActionContext): void {
  switch (actionKey) {
    case 'OPEN_CREATE_IDEA':
      window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
        detail: {
          contextType: 'asset',
          contextId: ctx.assetId,
          contextTitle: ctx.assetSymbol || undefined,
          captureType: 'trade_idea',
        },
      }))
      break

    case 'OPEN_TRADE_LAB_SIMULATION':
      ctx.onNavigate?.({
        id: 'trade-lab',
        title: 'Trade Lab',
        type: 'trade-lab',
        data: { assetId: ctx.assetId },
      })
      break

    case 'OPEN_PROPOSAL_REVIEW':
    case 'OPEN_CONFIRM_EXECUTION':
      ctx.onNavigate?.({
        id: 'trade-queue',
        title: 'Trade Queue',
        type: 'trade-queue',
        data: { assetId: ctx.assetId },
      })
      break

    case 'OPEN_UPDATE_THESIS': {
      const el = document.getElementById('asset-anchor-thesis')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('actionloop-edit-thesis', {
          detail: { assetId: ctx.assetId },
        }))
      }, 400)
      break
    }
  }
}
