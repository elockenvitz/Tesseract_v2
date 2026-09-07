import { Lightbulb, List, MessageSquareQuote, Tag, Target, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The one place the capture system says what it can capture.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Four things a user can write — a thought, a trade idea, a recommendation, a
 * prompt — were described in two places that had drifted apart, and each
 * described them differently.
 *
 * `FeedCaptureSheet` had an `OPTIONS` array with a label, an icon, a colour
 * and a one-line hint. `ThoughtsSection` had a picker with different words and
 * a hand-written sentence of guidance above each form: "Jot down an
 * observation, question, or thesis", "Assign a question to a team member",
 * "Select a trade idea to submit a recommendation". The two hosts also used
 * different names for the same four things — `thought` / `trade-idea` /
 * `recommendation` / `prompt` on the phone, `idea` / `trade_idea` / `prompt` /
 * `proposal` in the pane — so nothing in the codebase asserted they were the
 * same set, and nothing stopped a fifth being added to one and not the other.
 *
 * That is what made four forms read as four products. One table fixes the
 * vocabulary; the shells then only have to render it.
 *
 * ── What this does NOT do ─────────────────────────────────────────────────
 *
 * It does not touch what is saved. Each kind still routes to the component
 * that already owns its fields, validation, provenance and org stamping. This
 * describes the CHOICE, not the payload.
 *
 * Pure — no React state, no Supabase — so both hosts and the tests can read it.
 */

/** The canonical name. The phone's spelling, because it was already the clearer one. */
export type CaptureKind =
  | 'thought'
  | 'trade-idea'
  | 'recommendation'
  | 'prompt'
  | 'add-to-list'
  | 'add-to-theme'

/**
 * `ThoughtsSection` holds its open form in a `captureMode` whose values predate
 * the phone sheet. Recorded here rather than renamed: the value is persisted in
 * component state across a session and read by the pilot onboarding steps, and
 * a rename would be a behaviour change for no gain.
 */
export type LegacyCaptureMode = 'idea' | 'trade_idea' | 'prompt' | 'proposal'

export interface CaptureType {
  kind: CaptureKind
  /** The name on the picker row and on the form's own header. */
  label: string
  /** One line under the label on the picker. What this is FOR. */
  hint: string
  /**
   * The sentence shown above the form once it is open.
   *
   * Distinct from `hint` on purpose: the hint helps you choose, and this tells
   * you what to do now that you have. Both were written twice, differently.
   */
  guidance: string
  icon: LucideIcon
  /** Whole Tailwind classes — never interpolated, or JIT drops them. */
  tone: string
  /**
   * Writing something, or filing something that already exists.
   *
   * The picker keeps them apart. Every writing option produces prose and every
   * filing option does not, and running them together as one list of six makes
   * "Add to a list" look like a sixth thing to compose.
   */
  group: 'write' | 'file'
  /** Hidden where there is no asset — filing needs something to file. */
  needsAsset?: boolean
  /** The `captureMode` this kind opens in the pane, where it has one. */
  legacyMode?: LegacyCaptureMode
}

export const CAPTURE_TYPES: CaptureType[] = [
  {
    kind: 'thought',
    label: 'Quick thought',
    hint: 'Something worth remembering. Structure it later.',
    guidance: 'Jot down an observation, question or thesis. No structure required.',
    icon: Lightbulb,
    tone: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30',
    group: 'write',
    legacyMode: 'idea',
  },
  {
    kind: 'trade-idea',
    label: 'Trade idea',
    hint: 'A position to put on, with a direction.',
    guidance: 'A position to put on. Pick the name and the direction first.',
    icon: TrendingUp,
    tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30',
    group: 'write',
    legacyMode: 'trade_idea',
  },
  {
    kind: 'recommendation',
    label: 'Recommendation',
    hint: 'Ask a PM to act. Goes to the decision queue.',
    guidance: 'Ask a PM to act on an existing trade idea. It goes to the decision queue.',
    icon: Target,
    tone: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30',
    group: 'write',
    legacyMode: 'proposal',
  },
  {
    kind: 'prompt',
    label: 'Prompt',
    hint: 'Ask someone for work or an answer.',
    guidance: 'Ask a question of someone on the team, and choose who can see it.',
    icon: MessageSquareQuote,
    tone: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30',
    group: 'write',
    legacyMode: 'prompt',
  },
  {
    kind: 'add-to-list',
    label: 'Add to a list',
    hint: 'File it somewhere you already watch.',
    guidance: 'File this name on a list you already watch.',
    icon: List,
    tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/30',
    group: 'file',
    needsAsset: true,
  },
  {
    kind: 'add-to-theme',
    label: 'Add to a theme',
    hint: 'Connect it to a thesis you are building.',
    guidance: 'Connect this name to a thesis you are building.',
    icon: Tag,
    tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/30',
    group: 'file',
    needsAsset: true,
  },
]

const BY_KIND = new Map(CAPTURE_TYPES.map(t => [t.kind, t]))
const BY_LEGACY = new Map(
  CAPTURE_TYPES.filter(t => t.legacyMode).map(t => [t.legacyMode as LegacyCaptureMode, t]),
)

export function captureType(kind: CaptureKind | null | undefined): CaptureType | undefined {
  return kind ? BY_KIND.get(kind) : undefined
}

/** The same four things, addressed by the name the pane calls them. */
export function captureTypeForMode(mode: LegacyCaptureMode | null | undefined): CaptureType | undefined {
  return mode ? BY_LEGACY.get(mode) : undefined
}

/** The things you WRITE. Four, on every surface. */
export const WRITE_CAPTURE_TYPES = CAPTURE_TYPES.filter(t => t.group === 'write')
