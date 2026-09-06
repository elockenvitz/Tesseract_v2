/**
 * The card type a derived insight becomes.
 *
 * ── Why it lives here and not beside the hook ─────────────────────────────
 *
 * It started in `useDerivedInsights`, which is a React Query hook and imports
 * `supabase`. `explore-adapters` is a PURE module rendered by the gallery, and
 * the gallery has no Supabase env — `supabase.ts` throws at module load. So
 * importing one function from the hook took the whole gallery down with
 * "Missing Supabase environment variables", every card failed to render, and
 * the layout suite sat waiting for elements that would never appear.
 *
 * The mapping itself has no dependencies at all. Keeping it in a file that
 * does is what made a one-line import a build-breaking one.
 *
 * ── Why it is shared ──────────────────────────────────────────────────────
 *
 * It was a three-way conditional in the ranking adapter and a two-way one in
 * the Explore adapter, and they disagreed about `concentration`: the ranker
 * calls it `crowding`, Explore called it `research_stale`. So a concentration
 * tile declared one type, ranked as another, and could never be matched back
 * to its card.
 */
export function insightSignalType(kind: string): string {
  if (kind === 'no_thesis') return 'no_research'
  return 'research_stale'
}
