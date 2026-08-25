/**
 * The query key the feed's Case-vs-Price cards live under.
 *
 * ── Why this is a shared constant ─────────────────────────────────────────
 *
 * `useScenarioCards` derives every scenario card from `analyst_price_targets`.
 * `useAnalystPriceTargets` is what edits those rows. The two are the same data
 * behind two keys, and nothing connected them: editing a Bear case through
 * Review cases saved correctly, refreshed the editor, and left the card in the
 * feed showing the old number — while the in-card control, which invalidated
 * the feed key by hand, worked. Two write paths, one of them wired.
 *
 * A literal in each file is a wiring that can drift silently. One constant,
 * imported by the reader and by every writer, cannot.
 */
export const SCENARIO_CARDS_KEY = ['scenario-cards'] as const
