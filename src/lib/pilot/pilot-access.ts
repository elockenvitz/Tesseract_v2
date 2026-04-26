/**
 * Pilot Mode — centralized feature-access configuration.
 *
 * Philosophy: pilot is about *sequenced exposure*, not stripped-down product.
 * We gate which surfaces are fully accessible, previewed (teaser), or hidden.
 *
 * Flip any key here to roll out a new pilot stage. Org-level overrides can
 * live in organizations.settings.pilot_access (JSONB) and are merged on top
 * of these defaults by usePilotMode().
 */

export type PilotAccessLevel = 'full' | 'preview' | 'hidden'

/**
 * Every surface that pilot mode cares about. Add a key here when a new page
 * or nav surface should be pilot-aware.
 */
export interface PilotAccessConfig {
  tradeLab:     PilotAccessLevel  // the wedge — always 'full' for pilots
  tradeBook:    PilotAccessLevel  // downstream — starts as 'preview'
  outcomes:     PilotAccessLevel  // further downstream — starts as 'preview'
  ideaPipeline: PilotAccessLevel  // upstream (Ideas) — 'full' so pilots can see where ideas live
  dashboard:    PilotAccessLevel  // 'full' — pilot lands here on login as the action dashboard
  priorities:   PilotAccessLevel  // starts 'hidden'
  projects:     PilotAccessLevel  // starts 'hidden'
  coverage:     PilotAccessLevel  // starts 'hidden'
  workflows:    PilotAccessLevel  // 'full' — Get Started step "Build a workflow" sends users here
  notes:        PilotAccessLevel  // starts 'full' — notes support the idea
  assets:       PilotAccessLevel  // starts 'full' — can pivot to research
  portfolios:   PilotAccessLevel  // starts 'full'
  themes:       PilotAccessLevel  // starts 'full'
  lists:        PilotAccessLevel  // 'full' — Get Started step "Build a list" sends users here
  calendar:     PilotAccessLevel  // starts 'hidden'
  charting:     PilotAccessLevel  // starts 'hidden'
  files:        PilotAccessLevel  // starts 'hidden'
  organization: PilotAccessLevel  // org settings — 'full' so they can invite
}

/** Default pilot access for a newly flagged org/user. Conservative; opens up
 * as pilots progress through the experience. Override per-org via
 * organizations.settings.pilot_access. */
export const PILOT_ACCESS_DEFAULTS: PilotAccessConfig = {
  tradeLab:     'full',
  tradeBook:    'preview',
  outcomes:     'preview',
  ideaPipeline: 'full',   // was 'hidden' — pilots can now see the pipeline as a routing surface
  dashboard:    'full',   // was 'hidden' — pilots now land here on login as a lightweight action dashboard
  priorities:   'hidden',
  projects:     'hidden',
  coverage:     'hidden',
  workflows:    'full',   // Get Started teaches "Build a workflow"
  notes:        'full',
  assets:       'full',
  portfolios:   'full',
  themes:       'full',
  lists:        'full',   // Get Started teaches "Build a list"
  calendar:     'hidden',
  charting:     'hidden',
  files:        'hidden',
  organization: 'full',
}

/** Tab types from the DashboardPage router → which pilot feature gates them. */
export const TAB_TYPE_TO_PILOT_FEATURE: Record<string, keyof PilotAccessConfig | null> = {
  // Fully accessible
  'trade-lab':       'tradeLab',
  'asset':           'assets',
  'assets-list':     'assets',
  'portfolio':       'portfolios',
  'portfolios-list': 'portfolios',
  'theme':           'themes',
  'themes-list':     'themes',
  'note':            'notes',
  'notes-list':      'notes',
  'organization':    'organization',

  // Preview (landing page replaced with read-only/educational state)
  'trade-book':      'tradeBook',
  'outcomes':        'outcomes',

  // Hidden (guard redirects to trade-lab)
  'dashboard':       'dashboard',
  'idea-generator':  'ideaPipeline',
  'trade-queue':     'ideaPipeline',
  'priorities':      'priorities',
  'project':         'projects',
  'projects-list':   'projects',
  'coverage':        'coverage',
  'workflows':       'workflows',
  'lists':           'lists',
  'list':            'lists',
  'calendar':        'calendar',
  'charting':        'charting',
  'files':           'files',

  // Non-feature tabs
  'blank':           null,
  'tdf':             null,
  'tdf-list':        null,
  'asset-allocation': null,
  'audit':           null,
}

/** Merge org JSONB overrides onto defaults. Unknown keys are ignored. */
export function mergePilotAccess(override: Partial<PilotAccessConfig> | null | undefined): PilotAccessConfig {
  if (!override) return { ...PILOT_ACCESS_DEFAULTS }
  const merged: PilotAccessConfig = { ...PILOT_ACCESS_DEFAULTS }
  for (const key of Object.keys(PILOT_ACCESS_DEFAULTS) as (keyof PilotAccessConfig)[]) {
    const v = override[key]
    if (v === 'full' || v === 'preview' || v === 'hidden') merged[key] = v
  }
  return merged
}
