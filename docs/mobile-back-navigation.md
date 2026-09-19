# Mobile back navigation

## What the app looks like to the browser

The whole authenticated product is **one history entry**.

`src/App.tsx` mounts `DashboardPage` under `/*`. Tabs are not routes: they live
in `sessionStorage` via `TabStateManager`, and `DashboardPage` calls no router
hook at all. Opening an asset, a note, a portfolio or Trade Lab changes React
state and the tab strip. It does not change the URL, and it does not add a
history entry.

One consequence used to reach the user directly. On a phone the back gesture is
the primary way out of anything, and with an overlay open there was nothing in
history for it to consume, so it left Tesseract from behind a drawer the user
had opened a moment earlier.

## What is fixed

`src/hooks/useDismissOnBack.ts` gives every transient mobile surface one
history entry while it is open, and consumes that entry however the surface
closes.

| Surface | Where it is wired |
| --- | --- |
| Phone nav drawer | `MobileNavDrawer` |
| Notification / AI / messages sheet | `CommunicationPane`, mobile only |
| Full-screen search | `MobileSearchOverlay` |
| Every bottom sheet | `BottomSheet`, mobile only |

The guarantees it holds, all covered by
`src/hooks/__tests__/useDismissOnBack.test.tsx`:

- back with an overlay open closes the overlay and stays in the app
- back with nothing open leaves the app, exactly as before
- closing by button, backdrop or Escape consumes the entry, so no back press is
  ever spent stepping over something already gone
- stacked overlays close top down, one press each
- nobody is trapped: the entry is never re-pushed on dismissal
- desktop is untouched, because the hook is passed `enabled: isMobile` wherever
  a surface is shared

It uses the raw History API rather than a router hook. Sheets are rendered
outside a `<Router>` (the card gallery mounts `SignalCardView` with no router),
and `pushState` preserves whatever state react-router already put on the entry,
so the router's own bookkeeping survives a push it did not make.

## What is NOT fixed, and why

**Back from a detail does not return to the list it came from.**

Tabs are not addressable. Making back walk the tab set means either putting
tabs in the URL or building a parallel navigation stack beside the tab state
manager. Both are router redesigns:

- every tab type needs a URL shape, including the ones carrying opaque `data`
  payloads (`taskId`, `stageId`, `shareId`, `initialSection`, focus and issue)
- restore-from-session and restore-from-URL become two sources of truth that
  have to agree
- the feed's frozen contract requires SPA navigation to preserve feed state and
  order, which a real route change would have to be shown not to disturb
- desktop's multi-tab workspace has no back semantics at all, so the two form
  factors would need different navigation models over one tab set

That is a lane of its own, not a compatibility fix. Until it is done, back on a
phone dismisses what is in front of you and then leaves the app, and moving
between tabs is done through the drawer's Recent list.

A full browser refresh still resets ephemeral navigation state. That is
unchanged and intended.
