/**
 * The reader's kept answers, and the switch that keeps the feature off until
 * its table exists.
 *
 * RLS posture — one new table, four policies, nothing widened:
 *   ai_artifacts  SELECT/INSERT/UPDATE/DELETE  TO authenticated
 *                 USING/WITH CHECK (user_id = auth.uid()
 *                                   AND is_member_of_org(organization_id))
 * No anon grant. Parentage -- that `conversation_id` names a thread the
 * artifact's own owner owns -- is a SECURITY DEFINER trigger rather than a
 * policy subquery, because a subquery in a policy runs under the caller's own
 * RLS and in this repository that has both hidden real holes and broken
 * legitimate writes.
 *
 * ── THE TABLE DOES NOT EXIST YET ──────────────────────────────────────────
 *
 * `supabase/migrations/20261113120000_ai_artifacts.sql` is authored and
 * UNAPPLIED, in every environment, verified against the live database. So
 * `available` is false everywhere today and every surface that offers this
 * must be hidden, not disabled-looking and not throwing.
 *
 * It is detected rather than declared. One probe -- `select id limit 1` --
 * and a missing-table error turns the feature off for the session; any other
 * error is a real failure and is reported as one, because "denied" and
 * "absent" are different findings and collapsing them would hide an RLS
 * fault behind a feature flag. Applying the migration switches this on with
 * no code change and no flag to remember.
 *
 * The organization is in the query key AND in the filter: in the key because
 * a cached list from the other firm must not show while the new one loads,
 * and in the filter because the key is a client convention while the
 * boundary is the server's.
 */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import {
  isMissingTable, clampTitle, artifactTitleError, artifactAssociation, artifactDraftError,
  type ArtifactDraft, type ArtifactRow,
} from '../../lib/ai/artifact-store'

const ARTIFACT_COLUMNS =
  'id, user_id, organization_id, conversation_id, message_id, title, '
  + 'subject_type, subject_id, folder_id, created_at, updated_at'

/* See `useAIFolders` on why a write payload is declared here and cast once:
   the hand-maintained database types collapse every table's insert generic
   to `never`, which is most of the repository's standing type errors. */
type ArtifactInsert = {
  user_id: string
  organization_id: string
  conversation_id: string
  message_id: string
  title: string
  /* The association. Both columns or neither -- the table's CHECK says so,
     and `artifactAssociation` is what produces the pair. */
  subject_type: string | null
  subject_id: string | null
  folder_id: string | null
}

export const aiArtifactsKey = (
  userId: string | null | undefined,
  orgId: string | null | undefined,
) => ['ai-artifacts', userId ?? null, orgId ?? null] as const

/**
 * What keeping an answer needs.
 *
 * `draft` rather than a loose title, because the association travels with it
 * and the two columns have to be produced together -- `artifactAssociation`
 * is the only thing that does that, and splitting them across call sites is
 * how one of them ends up written alone.
 */
export interface KeepArgs {
  conversationId: string
  messageId: string
  draft: ArtifactDraft
}

export interface UseAiArtifacts {
  /**
   * Whether this feature can be used at all.
   *
   * False while the probe is in flight, so nothing appears and then
   * disappears: a Keep option that flickers into a menu the reader is
   * already reading is worse than one that arrives a moment late.
   */
  available: boolean
  artifacts: ArtifactRow[]
  isLoading: boolean
  /** Null while the organization is unknown, which is not the same as none. */
  organizationId: string | null
  /** Resolves to the row, or null when it could not be written. */
  keep: (args: KeepArgs) => Promise<ArtifactRow | null>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** The last rejection, as a sentence for the reader. Null when clean. */
  lastError: string | null
}

