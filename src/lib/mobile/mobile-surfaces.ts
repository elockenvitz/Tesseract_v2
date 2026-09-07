import {
  Beaker, BookOpen, Briefcase, Building2, Calendar, FileText, Flag,
  FolderKanban, FolderOpen, LineChart, Lightbulb, List, ListTodo, Repeat,
  Shield, StickyNote, Tag, Target, TrendingUp, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * How much of a surface works on a phone.
 *
 *  full         — purpose-built mobile treatment, including editing.
 *  read-only    — safe to view on a phone; authoring stays on desktop.
 *  desktop-only — renders a DesktopOnlyCard instead of the real surface.
 *
 * This registry is the one place "what works on mobile" is decided. Adding a
 * mobile treatment to a surface should be a one-line change here plus the
 * component work — never a scattered hunt for breakpoint branches.
 */
export type MobileSupportLevel = 'full' | 'read-only' | 'desktop-only'

export type MobileSurfaceGroup = 'core' | 'work' | 'admin'

export interface MobileSurface {
  /** Matches `Tab['type']` in components/layout/TabManager.tsx. */
  type: string
  title: string
  icon: LucideIcon
  color: string
  bg: string
  support: MobileSupportLevel
  group: MobileSurfaceGroup
  /** Shown on the DesktopOnlyCard. Say what the constraint actually is. */
  desktopReason?: string
  /** Shown in the nav drawer for partially-supported surfaces. */
  mobileNote?: string
  /** Surfaces reachable from the drawer. Detail types (asset, note) are not. */
  inNav?: boolean
}

export const MOBILE_SURFACES: MobileSurface[] = [
  // ---- Core ---------------------------------------------------------------
  {
    // The canonical home tab (see CANONICAL_HOME_TAB in lib/tabStateManager).
    // It is the tab `/dashboard` lands on, and on a phone it renders the same
    // MobileDashboard ideas feed the legacy `dashboard` type below does.
    //
    // It MUST stay registered: unregistered types default to `desktop-only`,
    // which is how the home tab once served a "Dashboard is desktop only"
    // card to every phone that opened `/dashboard`.
    //
    // NOT in the drawer's Core list — `inNav: false`.
    //
    // The drawer pins Home > Ideas above everything else, permanently, and it
    // lands here. A Core row doing the identical thing made one drawer offer
    // two routes to one destination, which is a question the reader has to
    // answer every time for no gain. The pinned row is the single route; this
    // entry exists to declare that `today` is a full phone surface, which is
    // the other half of the registry's job.
    //
    // It briefly HAD to carry that row, when the Home section was drawn only
    // if a home tab happened to be open. It is not needed for that any more:
    // Home is drawn unconditionally and opens the canonical home by id whether
    // or not a tab exists. See MobileNavDrawer.
    type: 'today', title: 'Ideas', icon: Lightbulb,
    color: 'text-purple-500', bg: 'bg-purple-50',
    support: 'full', group: 'core', inNav: false,
  },
  {
    // On phones this tab *is* the ideas feed — MobileDashboard replaces the
    // desktop analytics surface entirely — so it is named for what it shows.
    //
    // The legacy home. It is no longer the tab the app opens on, so it no
    // longer carries the drawer's Ideas row; the `today` entry above does.
    // Kept registered as `full` so a restored legacy tab still resolves to
    // the feed rather than to a desktop-only card.
    type: 'dashboard', title: 'Ideas', icon: Lightbulb,
    color: 'text-purple-500', bg: 'bg-purple-50',
    support: 'full', group: 'core', inNav: false,
  },
  {
    // Not offered separately on mobile: it would open a second, near-identical
    // ideas surface alongside the one already at home. Kept in the registry so
    // an existing `idea-generator` tab still resolves correctly.
    type: 'idea-generator', title: 'Ideas', icon: Lightbulb,
    color: 'text-purple-500', bg: 'bg-purple-50',
    support: 'full', group: 'core', inNav: false,
  },
  {
    type: 'trade-queue', title: 'Pipeline', icon: ListTodo,
    color: 'text-amber-500', bg: 'bg-amber-50',
    support: 'full', group: 'core', inNav: true,
    mobileNote: 'One stage at a time — tap a card to move it',
  },
  {
    type: 'trade-lab', title: 'Trade Lab', icon: Beaker,
    color: 'text-orange-500', bg: 'bg-orange-50',
    support: 'full', group: 'core', inNav: true,
    mobileNote: 'Size positions from the holdings list',
  },
  {
    type: 'trade-book', title: 'Trade Book', icon: BookOpen,
    color: 'text-indigo-500', bg: 'bg-indigo-50',
    support: 'full', group: 'core', inNav: true,
    mobileNote: 'Read and update execution status',
  },
  {
    type: 'assets-list', title: 'Assets', icon: TrendingUp,
    color: 'text-blue-500', bg: 'bg-blue-50',
    support: 'read-only', group: 'core', inNav: true,
    mobileNote: 'Search and open — column config stays on desktop',
  },
  {
    type: 'asset', title: 'Asset', icon: TrendingUp,
    color: 'text-blue-500', bg: 'bg-blue-50',
    support: 'full', group: 'core',
    mobileNote: 'Read and edit the case; Process stays on desktop',
  },
  {
    type: 'notes-list', title: 'Notes', icon: StickyNote,
    color: 'text-yellow-600', bg: 'bg-yellow-50',
    support: 'full', group: 'core', inNav: true,
  },
  {
    // A notebook renders NotesListPage scoped to one notebook — the same
    // surface as `notes-list` above, which is `full`. Opening one from the
    // notes list on a phone served a desktop-only card instead.
    type: 'notebook', title: 'Notebook', icon: StickyNote,
    color: 'text-yellow-600', bg: 'bg-yellow-50',
    support: 'full', group: 'core',
  },
  { type: 'note', title: 'Note', icon: StickyNote, color: 'text-yellow-600', bg: 'bg-yellow-50', support: 'full', group: 'core' },
  {
    type: 'priorities', title: 'Priorities', icon: Flag,
    color: 'text-rose-500', bg: 'bg-rose-50',
    support: 'read-only', group: 'core', inNav: true,
  },
  {
    // Same tab, older id. DashboardPage renders `prioritizer` and `priorities`
    // through one `case`, so leaving this unregistered meant a restored
    // session served a "desktop only" card for the page sitting one id away.
    type: 'prioritizer', title: 'Priorities', icon: Flag,
    color: 'text-rose-500', bg: 'bg-rose-50',
    support: 'read-only', group: 'core',
  },
  {
    type: 'outcomes', title: 'Outcomes', icon: Target,
    color: 'text-teal-500', bg: 'bg-teal-50',
    support: 'read-only', group: 'core', inNav: true,
  },
  {
    type: 'portfolios-list', title: 'Portfolios', icon: Briefcase,
    color: 'text-emerald-500', bg: 'bg-emerald-50',
    support: 'read-only', group: 'core', inNav: true,
  },
  { type: 'portfolio', title: 'Portfolio', icon: Briefcase, color: 'text-emerald-500', bg: 'bg-emerald-50', support: 'read-only', group: 'core' },
  {
    type: 'themes-list', title: 'Themes', icon: Tag,
    color: 'text-fuchsia-500', bg: 'bg-fuchsia-50',
    support: 'read-only', group: 'core', inNav: true,
  },
  { type: 'theme', title: 'Theme', icon: Tag, color: 'text-fuchsia-500', bg: 'bg-fuchsia-50', support: 'read-only', group: 'core' },

  // ---- Work management ----------------------------------------------------
  {
    type: 'lists', title: 'Lists', icon: List,
    color: 'text-violet-500', bg: 'bg-violet-50',
    support: 'read-only', group: 'work', inNav: true,
  },
  { type: 'list', title: 'List', icon: List, color: 'text-violet-500', bg: 'bg-violet-50', support: 'read-only', group: 'work' },
  {
    type: 'projects-list', title: 'Projects', icon: FolderKanban,
    color: 'text-indigo-500', bg: 'bg-indigo-50',
    support: 'read-only', group: 'work', inNav: true,
  },
  { type: 'project', title: 'Project', icon: FolderKanban, color: 'text-indigo-500', bg: 'bg-indigo-50', support: 'read-only', group: 'work' },
  {
    type: 'calendar', title: 'Calendar', icon: Calendar,
    color: 'text-sky-500', bg: 'bg-sky-50',
    support: 'read-only', group: 'work', inNav: true,
  },
  {
    // One event opens CalendarPage focused on it — the same page as above.
    type: 'calendar-event', title: 'Event', icon: Calendar,
    color: 'text-sky-500', bg: 'bg-sky-50',
    support: 'read-only', group: 'work',
  },
  {
    type: 'files', title: 'Files', icon: FolderOpen,
    color: 'text-slate-500', bg: 'bg-slate-100',
    support: 'read-only', group: 'work', inNav: true,
  },
  {
    // A model attached to an asset. Search returns these, so a phone could
    // reach one; it rendered the desktop AssetTab, which is the 4,300-line
    // wide-screen workspace the `asset` case deliberately avoids on a phone.
    // DashboardPage now sends it to Files focused on the file instead, which
    // is the surface registered just above and the exact thing searched for.
    type: 'model-file', title: 'Model', icon: FolderOpen,
    color: 'text-slate-500', bg: 'bg-slate-100',
    support: 'read-only', group: 'work',
  },
  {
    type: 'workflows', title: 'Process', icon: Repeat,
    color: 'text-cyan-500', bg: 'bg-cyan-50',
    support: 'read-only', group: 'work', inNav: true,
    mobileNote: 'Review processes and runs; building one stays on desktop',
  },
  {
    // A single process, and a process template. Both render WorkflowsPage
    // focused on one record — the surface registered read-only just above —
    // so a phone opening one from the list hit a desktop-only card for a page
    // it had already been told it could read.
    type: 'workflow', title: 'Process', icon: Repeat,
    color: 'text-cyan-500', bg: 'bg-cyan-50',
    support: 'read-only', group: 'work',
    mobileNote: 'Review the process and its runs; building one stays on desktop',
  },
  {
    type: 'workflow-template', title: 'Process Template', icon: Repeat,
    color: 'text-cyan-500', bg: 'bg-cyan-50',
    support: 'read-only', group: 'work',
    mobileNote: 'Read the template; creating from it stays on desktop',
  },
  {
    type: 'templates', title: 'Templates', icon: FileText,
    color: 'text-amber-600', bg: 'bg-amber-50',
    support: 'read-only', group: 'work', inNav: true,
    mobileNote: 'Browse templates; authoring stays on desktop',
  },
  {
    // Both open TemplatesTab on one template — the surface above.
    type: 'model-template', title: 'Model Template', icon: FileText,
    color: 'text-amber-600', bg: 'bg-amber-50',
    support: 'read-only', group: 'work',
  },
  {
    type: 'text-template', title: 'Text Template', icon: FileText,
    color: 'text-amber-600', bg: 'bg-amber-50',
    support: 'read-only', group: 'work',
  },
  {
    type: 'coverage', title: 'Coverage', icon: Users,
    color: 'text-sky-500', bg: 'bg-sky-50',
    support: 'read-only', group: 'work', inNav: true,
    mobileNote: 'Who covers what, and what nobody covers — editing stays on desktop',
  },

  // ---- Admin / analysis ---------------------------------------------------
  {
    type: 'organization', title: 'Organization', icon: Building2,
    color: 'text-gray-500', bg: 'bg-gray-100',
    support: 'read-only', group: 'admin', inNav: true,
    mobileNote: 'People and teams; the org chart wants a wide screen',
  },
  {
    // A team opens OrganizationPage on its access view — the same page as
    // above. Organization is a mobile destination and its own people list
    // links straight here, so an unregistered `team` meant tapping a team on
    // a phone landed on "this is desktop only" one step inside a surface the
    // registry had already called readable.
    type: 'team', title: 'Team', icon: Users,
    color: 'text-gray-500', bg: 'bg-gray-100',
    support: 'read-only', group: 'admin',
  },
  {
    // A person. UserTab is a stack of collapsible cards — coverage, recent
    // price targets, open tasks — with no grid, no table and no fixed width,
    // so it reads on a phone as it is. It is reachable two ways a phone user
    // actually takes: search, and tapping a name inside Organization.
    type: 'user', title: 'Person', icon: Users,
    color: 'text-gray-500', bg: 'bg-gray-100',
    support: 'read-only', group: 'admin',
    mobileNote: 'Coverage, recent targets and open work for one person',
  },
  {
    type: 'asset-allocation', title: 'Allocation', icon: Briefcase,
    color: 'text-emerald-600', bg: 'bg-emerald-50',
    support: 'read-only', group: 'admin', inNav: true,
    mobileNote: 'Read allocation; rebalancing stays on desktop',
  },
  {
    // One period, rendered by the same AssetAllocationPage.
    type: 'allocation-period', title: 'Allocation Period', icon: Briefcase,
    color: 'text-emerald-600', bg: 'bg-emerald-50',
    support: 'read-only', group: 'admin',
  },
  {
    type: 'charting', title: 'Charting', icon: LineChart,
    color: 'text-blue-600', bg: 'bg-blue-50',
    support: 'read-only', group: 'admin', inNav: true,
    mobileNote: 'Chart and timeframe; drawing tools want a pointer',
  },
  {
    type: 'audit', title: 'Audit', icon: Shield,
    color: 'text-gray-600', bg: 'bg-gray-100',
    support: 'read-only', group: 'admin', inNav: true,
    mobileNote: 'Search and read the trail',
  },
  {
    type: 'tdf-list', title: 'Target Date', icon: Target,
    color: 'text-teal-600', bg: 'bg-teal-50',
    support: 'read-only', group: 'admin', inNav: true,
    mobileNote: 'Browse funds; glidepath editing stays on desktop',
  },
  {
    type: 'tdf', title: 'Target Date Fund', icon: Target, color: 'text-teal-600', bg: 'bg-teal-50',
    support: 'read-only', group: 'admin',
    mobileNote: 'Read the fund; glidepath editing stays on desktop',
  },
]

const BY_TYPE = new Map(MOBILE_SURFACES.map(surface => [surface.type, surface]))

export function getMobileSurface(type: string | undefined): MobileSurface | undefined {
  if (!type) return undefined
  return BY_TYPE.get(type)
}

/**
 * Unregistered surfaces default to `desktop-only` on purpose: a new tab type
 * added without a mobile decision should show an honest card, not a broken
 * desktop layout squeezed into 390px.
 */
export function getMobileSupport(type: string | undefined): MobileSupportLevel {
  return getMobileSurface(type)?.support ?? 'desktop-only'
}

export function isDesktopOnly(type: string | undefined): boolean {
  return getMobileSupport(type) === 'desktop-only'
}

/** Surfaces usable on a phone, for the nav drawer's primary sections. */
export function getMobileNavSurfaces(group: MobileSurfaceGroup): MobileSurface[] {
  return MOBILE_SURFACES.filter(s => s.inNav && s.group === group && s.support !== 'desktop-only')
}

/** Nav entries that will render a DesktopOnlyCard — listed but de-emphasised. */
export function getDesktopOnlyNavSurfaces(): MobileSurface[] {
  return MOBILE_SURFACES.filter(s => s.inNav && s.support === 'desktop-only')
}
