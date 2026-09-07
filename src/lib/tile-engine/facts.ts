/**
 * The input boundary of the tile engine: facts and events, before meaning.
 *
 * ── Why this layer exists at all ──────────────────────────────────────────
 *
 * Every card family in the product currently reaches its own way into its own
 * source — a lens reads holdings, a builder reads a target row, an evaluator
 * reads a project. That is fine while a card is the only consumer, and it is
 * exactly what stops a second consumer existing: the desktop workbench cannot
 * ask "what do we know about MSFT" without re-running seven producers, because
 * the knowledge only exists in the shape of the card that happened to want it.
 *
 * So the engine starts one level below the card. A `Fact` is something the
 * product knows, carrying WHERE it came from and WHEN it was true. It has no
 * opinion, no threshold, no severity and no words a reader would see.
 *
 * ── Pure, and deliberately anaemic ────────────────────────────────────────
 *
 * No React, no Supabase, no clock. Nothing here decides whether a fact is
 * interesting — that is the finding layer's entire job, and folding the two
 * would recreate the thing this replaces: a producer that can only emit facts
 * it already knows how to render.
 */

import type { NumberSource } from '../signals/contract'

/**
 * Where a fact came from and how much to trust it.
 *
 * Reused from the card contract rather than redeclared. The vintage rules the
 * signals layer learned the hard way — a `holdings` mark is an upload-time
 * price carried forward, never comparable to a quote — are not rules about
 * cards, they are rules about the numbers themselves, and the engine inherits
 * them by using the same type.
 */
export type FactSource = NumberSource

/** A value the product knows, with its provenance attached. */
export interface Fact<V = unknown> {
  /** Stable within a subject. `weight_pct`, `target_price`, `last_review_at`. */
  key: string
  value: V
  source: FactSource
  /** ISO. When the value was true, not when it was read. */
  asOf: string
}

export type NumericFact = Fact<number>
export type TemporalFact = Fact<string>

/**
 * A fact whose value is a deliberate absence.
 *
 * `null` and "we did not look" are different answers and the distinction is
 * load-bearing all over this product: a target of `null` is the entire finding
 * on a no-target card, and a benchmark weight of `null` means the book has no
 * benchmark file rather than a zero weight. Modelling absence as a value the
 * engine can carry keeps that distinction alive up to the plan, where it
 * becomes a dashed empty slot rather than a missing region.
 */
export type AbsentFact = Fact<null>

export const isAbsent = (f: Fact): f is AbsentFact => f.value === null

/**
 * A dated thing that happened, as opposed to a value that is true.
 *
 * Kept separate from `Fact` because the two answer different questions and the
 * finding layer treats them differently: a fact can go stale, an event cannot.
 * A price target set in March is a fact with an old `asOf`; a rating change in
 * March is an event that will always have happened in March.
 */
export interface DomainEvent {
  key: string
  occurredAt: string
  actorId?: string | null
  payload?: Record<string, unknown>
}

/** Epoch ms for a fact or event, or null when unparseable. */
export function epochOf(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const t = typeof v === 'number' ? v : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Whole days between two instants, floored. Negative when `then` is later. */
export function daysBetween(then: string | number | null | undefined, now: number): number | null {
  const t = epochOf(then)
  if (t == null) return null
  return Math.floor((now - t) / 86_400_000)
}
