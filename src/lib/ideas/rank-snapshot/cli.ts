/**
 * Capture a candidate snapshot and replay every ranker against it.
 *
 * Run through `scripts/rank-report.mjs`, which bundles this with esbuild so it
 * can be plain TypeScript sharing the application's own modules. See that file
 * for the commands.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 *
 * `--staging` authenticates as a real reader, and takes the workspace URL and
 * anon key from the ROOT environment read in place — never copied here, never
 * written to a file, never printed. The account's email and password come from
 * the process environment at run time and are used once, for a sign-in, and
 * then discarded. Nothing identifying survives into the snapshot: see
 * `redactPeople`.
 */

import { createClient } from '@supabase/supabase-js'
import { fetchSourceCandidates, recentRange } from '../candidate-pools'
import { retrievalAssetIdsFor, type CoverageIndex } from '../../signals/coverage-relevance'
import { OPEN_PROPOSAL_STATUSES } from '../open-proposal'
import { readFileSync } from 'node:fs'
import { buildFixtureSnapshot } from './fixture'

import { redactPeople, SNAPSHOT_VERSION, type RankSnapshot, type SnapshotCandidate } from './types'

/** An optional browser export of the reader's dispositions. See below. */
function loadDispositionsFile(): Record<string, any> {
  const path = process.env.TESSERACT_DISPOSITIONS_FILE
  if (!path) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.warn(`  ! could not read ${path}: ${(e as Error).message}`)
    return {}
  }
}

const DAY_MS = 86_400_000

/** Sources the capture reads, with the columns any ranker looks at. */
const SOURCES = [
  { name: 'quick_thoughts', table: 'quick_thoughts', author: 'created_by', type: 'quick_thought',
    select: 'id, created_at, created_by, asset_id, content, sentiment, assets:asset_id(id, symbol)' },
  { name: 'trade_ideas', table: 'trade_queue_items', author: 'created_by', type: 'trade_idea',
    select: 'id, created_at, created_by, asset_id, rationale, urgency, status, pair_id, pair_trade_id, assets:asset_id(id, symbol)' },
  { name: 'asset_notes', table: 'asset_notes', author: 'user_id', type: 'note',
    select: 'id, created_at, user_id, asset_id, content, assets:asset_id(id, symbol)' },
  { name: 'asset_contributions', table: 'asset_contributions', author: 'created_by', type: 'thesis_update',
    select: 'id, created_at, created_by, asset_id, content, assets:asset_id(id, symbol)' },
] as const

/**
 * Capture from a live workspace, using the product's own retrieval helper.
 *
 * `fetchSourceCandidates` is the real one, so the windows, the relevance pool
 * and the merge are exactly what the feed does. Only the column lists are
 * restated, because the feed's include the fields needed to RENDER a card and a
 * snapshot deliberately stores none of those.
 */
