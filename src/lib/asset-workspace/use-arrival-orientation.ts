/**
 * Taking the arrival once, on the page the reader actually landed on.
 *
 * ── Why this is a hook and not four lines in the page ─────────────────────
 *
 * It was four lines in `AssetTab`, and those four lines carried three
 * decisions that can each be wrong in a way nobody would see in review:
 *
 *   wait for the organisation  `takeEntryArrival` discards a context whose
 *                              organisation does not match, and a null
 *                              organisation matches nothing. Taking before
 *                              the id resolves therefore CONSUMES the offer
 *                              and throws it away, and the band never draws.
 *   take once per arrival      the slot empties on the first take, so the
 *                              band is an orientation for an arrival rather
 *                              than a property of the page. Returning to the
 *                              tab is a remount and must show nothing.
 *   re-arm on a fresh request  `openAsset` on an ALREADY OPEN tab stamps a
 *                              new `focusRequestId` and does not remount, so
 *                              the request id has to be in the dependency
 *                              list or the second press orients nobody.
 *
 * `AssetTab` has a hundred imports and cannot be stood up in a test, so
 * those three decisions lived in code no test could observe. Here they can
 * be driven directly with `renderHook`, and the page's remaining share is
 * one call.
 *
 * ── The fourth decision, which the page had wrong ─────────────────────────
 *
 * A fresh `focusRequestId` with NO offer behind it used to leave the
 * previous orientation on screen. Open AAPL from a target-reached item, read
 * the band, then open AAPL again from the search box: the band was still
 * there, still saying "has reached the target you set for it", now above a
 * page the reader reached by typing a name. A reading of one moment restated
 * as current is the one failure this whole handoff exists to prevent, so a
 * new arrival key now clears what the last one left.
 *
 * ── Why the consumed key is a ref ─────────────────────────────────────────
 *
 * The app renders under `StrictMode`, which mounts, unmounts and remounts
 * every effect. Clearing on each run of the effect body would mean the first
 * run takes the context and the second run -- same deps, nothing left in the
 * slot -- wipes it, in development only. A ref survives that remount and is
 * written synchronously, so the second run recognises the key it already
 * consumed and leaves the state alone.
 *
 * Nothing is persisted, deliberately. The band states a reading of one
 * moment; a reading written into tab state would be restated as current
 * every time the reader came back to the tab.
 */
import { useEffect, useRef, useState } from 'react'
import { takeEntryArrival } from './entry-handoff'
import type { WorkspaceEntryContext } from './entry-context'

export interface ArrivalOrientationInput {
  assetId: string
  /** Null while the organisation is still resolving, which is not "none". */
  organizationId: string | null | undefined
  /** Stamped afresh by every `openAsset` call, mount or no mount. */
  focusRequestId?: string | number | null
}

/** One arrival, named so two of them cannot be mistaken for each other. */
function arrivalKey({ assetId, organizationId, focusRequestId }: ArrivalOrientationInput): string {
  return `${assetId}\u0000${organizationId ?? ''}\u0000${focusRequestId ?? ''}`
}

/**
 * The context the reader arrived with, or null when they arrived some other
 * way. Null is the normal answer: most visits to an asset page are not
 * handed an event.
 *
 * ── The fifth decision: an orientation already given is not given again ──
 *
 * The offer carries the sender's `oriented` declaration. Every offer in this
 * product is made by the embedded Asset Workspace, which has already drawn
 * the band for this arrival; "Review the case" then handed the canonical page
 * the same context and the page stated it a second time, as a second large
 * band, in the research content the reader had navigated to in order to read.
 *
 * So an oriented arrival is CONSUMED and discarded: the slot still empties
 * (which is what stops a later unrelated mount inheriting it) and the page
 * draws nothing. The reason itself is not lost -- a lapsed valuation and a
 * price past its target are both canonical facts the ⚡ attention surface
 * resolves from the page's own records.
 *
 * Returning null rather than refusing the take matters: refusing would leave
 * the offer in the slot for the next arrival, which is the third guard this
 * module exists to provide.
 */
export function useArrivalOrientation(input: ArrivalOrientationInput): WorkspaceEntryContext | null {
  const { assetId, organizationId } = input
  const [arrival, setArrival] = useState<WorkspaceEntryContext | null>(null)
  const consumed = useRef<string | null>(null)
  const key = arrivalKey(input)

  useEffect(() => {
    if (!organizationId) return
    if (consumed.current === key) return
    consumed.current = key
    const taken = takeEntryArrival({ assetId, organizationId })
    setArrival(taken && !taken.oriented ? taken.context : null)
  }, [assetId, organizationId, key])

  return arrival
}
