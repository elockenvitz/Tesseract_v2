/**
 * Coming back from the canonical page to the pane that sent you.
 *
 * ── What was missing ─────────────────────────────────────────────────────
 *
 * Every substantial control in the Dashboard's asset pane opens the full
 * Asset page, because that is where the case is written and the targets are
 * set. The asset opens as a tab BESIDE the one the reader came from, so going
 * back was always possible -- and nothing on the page they landed on said so,
 * or said which of eleven tabs it was. The 2.4 report listed the absent
 * Return affordance as its leading unfixed finding.
 *
 * ── Why these are the assertions ─────────────────────────────────────────
 *
 * The decision has four parts and three of them are refusals, so a test that
 * only proved the happy path would miss everything that can go wrong. The
 * refusals are: not asked for, nowhere to go back to, and the target has been
 * replaced or has gone. Each one, left out, produces a visible button that
 * either lies about where it goes or does nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  returnTargetFrom, returnTabData, returnTabPatch, readReturnTarget, returnLabelFor,
  activateTab, subscribeToActivateTab, ACTIVATE_TAB_EVENT,
} from '../return-to'

const ORG = 'org-1'
const HOSTS = [
  { id: 'dashboard', title: 'Dashboard', type: 'dashboard-next' },
  { id: 'ideas', title: 'Ideas', type: 'ideas' },
  { id: 'a-1', title: 'AAPL', type: 'asset' },
]

const ask = (over: Partial<Parameters<typeof returnTargetFrom>[0]> = {}) =>
  returnTargetFrom({
    requested: true,
    activeTabId: 'dashboard',
    hosts: HOSTS,
    targetId: 'a-1',
    organizationId: ORG,
    ...over,
  })

describe('resolving the ask into a tab', () => {
  it('names the tab that was active when the reader pressed', () => {
    expect(ask()).toEqual({ tabId: 'dashboard', label: 'Dashboard', organizationId: ORG })
  })

  /*
   * THE requirement that shaped the design: "Do not hardcode a single
   * originating tab."
   *
   * The pane is mounted by `IdeasWorkPane`, under both `DashboardNext` and
   * `IdeasApp`, and `DashboardNext` renders under three different tab ids.
   * Nothing here knows any of that -- it reads whichever tab was active --
   * so a host added next year gets a Return with no change to this module.
   */
  it('works from any host, including one it has never heard of', () => {
    expect(ask({ activeTabId: 'ideas' })?.label).toBe('Ideas')
    expect(ask({
      activeTabId: 'some-future-surface',
      hosts: [...HOSTS, { id: 'some-future-surface', title: 'Coverage', type: 'coverage' }],
    })).toEqual({ tabId: 'some-future-surface', label: 'Coverage', organizationId: ORG })
  })

  it('refuses when the sender did not ask', () => {
    /* An asset opened from the global search box is not a trip you come back
       from. A Return on every asset tab is an affordance that means nothing. */
    expect(ask({ requested: false })).toBeNull()
  })

  it('refuses when there is nothing to go back to', () => {
    expect(ask({ activeTabId: null })).toBeNull()
    expect(ask({ activeTabId: '' })).toBeNull()
  })

  it('refuses to return to the destination itself', () => {
    /* A control pressed on the Asset page, about the asset already open. */
    expect(ask({ activeTabId: 'a-1' })).toBeNull()
  })

  it('refuses a tab that is not open', () => {
    /* A stale id would activate nothing and the button would look broken. */
    expect(ask({ activeTabId: 'closed-last-week' })).toBeNull()
  })

  /*
   * A blank tab is not a place, and this is not theoretical: the shell
   * REPLACES a blank active tab with the thing being opened. Without this
   * refusal the reader lands on the asset page and is offered "Back to New
   * tab" pointing at an id the asset itself has just taken.
   */
  it('refuses a blank tab, which the destination is about to replace', () => {
    expect(ask({
      activeTabId: 'blank-1',
      hosts: [...HOSTS, { id: 'blank-1', title: 'New tab', type: 'blank', isBlank: true }],
    })).toBeNull()
  })
})

describe('what to call the place', () => {
  it('prefers the tab\'s own title, which is the word in the tab strip', () => {
    expect(returnLabelFor({ id: 'x', title: 'Large Cap Core', type: 'portfolio' })).toBe('Large Cap Core')
  })

  it('falls back to a host name when the tab has no title', () => {
    expect(returnLabelFor({ id: 'today', title: '  ', type: 'today' })).toBe('Dashboard')
    expect(returnLabelFor({ id: 'ideas', title: null, type: 'ideas' })).toBe('Ideas')
  })

  it('says something true rather than guessing a name', () => {
    expect(returnLabelFor({ id: 'x', title: null, type: 'something-new' })).toBe('where you were')
    expect(returnLabelFor(null)).toBe('where you were')
  })
})

