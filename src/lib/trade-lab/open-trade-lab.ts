/**
 * Open Trade Lab through the one path the app already has — and know whether
 * it went.
 *
 * ── The path ──────────────────────────────────────────────────────────────
 *
 * Every Trade Lab hand-off dispatches `openTradeLab` on `window`, and
 * `DashboardPage` is the listener that turns it into a navigation to the
 * `trade-lab` tab. Decision Inbox, the Header, the portfolio command centre and
 * the Pipeline board all use it. This does not add a second route; it
 * dispatches the same event with the same detail.
 *
 * ── Knowing it went ───────────────────────────────────────────────────────
 *
 * A bare `dispatchEvent` cannot tell you whether anybody was listening, so a
 * caller that wants to record "the reader got to Trade Lab" would be recording
 * the attempt. This event is `cancelable`, and the navigating listener calls
 * `preventDefault()` once it has navigated, so `defaultPrevented` afterwards
 * means the canonical handler ran. Existing dispatches are not cancelable, so
 * `preventDefault()` is a no-op for them and they behave exactly as before.
 */

export const OPEN_TRADE_LAB_EVENT = 'openTradeLab'

export interface OpenTradeLabDetail {
  labId?: string
  labName?: string
  portfolioId?: string
  /** The idea the hand-off is about, carried into the Trade Lab tab's data. */
  tradeQueueItemId?: string
  /** Who asked. Lets a passive listener leave a caller to record its own result. */
  source?: string
}

/** The Pipeline basics step-3 CTA, which records its own completion on success. */
export const PIPELINE_BASICS_CTA_SOURCE = 'pilot_pipeline_basics_cta'

/**
 * Dispatch the canonical Trade Lab event. Returns true only if the navigating
 * handler took it.
 */
export function requestOpenTradeLab(
  detail: OpenTradeLabDetail,
  target: Pick<EventTarget, 'dispatchEvent'> = window,
): boolean {
  const event = new CustomEvent<OpenTradeLabDetail>(OPEN_TRADE_LAB_EVENT, { detail, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** Whether an `openTradeLab` event came from the step-3 CTA. */
export function isPipelineBasicsCtaEvent(event: Event): boolean {
  return (event as CustomEvent<OpenTradeLabDetail>).detail?.source === PIPELINE_BASICS_CTA_SOURCE
}
