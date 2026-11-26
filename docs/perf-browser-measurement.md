# Measuring navigation latency in the browser

I cannot run a browser in this environment, so the numbers in the performance
PR are of two kinds, and they are labelled as such throughout:

- **Measured**: round-trip latency to this project's own Supabase endpoint,
  database execution time, and request *counts* (the last from a test that
  counts at the `supabase.from()` boundary with a real React Query cache).
- **Not measured**: what the page feels like. Time to first useful paint,
  render cost, and the effect of a fix on a real navigation.

This file is how you collect the second kind. It needs no build and no
dependencies: paste a snippet into the DevTools console.

---

## What the measured numbers were

Established in this session against the live project:

| quantity | value | how |
|---|---|---|
| warm round-trip to PostgREST | **132 ms** mean (23–257 ms over 9 samples) | 10 requests on one reused TLS connection |
| cold round-trip (new connection) | 1.3–1.7 s | first request, TLS handshake included |
| membership query execution | **6.7 ms** | `EXPLAIN (ANALYZE)` on the live database |

The shape of the problem follows from those three rows: the database is not
slow, the network trip is, so latency is *round-trip count* multiplied by
~132 ms. That is why both fixes in the performance PR remove round-trips rather
than tuning queries.

---

## Snippet 1 — count Supabase round-trips for one navigation

This is the one that matters most, because it shows duplicates and waterfall
depth directly.

1. Open the app and sign in.
2. Open DevTools (F12) → Console.
3. Paste this and press Enter. It arms a recorder; it prints nothing yet.

```js
window.__perf = (() => {
  const t0 = performance.now()
  const rows = []
  const obs = new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (!e.name.includes('/rest/v1/')) continue
      const table = decodeURIComponent(e.name.split('/rest/v1/')[1].split('?')[0])
      rows.push({
        table,
        startMs: Math.round(e.startTime - t0),
        durMs: Math.round(e.duration),
      })
    }
  })
  obs.observe({ type: 'resource', buffered: true })
  return {
    reset() { rows.length = 0; this.t0 = performance.now() },
    report() {
      const byTable = {}
      for (const r of rows) byTable[r.table] = (byTable[r.table] ?? 0) + 1
      const dupes = Object.entries(byTable).filter(([, n]) => n > 1)
      console.table(rows.slice().sort((a, b) => a.startMs - b.startMs))
      console.log('total round-trips:', rows.length)
      console.log('per table:', byTable)
      console.log(dupes.length ? 'DUPLICATED: ' + JSON.stringify(dupes) : 'no duplicates')
      const last = rows.reduce((m, r) => Math.max(m, r.startMs + r.durMs), 0)
      console.log('last response at:', last, 'ms after arming')
      return { rows, byTable, lastMs: last }
    },
  }
})()
```

4. Type `__perf.reset()`.
5. **Navigate to an asset page** (click an asset, or switch to an asset tab).
6. Wait until the page has visibly finished, then type `__perf.report()`.

**What to look for.** `DUPLICATED` naming the same table twice is the defect the
performance PR fixes. Before the fix, an asset page mounting a shallow consumer
beside a deep one fetched each of eight tables **twice** — the counting test
measures 16 round-trips where 9 now suffice. If you run this on production
(currently `ad173b9a`, which does **not** contain the fix) you should see the
duplicates; after the fix deploys, the same navigation should show
`price_history_cache` twice and everything else once.

The `startMs` column shows the waterfall: requests starting at roughly the same
time are parallel, and a cluster starting only after an earlier one finished is
a dependent trip.

---

## Snippet 2 — time to useful content

Round-trips are not the same as what the reader sees. This measures from the
moment you navigate to the moment real content exists in the DOM.

Paste, then navigate:

```js
window.__ttc = (sel = '[data-testid="pro-chart"], main h1, [class*="Snapshot"]') => {
  const t0 = performance.now()
  return new Promise(resolve => {
    const done = () => {
      const ms = Math.round(performance.now() - t0)
      console.log('useful content after', ms, 'ms  (matched:', sel, ')')
      resolve(ms)
    }
    if (document.querySelector(sel)) return done()
    const mo = new MutationObserver(() => {
      if (document.querySelector(sel)) { mo.disconnect(); done() }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { mo.disconnect(); console.log('no match within 20s'); resolve(null) }, 20000)
  })
}
```

Then: `__ttc()` and immediately click through to the asset page.

Replace the selector with something that only exists once the page has real
data — a price, a thesis heading. A skeleton or spinner must **not** match it,
or the number measures the skeleton and flatters the result. That distinction is
the whole point: a throwing or empty component can remove a spinner just as a
loaded one does.

---

## Snippet 3 — React render cost

Only worth running if snippets 1 and 2 show the requests are fast but the page
still feels slow.

1. Install the React DevTools extension.
2. Profiler tab → gear → tick **Record why each component rendered**.
3. Record, navigate to the asset page, stop.
4. Sort by self time.

**What to look for.** A component re-rendering many times during one navigation,
with the reason given as a changed prop that should have been stable. The
performance PR has one guard for exactly this: `useAssetWorkspace` returns the
shared `EMPTY` singleton by reference while loading, rather than a fresh object,
so downstream memos are not invalidated on every pass.

---

## Reporting back

For each of A (dashboard) and B (asset page), the useful record is:

```
surface:            asset page / dashboard
total round-trips:  <from __perf.report()>
duplicated tables:  <from __perf.report()>
last response at:   <ms>
useful content at:  <ms from __ttc()>
```

Run each twice: once cold (hard reload, Ctrl+Shift+R) and once warm (navigate
away and back). The two differ a lot — the cold round-trip measured above is
about ten times the warm one — and conflating them is how a cache win gets
reported as a network win.
