/**
 * Research evidence attached to ONE Investment Case section.
 *
 * ── Why this reuses `asset_contributions.attachments` ────────────────────
 *
 * The attachment list already lives on the contribution row, and that row is
 * already one per `(created_by, asset_id, section)` — `unique_user_asset_section`.
 * So "this note supports THIS section of MY case" is expressible today with no
 * new table and no migration, and it inherits the section's own guarantees:
 *
 *   - ownership: `asset_contributions` write policies are author-only, so a
 *     reader cannot attach to or strip evidence from somebody else's section.
 *   - visibility: evidence travels with the contribution it hangs on, so an
 *     organization view shows exactly the references on the contributions that
 *     reader is already permitted to see. No second visibility rule exists to
 *     disagree with the first.
 *   - tenancy: the row carries `organization_id`, trigger-assigned.
 *
 * The generic `object_links` table is the better long-term home — it has
 * `link_type` ('supports'/'opposes'), a reverse lookup, and referential
 * meaning — but its endpoints are a Postgres ENUM with no `asset_contribution`
 * member, and its org resolver would raise on one. Both are migrations, and
 * adding an enum value is irreversible. This slice therefore stays on
 * attachments; see the report for the trade-off.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────
 *
 * It does not create evidence, and it does not judge it. Attaching a note says
 * "I considered this while writing this section" — never that the section is
 * correct. Nothing here infers a relationship from a ticker or a text match.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  fetchSectionReferences, saveSectionReferences, type ThesisReference,
} from '../lib/research/asset-research'

export type SectionEvidence = ThesisReference

export function sectionEvidenceKey(assetId: string, section: string, userId?: string, orgId?: string | null) {
  return ['section-evidence', assetId, section, userId ?? null, orgId ?? null] as const
}

export function useSectionEvidence(assetId: string, section: string, enabled = true) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const key = sectionEvidenceKey(assetId, section, user?.id, currentOrgId)

  const { data: evidence = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchSectionReferences(assetId, section, user?.id, currentOrgId),
    enabled: enabled && !!assetId && !!section && !!user?.id && !!currentOrgId,
    staleTime: 30_000,
  })

  const write = useMutation({
    mutationFn: (next: SectionEvidence[]) =>
      saveSectionReferences(assetId, section, user?.id, currentOrgId, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key })
      // The section's own row carries the list, so the contribution caches that
      // render it must re-read too.
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    },
  })

  /**
   * Attach one item.
   *
   * Idempotent on `(type, id)`: attaching the same note twice is the same
   * single reference, not two rows that later disagree.
   */
  const attach = (item: SectionEvidence) => {
    const already = evidence.some(e => e.type === item.type && e.id === item.id && !!item.id)
    if (already) return Promise.resolve({ saved: true })
    return write.mutateAsync([...evidence, item])
  }

  const detach = (item: Pick<SectionEvidence, 'type' | 'id'>) =>
    write.mutateAsync(evidence.filter(e => !(e.type === item.type && e.id === item.id)))

  return {
    evidence,
    isLoading,
    attach,
    detach,
    isSaving: write.isPending,
    /** False when the section has not been written yet — attachments live ON
     *  the contribution row, so there is nothing to hang them from. */
    canAttach: !!user?.id && !!currentOrgId,
  }
}
