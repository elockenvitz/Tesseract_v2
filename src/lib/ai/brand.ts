/*
 * What the assistant is called, in one place.
 *
 * The name was "Co-Analyst" in the pane header, "CoAnalyst" on two buttons
 * that open it, "AI Assistant" in the header tooltip, and nothing at all in
 * the composer, which said "Ask anything". Four names for one capability is
 * how a product stops reading as a product.
 *
 * It is officially ACT AI. These constants exist so renaming it again is one
 * edit rather than a grep, and so `guard:copy` can ratchet the old names out
 * of user-visible strings (see scripts/no-legacy-ai-name.mjs).
 *
 * Deliberately NOT applied to: the `co-analyst` role on a trade idea, which is
 * a person who shares the work on an idea and has nothing to do with the
 * assistant. Renaming that would turn "3 co-analysts" into a sentence about
 * software.
 */

/** The assistant, wherever it is named. */
export const ACT_AI = 'ACT AI'

/** The expanded, full-width reading experience. */
export const ACT_AI_RESEARCH = 'ACT AI Research'

/** The grounded intelligence section on an Asset Workspace. */
export const ACT_AI_BRIEFING = 'ACT AI Briefing'

/** The composer's placeholder. Names what you are talking to. */
export const ACT_AI_PLACEHOLDER = 'Ask ACT AI…'

/** The verb form, for a control that hands one record to the assistant. */
export const ACT_AI_ANALYZE = 'Analyze with ACT AI'

/**
 * The pane's title, which is the mode's name once the pane is wide enough to
 * be a reading surface.
 */
export function actAiTitle(mode: 'compact' | 'research'): string {
  return mode === 'research' ? ACT_AI_RESEARCH : ACT_AI
}
