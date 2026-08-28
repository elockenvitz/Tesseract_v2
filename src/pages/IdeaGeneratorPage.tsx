import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { type IdeasInitialFilters } from '../hooks/useIdeasRouting'
import { IdeasFeedPage } from '../components/ideas/feed'
import { useOrganization } from '../contexts/OrganizationContext'

// ============================================================================
// IDEAS GENERATOR PAGE
// ============================================================================

/**
 * The Ideas route. One component, one feed.
 *
 * ── What was removed, and why it was not ported ───────────────────────────
 *
 * `LegacyIdeaGeneratorPage` — a masonry/reels view kept "for rollback" — lived
 * below this for months. It was exported and imported by nothing: the only
 * route renders `IdeaGeneratorPage`, which returns `<IdeasFeedPage />`. It was
 * compiled into every bundle and reachable by no user.
 *
 * It also carried the product's THIRD ranking system. `useDiscoveryFeed` →
 * `useUnifiedFeed` → `useRelevanceScoring` scored asset relevance from
 * `watchlist_items` and `portfolio_holdings` — a fourth definition of "relevant
 * to this reader", written before coverage existed and never given the seam.
 * Ranking unification had two honest options for it: teach it the canonical
 * scope model, or delete it. Porting a relevance definition into a view nobody
 * can open is work that can only ever create drift, so it is deleted.
 *
 * The feed it fed on is not lost — `useIdeasFeed` reads the same sources plus
 * two the legacy path never had, and ranks them with the one canonical ranker.
 */

interface IdeaGeneratorPageProps {
  onItemSelect?: (item: any) => void
  /** Initial filters passed from tab data (e.g., from "View all" navigation) */
  initialFilters?: IdeasInitialFilters
}

export function IdeaGeneratorPage({ onItemSelect }: IdeaGeneratorPageProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  // Mark the "View idea feed" step in PilotWelcomeBanner complete on
  // first visit, keyed per (user, org) to mirror how AssetTab signals
  // its own "explored an asset" step. localStorage write + custom event
  // so the banner picks it up live without a refetch.
  useEffect(() => {
    if (!user?.id || !currentOrgId) return
    const key = `pilot-tutorial-idea-feed-viewed-${user.id}-${currentOrgId}`
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('pilot-tutorial:idea-feed-viewed')) } catch { /* ignore */ }
  }, [user?.id, currentOrgId])

  return <IdeasFeedPage onItemSelect={onItemSelect} />
}

export default IdeaGeneratorPage
