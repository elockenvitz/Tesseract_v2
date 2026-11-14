/**
 * Coming back from the canonical page to the pane that sent you.
 *
 * ── The problem this closes ──────────────────────────────────────────────
 *
 * Every substantial action in the Dashboard's asset pane now LEAVES. Edit the
 * case, open the scenarios, open a pending recommendation: each one opens the
 * full Asset page, because that is where those things are actually done and a
 * cramped copy of the editor inside a dashboard column was worse than a hop.
 *
 * What the hop did not have was a way back. The asset opens as a tab beside
 * the one the reader came from, so returning was always POSSIBLE -- press the
 * other tab -- but nothing on the page they landed on said so, and nothing
 * said which of eleven tabs it was. A reader who followed a target breach
 * from the Dashboard into AAPL's research page, wrote the case, and then
 * wanted to go back to the breach had to remember where they had been.
 *
 * ── Why the SHELL names the tab and the sender only asks ────────────────
 *
 * The obvious design is for the pane to put its own tab id in the request.
 * It cannot: `AssetWorkspacePane` is mounted by `IdeasWorkPane`, which is
 * mounted by both `DashboardNext` and `IdeasApp`, and `DashboardNext` is
 * itself rendered under three different tab ids (`dashboard`, `today` and
 * `dashboard-next`). None of them is passed its own tab id, and threading
 * one down four levels of props would hardcode the list of hosts -- the
 * thing this must not do, because the next host would silently get no
 * Return.
 *
 * So the division is: the SENDER declares intent (`openAsset({ returnTo:
 * true })`, meaning "the reader should be able to come back to where they
 * pressed this"), and the SHELL -- the only thing that knows what is open --
 * resolves that intent against the tab that was active at the moment of the
 * press. Any host gets a Return, including ones written later, and none of
 * them has to know its own identity.
 *
 * ── Why the three keys are always written ───────────────────────────────
 *
 * The shell MERGES tab data into an open tab, so a key left out of a later
 * arrival persists from an earlier one. A reader who came from the Dashboard,
 * then opened the same asset from the global search box, would otherwise
 * still be offered "Return to Dashboard" by a navigation that had nothing to
 * do with it. `returnTabData` therefore always writes all three keys,
 * including as nulls -- the same rule, and the same reason, as every other
 * context field in `assetTabFor`.
 *
 * ── Why the organisation is one of them ─────────────────────────────────
 *
 * Return state must not survive an organisation change. The tab itself can:
 * a reader switches organisation with the Dashboard tab and an asset tab
 * both open, and the asset tab's saved data still says "return to the
 * Dashboard". That tab is now showing another firm's feed, and the breach
 * the reader was sent from does not exist in it. So the organisation is
 * stamped at send time and compared at read time, and a mismatch means no
 * Return rather than a Return to a surface that has been replaced underneath
 * it. This is the same identity check `contextAppliesTo` makes for the
 * arrival context, for the same reason.
 */

/** A tab, as this module needs to see one. */
export interface ReturnHost {
  id: string
  title?: string | null
  type?: string | null
  /**
   * An empty tab waiting to be given a purpose.
   *
   * It is never a place to come back to, and it matters here rather than
   * being a theoretical case: the shell REPLACES a blank active tab with the
   * thing being opened, so without this check the reader would land on the
   * asset page and be offered "Return to New tab" -- pointing at a tab id
   * that no longer exists, because the asset took it.
   */
  isBlank?: boolean | null
}

/** Where a Return goes, once it is known to be valid. */
export interface ReturnTarget {
  tabId: string
  label: string
  /** The organisation the send happened in. Null means "not stamped". */
  organizationId: string | null
}

/** The shape the three keys take in tab data. */
export interface ReturnTabData {
  returnTabId: string | null
  returnTabLabel: string | null
  returnOrgId: string | null
}

/**
 * Names for tab types whose own title is not a place the reader recognises.
 *
 * Only for the hosts that can mount an asset pane. A type absent from here
 * falls back to the tab's own title, which is what the reader is looking at
 * in the tab strip and therefore the most truthful label available.
 */
const HOST_NAME: Record<string, string> = {
  dashboard: 'Dashboard',
  'dashboard-next': 'Dashboard',
  today: 'Dashboard',
  ideas: 'Ideas',
}

/**
 * What to call the place the reader came from.
 *
 * The tab's own title first, because that is the word in the tab strip they
 * would otherwise be hunting for. `HOST_NAME` is the fallback for a tab whose
 * title is blank, and the last resort says something true rather than
 * guessing a name.
 */
