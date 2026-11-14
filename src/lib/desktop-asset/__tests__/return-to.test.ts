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
  returnTargetFrom, returnTabData, readReturnTarget, returnLabelFor,
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
