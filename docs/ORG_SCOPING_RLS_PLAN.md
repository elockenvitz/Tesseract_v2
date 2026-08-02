# Organisation scoping: RLS plan

Status: **blocked on a data backfill.** The policy changes below are correct
but must not be applied until `organization_id` is populated, or they will hide
almost all existing content.

## What is actually wrong

An earlier read of `pg_policies` suggested `trade_queue_items`,
`quick_thoughts`, `asset_notes` and `asset_lists` had no organisation-aware
policies at all. That was wrong: it searched policy expressions for the literal
string `organization`, which misses helper functions.

`trade_queue_items` **is** org-scoped on SELECT, through
`portfolio_in_current_org(portfolio_id)`. The real holes are narrower, but they
are real:

| Table | Policy | Hole |
|---|---|---|
| `quick_thoughts` | `Users can view public thoughts` | `visibility = 'public'` with no org constraint — a public thought is readable by **any authenticated user in any organisation** |
| `quick_thoughts` | `Users can view team thoughts` | Team membership is derived from shared `project_assignments`, which are not org-constrained |
| `quick_thoughts` | `Users can view own thoughts` | Own thoughts appear in every workspace the author belongs to |
| `asset_notes` | `Users can read own notes and shared notes from others` | `is_shared = true` with no org constraint — shared notes cross organisations |
| `asset_lists` | `Users can read own or shared lists` | No org constraint on either branch |
| `trade_queue_items` | `Trade queue: org-scoped access` | The `portfolio_id IS NULL` branch is scoped to creator/assignee only, so portfolio-less ideas follow their author across orgs |

The first two rows are cross-tenant exposure. The rest are one user seeing their
own or their collaborators' data in the wrong workspace — the symptom originally
reported.

## Why the policies cannot be applied yet

```
quick_thoughts        19 rows, 18 with organization_id IS NULL   (95%)
asset_notes           57 rows, 54 NULL                           (95%)
asset_lists           62 rows, 60 NULL                           (97%)
trade_queue_items    228 rows,  8 NULL                           (3.5%)
```

Adding `organization_id = current_org_id()` to a SELECT policy makes every NULL
row invisible to everyone. On these tables that is most of the content, and to a
pilot user it looks like their work has been deleted.

Newer rows are populated because triggers already stamp the column on insert
(`set_quick_thoughts_org_id`, `set_asset_lists_org_id`,
`set_note_org_id_from_caller`, `set_trade_queue_items_org_id`). The NULLs are
legacy rows predating those triggers.

## Why the backfill is not mechanical

The obvious rule — take the creator's organisation — does not resolve most of
the rows:

```
users with exactly one active org   20
users with more than one            4

asset_notes    NULL + creator in 1 org:   3      NULL + creator in many:  51
asset_lists    NULL + creator in many:   16
quick_thoughts NULL + creator in many:   14
```

The accounts holding the legacy content are the multi-org ones, so their rows
are genuinely ambiguous. Resolving them needs either a relation to lean on
(the linked asset's portfolio, the note's portfolio, the list's portfolio) or a
human decision per row.

## Sequence

1. **Backfill by relation.** For each table, derive the organisation from a
   linked entity that already carries one — portfolio, or an asset's holding.
   Measure how many rows this resolves.
2. **Decide the remainder by hand.** Low volume (tens of rows). A deliberate
   assignment is safer than a heuristic that silently puts a note in the wrong
   workspace.
3. **Verify no NULLs remain**, then apply the policies below.
4. **Add `NOT NULL`** so the triggers cannot be bypassed later.
5. Only then remove the client-side filters, if desired — though keeping them is
   harmless defence in depth.

Steps 1–2 should run on staging first. `docs/CONTRIBUTING.md` requires it for
risky changes, and there is no riskier class than one that can hide live data.

## The policies (do not apply before step 3)

```sql
-- quick_thoughts ------------------------------------------------------------
drop policy if exists "Users can view public thoughts" on public.quick_thoughts;
create policy "Users can view public thoughts"
  on public.quick_thoughts for select
  using (
    visibility = 'public'::thought_visibility
    and organization_id = current_org_id()
  );

drop policy if exists "Users can view own thoughts" on public.quick_thoughts;
create policy "Users can view own thoughts"
  on public.quick_thoughts for select
  using (
    created_by = auth.uid()
    and organization_id = current_org_id()
  );

drop policy if exists "Users can view team thoughts" on public.quick_thoughts;
create policy "Users can view team thoughts"
  on public.quick_thoughts for select
  using (
    visibility = 'team'::thought_visibility
    and organization_id = current_org_id()
    and exists (
      select 1
      from project_assignments pa1
      join project_assignments pa2 on pa1.project_id = pa2.project_id
      where pa1.assigned_to = auth.uid()
        and pa2.assigned_to = quick_thoughts.created_by
    )
  );

-- asset_notes ---------------------------------------------------------------
drop policy if exists "Users can read own notes and shared notes from others" on public.asset_notes;
create policy "Users can read own notes and shared notes from others"
  on public.asset_notes for select
  using (
    organization_id = current_org_id()
    and (
      auth.uid() = created_by
      or is_shared = true
      or exists (
        select 1 from note_collaborations
        where note_collaborations.note_id = asset_notes.id
          and note_collaborations.note_type = 'asset'
          and note_collaborations.user_id = auth.uid()
          and note_collaborations.permission = any (array['read','write','admin'])
      )
    )
  );

-- asset_lists ---------------------------------------------------------------
drop policy if exists "Users can read own or shared lists" on public.asset_lists;
create policy "Users can read own or shared lists"
  on public.asset_lists for select
  using (
    organization_id = current_org_id()
    and (created_by = auth.uid() or user_has_list_collaboration(id))
  );

-- trade_queue_items ---------------------------------------------------------
-- Closes the portfolio-less branch, which currently ignores the organisation.
drop policy if exists "Trade queue: org-scoped access" on public.trade_queue_items;
create policy "Trade queue: org-scoped access"
  on public.trade_queue_items for select
  using (
    (
      portfolio_id is null
      and organization_id = current_org_id()
      and (created_by = auth.uid() or assigned_to = auth.uid())
    )
    or (
      portfolio_in_current_org(portfolio_id)
      and (
        sharing_visibility is distinct from 'private'
        or created_by = auth.uid()
        or assigned_to = auth.uid()
      )
    )
  );
```

## Note on the default lists

`asset_lists` carries two system-seeded rows per user (`is_default = true`) that
are intentionally visible in every organisation — see
`20260603160000_asset_lists_organization_id.sql`. The policy above would hide
them. Either exempt them explicitly:

```sql
and (is_default = true or organization_id = current_org_id())
```

or give each organisation its own copy. The second is cleaner but is a data
change, not a policy change.
