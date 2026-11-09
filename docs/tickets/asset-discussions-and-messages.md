# Asset discussions and Messages — audit, and the one thing to fix now

Status: **audit complete, implementation deferred.** One material correctness
finding is listed as "fix now" at the bottom; the integration work is a
separate lane and is specified here rather than improvised.

---

## What I expected to find, and did not

The concern was a second messaging silo: asset discussions stored apart from
Messages, invisible to it, unreachable afterwards.

**That is not what is there.** The storage is already unified.

```
Asset page "Team" button
  → discuss(target)                       src/lib/engagement/open-engagement.ts
  → window CustomEvent 'tesseract:open-engagement'
  → CommunicationPane (mounted once in Layout)
  → EngagementThread                      src/components/communication/
  → IdeaComments                          src/components/ideas/social/
  → messages (context_type='asset', context_id=<asset id>)
```

`EngagementThread` writes no query of its own. Its header says so explicitly:
it contributes "WHICH pair to bind, and WHY the conversation was started" and
delegates everything else to `IdeaComments`, which already owns the composer,
the user join and the timestamps.

And `MessagingSection` already reads those rows back: it groups `messages` by
`(context_type, context_id)`, excludes `trade_idea` (which has its own UI),
and resolves `context_type='asset'` to `SYMBOL - Company Name` against the
`assets` table.

**So an asset discussion is already visible in Messages today.** Production
carries 20 such rows (`context_type='asset'`), against 21 `trade_idea` and 3
`theme`.

---

## The material finding: "Team" is not the scope

```sql
-- pg_policies, production, 2026-10-14
messages_select  SELECT  {authenticated}  (organization_id = current_org_id())
messages_insert  INSERT  {authenticated}  (user_id = auth.uid() AND organization_id = current_org_id())
messages_delete  DELETE  {authenticated}  (user_id = auth.uid() AND organization_id = current_org_id())
```

`messages_select` is **organization-wide**. It is not team-scoped, not
portfolio-scoped, and not participant-scoped. Every authenticated user in the
organisation can read every asset discussion in it.

The button is labelled **Team**. The visibility is **the whole organisation**.

That mismatch is the answer to "users may not understand who can see those
conversations": the label tells them something narrower than the truth. A
person writing a candid note about a position under a button marked "Team" is
being told the audience is smaller than it is.

Note this is not a leak — RLS holds the tenant boundary correctly, and
`organization_id` is enforced on insert as well as select. It is a **labelling
and disclosure** problem, and it is the one thing here I would fix before
shipping anything else in this area.

---

## The real gaps

1. **No route back from the Asset page to the thread's history.** The Team
   button opens the pane bound to this asset. There is no indicator that a
   discussion already exists, how many messages, or when the last one was —
   so a reader has no reason to press it and no idea they are missing
   something.

2. **No route from Messages to the Asset Workspace.** `MessagingSection`
   resolves the asset name and stores `contextData`, but opening the
   conversation does not open the asset's workspace in the tab shell.

3. **`MessagingSection`'s query is unbounded and unscoped by context.** It
   selects the newest 100 `messages` rows across all context types and groups
   client-side, then issues one lookup **per conversation** to resolve the
   name (an N+1). On a busy organisation the 100-row window silently drops
   older conversations — a discussion is not deleted, it simply stops being
   listed. That is a correctness problem waiting for scale, not a visual one.

4. **No notifications on an asset discussion.** `is_read` exists on the row
   and `MessagingSection` computes `has_unread` from it, but nothing notifies
   a covering analyst that somebody wrote about their name.

---

## Recommended implementation, as its own lane

Do not widen RLS. Do not add a second store. In order of value:

**A. Say who can see it.** (small, do now — see below)

**B. Show that a thread exists, on the Asset Workspace.** A count and a
last-activity timestamp beside the Team button, read from the same
`(context_type, context_id)` pair. One query, no new table, no new policy.

**C. Make Messages open the workspace.** `MessagingSection` already holds the
resolved asset row in `contextData`; wiring its click to the existing
`open-asset-by-symbol` event — the channel the rest of the app already uses —
closes the loop without new navigation concepts.

**D. Fix the 100-row window and the N+1.** A proper conversation index:
either a server-side `DISTINCT ON (context_type, context_id)` view, or a
`conversations` projection maintained by trigger. This is the only item that
needs schema work, and it should be designed rather than patched.

**E. Notifications.** The notification contract already in use for coverage
(`context_id`, `context_data.asset_id`, the full `asset_ids` list) applies
directly. Defer until B and C exist, or people will be notified about threads
they still cannot navigate to.

---

## Fix now: the label

The smallest honest change is to stop the button claiming a scope it does not
have, and to say the real one where the conversation is composed. No RLS
change, no schema change, no new surface.

That is the only part of this document I would implement without further
design review.
