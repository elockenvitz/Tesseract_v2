/**
 * The chart workspace a tab switch must not destroy.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `DashboardPage.renderTabContent()` renders only the ACTIVE tab, so moving
 * from Charting to Overview unmounts `ChartingPage` outright. Its panels —
 * the selected symbol, the timeframe, the chart type, the indicators, the
 * comparison series — lived in `useState` seeded by `getDefaultChartingState`,
 * whose own comment read "(no persistence)". Coming back therefore rebuilt
 * the default: blank symbol, `1M`, no indicators. The state was owned by a
 * component that the navigation in question destroys.
 *
 * Lifting it here, outside React's tree, is the smallest ownership change
 * that survives an unmount. Keeping every tab mounted instead would have
 * changed the behaviour of every other tab in the app to fix one.
 *
 * ── Why the key carries the principal ────────────────────────────────────
 *
 * A plain tab id would let the next person signed in on this machine open
 * Charting and find the previous account's symbols and comparisons sitting
 * there. So the key is `userId:orgId:tabId`, and a different account or a
 * different organization simply reads a different entry — it cannot see the
 * other's, by construction rather than by remembering to clear.
 *
 * `clearChartingWorkspaces` exists as well, wired to the principal change, so
 * the map does not hold a signed-out account's selections in memory. The
 * partitioning is what makes it safe; the clear is hygiene.
 *
 * ── Surviving a RELOAD, which the memory map cannot ──────────────────────
 *
 * The map above survives a tab switch and nothing else. Reloading Charting
 * returned "No Symbol Selected": the instrument, the timeframe, the
 * indicators and the drawings were all gone. On a terminal that is not a
 * fresh start, it is losing the analyst's place.
 *
 * So there is a second, durable layer behind the same two functions. It is
 * OPT-IN: a caller that passes no codec gets exactly the in-memory behaviour
 * this module had before, and only a caller that says how its state
 * survives JSON gets durability.
 *
 * That is not ceremony. `CustomDateRange` holds real `Date` objects, and a
 * `Date` does not survive `JSON.parse(JSON.stringify(x))` -- it comes back a
 * string. Restoring one straight from storage hands `ProChart` a string
 * where it expects a Date and the chart throws on `.getTime()`. A blanket
 * "revive anything that looks like a date" walker would be worse, because it
 * would also rewrite fields that are legitimately strings. The owner of the
 * shape is the only thing that knows, so the owner supplies the codec.
 *
 * ── What is written to disk, and what is not ─────────────────────────────
 *
 * Entries are namespaced and keyed by the same `userId:orgId:tabId`, so a
 * different account or organization reads a different entry. The principal
 * change purges the stored entries as well as the map -- without that, a
 * signed-out account's symbols would sit on disk until something overwrote
 * them, which is the one real cost of moving off memory and is paid here
 * rather than noted.
 *
 * Every access is wrapped: storage can be absent, disabled, full, or throw
 * on read in a private window. In each case this degrades to the in-memory
 * behaviour rather than failing the page.
 */
/*
 * Generic over the state it holds, so this module has no dependency on the
 * page. `ChartPanel` and its chart-type unions live with the Charting page;
 * importing them here to type the map would make the page and the store
 * import each other, and the store exists precisely so it does not share the
 * page's lifetime.
 */

/**
 * Exported so a test can seed it and watch the clear empty it.
 *
 * A source assertion that the clear is *called* passes just as happily when
 * the call is dead, which is how an earlier cache guard in this codebase went
 * green with its clear disabled.
 */
export const chartingWorkspaceStore = new Map<string, unknown>()

/**
 * The identity of one workspace.
 *
 * A null principal yields null, and a null key means "do not persist" — an
 * unauthenticated or still-resolving session must not write into a slot that
 * a real principal could later read.
 */
export function chartingWorkspaceKey(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  tabId: string | null | undefined,
): string | null {
  if (!userId || !tabId) return null
  return `${userId}:${orgId ?? 'no-org'}:${tabId}`
}

/**
 * How a workspace survives JSON, supplied by whatever owns its shape.
 *
 * `fromJSON` returns null for anything it does not recognise. A stored entry
 * is untrusted input -- it can be stale from an older build, hand-edited, or
 * truncated -- and a page that renders a half-understood object is worse
 * than one that starts fresh.
 */
