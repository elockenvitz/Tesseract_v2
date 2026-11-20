# Demo preparation checklist

Work through this before a live demo or a recording. It exists because three
of the items below have failed before.

---

## 1. Environment

- [ ] **Organization:** QA Lifecycle Validation. Check the org name in the
      header before you start, not after.
- [ ] **Account:** your own (platform admin). There is no second human
      account in this organization, so you cannot demonstrate two people
      with different roles. If a prospect asks to see the analyst view and
      the PM view as separate users, say that is a single-tenant limitation
      of the demo environment, not of the product.
- [ ] **Never use a real client organization.** There are 26 organizations
      on this project. Confirm the switcher is on QA Lifecycle Validation.
- [ ] **Do not delete or alter organizations.** "Daniel Adam Capital" is a
      shell and must not be touched.

## 2. Application state

- [ ] Open the app and let it finish loading before sharing your screen.
      First paint is gated deliberately and the wait looks like a hang if
      the prospect is watching.
- [ ] Light theme. It survives video compression; dark does not.
- [ ] Browser at 1600px wide. Narrower and the asset workspace starts
      collapsing columns.
- [ ] Hide the bookmarks bar, close other tabs, mute notifications.
- [ ] Sign out of any other organization in another tab, so an organization
      switch does not surprise you mid-demo.

## 3. The dry run, same day

Do this once before the real thing, every time.

- [ ] **Open the AAPL asset workspace** via Idea Pipeline, Ready to
      Recommend, click the ticker.
- [ ] **Confirm the header shows a price with a provenance caption.** You
      want something like `USD · Equity · Held in 1 portfolio · Delayed ·
      <date> · eodhd`. If it shows "No price observation", the quote path is
      down and segment 2 of the walkthrough needs to skip the header.
- [ ] **Confirm the written case is populated.** An empty Research tab makes
      segment 2 pointless.
- [ ] **Open the AAPL recommendation and find the frozen-reasoning panel.**
      This is the centre of the demo. If it does not render, stop and fix it
      before demoing.
- [ ] **Identify the decision request with no frozen version behind it** and
      note which one it is, so you do not open it. It is the defect PR #340
      fixes.
- [ ] **Open the Decision Inbox** and confirm a pending request shows all
      three controls: approve, reject, defer. A missing trio is the pilot
      example gate, not a bug, and it means that row is an example rather
      than a live request.
- [ ] **Open the AAPL decision timeline** and confirm it renders history.

## 4. Known-broken: do not navigate here

- [ ] **Global search does not return assets.** Typing a ticker or company
      name returns "No results" even though the row exists and the backend
      RPC returns it correctly when called directly. Reach assets through
      Idea Pipeline or Coverage instead. Do not demonstrate search.
- [ ] **Do not open the Outcomes surface.** Four attribution defects have
      open PRs (#341, #342, #343, #345). Until they merge it displays
      numbers we know are wrong.
- [ ] **Do not show any return or P&L figure.** Decision-time price
      snapshots copy an undated column; a computed return can be arbitrary.
- [ ] **Do not claim market-data coverage.** If asked what the data is: a
      single-seat EODHD subscription that covers the founder's own use, and
      a commercial licence for external users is an open dependency.
- [ ] **Do not demonstrate ACT AI without first confirming a provider key is
      configured** for this organization. It will fail live otherwise.

## 5. Actions that are safe to perform live

Safe, read-only or reversible:

- Navigating between tabs, assets, and the pipeline.
- Opening a recommendation and its frozen reasoning.
- Opening the Decision Inbox and reading a pending request.
- Opening a decision timeline.
- Scrolling research.

**Not safe live** (these write to the record):

- Accepting, rejecting or deferring a request. This creates execution and
  decision records and changes the demo state.
- Moving an idea between pipeline stages.
- Recording an outcome review.
- Creating or editing a thesis.

If you want to show the act of deciding, do it on a dedicated run and plan
the reset first.

## 6. Reset strategy

There is no reset button, and there is no isolated demo tenant. This is the
honest position:

- **Preferred:** do not mutate during a demo. Everything in the walkthrough
  is reachable read-only.
- **If you do mutate:** the change is permanent in the QA organization. A
  deferred request can be reconsidered; an accepted one creates an execution
  record that stays.
- **Re-seeding** is handled by the `seed-pilot-data` edge function, which is
  what created this corpus. Re-running it is a production write and needs a
  deliberate decision, not a mid-demo reflex.
- **Recommended before a sequence of demos:** take one run-through, note
  anything you changed, and decide once whether to re-seed rather than after
  each call.

## 7. What to say when something breaks

Have these ready. A straight answer costs less than a recovery attempt.

| Fails | Say |
| --- | --- |
| A price is missing | "The quote path is a single-seat data subscription and commercial licensing for pilot users is an open item. The record does not depend on it." |
| Search returns nothing | "Search has a known regression on assets. Let me go through the pipeline." |
| ACT AI errors | "The assistant runs on your own provider key, and this environment does not have one configured." |
| A page is slow | Nothing. Keep talking and let it load. Do not narrate the wait. |
| Anything shows a number you do not recognise | "I do not trust that figure and I will not walk you through it. The attribution layer has known bugs we are fixing." |

That last one is worth rehearsing. It is more persuasive than any feature in
the demo.

## 8. Before a recording specifically

- [ ] Record narration separately, then cut picture to it.
- [ ] Do the dry run in section 3 immediately before, not the day before.
      The quote path and the application state both change.
- [ ] Capture the five available screenshots listed in
      [demo-walkthrough.md](demo-walkthrough.md) in the same session, so
      they are internally consistent.
- [ ] Do not capture `outcome-review.png` yet.
- [ ] Review the recording for any visible organization name other than QA
      Lifecycle Validation, any real person's name other than your own, and
      any email address.
