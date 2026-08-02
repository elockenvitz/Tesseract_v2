import type { AttentionItem } from '../../types/attention'

/**
 * Attention items carry a path-style `source_url` (`/project/{id}`,
 * `/trade-queue`, `/list/{id}`), but the product navigates by tabs rather than
 * routes — everything below `/*` is one shell. This translates a source_url
 * into the tab descriptor `handleSearchResult` expects.
 *
 * Returns null when the path has no tab equivalent, so callers can hide the
 * "Open" affordance rather than offering navigation that goes nowhere.
 */
export function attentionTarget(item: AttentionItem): { id: string; title: string; type: string; data: any } | null {
  const url = item.source_url || ''
  const [, head, id] = url.split('/')

  // Prefer the linked asset when there is one: an asset page is a more useful
  // landing place than the surface that happened to raise the alert.
  const assetId = item.context?.asset_id
  if (assetId && (head === 'asset' || head === 'ideas')) {
    return { id: assetId, title: item.title, type: 'asset', data: { id: assetId } }
  }

  switch (head) {
    case 'asset':
      return id ? { id, title: item.title, type: 'asset', data: { id } } : null
    case 'project':
      return id ? { id, title: item.title, type: 'project', data: { id } } : null
    case 'list':
      return id ? { id, title: item.title, type: 'list', data: { id } } : null
    case 'trade-queue':
      return { id: 'trade-queue', title: 'Pipeline', type: 'trade-queue', data: null }
    case 'trade-book':
      return { id: 'trade-book', title: 'Trade Book', type: 'trade-book', data: null }
    case 'trade-lab':
      return { id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', data: null }
    case 'portfolio':
      return id ? { id, title: item.title, type: 'portfolio', data: { id } } : null
    case 'theme':
      return id ? { id, title: item.title, type: 'theme', data: { id } } : null
    // `/ideas` is the surface the user is already on when this renders on
    // mobile, so navigating there is a no-op worth suppressing.
    case 'ideas':
      return null
    default:
      return null
  }
}
