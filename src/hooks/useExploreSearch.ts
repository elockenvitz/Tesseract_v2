import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganizationOptional } from '../contexts/OrganizationContext'

/**
 * Keyword search across *content*, not just object names.
 *
 * GlobalSearch answers "take me to the thing called X" — it matches titles and
 * navigates. That is the right behaviour when you know what you are looking
 * for, and useless when you do not: searching "datacenter" there finds an
 * asset literally named that, and nothing else, even when three theses and a
 * dozen headlines are about exactly it.
 *
 * This searches the prose: theses, where-we-are-different, risks, trade
 * rationales, note bodies, theme and list descriptions. The result is a mixed
 * feed of things that *mention* the term, ranked by where the match landed,
 * which is what makes a keyword behave like a topic rather than a lookup.
 *
 * Ranking, highest first:
 *   exact symbol match          — searching "NVDA" means the company
 *   name / title match          — the thing is called this
 *   body match                  — the thing is about this
 * Ties break on recency, so an old thesis mentioning a term in passing does
 * not outrank this week's note about it.
 */

export type ExploreKind = 'asset' | 'theme' | 'list' | 'note' | 'idea'

export interface ExploreResult {
  id: string
  kind: ExploreKind
  title: string
  /** Where the term actually appeared, so the reader knows why this is here. */
  matchedIn: string
  /** The matching prose, trimmed around the hit. */
  excerpt?: string
  symbol?: string
  updatedAt?: string | null
  score: number
  data: any
}

const MATCH_NAME = 100
const MATCH_SYMBOL = 200
const MATCH_BODY = 40

/** Escape PostgREST `or` filter metacharacters so a query cannot break out. */
function safe(term: string): string {
  return term.replace(/[%,()\\]/g, ' ').trim()
}

/** ~200 chars of the field centred on the first hit. */
function excerptAround(text: string | null | undefined, term: string): string | undefined {
  if (!text) return undefined
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return undefined
  const at = plain.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return plain.slice(0, 180)
  const start = Math.max(0, at - 70)
  return (start > 0 ? '…' : '') + plain.slice(start, start + 200).trim() + (plain.length > start + 200 ? '…' : '')
}

function recencyBonus(iso: string | null | undefined): number {
  if (!iso) return 0
  const days = (Date.now() - new Date(iso).getTime()) / 86400_000
  if (!Number.isFinite(days)) return 0
  // Small relative to the match tiers: recency breaks ties, it does not
  // outrank where the term was found.
  return Math.max(0, 20 - days / 7)
}