export function returnLabelFor(host: ReturnHost | null | undefined): string {
  const title = (host?.title ?? '').trim()
  if (title) return title
  const byType = host?.type ? HOST_NAME[host.type] : null
  return byType ?? 'where you were'
}

/**
 * The Return target for one navigation, or null when there is not one.
 *
 * Null, and not a best guess, in four cases:
 *
 *   - the sender did not ask for one. Opening an asset from the global search
 *     box is not a trip you come back from, and offering a Return on every
 *     asset tab would make the affordance meaningless.
 *   - nothing was active. There is no "back" from the first tab opened.
 *   - the active tab IS the destination. Returning to yourself is not a
 *     return; this is the case where a reader presses a control on the Asset
 *     page itself.
 *   - the active tab is not open any more. A stale id would activate nothing
 *     and the button would look broken.
 *   - the active tab is blank. See `ReturnHost.isBlank`: the shell is about
 *     to replace that very tab with the destination.
 */
export function returnTargetFrom(input: {
  requested: boolean
  activeTabId: string | null | undefined
  hosts: readonly ReturnHost[]
  /** The tab the navigation is opening. */
  targetId: string
  organizationId: string | null
}): ReturnTarget | null {
  if (!input.requested) return null
  const from = input.activeTabId
  if (!from || from === input.targetId) return null
  const host = input.hosts.find(h => h.id === from)
  if (!host || host.isBlank === true) return null
  return { tabId: from, label: returnLabelFor(host), organizationId: input.organizationId ?? null }
}

/** The three keys, always all three. See the header for why. */
export function returnTabData(target: ReturnTarget | null | undefined): ReturnTabData {
  return {
    returnTabId: target?.tabId ?? null,
    returnTabLabel: target?.label ?? null,
    returnOrgId: target?.organizationId ?? null,
  }
}

/**
 * The Return the landing page should offer, read back out of tab data.
 *
 * `organizationId` is the reader's CURRENT organisation. A target stamped in
 * another one is dropped: see the header. A target with no stamp at all is
 * also dropped rather than trusted -- an unstamped return is one written
 * before this check existed, and "we do not know which firm this belongs to"
 * is not a reason to offer it.
 */
export function readReturnTarget(
  data: { returnTabId?: unknown; returnTabLabel?: unknown; returnOrgId?: unknown } | null | undefined,
  live: { organizationId: string | null },
): ReturnTarget | null {
  const tabId = typeof data?.returnTabId === 'string' ? data.returnTabId.trim() : ''
  if (!tabId) return null
  const stamped = typeof data?.returnOrgId === 'string' ? data.returnOrgId : null
  if (!stamped || !live.organizationId || stamped !== live.organizationId) return null
  const label = typeof data?.returnTabLabel === 'string' && data.returnTabLabel.trim()
    ? data.returnTabLabel.trim()
    : 'where you were'
  return { tabId, label, organizationId: stamped }
}

/**
 * Activating a tab that already exists, and nothing else.
 *
 * ── Why not the tab channel every other link uses ───────────────────────
 *
 * `decision-engine-action` carries a full descriptor and CREATES the tab
 * when it is not open. That is right for a link to an object and wrong here:
 * a reader who closed the Dashboard tab would get a brand new empty one
 * rather than being told there is nowhere to go back to. Worse, the
 * descriptor would merge its `data` into the host tab, so returning to the
 * Dashboard would overwrite whatever state it held.
 *
 * This event carries an id and no data. The shell activates that tab if it is
 * open and ignores the event if it is not, which is also what makes the
 * affordance safe to leave on screen: the worst case is a press that does
 * nothing, not a press that invents a surface.
 *
 * It goes through the shell's own guarded tab switch, so a reader with
 * unsaved research in the editor they are leaving is asked first -- the same
 * prompt as pressing the tab by hand, because it is the same act.
 */
export const ACTIVATE_TAB_EVENT = 'tesseract:activate-tab' as const

export function activateTab(tabId: string): boolean {
  if (typeof window === 'undefined') return false
  const id = (tabId ?? '').trim()
  if (!id) return false
  window.dispatchEvent(new CustomEvent<{ tabId: string }>(ACTIVATE_TAB_EVENT, { detail: { tabId: id } }))
  return true
}

export function subscribeToActivateTab(handler: (tabId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const id = (e as CustomEvent<{ tabId?: unknown }>).detail?.tabId
    if (typeof id !== 'string' || !id.trim()) return
    handler(id)
  }
  window.addEventListener(ACTIVATE_TAB_EVENT, listener)
  return () => window.removeEventListener(ACTIVATE_TAB_EVENT, listener)
}
