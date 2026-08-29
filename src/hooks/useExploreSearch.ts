import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganizationOptional } from '../contexts/OrganizationContext'
import {
  assetResearchSearchQuery,
  RESEARCH_SECTION_LABEL,
  type LegacyResearchSection,
} from '../lib/research/asset-research'

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
 * rationales, research notes, captured thoughts, portfolio notes, and theme
 * and list descriptions. The result is a mixed feed of things that *mention*
 * the term, which is what makes a keyword behave like a topic rather than a
 * lookup.
 *
 * Multi-word queries match every word rather than the literal string. One
 * OR-group per token, ANDed by PostgREST, so "AI capex" finds the note
 * arguing about capital spending on AI — not only one containing that exact
 * pair of words, which is what it used to do and why searching a concept
 * instead of a name returned nothing.
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
  /**
   * True when this came from the relaxed pass — it matched some of the query,
   * not all of it. Surfaced separately so "related" never masquerades as an
   * answer, which is the difference between a useful suggestion and a wrong
   * result.
   */
  related?: boolean
  data: any
}

const MATCH_NAME = 100
const MATCH_SYMBOL = 200
const MATCH_BODY = 40

/**
 * A scattered match is worth less than the phrase.
 *
 * Searching "AI capex" should surface a note arguing about AI capital
 * spending above one that says "AI" in the first line and "capex" in the
 * last, but it should surface both — the second is exactly the kind of
 * adjacent thinking this search exists to turn up.
 */
const SCATTER_PENALTY = 0.45

/** Words worth matching on. Single characters and noise words are dropped. */
const STOP = new Set([
  'the','a','an','and','or','of','in','on','for','to','is','are','was','were',
  'be','by','with','at','as','it','its','that','this','from','we','our',
])

function tokenize(term: string): string[] {
  return Array.from(new Set(
    term.toLowerCase().split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2 && !STOP.has(t))
  )).slice(0, 6)
}

/**
 * How well a set of fields matches, as a multiplier on the field's tier.
 *
 * Returns 0 when nothing matched, so a row that came back because a *different*
 * field matched does not claim a hit it does not have.
 */
function strength(text: string | null | undefined, phrase: string, tokens: string[]): number {
  const hay = (text ?? '').toLowerCase()
  if (!hay) return 0
  if (phrase && hay.includes(phrase.toLowerCase())) return 1
  if (!tokens.length) return 0
  const hits = tokens.filter(t => hay.includes(t)).length
  if (!hits) return 0
  // Partial token coverage still counts — "datacenter capex risk" matching two
  // of three words is usually the thing you wanted.
  return SCATTER_PENALTY * (hits / tokens.length)
}

/**
 * Apply one OR-group per token, which ANDs across tokens in PostgREST.
 *
 * Chained .or() calls combine with AND, so this asks for "every word appears
 * somewhere in these fields" rather than "this exact string appears". Without
 * it a two-word query only matched documents containing that literal string,
 * which is why searching a concept rather than a name returned nothing.
 */
function withTokens<T>(query: T, fields: string[], tokens: string[]): T {
  let q: any = query
  for (const t of tokens) {
    const esc = t.replace(/[%,()\\]/g, '')
    if (!esc) continue
    q = q.or(fields.map(f => `${f}.ilike.%${esc}%`).join(','))
  }
  return q as T
}

/**
 * One OR-group spanning every field *and* every token — "any word, anywhere".
 *
 * The counterpart to withTokens, used only when the strict pass came back
 * near-empty. Searching "margin pressure" found nothing because no single
 * document contained both words, which is a correct answer to the question
 * asked and a useless one to the person asking: they want the margin
 * discussion and the pressure discussion, and to judge the connection
 * themselves.
 */
