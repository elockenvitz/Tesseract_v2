/**
 * asset_notes: the SELECT policy permits reads across every organization.
 *
 * Live policy in production, read from pg_policies rather than reconstructed
 * from this repo's migration history, and named:
 *
 *   "Users can read own notes and shared notes from others"
 *
 *   (auth.uid() = created_by)
 *   OR (is_shared = true)
 *   OR EXISTS (SELECT 1 FROM note_collaborations
 *              WHERE note_id = asset_notes.id
 *                AND note_type = 'asset'
 *                AND user_id = auth.uid()
 *                AND permission = ANY (ARRAY['read','write','admin']))
 *
 * The `is_shared = true` branch has no organization predicate, so a note
 * flagged shared is readable by every authenticated user in all 27
 * organizations — not just the author's colleagues.
 *
 * This is the original of the shape found on asset_models, which was copied
 * from here and says so:
 *
 *   20251230000002_add_notes_models_section.sql:52
 *   -- RLS Policies for asset_models (same pattern as asset_notes)
 *
 * ── Exposure ──────────────────────────────────────────────────────────────
 *
 * Zero today, and unreachable rather than merely unused: `is_shared` is false
 * on all 57 rows, and no code path can set it true. Every write hardcodes
 * false (AddReferenceModal, KeyReferencesSection x2, DocumentLibrarySection
 * x3) and there is no sharing control in the notes UI. The only settable
 * is_shared belongs to investment_case_templates, whose policy is already
 * org-aware.
 *
 * So this is armed, not leaking. It becomes a live cross-tenant read the day
 * somebody builds the share toggle — at which point the defect is invisible,
 * because the feature will appear to work correctly.
 *
 * ── What changes ──────────────────────────────────────────────────────────
 *
 * The org predicate is added as an AND across the whole policy rather than
 * only to the is_shared branch. Author and collaborator access should be
 * org-bounded too: a collaboration invitation is not a reason to read another
 * organization's note, and `created_by` matching is not either — the same
 * person in two orgs should not carry notes between them.
 *
 * Legacy rows carry organization_id IS NULL (20260603140000 left them so, as
 * pre-migration rows had no reconstructable origin org). Those become
 * readable only by their author, which is the correct conservative outcome:
 * an unattributable note should not be shared with an org it may not belong
 * to.
 *
 * ── Reversibility ─────────────────────────────────────────────────────────
 *
 * The prior policy body is reproduced verbatim above. To restore, drop the
 * new policy and recreate with that expression. This is a strict tightening:
 * nothing readable after this was unreadable before.
 *
 * ── Blast radius ──────────────────────────────────────────────────────────
 *
 * 57 rows. 0 shared. Notes authored in an org remain readable to their author
 * and collaborators within that org. The only reads removed are cross-org
 * ones, none of which can currently occur.
 */

DROP POLICY IF EXISTS "Users can read own notes and shared notes from others" ON public.asset_notes;

CREATE POLICY "Org members can view notes in current org"
  ON public.asset_notes
  FOR SELECT
  TO authenticated
  USING (
    organization_id = current_org_id()
    AND (
      auth.uid() = created_by
      OR is_shared = true
      OR EXISTS (
        SELECT 1 FROM note_collaborations
        WHERE note_collaborations.note_id = asset_notes.id
          AND note_collaborations.note_type = 'asset'
          AND note_collaborations.user_id = auth.uid()
          AND note_collaborations.permission = ANY (ARRAY['read','write','admin'])
      )
    )
  );

-- Dead code today: 0 of 57 rows have a null organization_id. Kept as a guard
-- against a future null-org insert silently becoming unreadable to its author.
CREATE POLICY "Authors can view their own unattributed notes"
  ON public.asset_notes
  FOR SELECT
  TO authenticated
  USING (organization_id IS NULL AND auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- Verification. Asserts a NEGATIVE, because the failure mode of this migration
-- is persistence, not absence.
--
-- The first draft dropped two policy names that do not exist in production
-- ("Users can view own and shared notes", "Users can view accessible notes"),
-- reconstructed from this repo's migration history. Both DROPs would have
-- no-opped, both CREATEs would have succeeded, and the old permissive policy
-- would have remained — policies OR together, so the cross-org read stays
-- open while pg_policies shows two correctly-scoped new policies. A check for
-- "the new policy exists" passes on that. Only a check for "the old policy is
-- gone" catches it.
-- ---------------------------------------------------------------------------
--
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'asset_notes' AND cmd = 'SELECT';
--   -- exactly 2 rows, and NOT containing
--   -- 'Users can read own notes and shared notes from others'
--
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'asset_notes' AND cmd = 'SELECT'
--      AND qual NOT LIKE '%organization_id%';
--   -- zero rows
--
-- Applied to production 2026-08-16. Both assertions passed.
