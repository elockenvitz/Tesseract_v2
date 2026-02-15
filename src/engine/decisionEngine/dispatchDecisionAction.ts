/**
 * Action dispatcher for DecisionItem CTAs.
 *
 * Maps actionKey strings to navigation events. Emits a
 * `decision-engine-action` CustomEvent that the DashboardPage
 * listens for and routes via handleSearchResult.
 */

export function dispatchDecisionAction(
  actionKey: string,
  payload: Record<string, any> = {},
): void {
  switch (actionKey) {
    case 'OPEN_TRADE_QUEUE_PROPOSAL':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'trade-queue',
          id: 'trade-queue',
          title: 'Trade Queue',
          data: { selectedTradeId: payload.tradeIdeaId },
        },
      }))
      break

    case 'OPEN_TRADE_QUEUE_EXECUTION':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'trade-queue',
          id: 'trade-queue',
          title: 'Trade Queue',
          data: { selectedTradeId: payload.tradeIdeaId },
        },
      }))
      break

    case 'OPEN_TRADE_LAB_SIMULATION':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'trade-lab',
          id: payload.labId || 'trade-lab',
          title: 'Trade Lab',
          data: { assetId: payload.assetId },
        },
      }))
      break

    case 'OPEN_ASSET_CREATE_IDEA':
      window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
        detail: {
          contextType: 'asset',
          contextId: payload.assetId,
          contextTitle: payload.assetTicker,
          captureType: 'trade_idea',
        },
      }))
      break

    case 'OPEN_ASSET_UPDATE_THESIS':
      // Navigate to asset page then scroll to thesis
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'asset',
          id: payload.assetId,
          title: payload.assetTicker || 'Asset',
          data: { id: payload.assetId, symbol: payload.assetTicker },
        },
      }))
      // After nav, trigger thesis edit
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('actionloop-edit-thesis', {
          detail: { assetId: payload.assetId },
        }))
      }, 500)
      break

    case 'OPEN_PROJECT':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'project',
          id: payload.projectId,
          title: payload.projectName || 'Project',
          data: { id: payload.projectId },
        },
      }))
      break

    case 'OPEN_TRADE_QUEUE_FILTERED':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'trade-queue',
          id: 'trade-queue',
          title: 'Trade Queue',
          data: { filter: payload.filter },
        },
      }))
      break

    case 'OPEN_PROMPT_PM':
      // Open thoughts capture with a pre-filled PM prompt
      window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
        detail: {
          contextType: 'asset',
          contextId: payload.assetId,
          contextTitle: payload.assetTicker,
          captureType: 'prompt',
          prefillText: payload.prefillText,
        },
      }))
      break

    case 'OPEN_TRADE_QUEUE_FILTER':
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: {
          type: 'trade-queue',
          id: 'trade-queue',
          title: 'Trade Queue',
          data: { filter: payload.filter },
        },
      }))
      break

    case 'OPEN_ASSET_REVIEW_SEQUENCE':
      // Open the first asset in the sequence for thesis review
      if (payload.assetIds?.length) {
        window.dispatchEvent(new CustomEvent('decision-engine-action', {
          detail: {
            type: 'asset',
            id: payload.assetIds[0],
            title: payload.assetTicker || 'Asset',
            data: { id: payload.assetIds[0], symbol: payload.assetTicker },
          },
        }))
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('actionloop-edit-thesis', {
            detail: { assetId: payload.assetIds[0] },
          }))
        }, 500)
      }
      break

    case 'OPEN_PROMPT_THREAD':
      // Prompts not fully implemented — fallback to dashboard
      break

    case 'OPEN_ADD_CATALYST_PLAN_NOTE':
      // Catalysts not fully implemented — fallback to asset page
      if (payload.assetId) {
        window.dispatchEvent(new CustomEvent('decision-engine-action', {
          detail: {
            type: 'asset',
            id: payload.assetId,
            title: payload.assetTicker || 'Asset',
            data: { id: payload.assetId },
          },
        }))
      }
      break
  }
}