async function captureStaging(label: string): Promise<RankSnapshot> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.TESSERACT_STAGING_EMAIL
  const password = process.env.TESSERACT_STAGING_PASSWORD
  if (!url || !anon) throw new Error('Workspace URL/anon key not resolved from the root environment.')
  if (!email || !password) {
    throw new Error(
      'Set TESSERACT_STAGING_EMAIL and TESSERACT_STAGING_PASSWORD in your shell. ' +
      'They are used once to sign in and are never stored.',
    )
  }

  const sb = createClient(url, anon, { auth: { persistSession: false } })
  const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email, password })
  if (authError || !auth.user) throw new Error(`Sign-in failed: ${authError?.message ?? 'no user'}`)
  const userId = auth.user.id

  const { data: profile } = await sb.from('users')
    .select('current_organization_id').eq('id', userId).maybeSingle()
  const orgId = (profile as any)?.current_organization_id
  if (!orgId) throw new Error('That account has no current organization.')

  const [{ data: follows }, { data: coverageRows }, { data: holdings }] = await Promise.all([
    sb.from('author_follows').select('followed_id').eq('follower_id', userId),
    sb.from('coverage').select('asset_id, coverage_scope')
      .eq('user_id', userId).eq('organization_id', orgId).eq('is_active', true),
    sb.from('portfolio_holdings').select('asset_id'),
  ])

  const direct = new Set<string>()
  const assigned = new Set<string>()
  for (const r of (coverageRows ?? []) as any[]) {
    if (r.asset_id) (r.coverage_scope === 'personal' ? direct : assigned).add(r.asset_id)
  }
  const held = new Set<string>(((holdings ?? []) as any[]).map(h => h.asset_id).filter(Boolean))
  const coverageIndex: CoverageIndex = { ready: true, direct, assigned, held }
  const coveredAssetIds = retrievalAssetIdsFor(coverageIndex)

  const now = Date.now()
  const recentSince = new Date(now - 90 * DAY_MS).toISOString()
  const coverageSince = new Date(now - 365 * DAY_MS).toISOString()

  const candidates: SnapshotCandidate[] = []
  for (const src of SOURCES) {
    const rows = await fetchSourceCandidates({
      offset: 0,
      pageSize: 15,
      coveredAssetIds,
      recentSince: src.type === 'trade_idea' ? coverageSince : recentSince,
      coverageSince,
      build: () => {
        let q = (sb.from(src.table) as any)
          .select(src.select)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        if (src.type === 'trade_idea') {
          q = q.in('status', OPEN_PROPOSAL_STATUSES).eq('visibility_tier', 'active')
        }
        if (src.table === 'quick_thoughts') q = q.eq('is_archived', false)
        return q
      },
      onError: (pool, e) => console.warn(`  ! ${src.name} ${pool} pool: ${(e as any)?.message ?? e}`),
    })

    // Which ids the OLD recency-only window would have seen, so the snapshot
    // can mark the rows that exist only because of the relevance pool.
    const [from, to] = recentRange(0)
    const recentIds = new Set(
      rows.filter((r: any) => r.created_at >= (src.type === 'trade_idea' ? coverageSince : recentSince))
        .slice(from, to + 1).map((r: any) => String(r.id)),
    )

    for (const r of rows as any[]) {
      if (src.type === 'trade_idea' && (r.pair_id || r.pair_trade_id)) continue
      candidates.push({
        id: String(r.id),
        type: src.type,
        created_at: r.created_at,
        authorId: r[src.author] ?? null,
        assetId: r.asset_id ?? null,
        assetSymbol: r.assets?.symbol ?? null,
        contentLength: String(r.content ?? r.rationale ?? '').length,
        hasSentiment: !!r.sentiment,
        reactionCount: 0,
        urgency: r.urgency ?? null,
        status: r.status ?? null,
        source: src.name,
        fromRelevancePool: !recentIds.has(String(r.id)),
      })
    }
    console.log(`  ${src.name}: ${rows.length} rows`)
  }

  /**
   * Pair trades, grouped from their legs the way the feed does.
   *
   * Captured separately because the single-idea query above drops legs — a leg
   * rendered on its own is half a position — and because a pair is one
   * candidate spanning two names. Phase 3 asks specifically how proposals and
   * pairs behave under the canonical tiers, which cannot be answered from a
   * snapshot that has none.
   *
   * The asset recorded is the first long leg, matching `buildIdeaCard`. That is
   * lossy for scope — a pair can straddle a scoped and an unscoped name — and
   * is exactly the kind of thing the readthrough model exists to fix later.
   */
  const { data: legs } = await sb
    .from('trade_queue_items')
    .select('id, created_at, created_by, asset_id, status, urgency, rationale, pair_id, pair_trade_id, pair_leg_type, action, assets:asset_id(id, symbol)')
    .or('pair_id.not.is.null,pair_trade_id.not.is.null')
    .eq('visibility_tier', 'active')
    .eq('organization_id', orgId)
    .neq('status', 'deleted')
    .gte('created_at', coverageSince)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(120)

  const byPair = new Map<string, any[]>()
  for (const leg of (legs ?? []) as any[]) {
    const key = leg.pair_trade_id || leg.pair_id
    if (!key) continue
    const list = byPair.get(key)
    if (list) list.push(leg)
    else byPair.set(key, [leg])
  }
  const openStatuses = new Set<string>(OPEN_PROPOSAL_STATUSES as unknown as string[])
  for (const [pairId, pairLegs] of byPair) {
    if (!pairLegs.some(l => openStatuses.has(l.status))) continue
    const lead = pairLegs.find(l => l.pair_leg_type === 'long' || l.action === 'buy') ?? pairLegs[0]
    candidates.push({
      id: pairId,
      type: 'pair_trade',
      created_at: pairLegs[0].created_at,
      authorId: lead.created_by ?? null,
      assetId: lead.asset_id ?? null,
      assetSymbol: lead.assets?.symbol ?? null,
      contentLength: String(lead.rationale ?? '').length,
      hasSentiment: false,
      reactionCount: 0,
      urgency: lead.urgency ?? null,
      status: lead.status ?? null,
      source: 'pair_trades',
    })
  }
  console.log(`  pair_trades: ${byPair.size} pairs from ${(legs ?? []).length} legs`)

  /**
   * Reaction counts, in one query for every candidate.
   *
   * The desktop scorer weighted engagement at 0.2 and the canonical ranker
   * still reads it, so a capture that hard-coded zero would report a term the
   * real feed does not have at zero — and would understate exactly the rows
   * colleagues found worth responding to.
   */
  const ids = candidates.map(c => c.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: reactions, error: reactionError } = await sb
      .from('idea_reactions')
      .select('item_id')
      .in('item_id', ids.slice(i, i + 200))
    if (reactionError) {
      console.warn(`  ! reactions unavailable (${reactionError.message.slice(0, 60)}) — engagement will read as zero`)
      break
    }
    const counts = new Map<string, number>()
    for (const r of (reactions ?? []) as any[]) {
      counts.set(String(r.item_id), (counts.get(String(r.item_id)) ?? 0) + 1)
    }
    for (const c of candidates) {
      if (counts.has(c.id)) c.reactionCount = counts.get(c.id)!
    }
  }

  await sb.auth.signOut()

  // Nothing identifying leaves this function.
  const people = redactPeople([userId, ...candidates.map(c => c.authorId),
    ...((follows ?? []) as any[]).map(f => f.followed_id)])
  const opaque = (id: string | null | undefined) => (id ? people.get(id) ?? null : null)

  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date(now).toISOString(),
    source: 'staging',
    label,
    context: {
      userId: opaque(userId),
      followedIds: ((follows ?? []) as any[]).map(f => opaque(f.followed_id)).filter(Boolean) as string[],
      heldAssetIds: [...held],
      coverage: { ready: true, direct: [...direct], assigned: [...assigned], held: [...held] },
      /**
       * Dispositions live in the browser's localStorage, so a headless capture
       * cannot reach them. `--dispositions <file>` accepts an export, and the
       * report says plainly when none was supplied rather than letting an empty
       * map read as "this reader has dismissed nothing".
       *
       * To produce one, in DevTools on the signed-in app:
       *   copy(localStorage.getItem('tesseract:signal-disposition:' + <userId>))
       */
      dispositions: loadDispositionsFile(),
      now,
    },
    candidates: candidates.map(c => ({ ...c, authorId: opaque(c.authorId) })),
  }
}

export async function captureSnapshot(mode: 'fixture' | 'staging', label: string) {
  return mode === 'staging' ? captureStaging(label) : buildFixtureSnapshot(label)
}