describe('the three keys are always three keys', () => {
  /*
   * THE defect this prevents, and it is the merge trap this codebase has
   * documented at length on `assetTabFor`: the shell merges tab data into an
   * open tab, so a key left out of a later arrival persists from an earlier
   * one. A reader who came from the Dashboard and then opened the same name
   * from the Trade Queue would still be offered a way back to the Dashboard.
   */
  it('writes all three as nulls when there is no target', () => {
    expect(returnTabData(null)).toEqual({
      returnTabId: null, returnTabLabel: null, returnOrgId: null,
    })
    expect(Object.keys(returnTabData(null)).sort())
      .toEqual(Object.keys(returnTabData({ tabId: 't', label: 'T', organizationId: ORG })).sort())
  })

  it('writes all three when there is one', () => {
    expect(returnTabData({ tabId: 'dashboard', label: 'Dashboard', organizationId: ORG })).toEqual({
      returnTabId: 'dashboard', returnTabLabel: 'Dashboard', returnOrgId: ORG,
    })
  })
})

describe('reading it back on the page that landed', () => {
  const stamped = returnTabData({ tabId: 'dashboard', label: 'Dashboard', organizationId: ORG })

  it('offers the Return the shell wrote', () => {
    expect(readReturnTarget(stamped, { organizationId: ORG }))
      .toEqual({ tabId: 'dashboard', label: 'Dashboard', organizationId: ORG })
  })

  it('offers nothing when nothing was written', () => {
    expect(readReturnTarget(returnTabData(null), { organizationId: ORG })).toBeNull()
    expect(readReturnTarget(null, { organizationId: ORG })).toBeNull()
    expect(readReturnTarget({}, { organizationId: ORG })).toBeNull()
  })

  /*
   * The leak the brief names: "Return state must not leak across unrelated
   * navigation or organizations."
   *
   * A reader switches organisation with the Dashboard tab and an asset tab
   * both open. The asset tab's saved data still says "return to the
   * Dashboard" -- but that tab is now showing another firm's feed, in which
   * the item they were sent from does not exist. So the stamp is compared,
   * and a mismatch means no Return rather than a Return to a surface that has
   * been replaced underneath it.
   */
  it('drops a target stamped in another organisation', () => {
    expect(readReturnTarget(stamped, { organizationId: 'org-2' })).toBeNull()
  })

  it('drops a target when the reader\'s organisation is not known yet', () => {
    /* Null matches nothing. Offering the Return while the org is still
       resolving would be deciding the question by timing. */
    expect(readReturnTarget(stamped, { organizationId: null })).toBeNull()
  })

  it('drops an unstamped target rather than trusting it', () => {
    /* Written by a build before this check existed. "We do not know which
       firm this belongs to" is not a reason to offer it. */
    expect(readReturnTarget(
      { returnTabId: 'dashboard', returnTabLabel: 'Dashboard' },
      { organizationId: ORG },
    )).toBeNull()
  })

  it('survives a label that went missing without losing the destination', () => {
    expect(readReturnTarget(
      { returnTabId: 'dashboard', returnTabLabel: '   ', returnOrgId: ORG },
      { organizationId: ORG },
    )).toEqual({ tabId: 'dashboard', label: 'where you were', organizationId: ORG })
  })

  it('ignores values of the wrong type instead of rendering them', () => {
    expect(readReturnTarget(
      { returnTabId: 42, returnTabLabel: 'Dashboard', returnOrgId: ORG } as never,
      { organizationId: ORG },
    )).toBeNull()
  })
})

describe('asking the shell to go there', () => {
  const seen: string[] = []
  const stop = subscribeToActivateTab(id => seen.push(id))
  afterEach(() => { seen.length = 0 })

  it('carries an id and no data', () => {
    /*
     * Deliberately not the `decision-engine-action` channel every other link
     * uses. That one CREATES the tab when it is closed and MERGES its `data`
     * into it when it is open -- so a Return would either invent a Dashboard
     * the reader had closed, or overwrite the state of the one they were
     * coming back to.
     */
    const spy = vi.spyOn(window, 'dispatchEvent')
    expect(activateTab('dashboard')).toBe(true)
    const ev = spy.mock.calls.map(([e]) => e as CustomEvent)
      .find(e => e.type === ACTIVATE_TAB_EVENT)!
    expect(ev.detail).toEqual({ tabId: 'dashboard' })
    expect(spy.mock.calls.some(([e]) => (e as Event).type === 'decision-engine-action')).toBe(false)
    spy.mockRestore()
    expect(seen).toEqual(['dashboard'])
  })

  it('refuses an empty id rather than dispatching a no-op', () => {
    expect(activateTab('')).toBe(false)
    expect(activateTab('   ')).toBe(false)
    expect(seen).toEqual([])
  })

  it('ignores an event carrying no usable id', () => {
    window.dispatchEvent(new CustomEvent(ACTIVATE_TAB_EVENT, { detail: { tabId: 7 } }))
    window.dispatchEvent(new CustomEvent(ACTIVATE_TAB_EVENT, { detail: {} }))
    window.dispatchEvent(new CustomEvent(ACTIVATE_TAB_EVENT))
    expect(seen).toEqual([])
  })

  it('stops listening when told to', () => {
    stop()
    activateTab('dashboard')
    expect(seen).toEqual([])
  })
})

