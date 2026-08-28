/**
 * Turning ranking reasons into something a reader can act on.
 *
 * ── The line this module draws ────────────────────────────────────────────
 *
 * `feed-priority` emits `RankReason[]` — codes and signed contributions — and
 * deliberately emits no copy, because a ranker that produced finished strings
 * would decide tone, length and language for every surface that renders them.
 * This is the other half of that contract: the one place ranking vocabulary
 * becomes product vocabulary.
 *
 * That makes it the place a rename has to happen once. The model's internal
 * bands are `direct`, `assigned`, `held`; the product says **My Scope**,
 * **Assigned to you**, **In portfolio**. Those are not synonyms a reader should
 * ever have to translate, and "direct coverage" on a card is a database column
 * leaking into a workspace. A test asserts none of the internal names can
 * appear in rendered output.
 *
 * ── Why one reason and not five ───────────────────────────────────────────
 *
 * Every card has several true reasons. A row that lists all of them stops
 * being an explanation and becomes a wall of badges the eye skips — which is
 * worse than no explanation, because it costs space and teaches the reader to
 * ignore that region. So: one primary, at most one secondary, chosen by what
 * the reader can act on rather than by what scored highest.
 *
 * Relevance beats mechanics. "My Scope" tells a reader why this is theirs;
 * "fresh" tells them something they can see from the timestamp. So a scope
 * reason is always primary when one exists, and the strongest remaining driver
 * becomes secondary.
 */

import type { RankReason, RankReasonCode } from '../../../lib/signals/feed-priority'

export interface WhyThis {
  /** The reason a reader should read first. Never absent. */
  primary: WhyLabel
  /** At most one more, when it adds something the primary does not. */
  secondary?: WhyLabel
}

export interface WhyLabel {
  code: RankReasonCode | 'default'
  /** Short, user-facing. Never an internal enum name. */
  label: string
  /**
   * A sentence, only where the reason is not self-evident from the label.
   *
   * Today this is populated for exactly one code — `readthrough` — because it
   * is the only reason whose subject is a DIFFERENT asset than the row is
   * about, so the label alone cannot carry it.
   */
  detail?: string
  /** How loudly to render it. Not a colour: the card decides that. */
  tone: 'scope' | 'urgent' | 'action' | 'neutral'
}

/**
 * Relevance reasons, strongest claim first.
 *
 * Order matters: a name can be both assigned and held, and "Assigned to you"
 * is the more specific fact about this reader's responsibility.
 */
const SCOPE_ORDER: RankReasonCode[] = ['in_my_scope', 'assigned_to_me', 'readthrough', 'held']

const LABELS: Partial<Record<RankReasonCode, Omit<WhyLabel, 'code'>>> = {
  in_my_scope: { label: 'My Scope', tone: 'scope' },
  assigned_to_me: { label: 'Assigned to you', tone: 'scope' },
  held: { label: 'In portfolio', tone: 'scope' },
  urgency: { label: 'Urgent', tone: 'urgent' },
  unresolved: { label: 'Open decision', tone: 'action' },
  off_framework: { label: 'Off framework', tone: 'urgent' },
  freshness: { label: 'Fresh update', tone: 'neutral' },
  followed_author: { label: 'Author you follow', tone: 'neutral' },
  own_post: { label: 'Yours', tone: 'neutral' },
  peer_interest: { label: 'Team engaging', tone: 'neutral' },
  acknowledged: { label: 'Seen before', tone: 'neutral' },
}

/**
 * Reasons that describe the ranking rather than the reader's world.
 *
 * `material` is the position-size band. It is real and it is not an
 * explanation: "this is a large position" is visible from the portfolio and
 * says nothing about why the row is on screen TODAY. Excluded rather than
 * relabelled, because a reason nobody can act on is noise wearing a badge.
 */
const NOT_SHOWN: ReadonlySet<RankReasonCode> = new Set(['material'])

/**
 * Reasons that may lead a row but must never be its second chip.
 *
 * `freshness` is true of most of the feed and is already on the row as an age.
 * "My Scope · Fresh update" next to a "1d" column spends a chip restating the
 * column, and at eleven days old it is not even true — the term decays over a
 * fortnight, so a row can still carry it while a reader would call it stale.
 * It survives as a fallback for a row with nothing better to say, which is the
 * one case where it is genuinely the reason.
 */
const PRIMARY_ONLY: ReadonlySet<RankReasonCode> = new Set(['freshness'])

/**
 * The readthrough label names the asset it reads THROUGH to, not the asset the
 * row is about — which is the whole point of the concept and the only reason
 * its label has to be built rather than looked up.
 *
 * Nothing produces `readthrough` yet. The shape is here so that when the
 * relationship graph lands, it renders through this function and the card
 * architecture does not move. See docs/tickets/ideas-ranking-divergence.md.
 */
function readthroughLabel(reason: RankReason): WhyLabel {
  const via = (reason.detail as any)?.via
  const target = via?.targetTicker ?? via?.targetAssetId
  return {
    code: 'readthrough',
    label: target ? `Readthrough to ${target}` : 'Readthrough',
    detail: via?.explanation,
    tone: 'scope',
  }
}

function labelFor(reason: RankReason): WhyLabel | null {
  if (reason.code === 'readthrough') return readthroughLabel(reason)
  const base = LABELS[reason.code]
  return base ? { code: reason.code, ...base } : null
}

/** When nothing rose above the noise floor — a real state, not an error. */
const DEFAULT: WhyLabel = { code: 'default', label: 'In your feed', tone: 'neutral' }

export function whyThis(reasons: readonly RankReason[] | undefined): WhyThis {
  const usable = (reasons ?? []).filter(r => !NOT_SHOWN.has(r.code))

  const scope = SCOPE_ORDER
    .map(code => usable.find(r => r.code === code))
    .find(Boolean)

  const rest = usable
    .filter(r => r !== scope && !SCOPE_ORDER.includes(r.code))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))

  const primary = (scope && labelFor(scope)) ?? (rest[0] && labelFor(rest[0])) ?? DEFAULT
  const secondary = scope
    ? rest.filter(r => !PRIMARY_ONLY.has(r.code)).map(labelFor).find(Boolean) ?? undefined
    : undefined

  return secondary ? { primary, secondary } : { primary }
}
