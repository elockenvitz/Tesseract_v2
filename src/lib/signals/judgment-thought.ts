import { supabase } from '../supabase'
import type { SignalCard } from './contract'

/**
 * A judgment becomes a thought the reader can actually find.
 *
 * ── Why answering needed an artefact ──────────────────────────────────────
 *
 * Applying a judgment wrote an audit row and a local disposition. Both are
 * correct and neither is visible: the card stops asking, and that is the whole
 * of what the reader gets back. So the surface asked for a decision and
 * returned nothing they could use ten minutes later — which is how a triage
 * control becomes one people stop touching.
 *
 * The judgment options already carry `note`, written in the first person
 * precisely so it could be recorded as prose. This writes it as a quick
 * thought against the same name, so a week later "what did I decide about
 * NVDA" has an answer in the place people already look for one.
 *
 * ── Private by default ────────────────────────────────────────────────────
 *
 * A judgment made while scrolling is a working note, not a publication. It
 * lands as `private`, and sharing is a separate, deliberate act from the
 * recorded state — the reader chooses to show it to someone, and until then it
 * is theirs. Defaulting the other way would make people hesitate before
 * answering honestly, which defeats the point of asking.
 *
 * ── Why a failure here is not a failure of the judgment ───────────────────
 *
 * The judgment is the record; the thought is a convenience on top of it. If
 * this write fails the judgment still stands, so the caller is told what
 * happened and nothing is rolled back. Reporting a judgment as failed because
 * its companion note did not save would be the tail wagging the dog.
 */

export interface JudgmentThoughtInput {
  userId: string
  card: SignalCard
  /** The option's first-person note. Already written for this purpose. */
  note: string
}

export interface JudgmentThoughtResult {
  /** The row id, for a follow-on share. Null when nothing was written. */
  thoughtId: string | null
  reason: 'written' | 'no_note' | 'failed'
}

/**
 * The asset a card is about, where it has one.
 *
 * Cards carry their subject as an entity with an optional ticker and id. A
 * thought with no asset is still a thought — a macro card, a workflow item —
 * so this returns null rather than refusing to write.
 */
function assetIdOf(card: SignalCard): string | null {
  const e = (card as any).entity
  return (e?.assetId ?? e?.id ?? null) || null
}

export async function writeJudgmentThought(
  input: JudgmentThoughtInput,
): Promise<JudgmentThoughtResult> {
  const content = input.note?.trim()
  // Feed-quality options ("show fewer like this") carry no note, and inventing
  // prose for them would put opinions about the FEED into the research record.
  if (!content) return { thoughtId: null, reason: 'no_note' }

  const { data, error } = await supabase
    .from('quick_thoughts')
    .insert({
      content,
      created_by: input.userId,
      asset_id: assetIdOf(input.card),
      // Private. See the header: a judgment made while scrolling is a working
      // note, and defaulting to visible would make people answer less honestly.
      visibility: 'private',
      // `organization_id` is deliberately absent. A BEFORE INSERT trigger
      // stamps it from `users.current_organization_id`, and passing it here
      // would be a second source of truth for tenancy — the one thing the
      // org-scoping work is most careful about.
    } as any)
    .select('id')
    .single()

  if (error || !data) return { thoughtId: null, reason: 'failed' }
  return { thoughtId: (data as any).id as string, reason: 'written' }
}