/*
 * ── §5D: the same trip, over and over ────────────────────────────────────
 *
 * The brief asks what happens when a reader navigates repeatedly: open,
 * return, open again, switch tabs, return, open again. Each of those steps
 * passed on its own. Walking them in sequence is what found the defect,
 * because the bug is in what one step does to the state another step left.
 *
 * This harness is the shell, reduced to the two things that matter: it keeps
 * one tab's data, and it merges each arrival into it the way `DashboardPage`
 * does (`{ ...tab.data, ...arrival }`). The merge is the whole hazard -- a
 * key left out of a later arrival keeps an earlier arrival's value -- so a
 * test that replaced the data instead of merging it would prove nothing.
 */
describe('a reader who makes the same trip repeatedly', () => {
  const ASSET = 'a-1'

  /** The shell, as far as the Return keys are concerned. */
  function shell(active: string) {
    let tabData: Record<string, unknown> = {}
    let activeTabId = active
    return {
      /** A navigation to the asset tab, which is already open. */
      open(opts: { requested: boolean; org?: string | null }) {
        const patch = returnTabPatch({
          requested: opts.requested,
          activeTabId,
          hosts: HOSTS,
          targetId: ASSET,
          organizationId: opts.org === undefined ? ORG : opts.org,
        })
        tabData = { ...tabData, ...(patch ?? {}) }
        activeTabId = ASSET
        return this
      },
      /** The reader presses the Back button, or any tab. */
      goTo(tabId: string) { activeTabId = tabId; return this },
      /** What the landing page would offer, in the given organisation. */
      offered(org: string | null = ORG) {
        return readReturnTarget(tabData, { organizationId: org })
      },
    }
  }

  it('offers the same way back after open, return, open again', () => {
    const s = shell('dashboard')
    expect(s.open({ requested: true }).offered()?.label).toBe('Dashboard')
    /* Back to the Dashboard, then in again by the same control. The second
       arrival must not degrade the first -- this is the step where a stale
       `activeTabId` would resolve the Return to the asset tab itself. */
    expect(s.goTo('dashboard').open({ requested: true }).offered()?.label).toBe('Dashboard')
  })

  it('follows the reader to a new origin instead of offering the old one', () => {
    const s = shell('dashboard').open({ requested: true })
    expect(s.offered()?.tabId).toBe('dashboard')
    /* Same asset, different origin. The Return must name Ideas, because
       that is where this press happened. */
    expect(s.goTo('ideas').open({ requested: true }).offered())
      .toMatchObject({ tabId: 'ideas', label: 'Ideas' })
  })

  it('keeps the way back when a control on the asset page does not move the reader', () => {
    /*
     * THE §5D DEFECT. The reader followed a breach from the Dashboard into
     * AAPL, then pressed one control on the page they landed on -- a source
     * chip, a section link -- which re-opens the same asset at a different
     * section. The destination is the tab they are already on, so there is
     * no Return to resolve, and the shell wrote all three keys as null: the
     * way back vanished without the reader ever leaving.
     *
     * Both spellings are tested because both are reachable: a same-tab
     * navigation that asks for a Return and one that does not.
     */
    const asked = shell('dashboard').open({ requested: true })
    expect(asked.open({ requested: true }).offered()?.label).toBe('Dashboard')

    const unasked = shell('dashboard').open({ requested: true })
    expect(unasked.open({ requested: false }).offered()?.label).toBe('Dashboard')
  })

  it('still clears the way back when the reader really does arrive from nowhere', () => {
    /* The counterpart, and the reason the fix is not "never clear". A
       reader who came from the Dashboard and then opens the same name from
       the global search box must NOT be offered a way back to a surface
       they did not come from. That is a real move, so the keys are
       rewritten -- and this is the leak the module exists to prevent. */
    const s = shell('dashboard').open({ requested: true })
    expect(s.goTo('ideas').open({ requested: false }).offered()).toBeNull()
  })

  it('drops a way back that was stamped in another organisation', () => {
    const s = shell('dashboard').open({ requested: true })
    expect(s.offered('org-2')).toBeNull()
    /* And it comes back when the reader switches back, because the stamp is
       a comparison and not a deletion. */
    expect(s.offered('org-1')?.label).toBe('Dashboard')
  })

  it('writes all three keys on a move, so nothing survives by omission', () => {
    /* The merge rule, asserted directly on the patch rather than through
       the harness: a clearing patch has to SAY null three times. */
    const patch = returnTabPatch({
      requested: false, activeTabId: 'ideas', hosts: HOSTS,
      targetId: ASSET, organizationId: ORG,
    })
    expect(patch).toEqual({ returnTabId: null, returnTabLabel: null, returnOrgId: null })
    /* And a non-move patch says nothing at all, which is a different thing
       from saying null. */
    expect(returnTabPatch({
      requested: false, activeTabId: ASSET, hosts: HOSTS,
      targetId: ASSET, organizationId: ORG,
    })).toBeNull()
  })
})
