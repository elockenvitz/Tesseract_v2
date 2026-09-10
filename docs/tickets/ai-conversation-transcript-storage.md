# AI conversation transcripts are one unbounded jsonb column

**Status**: the read half is closed; the write half is BLOCKED ON ERIC — one
decision, stated in §5. Do not start the migration before that answer.
**Found**: 2026-09-08, AI System V2 stage 2 (`feat/ai-system-v2`).
**Closed here**: 2026-09-10, backlog closure. See §3 for what actually shipped.

---

## 1. The shape of the problem

`ai_conversations.messages` is a single `jsonb` column holding every turn of a
thread. Nothing in the schema bounds it and nothing in the application bounds
it either. Three separate costs came out of that, and they are not the same
problem despite sharing a cause.

| | What it cost | Fixed? |
|---|---|---|
| **Send** | The whole thread re-sent to the model every turn | Yes — stage 2, `boundHistory` |
| **List** | Up to 200 full transcripts downloaded to render a sidebar of titles | Yes — see §3 |
| **Write** | The whole array rewritten on every turn, forever | **No** — see §4 |

Only the third one needs a migration. That distinction is what let two thirds
of this ticket close without one.

---

## 2. What was already fixed before this ticket

`src/lib/ai/history.ts` bounds what goes **to the model**: twelve messages,
24,000 characters, oldest dropped first, never ending on an orphaned assistant
turn. Deterministic rather than a model-generated summary, because a summary
costs an extra request on the critical path of a latency-bound feature and
makes "why did it forget X" unanswerable.

That is the send side and only the send side. It does not touch the database.

---

## 3. What closed during backlog closure — no migration

The sidebar query was `select('*')` with `.limit(200)`. `*` includes
`messages`, so opening the AI panel downloaded up to two hundred complete
transcripts in order to render a list of titles and dates. The most expensive
query in the feature was the one displaying the least, and it grew every time
anybody asked the model anything.

Three changes, all in `src/hooks/useAI.ts`, none of them schema:

1. The list query names its columns (`CONVERSATION_SUMMARY_COLUMNS`) and
   `messages` is not among them.
2. `AIConversationSummary = Omit<AIConversation, 'messages'>` types the list.
   Three call sites read `messages` off a cached list row and would otherwise
   have silently started rendering an empty thread; a fourth is now a type
   error rather than a blank panel.
3. `fetchConversationMessages(id)` fetches one transcript when a thread is
   actually opened. The auto-load effect guards it with `cancelled`, because
   that effect re-fires on navigation and a slow fetch for AAPL must not land
   in a pane the reader has since pointed at MSFT.

Also: the create path's `.select()` echoed the entire new row back, including
the `messages` array just uploaded. It now selects `id`. Creating a
conversation had been paying for the transcript twice, up and down.

**Net:** the sidebar payload no longer scales with how much anyone has ever
said to the model. The per-thread transcript still does.

---

## 4. What is left, and why it is genuinely a schema question

`saveConversation` writes `messages: nextMessages` — the complete array — on
every single turn. Turn 100 uploads 99 turns of history in order to append one.
`fetchConversationMessages` then downloads all of it to open the thread.

There is no application-level fix that is not a lie:

- **Truncating on write deletes the reader's own transcript.** The sidebar
  reads it back and a research thread is a record of how a judgment was
  reached. Silently dropping turn 3 because turn 40 arrived is data loss
  dressed as an optimisation. This product's whole premise is that reasoning
  is a typed, retained entity, not scrollback.
- **A jsonb append operator** (`messages || $1`) removes the re-upload but not
  the re-download, does not bound growth, and gives up the row-level RLS and
  per-message indexing that make the real fix worth doing.
- **Client-side paging over a jsonb array** requires reading the array to page
  it. It is the problem wearing a hat.

The honest fix is `ai_conversation_messages` — one row per turn, appended
rather than rewritten, `conversation_id` FK, ordinal, role, content, and the
optional payloads (`citations`, `tool_calls`, `actions`, `evidence`,
`analysis`) that `rehydrateMessage` already reads.

---

## 5. THE DECISION — one question for Eric

Everything above is settled. This is not:

> **When a thread's transcript moves to its own table, do existing threads
> come with it?**

The two answers lead to genuinely different work, and neither is obviously
right:

**(a) Backfill.** Every existing `messages` array is expanded into rows, the
column is dropped, history is continuous. Costs a data migration over live
rows with no migration ledger to check it against (see the schema-drift note:
migrations do not describe production, so the backfill has to be written
defensively and verified against the live table, not against these files).

**(b) Cut over.** New turns go to the new table; the old column is retained
read-only and the loader unions the two. No data migration, no backfill risk,
but every reader carries a two-source union permanently and the column never
actually goes away.

Recommendation: **(a) backfill**, on the grounds that (b)'s "temporary" union
is the kind of thing that outlives everyone who understood why it was there,
and that AI conversations are recent enough and few enough that the backfill is
small. But this is a call about how much migration risk is acceptable against
how much permanent complexity, and that is not a call to make silently.

Not drafted as SQL yet, deliberately: the table shape barely differs between
the two answers, but the migration is most of the work and half of it depends
on which one this is.

---

## 6. RLS posture, for whoever picks this up

`ai_conversations` is **user-scoped, not org-scoped**:

```sql
CREATE POLICY "Users manage their own ai conversations" ON public.ai_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

A new `ai_conversation_messages` table must reach `auth.uid()` **through**
`conversation_id`, not carry its own `user_id` — a denormalised owner column is
a second source of truth for who may read a turn, and the two will disagree the
first time a conversation changes hands or a row is inserted by anything but
the panel.

Note also what user-scoping means and does not mean: a thread is private to its
author, but its *contents* are assembled by `selectContext` from org-scoped
data. Whether a conversation should survive its author leaving an organization
is a separate open question and is **not** part of this ticket.