export function useAiArtifacts(): UseAiArtifacts {
  const { user } = useAuth()
  /* Optional for the same reason as `useAIFolders`: this is mounted in panes
     that render outside an organization provider. */
  const org = useOrganizationOptional()
  const organizationId = org?.currentOrgId ?? null
  const queryClient = useQueryClient()

  const enabled = !!user?.id && !!organizationId

  const { data, isLoading, error } = useQuery({
    queryKey: aiArtifactsKey(user?.id, organizationId),
    enabled,
    /*
     * The list IS the probe. A separate capability query would be a second
     * round trip to learn what the first one already reports, and the two
     * could disagree.
     */
    queryFn: async (): Promise<{ rows: ArtifactRow[]; available: boolean }> => {
      const { data: rows, error: queryError } = await supabase
        .from('ai_artifacts')
        .select(ARTIFACT_COLUMNS)
        .eq('user_id', user!.id)
        .eq('organization_id', organizationId!)
        .order('created_at', { ascending: false })

      if (queryError) {
        /* Absent: the feature is off, and that is not an error to report. */
        if (isMissingTable(queryError)) return { rows: [], available: false }
        /* Anything else is real. Thrown so it reaches `lastError` rather
           than reading as an empty shelf. */
        throw queryError
      }

      return { rows: (rows ?? []) as ArtifactRow[], available: true }
    },
    /* The table's existence does not change during a session, and the list
       is invalidated explicitly by every write below. */
    staleTime: 5 * 60_000,
    retry: false,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: aiArtifactsKey(user?.id, organizationId) })
  }, [queryClient, user?.id, organizationId])

  const keepMutation = useMutation({
    mutationFn: async (args: KeepArgs): Promise<ArtifactRow | null> => {
      if (!user?.id || !organizationId) return null

      const draft = { ...args.draft, title: clampTitle(args.draft.title) }
      const invalid = artifactDraftError(draft)
      if (invalid) throw new Error(invalid)

      const payload: ArtifactInsert = {
        user_id: user.id,
        /* Stamped at write time, never derived from a mutable
           `current_org_id()` at read time. */
        organization_id: organizationId,
        conversation_id: args.conversationId,
        message_id: args.messageId,
        title: draft.title,
        /*
         * The association, produced as a set.
         *
         * Note what this does NOT do: it does not check that the subject or
         * the folder belongs to this reader's organization. That is not an
         * omission -- a client-side check would be advisory, and the
         * authority is the `ai_artifact_conversation_must_be_own` trigger,
         * which runs SECURITY DEFINER and raises 42501. The picker only
         * offers RLS-visible objects, so a legitimate reader never meets it.
         */
        ...artifactAssociation(draft),
      }

      const { data: row, error: writeError } = await supabase
        .from('ai_artifacts')
        /*
         * Upsert on the unique index, because keeping the same answer twice
         * is the same artifact renamed -- not a second row, and not a
         * duplicate-key error the reader has to interpret.
         */
        .upsert(payload as never, { onConflict: 'user_id,conversation_id,message_id' })
        .select(ARTIFACT_COLUMNS)
        .single()

      if (writeError) throw writeError
      return (row ?? null) as ArtifactRow | null
    },
    onSuccess: invalidate,
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const next = clampTitle(title)
      const invalid = artifactTitleError(next)
      if (invalid) throw new Error(invalid)
      const { error: writeError } = await supabase
        .from('ai_artifacts')
        .update({ title: next } as never)
        .eq('id', id)
      if (writeError) throw writeError
    },
    onSuccess: invalidate,
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: writeError } = await supabase.from('ai_artifacts').delete().eq('id', id)
      if (writeError) throw writeError
    },
    onSuccess: invalidate,
  })

  const keep = useCallback(
    (args: KeepArgs) => keepMutation.mutateAsync(args).catch(() => null),
    [keepMutation],
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      await renameMutation.mutateAsync({ id, title }).catch(() => undefined)
    },
    [renameMutation],
  )

  const remove = useCallback(
    async (id: string) => {
      await removeMutation.mutateAsync(id).catch(() => undefined)
    },
    [removeMutation],
  )

  const failure =
    error ?? keepMutation.error ?? renameMutation.error ?? removeMutation.error ?? null

  return {
    /* False until the probe says otherwise. See the interface note. */
    available: data?.available === true,
    artifacts: data?.rows ?? [],
    isLoading,
    organizationId,
    keep,
    rename,
    remove,
    lastError: failure ? (failure as { message?: string }).message ?? 'That did not save.' : null,
  }
}
