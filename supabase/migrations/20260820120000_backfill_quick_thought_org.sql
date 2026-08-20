-- Give the quick thoughts that predate org scoping an organization.
--
-- ── What is broken ────────────────────────────────────────────────────────
--
-- The Ideas feed reads quick_thoughts with `.eq('organization_id', ...)`, so a
-- row with a null organization_id is invisible to every org including the one
-- that wrote it. In production 18 of 19 rows are null — 10 of them belonging to
-- a single active org — which means the feed's largest human-authored source
-- contributes nothing at all. That is a silent zero, not an error: the query
-- succeeds and simply returns less.
--
-- ── Why they are null ─────────────────────────────────────────────────────
--
-- `set_quick_thoughts_org_id_trigger` stamps the column from the caller's
-- `users.current_organization_id` on insert. It exists and it works. Only rows
-- written before it was added are affected, and nothing ever backfilled them.
--
-- ── Why the author's org is the right answer ──────────────────────────────
--
-- Because it is the same rule the trigger itself applies. This is not a new
-- inference about where a thought belongs; it is the existing rule, applied to
-- the rows that missed it. Anything cleverer — guessing from mentioned assets,
-- from co-authors — would be a second, different rule, and a wrong guess here
-- puts one org's research in front of another.
--
-- Rows whose author has no current organization are LEFT NULL on purpose.
-- There is no defensible answer for them, and inventing one would be the only
-- part of this migration that could leak.
--
-- Idempotent, and narrow: `organization_id IS NULL` means re-running touches
-- nothing, and no row that already has an org is reconsidered.

UPDATE public.quick_thoughts AS q
SET organization_id = u.current_organization_id
FROM public.users AS u
WHERE q.created_by = u.id
  AND q.organization_id IS NULL
  AND u.current_organization_id IS NOT NULL;