export function useExploreSearch(query: string, options?: { enabled?: boolean }) {
  const term = safe(query)
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<ExploreResult[]>({
    queryKey: ['explore-search', term, currentOrgId],
    // Gated on the org as well as the term: asset_lists and trade_queue_items
    // have no org-aware RLS, so the filters below are the only thing keeping
    // one workspace's lists and ideas out of another's search results. Running
    // this before the org resolves would return everything.
    enabled: (options?.enabled ?? true) && term.length >= 2 && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      const like = `%${term}%`
      const out: ExploreResult[] = []

      const [assets, themes, lists, notes, ideas] = await Promise.all([
        supabase.from('assets')
          .select('id, symbol, company_name, sector, thesis, where_different, risks_to_thesis, updated_at')
          .or(`symbol.ilike.${like},company_name.ilike.${like},sector.ilike.${like},thesis.ilike.${like},where_different.ilike.${like},risks_to_thesis.ilike.${like}`)
          .limit(25),
        supabase.from('themes')
          .select('id, name, description, updated_at')
          .or(`name.ilike.${like},description.ilike.${like}`)
          .limit(15),
        supabase.from('asset_lists')
          .select('id, name, description, brief, updated_at')
          .eq('organization_id', currentOrgId!)
          .or(`name.ilike.${like},description.ilike.${like},brief.ilike.${like}`)
          .limit(15),
        supabase.from('portfolio_notes')
          .select('id, title, content, content_preview, updated_at, portfolio_id')
          .or(`title.ilike.${like},content.ilike.${like}`)
          .neq('is_deleted', true)
          .limit(15),
        supabase.from('trade_queue_items')
          .select('id, rationale, thesis_text, updated_at, asset_id, assets(id, symbol, company_name)')
          .eq('organization_id', currentOrgId!)
          .or(`rationale.ilike.${like},thesis_text.ilike.${like}`)
          .limit(15),
      ])

      for (const a of ((assets.data as any[]) ?? [])) {
        const symbolHit = (a.symbol ?? '').toLowerCase() === term.toLowerCase()
        const nameHit = (a.company_name ?? '').toLowerCase().includes(term.toLowerCase())
        const bodyField = [
          ['thesis', a.thesis],
          ['where we differ', a.where_different],
          ['risks', a.risks_to_thesis],
        ].find(([, v]) => (v ?? '').toLowerCase().includes(term.toLowerCase()))
        out.push({
          id: a.id,
          kind: 'asset',
          title: `${a.symbol}${a.company_name ? ` · ${a.company_name}` : ''}`,
          matchedIn: symbolHit ? 'ticker' : nameHit ? 'company name' : bodyField ? String(bodyField[0]) : 'sector',
          excerpt: bodyField ? excerptAround(String(bodyField[1]), term) : undefined,
          symbol: a.symbol,
          updatedAt: a.updated_at,
          score: (symbolHit ? MATCH_SYMBOL : nameHit ? MATCH_NAME : MATCH_BODY) + recencyBonus(a.updated_at),
          data: a,
        })
      }

      for (const t of ((themes.data as any[]) ?? [])) {
        const nameHit = (t.name ?? '').toLowerCase().includes(term.toLowerCase())
        out.push({
          id: t.id, kind: 'theme', title: t.name,
          matchedIn: nameHit ? 'theme name' : 'theme description',
          excerpt: nameHit ? undefined : excerptAround(t.description, term),
          updatedAt: t.updated_at,
          score: (nameHit ? MATCH_NAME : MATCH_BODY) + recencyBonus(t.updated_at),
          data: t,
        })
      }

      for (const l of ((lists.data as any[]) ?? [])) {
        const nameHit = (l.name ?? '').toLowerCase().includes(term.toLowerCase())
        out.push({
          id: l.id, kind: 'list', title: l.name,
          matchedIn: nameHit ? 'list name' : 'list brief',
          excerpt: nameHit ? undefined : excerptAround(l.description || l.brief, term),
          updatedAt: l.updated_at,
          score: (nameHit ? MATCH_NAME : MATCH_BODY) + recencyBonus(l.updated_at),
          data: l,
        })
      }

      for (const n of ((notes.data as any[]) ?? [])) {
        const titleHit = (n.title ?? '').toLowerCase().includes(term.toLowerCase())
        out.push({
          id: n.id, kind: 'note', title: n.title || 'Untitled note',
          matchedIn: titleHit ? 'note title' : 'note body',
          excerpt: excerptAround(n.content || n.content_preview, term),
          updatedAt: n.updated_at,
          score: (titleHit ? MATCH_NAME : MATCH_BODY) + recencyBonus(n.updated_at),
          data: n,
        })
      }

      for (const i of ((ideas.data as any[]) ?? [])) {
        const asset = i.assets as any
        out.push({
          id: i.id, kind: 'idea',
          title: asset?.symbol ? `${asset.symbol} — trade rationale` : 'Trade rationale',
          matchedIn: 'trade rationale',
          excerpt: excerptAround(i.rationale || i.thesis_text, term),
          symbol: asset?.symbol,
          updatedAt: i.updated_at,
          score: MATCH_BODY + recencyBonus(i.updated_at),
          data: i,
        })
      }

      return out.sort((a, b) => b.score - a.score)
    },
  })
}
