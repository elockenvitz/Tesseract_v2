/**
 * The two shapes the assistant takes, and the layout each one implies.
 *
 * ── Why a module and not two branches inside the pane ────────────────────
 *
 * "Compact" and "research" are not a styling preference. They decide whether
 * a 60-row weight table is readable, whether the conversation list sits
 * alongside the thread or replaces it, and how many suggested questions fit
 * before they start wrapping. Those decisions were about to be six scattered
 * `isFullscreen ?` ternaries inside a 700-line component, which is how the
 * compact pane ended up with a reading column wider than the pane itself the
 * first time this was prototyped.
 *
 * They live here for the same reason the trail's words do: a second surface
 * (the contextual briefing, PR 3) has to lay its own prose out the same way,
 * and a test can read a class string without a DOM.
 *
 * ── What this module must NOT do ─────────────────────────────────────────
 *
 * It holds no state and owns no toggle. The mode is derived from the pane the
 * reader is already in — the desktop rail's fullscreen state — because adding
 * a second, independent mode switch would let the pane be 384px wide while
 * claiming to be in research mode. One source of truth, derived, not stored.
 */

/** Compact is the 384px right rail and the phone sheet. Research is the full-width pane. */
export type AiChatMode = 'compact' | 'research'

export interface ChatModeInput {
  /** The desktop rail's fullscreen state — the only thing that widens the pane. */
  isFullscreen?: boolean | null
  /**
   * A phone. The sheet is already edge-to-edge and has no room for an inline
   * conversation sidebar, so it stays compact whatever the rail state says.
   * Its reading rules are the research ones anyway, because a full-width
   * single column is what both of them are.
   */
  isMobile?: boolean | null
}

export function chatModeFor({ isFullscreen, isMobile }: ChatModeInput): AiChatMode {
  if (isMobile) return 'compact'
  return isFullscreen ? 'research' : 'compact'
}

/**
 * The class strings each mode implies.
 *
 * Returned as data rather than applied inline so that the compact and research
 * layouts can be compared side by side in a test, and so the briefing can ask
 * for the research reading column without importing the chat pane.
 */
export interface ChatLayout {
  /**
   * The reading column. Prose stops being readable somewhere around 90
   * characters, and a full-width 1600px pane is roughly 200, so research mode
   * centres a column instead of stretching the thread across the monitor.
   * Compact has no room to centre anything.
   */
  column: string
  /**
   * The assistant's turn.
   *
   * Not a bubble, and the rename is the point. A reply was rendered as a
   * filled grey container inset to 85% of the pane, which did two things
   * wrong at once: it read as a dense block of chat rather than as something
   * written to be read, and it spent the pane's narrowest dimension on
   * padding and empty gutter. A six-column weight table scrolled inside a
   * container that had 15% of the pane sitting empty beside it.
   *
   * The answer is the content of the pane, so it takes the pane's width in
   * both modes and sits on its surface. The reader's own turn is what stays a
   * bubble, which is also what keeps the two distinguishable without a fill
   * on each.
   */
  assistantTurn: string
  /** The reader's own turn stays inset in both modes, so the two never blur. */
  userBubble: string
  /** Padding around the thread. */
  threadPad: string
  /** Gap between turns. Research gives multi-turn reading more air. */
  threadGap: string
  /** How many suggested questions sit across. */
  promptColumns: 1 | 2
  /** Research has room for the conversation list beside the thread. */
  showInlineSidebar: boolean
  /**
   * Whether a reply's research trail starts open.
   *
   * Compact keeps it folded: the evidence rail is taller than the pane is
   * wide. Research is where someone is actually checking the sources, so it
   * opens — this is the one behavioural difference between the modes, and the
   * reason the mode is a prop on the message rather than CSS.
   */
  evidenceOpen: boolean
}

const COMPACT: ChatLayout = {
  column: 'w-full',
  assistantTurn: 'w-full max-w-none',
  userBubble: 'max-w-[85%]',
  threadPad: 'p-4',
  threadGap: 'space-y-4',
  promptColumns: 1,
  showInlineSidebar: false,
  evidenceOpen: false,
}

const RESEARCH: ChatLayout = {
  column: 'mx-auto w-full max-w-3xl',
  assistantTurn: 'w-full max-w-none',
  userBubble: 'max-w-[80%]',
  threadPad: 'px-6 py-5',
  threadGap: 'space-y-6',
  promptColumns: 2,
  showInlineSidebar: true,
  evidenceOpen: true,
}

export function chatLayout(mode: AiChatMode): ChatLayout {
  return mode === 'research' ? RESEARCH : COMPACT
}

/** What the control that switches modes should say it does next. */
export function modeToggleLabel(mode: AiChatMode): string {
  return mode === 'research' ? 'Back to compact view' : 'Expand to research mode'
}
