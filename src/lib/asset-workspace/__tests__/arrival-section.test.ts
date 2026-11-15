/**
 * An arrival SECTION is acted on once per request, and never replayed.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * "Edit in research" inside The case, on a dashboard asset pane, sent
 * `focus: 'research'` and nothing else. `focus` names a LENS, so the reader
 * arrived at the Research page — and then at whatever scroll position the
 * Research page had last been left at, which on a long page is usually not
 * the paragraph whose Edit control they had just pressed. The control named a
 * section and the arrival dropped it.
 *
 * ── Why this is a module and not a mounted test ───────────────────────────
 *
 * The receiver is a 4,500-line component that cannot be stood up here, so the
 * DECISION lives in `arrival-focus` next to the focus rule it mirrors, and
 * this suite exercises it directly. What the component does with a `true` is
 * one `setAttentionAnchor` call; what it must never do is decide this itself,
 * which is the mistake the durable-replay bug was made of.
 *
 * ── The journey these pin ─────────────────────────────────────────────────
 *
 *   1. Press "Edit in research" in The case.      -> scroll to the case
 *   2. Move to another tab; the Asset page UNMOUNTS.
 *   3. Come back; it remounts on the same tab data. -> do NOT scroll again
 *
 * Step 3 is the one that matters. Keyed on the section value alone, the
 * reader is yanked back to the case every time they return to that tab,
 * forever — the exact defect `focusRequestId` was introduced for, one field
 * over.
 */
import { describe, it, expect } from 'vitest'
import {
  sectionIntentKey, shouldApplySection, focusIntentKey,
} from '../arrival-focus'
import {
  assetTabFor, isAssetSectionTarget, ASSET_SECTION_TARGETS,
} from '../../desktop-asset/navigate'

/** One receiver, holding what it has consumed, as the component's ref does. */
function receiver() {
  let consumed: string | null = null
  return {
    arrive(section: unknown, focusRequestId?: string | null): boolean {
      const intent = sectionIntentKey(
        typeof section === 'string' ? section : null,
        focusRequestId,
      )
      const take = shouldApplySection(intent, consumed, isAssetSectionTarget(section))
      if (take) consumed = intent
      return take
    },
    get consumed() { return consumed },
  }
}

describe('a named section is acted on once', () => {
  it('scrolls on the request, and not again when the tab is returned to', () => {
    const r = receiver()
    const tab = assetTabFor({ assetId: 'aapl', focus: 'research', section: 'case' }).data

    expect(r.arrive(tab.section, tab.focusRequestId)).toBe(true)
    /* The remount. Same tab data, because tab data is durable. */
    expect(r.arrive(tab.section, tab.focusRequestId)).toBe(false)
    expect(r.arrive(tab.section, tab.focusRequestId)).toBe(false)
  })

  it('acts again when the reader presses the same control a second time', () => {
    /*
     * The whole reason for the request id. "Edit in research" pressed twice
     * is two arrivals, and the second has to work — a reader who scrolled
     * away and pressed it again is asking to be taken back.
     */
    const r = receiver()
    const first = assetTabFor({ assetId: 'aapl', section: 'case' }).data
    const second = assetTabFor({ assetId: 'aapl', section: 'case' }).data

    expect(r.arrive(first.section, first.focusRequestId)).toBe(true)
    expect(r.arrive(second.section, second.focusRequestId)).toBe(true)
  })

  it('still fires only once for a descriptor with no request id', () => {
    /* A saved session, or a hand-built descriptor. It gives up re-requesting
       the same section; it does not give up the replay guard. */
    const r = receiver()
    expect(r.arrive('case', null)).toBe(true)
    expect(r.arrive('case', null)).toBe(false)
    /* A DIFFERENT section is a different intent and still lands. */
    expect(r.arrive('targets', null)).toBe(true)
  })
})

describe('an arrival that named no section does nothing', () => {
  it('is the normal case, and is not an error', () => {
    /* Most visits to an asset are about the asset, not about a paragraph of
       it. A scroll the reader did not ask for is as disorienting as one that
       failed to happen. */
    const r = receiver()
    const tab = assetTabFor({ assetId: 'aapl', focus: 'research' }).data
    expect(tab.section).toBeNull()
    expect(r.arrive(tab.section, tab.focusRequestId)).toBe(false)
    expect(r.consumed).toBeNull()
  })
})

describe('an unreachable section is refused, not consumed', () => {
  it('refuses a value the Asset page has no anchor for', () => {
    /*
     * There are five anchors. A sixth value would set an anchor whose DOM id
     * is `undefined`, and the receiving effect polls for three seconds and
     * then gives up — a scroll that never happened and never said so.
     */
    const r = receiver()
    expect(r.arrive('outcomes', 'req-1')).toBe(false)
    expect(r.arrive('', 'req-1')).toBe(false)
    expect(r.arrive(42, 'req-1')).toBe(false)
  })

  it('leaves the request unconsumed, so a later build can still honour it', () => {
    /*
     * Deliberate, and the reason `reachable` is a separate argument rather
     * than folded into the key. A section this build cannot reach is not a
     * request that has been SERVED. Consuming it would mean that adding the
     * anchor later still did nothing for the reader who was already sent
     * there — a tab in hand, with an arrival that had been silently spent.
     */
    const r = receiver()
    r.arrive('outcomes', 'req-1')
    expect(r.consumed).toBeNull()
    /* The same request, once the section is one the page knows. */
    expect(r.arrive('targets', 'req-1')).toBe(true)
  })

  it('covers every section the navigation contract can express', () => {
    /* The two sets must not drift: a sender can name any of these, and each
       one has to be reachable or the navigation is dead on arrival. */
    for (const s of ASSET_SECTION_TARGETS) {
      expect(receiver().arrive(s, 'req-1')).toBe(true)
    }
  })
})

describe('the section key and the focus key do not collide', () => {
  it('are different strings for the same request', () => {
    /*
     * Both effects fire on one arrival: the focus effect sets the sub-page,
     * the section effect sets the scroll anchor. Sharing a key would mean
     * whichever ran first cancelled the other — not a rare race, but every
     * navigation that names both, which is every one this change adds.
     */
    const tab = assetTabFor({ assetId: 'aapl', focus: 'research', section: 'case' }).data
    const f = focusIntentKey(tab.focus, tab.focusRequestId)
    const s = sectionIntentKey(tab.section, tab.focusRequestId)
    expect(f).not.toBe(s)
    expect(f).toBeTruthy()
    expect(s).toBeTruthy()
  })

  it('does not leak one asset\'s consumed section to another', () => {
    /* Each tab has its own receiver, because the component is keyed per
       asset. Asserted so that a future unkeyed render is a failing test
       rather than a reader scrolled to another name's paragraph. */
    const amzn = receiver()
    const tab = assetTabFor({ assetId: 'amzn', section: 'case' }).data
    expect(amzn.arrive(tab.section, tab.focusRequestId)).toBe(true)
    expect(receiver().arrive(tab.section, tab.focusRequestId)).toBe(true)
  })
})