function withAnyToken<T>(query: T, fields: string[], tokens: string[]): T {
  const clauses: string[] = []
  for (const t of tokens) {
    const esc = t.replace(/[%,()\\]/g, '')
    if (!esc) continue
    for (const f of fields) clauses.push(`${f}.ilike.%${esc}%`)
  }
  return (clauses.length ? (query as any).or(clauses.join(',')) : query) as T
}

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
      const out: ExploreResult[] = []
      const tokens = tokenize(term)
      // A one-word query is its own token, so phrase and token matching agree.
      const phrase = term

      /**
       * Both passes hit the same sources; only the token combinator differs.
       * `apply` is withTokens for the strict pass ("every word") and
       * withAnyToken for the relaxed one ("any word").
       */
      const runPass = (apply: typeof withTokens) => Promise.all([
        // Global reference only. `assets` is one shared row per ticker with no
        // organization, so anything searched here is searched across every
        // tenant — which is correct for a ticker, a company name and a sector,
        // and was very much not correct for the thesis columns this used to
        // include. Research moved to the pass below.
        apply(
          supabase.from('assets')
            .select('id, symbol, company_name, sector, updated_at'),
          ['symbol', 'company_name', 'sector'],
          tokens,
        ).limit(25),

        // The research half, now org-scoped. `asset_contributions` RLS confines
        // this to the caller's organisation, so a phrase from another firm's
        // thesis returns nothing rather than returning their thesis.
        apply(
          assetResearchSearchQuery(currentOrgId!),
          ['content'],
          tokens,
        ).limit(25),
        apply(
          supabase.from('themes').select('id, name, description, updated_at'),
          ['name', 'description'],
          tokens,
        ).limit(15),
        apply(
          supabase.from('asset_lists')
            .select('id, name, description, brief, updated_at')
            .eq('organization_id', currentOrgId!),
          ['name', 'description', 'brief'],
          tokens,
        ).limit(15),
        apply(
          supabase.from('portfolio_notes')
            .select('id, title, content, content_preview, updated_at, portfolio_id')
            .neq('is_deleted', true),
          ['title', 'content'],
          tokens,
        ).limit(15),
        apply(
          supabase.from('trade_queue_items')
            .select('id, rationale, thesis_text, updated_at, asset_id, assets(id, symbol, company_name)')
            .eq('organization_id', currentOrgId!),
          ['rationale', 'thesis_text'],
          tokens,
        ).limit(15),

        // asset_notes was missing entirely, which is the single biggest gap in
        // this search: it is where the actual research is written. Everything
        // else here is a name, a rationale or a portfolio-level note.
        apply(
          supabase.from('asset_notes')
            .select('id, title, content, content_preview, updated_at, asset_id, assets(symbol, company_name)')
            .eq('organization_id', currentOrgId!)
            .neq('is_deleted', true),
          ['title', 'content'],
          tokens,
        ).limit(20),

        // Captured thoughts are half-formed by definition, which is exactly
        // what someone asking "what should I look at next" wants to find.
        apply(
          supabase.from('quick_thoughts')
            .select('id, content, source_title, tags, updated_at, asset_id, assets(symbol, company_name)')
            .eq('organization_id', currentOrgId!)
            .neq('is_archived', true),
          ['content', 'source_title'],
          tokens,
        ).limit(15),
      ])

      let [assets, research, themes, lists, portfolioNotes, ideas, assetNotes, thoughts] =
        await runPass(withTokens)

      /**
       * Nothing matched every word — so ask for any word instead.
       *
       * "margin pressure" is the example the search box itself suggests, and
       * it returned nothing because no single document contained both. That is
       * a correct answer to the question asked and a useless one to the person
       * asking: they want the margin discussion and the pressure discussion,
       * and to judge the connection themselves. Only runs when the strict pass
       * is thin, so the common case is still one round trip, and results are
       * marked `related` so a partial match never poses as a full one.
       */
      let relaxed = false
      if (tokens.length > 1) {
        const strictCount =
          (assets.data?.length ?? 0) + (research.data?.length ?? 0) +
          (themes.data?.length ?? 0) + (lists.data?.length ?? 0) +
          (portfolioNotes.data?.length ?? 0) + (ideas.data?.length ?? 0) +
          (assetNotes.data?.length ?? 0) + (thoughts.data?.length ?? 0)
        if (strictCount < 3) {
          relaxed = true
          ;[assets, research, themes, lists, portfolioNotes, ideas, assetNotes, thoughts] =
            await runPass(withAnyToken)
        }
      }

      // Reference matches: ticker, company name, sector. No prose reaches here
      // any more, so `matchedIn` can only be one of those three.
      const seenAssets = new Set<string>()
      for (const a of ((assets.data as any[]) ?? [])) {
        const symbolHit = (a.symbol ?? '').toLowerCase() === term.toLowerCase()
        const nameHit = (a.company_name ?? '').toLowerCase().includes(term.toLowerCase())
        seenAssets.add(a.id)
        out.push({
          id: a.id,
          kind: 'asset',
          title: `${a.symbol}${a.company_name ? ` · ${a.company_name}` : ''}`,
          matchedIn: symbolHit ? 'ticker' : nameHit ? 'company name' : 'sector',
          symbol: a.symbol,
          updatedAt: a.updated_at,
          score: (symbolHit ? MATCH_SYMBOL : nameHit ? MATCH_NAME : MATCH_BODY) + recencyBonus(a.updated_at),
          data: a,
        })
      }

      // Research matches, scored as body hits exactly as the old thesis columns
      // were. An asset already returned by the reference pass is skipped rather
      // than listed twice — the same asset matching both its ticker and its
      // thesis is one result, and the ticker hit is the stronger one.
      for (const r of ((research.data as any[]) ?? [])) {
        const a = r.assets as any
        if (!a || seenAssets.has(r.asset_id)) continue
        seenAssets.add(r.asset_id)
        const section = r.section as LegacyResearchSection
        out.push({
          id: r.asset_id,
          kind: 'asset',
          title: `${a.symbol}${a.company_name ? ` · ${a.company_name}` : ''}`,
          matchedIn: RESEARCH_SECTION_LABEL[section] ?? 'research',
          excerpt: excerptAround(r.content, term),
          symbol: a.symbol,
          updatedAt: r.updated_at,
          score: MATCH_BODY + recencyBonus(r.updated_at),
          data: { ...a, id: r.asset_id },
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

      for (const n of ((portfolioNotes.data as any[]) ?? [])) {
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

      // ── asset notes ────────────────────────────────────────────────────
      for (const n of ((assetNotes.data as any[]) ?? [])) {
        const asset = n.assets as any
        const titleS = strength(n.title, phrase, tokens)
        const bodyS = strength(n.content ?? n.content_preview, phrase, tokens)
        if (!titleS && !bodyS) continue
        out.push({
          id: n.id,
          kind: 'note',
          title: n.title || (asset?.symbol ? `${asset.symbol} note` : 'Untitled note'),
          matchedIn: titleS >= bodyS ? 'note title' : 'research note',
          excerpt: excerptAround(n.content || n.content_preview, tokens[0] ?? phrase),
          symbol: asset?.symbol,
          updatedAt: n.updated_at,
          score: Math.max(MATCH_NAME * titleS, MATCH_BODY * bodyS) + recencyBonus(n.updated_at),
          data: n,
        })
      }

      // ── captured thoughts ──────────────────────────────────────────────
      for (const t of ((thoughts.data as any[]) ?? [])) {
        const asset = t.assets as any
        const bodyS = strength(t.content, phrase, tokens)
        const tagS = strength(Array.isArray(t.tags) ? t.tags.join(' ') : '', phrase, tokens)
        if (!bodyS && !tagS) continue
        const firstLine = String(t.content ?? '').split(/\r?\n/)[0].trim()
        out.push({
          id: t.id,
          kind: 'idea',
          title: firstLine.slice(0, 80) || 'Captured thought',
          matchedIn: tagS > bodyS ? 'thought tag' : 'captured thought',
          excerpt: excerptAround(t.content, tokens[0] ?? phrase),
          symbol: asset?.symbol,
          updatedAt: t.updated_at,
          score: MATCH_BODY * Math.max(bodyS, tagS) + recencyBonus(t.updated_at),
          data: t,
        })
      }

      // A relaxed hit is a suggestion, not an answer, and is scored and
      // labelled as one so it can never outrank a genuine match.
      if (relaxed) for (const r of out) { r.related = true; r.score *= 0.5 }

      // Highest first. Ties on score fall back to recency so the ordering is
      // stable between renders rather than depending on which promise settled
      // first — a list that reshuffles under the reader looks broken.
      return out.sort((a, b) =>
        b.score - a.score ||
        new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      )
    },
  })
}
