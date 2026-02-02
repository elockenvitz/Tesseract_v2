/**
 * Provenance Helper - Auto-capture origin context for trade ideas
 *
 * Tracks where trade ideas were created from (asset page, portfolio page, etc.)
 * without requiring user interaction.
 */

export type OriginType =
  | 'asset_page'
  | 'portfolio_page'
  | 'trade_lab'
  | 'search'
  | 'dashboard'
  | 'manual'

export type OriginEntityType =
  | 'asset'
  | 'portfolio'
  | 'trade_lab'
  | 'view'
  | null

export interface OriginMetadata {
  asset_symbol?: string
  asset_name?: string
  portfolio_name?: string
  trade_lab_name?: string
  view_name?: string
  search_query?: string
  [key: string]: string | undefined
}

export interface Provenance {
  origin_type: OriginType
  origin_entity_type: OriginEntityType
  origin_entity_id: string | null
  origin_route: string
  origin_metadata: OriginMetadata
}

interface ProvenanceContext {
  // Current route/pathname
  pathname: string

  // If on asset page
  assetId?: string
  assetSymbol?: string
  assetName?: string

  // If on portfolio page
  portfolioId?: string
  portfolioName?: string

  // If in trade lab
  tradeLabId?: string
  tradeLabName?: string
  viewId?: string
  viewName?: string

  // If from search
  searchQuery?: string
}

/**
 * Infer provenance from the current UI context
 */
export function inferProvenance(context: ProvenanceContext): Provenance {
  const { pathname } = context

  // Asset page detection
  if (pathname.includes('/assets/') || pathname.includes('/asset/')) {
    return {
      origin_type: 'asset_page',
      origin_entity_type: 'asset',
      origin_entity_id: context.assetId || null,
      origin_route: pathname,
      origin_metadata: {
        asset_symbol: context.assetSymbol,
        asset_name: context.assetName,
      },
    }
  }

  // Portfolio page detection
  if (pathname.includes('/portfolios/') || pathname.includes('/portfolio/')) {
    return {
      origin_type: 'portfolio_page',
      origin_entity_type: 'portfolio',
      origin_entity_id: context.portfolioId || null,
      origin_route: pathname,
      origin_metadata: {
        portfolio_name: context.portfolioName,
      },
    }
  }

  // Trade lab detection
  if (pathname.includes('/trade-lab') || pathname.includes('/simulation')) {
    return {
      origin_type: 'trade_lab',
      origin_entity_type: context.viewId ? 'view' : (context.tradeLabId ? 'trade_lab' : null),
      origin_entity_id: context.viewId || context.tradeLabId || null,
      origin_route: pathname,
      origin_metadata: {
        trade_lab_name: context.tradeLabName,
        view_name: context.viewName,
        portfolio_name: context.portfolioName,
      },
    }
  }

  // Search page detection
  if (pathname.includes('/search')) {
    return {
      origin_type: 'search',
      origin_entity_type: null,
      origin_entity_id: null,
      origin_route: pathname,
      origin_metadata: {
        search_query: context.searchQuery,
      },
    }
  }

  // Dashboard detection
  if (pathname === '/' || pathname.includes('/dashboard')) {
    return {
      origin_type: 'dashboard',
      origin_entity_type: null,
      origin_entity_id: null,
      origin_route: pathname,
      origin_metadata: {},
    }
  }

  // Default: manual
  return {
    origin_type: 'manual',
    origin_entity_type: null,
    origin_entity_id: null,
    origin_route: pathname,
    origin_metadata: {},
  }
}

/**
 * Get a human-readable display string for provenance
 */
export function getProvenanceDisplayText(provenance: Provenance): string | null {
  const { origin_type, origin_metadata } = provenance

  switch (origin_type) {
    case 'asset_page':
      if (origin_metadata.asset_symbol) {
        return `Captured from Asset: ${origin_metadata.asset_symbol}`
      }
      return 'Captured from Asset page'

    case 'portfolio_page':
      if (origin_metadata.portfolio_name) {
        return `Captured from Portfolio: ${origin_metadata.portfolio_name}`
      }
      return 'Captured from Portfolio page'

    case 'trade_lab':
      if (origin_metadata.view_name) {
        return `Captured from Trade Lab: ${origin_metadata.view_name}`
      }
      if (origin_metadata.trade_lab_name) {
        return `Captured from Trade Lab: ${origin_metadata.trade_lab_name}`
      }
      return 'Captured from Trade Lab'

    case 'search':
      if (origin_metadata.search_query) {
        return `Captured from Search: "${origin_metadata.search_query}"`
      }
      return 'Captured from Search'

    case 'dashboard':
      return 'Captured from Dashboard'

    case 'manual':
    default:
      return null // No display for manual captures
  }
}