export interface WorkspaceCodec<T> {
  toJSON(state: T): unknown
  fromJSON(raw: unknown): T | null
}

/**
 * The storage namespace.
 *
 * Versioned, so a change to the stored shape cannot resurrect an object the
 * current build does not understand: the prefix changes and the old entries
 * are simply never read. They are removed by the next `clearChartingWorkspaces`.
 */
const STORAGE_PREFIX = 'tesseract.charting.workspace.v1:'

/**
 * The most workspaces kept on disk at once.
 *
 * One per tab per principal, and tabs are cheap to open, so without a cap
 * this grows until the origin's quota is reached -- at which point every
 * OTHER feature's storage write starts failing too. The oldest entries go
 * first. A low cap is fine: the point is to survive a reload, not to archive
 * every workspace a person has ever opened.
 */
const MAX_STORED_WORKSPACES = 24

/**
 * The backing store, or null when there is not one.
 *
 * Reading `localStorage` THROWS rather than returning undefined when site
 * data is blocked, so even the lookup is guarded.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Our own keys, oldest first by insertion order. */
function storedKeys(store: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  return keys
}

export function readChartingWorkspace<T>(
  key: string | null,
  codec?: WorkspaceCodec<T>,
): T | null {
  if (!key) return null

  // The map wins. Within a session it is the live object, and it has not
  // been through JSON.
  const inMemory = chartingWorkspaceStore.get(key) as T | undefined
  if (inMemory !== undefined) return inMemory

  if (!codec) return null
  const store = storage()
  if (!store) return null

  try {
    const raw = store.getItem(STORAGE_PREFIX + key)
    if (raw === null) return null

    const restored = codec.fromJSON(JSON.parse(raw))
    if (restored === null) {
      // Understood as far as JSON and no further. Dropped rather than left
      // to be re-read and re-rejected on every mount.
      store.removeItem(STORAGE_PREFIX + key)
      return null
    }

    // Promoted into the map so the next read in this session skips all of
    // the above and returns the same object identity.
    chartingWorkspaceStore.set(key, restored)
    return restored
  } catch {
    // Unparseable, or storage threw. Starting fresh is the correct outcome
    // and is what this did before it was durable.
    try { store.removeItem(STORAGE_PREFIX + key) } catch { /* nothing left to do */ }
    return null
  }
}

export function writeChartingWorkspace<T>(
  key: string | null,
  state: T,
  codec?: WorkspaceCodec<T>,
): void {
  if (!key) return
  chartingWorkspaceStore.set(key, state)

  if (!codec) return
  const store = storage()
  if (!store) return

  try {
    const serialised = JSON.stringify(codec.toJSON(state))
    prune(store, key)
    store.setItem(STORAGE_PREFIX + key, serialised)
  } catch {
    /*
     * Quota exceeded, storage disabled mid-session, or a value that will not
     * serialise. The in-memory write above already happened, so the session
     * behaves exactly as it did before durability existed. Never surfaced:
     * failing to persist a chart selection is not something to interrupt an
     * analyst for.
     */
  }
}

/** Make room for one more, oldest first. */
function prune(store: Storage, incomingKey: string): void {
  const keys = storedKeys(store).filter(k => k !== STORAGE_PREFIX + incomingKey)
  for (let i = 0; i <= keys.length - MAX_STORED_WORKSPACES; i++) {
    store.removeItem(keys[i])
  }
}

/**
 * Forget every workspace, in memory AND on disk.
 *
 * Wired to the principal change. The disk half is the part that matters now
 * that there is one: partitioning by key stops one account READING another's
 * entry, but it does not stop a signed-out account's symbols sitting in
 * storage afterwards. Only our own prefix is removed -- this must never
 * reach for `clear()` and take every other feature's storage with it.
 */
export function clearChartingWorkspaces(): void {
  chartingWorkspaceStore.clear()

  const store = storage()
  if (!store) return
  try {
    for (const key of storedKeys(store)) store.removeItem(key)
  } catch {
    /* Storage went away mid-clear; the map is already empty. */
  }
}
