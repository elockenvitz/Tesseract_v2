/**
 * The reviewed tenant-boundary exceptions.
 *
 * ── Why this replaced two numbers ─────────────────────────────────────────
 *
 * The gate used to hold `BASELINE_TOTAL = 38` and `BASELINE_P0 = 17` and
 * compare counts. Four things were wrong with that, all measured on
 * 2026-11-06:
 *
 *   1. It could not say WHICH findings were accepted. When the output read
 *      "+12 P0", nobody could tell which twelve, so the only way to answer
 *      "are we exposed?" was to adjudicate all 29 by hand.
 *   2. The numbers were set on 2026-02-23 and never updated. By 2026-11-06
 *      they were 1,568 commits stale, and 16 new violations had arrived
 *      across eleven commits without the gate naming one of them.
 *   3. A count cancels. Fix one query, add a worse one, and the gate stays
 *      green.
 *   4. The counts were wrong anyway. The scanner they came from saw 53
 *      findings; parsing the same tree finds 196. The 38 was never the number
 *      of unfiltered reads in this codebase.
 *
 * ── How a review is recorded, and why it is per table ────────────────────
 *
 * Row-level security is defined per table, so that is where the reasoning
 * belongs. `TABLE_POLICY` holds one entry per organization-owned table the
 * frontend reads without a filter: the SELECT policy, quoted from
 * `pg_policies`, and `evidence`, which says how far the checking actually
 * went. A per-site paragraph would be 137 restatements of the same policy,
 * and 137 paragraphs nobody reads is a worse record than 19 somebody does.
 *
 * `SITES` is the ratchet: one entry per `<file>::<table>::<kind>`, holding
 * how many findings of that kind that file is allowed. A new site fails. A
 * site that grows fails. A site that shrinks fails until the number comes
 * down, so ground gained is held the way the type-error ceiling holds it.
 *
 * An entry in either is NOT a claim that the query is fine. It is a claim
 * that somebody read the policy behind it and wrote down what they found.
 *
 * ── Evidence levels, and what they are worth ─────────────────────────────
 *
 *   probed    The policy was read AND exercised under RLS as two real
 *             non-platform-admin users in two different organizations, as a
 *             caller with no membership anywhere, and as anon. Counts only,
 *             no row content:
 *
 *               caller                    workflows themes projects events
 *               user A (org 4b4713e8)       61/153  15/51     --     0/8
 *               user B (org 7b76f7f7)        3/153  11/51     0/3    0/8
 *               no active membership            0      0       0       0
 *               anon                            0      0       0       0
 *
 *             The denominator is every row in the table. User A seeing 61 of
 *             their own organization's 144 workflows is the second half of the
 *             workflows policy being NARROWER than the organization, not a
 *             leak.
 *
 *   policy    The policy was read from pg_policies on 2026-11-06 and carries
 *             a conjunctive organization term (or something narrower). NOT
 *             exercised under RLS. This is weaker evidence and is marked as
 *             such on purpose: it is the open half of this work.
 */

/**
 * The organization term almost all of these rest on.
 *
 * Quoted once because nineteen entries depend on it and a copy per entry
 * would rot independently.
 */
const CURRENT_ORG =
  'organization_id = current_org_id(). current_org_id() returns ' +
  'users.current_organization_id only when an organization_memberships row ' +
  "exists for auth.uid() in that org with status='active' and " +
  '(expires_at IS NULL OR expires_at > now()), so it is NULL for a ' +
  'non-member, for an expired member and for anon, and "= NULL" is never ' +
  'true. The client cannot forge it: authenticated holds no UPDATE grant on ' +
  'users, and the only write path, set_current_org(), verifies membership ' +
  'first.'

const OWN_ROWS_ONLY =
  'has no organization term at all. Its SELECT policy is keyed on the caller ' +
  '(auth.uid()), which is strictly NARROWER than an organization, so a ' +
  'missing organization filter cannot widen it. The table is listed as ' +
  'org-scoped because it carries the column, not because the policy uses it.'

/**
 * One entry per table, keyed by table name.
 *
 * `rls` is quoted policy. `evidence` is 'probed' or 'policy' — see the header.
 */
export const TABLE_POLICY = {
  workflows: {
    evidence: 'probed',
    rls:
      `SELECT: (${CURRENT_ORG}) AND (is_public = true OR created_by = ` +
      'auth.uid() OR user_has_workflow_access(id, auth.uid()) OR ' +
      '(parent_workflow_id IS NOT NULL AND ' +
      'user_has_workflow_access(parent_workflow_id, auth.uid()))). The ' +
      'organization term is conjunctive and outermost, so the collaborator ' +
      'and stakeholder branches inside user_has_workflow_access() — which ' +
      'carry no organization term of their own — cannot reach another ' +
      "organization's rows. That conjunction is load-bearing: moving it " +
      'inside the disjunction would open a real cross-org path.',
  },
  projects: {
    evidence: 'probed',
    rls:
      `SELECT: (${CURRENT_ORG}) AND (auth.uid() = created_by OR EXISTS ` +
      '(SELECT 1 FROM project_assignments pa WHERE pa.project_id = ' +
      'projects.id AND pa.assigned_to = auth.uid())). Narrower than the ' +
      'organization, so the assigned-to-me filters several of these sites ' +
      'apply client-side are a performance hint, not the boundary.',
  },
  themes: { evidence: 'probed', rls: `SELECT: ${CURRENT_ORG}` },
  calendar_events: { evidence: 'probed', rls: `SELECT: ${CURRENT_ORG}` },
  conversations: { evidence: 'probed', rls: `SELECT: ${CURRENT_ORG}` },

  captures: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  topics: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  custom_notebooks: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  teams: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  org_chart_nodes: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  allocation_periods: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },
  target_date_funds: { evidence: 'policy', rls: `SELECT: ${CURRENT_ORG}` },

  research_fields: {
    evidence: 'policy',
    rls:
      `SELECT: (is_archived = false) AND (${CURRENT_ORG}) AND ` +
      'is_active_member_of_current_org(), which re-checks the membership a ' +
      'second time.',
  },
  research_sections: {
    evidence: 'policy',
    rls: `SELECT: (${CURRENT_ORG}) AND is_active_member_of_current_org()`,
  },
  organization_contacts: {
    evidence: 'policy',
    rls: `SELECT: (${CURRENT_ORG}) AND is_active_member_of_current_org()`,
  },
  rating_scales: {
    evidence: 'policy',
    rls:
      'SELECT: (is_system = true) OR (organization_id IS NULL) OR ' +
      `((${CURRENT_ORG}) AND is_active_member_of_current_org()). The first ` +
      'two branches are global reference data with no owner, which is the ' +
      'documented Standing Rule 5 exception; the third is the org term.',
  },
  text_templates: {
    evidence: 'policy',
    rls:
      `SELECT: (${CURRENT_ORG}) AND (is_shared = true), plus an ALL policy ` +
      'for the author: (org term) AND user_id = auth.uid().',
  },
  investment_case_templates: {
    evidence: 'policy',
    rls:
      `SELECT: (is_shared = true) AND (${CURRENT_ORG}) AND ` +
      'is_active_member_of_current_org(), plus an ALL policy for the owner ' +
      '(auth.uid() = user_id).',
  },
  model_templates: {
    evidence: 'policy',
    rls:
      `SELECT: (is_firm_template = true) AND (${CURRENT_ORG}), plus an ALL ` +
      'policy for the author (created_by = auth.uid()).',
  },
  access_requests: {
    evidence: 'policy',
    rls:
      'SELECT: (requester_id = auth.uid()) OR ' +
      `((${CURRENT_ORG}) AND is_active_org_admin_of_current_org()). A ` +
      'non-admin sees only their own request.',
  },
  organization_memberships: {
    evidence: 'policy',
    rls:
      'SELECT, three policies: (user_id = auth.uid()) for own rows; ' +
      `((${CURRENT_ORG}) AND status = 'active') for the roster; and ` +
      'is_platform_admin() for the ops console. The roster branch is the one ' +
      'these sites rely on.',
  },

  // Tables listed as org-scoped that the policy does not actually scope by org.
  project_collections: {
    evidence: 'policy',
    rls: `SELECT: auth.uid() = created_by. project_collections ${OWN_ROWS_ONLY}`,
  },
  project_tags: {
    evidence: 'policy',
    rls: `SELECT: auth.uid() = created_by. project_tags ${OWN_ROWS_ONLY}`,
  },
  template_tags: {
    evidence: 'policy',
    rls: `SELECT: user_id = auth.uid(). template_tags ${OWN_ROWS_ONLY}`,
  },
}

/**
 * Per-site counts. Generated with `--emit`, kept by hand.
 *
 * The kinds mean:
 *   unscoped      nothing in the chain could bound tenancy
 *   pk-filtered   eq or in on a primary key, and nothing about the org
 *   fk-filtered   eq or in on a foreign key, and nothing about the org
 *   embed         an org-owned table pulled in through a PostgREST select
 *
 * pk-filtered and fk-filtered are findings, not passes. Knowing a uuid is not
 * an authorization, and the scanner this replaced treated it as one.
 */
export const SITES = {
  // ── access_requests
  'src/components/organization/OrgRequestsTab.tsx::access_requests::unscoped': 1,
  'src/pages/OrganizationPage.tsx::access_requests::fk-filtered': 1,
  'src/pages/OrganizationPage.tsx::access_requests::unscoped': 1,
  // ── allocation_periods
  'src/pages/AssetAllocationPage.tsx::allocation_periods::unscoped': 1,
  // ── calendar_events
  'src/hooks/useAssetEvents.ts::calendar_events::fk-filtered': 1,
  'src/hooks/useEntitySearch.ts::calendar_events::unscoped': 1,
  'src/hooks/useObjectLinks.ts::calendar_events::pk-filtered': 1,
  // ── captures
  'src/hooks/useCapture.ts::captures::pk-filtered': 1,
  'src/hooks/useCapture.ts::captures::unscoped': 3,
  'src/lib/storage/note-attachments.ts::captures::unscoped': 1,
  // ── conversations
  'src/components/ui/AssignmentSelector.tsx::conversations::embed': 1,
  'src/lib/messaging/conversation-queries.ts::conversations::pk-filtered': 1,
  // ── custom_notebooks
  'src/hooks/feed/useInfiniteFeed.ts::custom_notebooks::embed': 1,
  'src/hooks/ideas/useContentAggregation.ts::custom_notebooks::embed': 1,
  'src/hooks/useEntitySearch.ts::custom_notebooks::embed': 1,
  'src/pages/NotesListPage.tsx::custom_notebooks::embed': 1,
  // ── investment_case_templates
  'src/hooks/useInvestmentCaseTemplates.ts::investment_case_templates::fk-filtered': 1,
  // ── model_templates
  'src/hooks/useModelTemplates.ts::model_templates::embed': 2,
  'src/hooks/useModelTemplates.ts::model_templates::fk-filtered': 2,
  'src/hooks/useModelTemplates.ts::model_templates::pk-filtered': 1,
  // ── org_chart_nodes
  'src/components/contributions/ContributionSection.tsx::org_chart_nodes::embed': 1,
  'src/components/coverage/CoverageManager.tsx::org_chart_nodes::embed': 3,
  'src/components/coverage/CoverageManager.tsx::org_chart_nodes::pk-filtered': 2,
  'src/components/mobile/MobileCoverage.tsx::org_chart_nodes::embed': 1,
  'src/components/projects/CreateTeamModal.tsx::org_chart_nodes::embed': 1,
  'src/components/tabs/ProjectDetailTab.tsx::org_chart_nodes::embed': 1,
  'src/components/templates/ExcelModelTemplateManager.tsx::org_chart_nodes::embed': 1,
  'src/hooks/useContributions.ts::org_chart_nodes::embed': 2,
  'src/hooks/useLayoutCollaborations.ts::org_chart_nodes::embed': 1,
  /*
   * These two are the SAME audience read that used to sit inline in
   * AssetTab.tsx, which is why that entry is gone from above. It moved into
   * `useOrgAudienceContext.ts` so the node rows are typed once instead of
   * re-inferred at every use, and `useThemeResearch.ts` is the theme
   * subject's counterpart of it. The query did not change, only its home, so
   * the review that covered the AssetTab site covers these.
   */
  'src/hooks/useOrgAudienceContext.ts::org_chart_nodes::embed': 1,
  'src/hooks/useThemeResearch.ts::org_chart_nodes::embed': 1,
  'src/hooks/useModelTemplateCollaborations.ts::org_chart_nodes::embed': 1,
  'src/pages/OrganizationPage.tsx::org_chart_nodes::pk-filtered': 2,
  'src/pages/PortfoliosListPage.tsx::org_chart_nodes::embed': 1,
  // ── organization_contacts
  'src/pages/OrganizationPage.tsx::organization_contacts::unscoped': 1,
  // ── organization_memberships
  'src/components/templates/ResearchFieldsManager.tsx::organization_memberships::fk-filtered': 2,
  'src/components/thoughts/PromptModal.tsx::organization_memberships::fk-filtered': 1,
  'src/contexts/OrganizationContext.tsx::organization_memberships::fk-filtered': 1,
  'src/hooks/useInvestmentCaseTemplates.ts::organization_memberships::fk-filtered': 3,
  'src/hooks/useLayoutCollaborations.ts::organization_memberships::fk-filtered': 2,
  'src/hooks/useModelTemplates.ts::organization_memberships::fk-filtered': 1,
  'src/pages/ops/OpsClientsPage.tsx::organization_memberships::unscoped': 1,
  'src/pages/ops/OpsDashboardPage.tsx::organization_memberships::unscoped': 1,
  // ── project_collections
  'src/components/projects/ProjectCollectionsSidebar.tsx::project_collections::fk-filtered': 1,
  'src/components/projects/SavedFiltersPanel.tsx::project_collections::fk-filtered': 1,
  'src/pages/ProjectsPage.tsx::project_collections::fk-filtered': 1,
  // ── project_tags
  'src/components/projects/ProjectCollectionsSidebar.tsx::project_tags::fk-filtered': 1,
  'src/pages/ProjectsPage.tsx::project_tags::embed': 1,
  'src/pages/ProjectsPage.tsx::project_tags::fk-filtered': 1,
  // ── projects
  'src/components/portfolio/tabs/OverviewTab.tsx::projects::embed': 1,
  'src/components/projects/ProjectOverviewWidget.tsx::projects::fk-filtered': 1,
  'src/components/projects/ProjectStatusBreakdown.tsx::projects::fk-filtered': 1,
  'src/components/projects/RecentProjectActivity.tsx::projects::embed': 2,
  'src/components/projects/RecentProjectActivity.tsx::projects::fk-filtered': 1,
  'src/components/projects/RelatedProjects.tsx::projects::embed': 1,
  'src/components/projects/UpcomingDeadlines.tsx::projects::fk-filtered': 1,
  'src/components/tabs/ProjectDetailTab.tsx::projects::pk-filtered': 1,
  'src/engine/decisionEngine/useDecisionEngine.ts::projects::pk-filtered': 1,
  'src/hooks/useAttention.ts::projects::embed': 7,
  'src/hooks/useCapture.ts::projects::pk-filtered': 1,
  'src/hooks/useCommandCenter.ts::projects::embed': 3,
  'src/hooks/useCommandCenter.ts::projects::unscoped': 1,
  'src/hooks/useEntitySearch.ts::projects::unscoped': 1,
  'src/hooks/useGlobalDecisionEngine.ts::projects::pk-filtered': 1,
  'src/hooks/useObjectLinks.ts::projects::pk-filtered': 1,
  'src/pages/CalendarPage.tsx::projects::unscoped': 1,
  'src/pages/DashboardPage.tsx::projects::pk-filtered': 1,
  'src/pages/ProjectsPage.tsx::projects::unscoped': 1,
  // ── rating_scales
  'src/hooks/useAnalystRatings.ts::rating_scales::embed': 1,
  'src/hooks/useAnalystRatings.ts::rating_scales::unscoped': 1,
  'src/hooks/useScorecards.ts::rating_scales::pk-filtered': 1,
  // ── research_fields
  'src/components/templates/ResearchFieldsManager.tsx::research_fields::unscoped': 1,
  'src/hooks/useResearchFields.ts::research_fields::embed': 4,
  'src/hooks/useResearchFields.ts::research_fields::unscoped': 2,
  // ── research_sections
  'src/hooks/useResearchFields.ts::research_sections::embed': 4,
  'src/hooks/useResearchFields.ts::research_sections::unscoped': 2,
  // ── target_date_funds
  'src/pages/TDFListPage.tsx::target_date_funds::unscoped': 1,
  // ── teams
  'src/components/coverage/CoverageManager.tsx::teams::unscoped': 1,
  'src/hooks/lists/useListSurfaces.ts::teams::embed': 1,
  'src/hooks/useLayoutCollaborations.ts::teams::embed': 2,
  'src/hooks/useModelTemplateCollaborations.ts::teams::embed': 1,
  'src/hooks/useOrganizationData.ts::teams::unscoped': 1,
  'src/hooks/useResearchFields.ts::teams::embed': 2,
  'src/hooks/useTemplateCollaborations.ts::teams::embed': 1,
  'src/hooks/useTemplateCollaborations.ts::teams::fk-filtered': 1,
  'src/pages/ops/OpsAIUsagePage.tsx::teams::pk-filtered': 1,
  'src/pages/OrganizationPage.tsx::teams::pk-filtered': 1,
  'src/pages/OrganizationPage.tsx::teams::unscoped': 1,
  // ── template_tags
  'src/hooks/useTemplates.ts::template_tags::embed': 1,
  'src/hooks/useTemplateTags.ts::template_tags::fk-filtered': 2,
  // ── text_templates
  'src/hooks/useTemplates.ts::text_templates::fk-filtered': 2,
  'src/hooks/useTemplates.ts::text_templates::pk-filtered': 1,
  // ── themes
  'src/components/communication/AITagPicker.tsx::themes::unscoped': 1,
  'src/components/communication/MessagingSection.tsx::themes::pk-filtered': 1,
  'src/components/lists/AddToThemeButton.tsx::themes::fk-filtered': 1,
  'src/components/mobile/CaptureFilePicker.tsx::themes::unscoped': 1,
  'src/components/notes/InlineReferencePopup.tsx::themes::pk-filtered': 1,
  'src/components/notes/UniversalNoteEditor.tsx::themes::embed': 1,
  'src/components/tabs/AssetTab.tsx::themes::embed': 1,
  'src/hooks/feed/useInfiniteFeed.ts::themes::embed': 1,
  'src/hooks/ideas/useContentAggregation.ts::themes::embed': 1,
  'src/hooks/useAI.ts::themes::pk-filtered': 1,
  'src/hooks/useAssetHeaderContext.ts::themes::embed': 1,
  'src/hooks/useCapture.ts::themes::pk-filtered': 1,
  'src/hooks/useEntitySearch.ts::themes::embed': 1,
  'src/hooks/useExploreSearch.ts::themes::unscoped': 1,
  'src/pages/NotesListPage.tsx::themes::embed': 1,
  'src/pages/ThemesListPage.tsx::themes::unscoped': 2,
  'src/pages/WorkflowsPage.tsx::themes::unscoped': 1,
  // ── workflows
  'src/components/asset/work/PriorWorkPanel.tsx::workflows::pk-filtered': 2,
  'src/components/asset/work/ProcessHistory.tsx::workflows::pk-filtered': 2,
  'src/components/asset/work/useProcessReport.ts::workflows::pk-filtered': 1,
  'src/components/portfolio/tabs/ProcessesTab.tsx::workflows::embed': 1,
  'src/components/portfolio/tabs/ProcessWalkthrough.tsx::workflows::fk-filtered': 1,
  'src/components/portfolio/tabs/ProcessWalkthrough.tsx::workflows::pk-filtered': 2,
  'src/components/tabs/AssetTab.tsx::workflows::embed': 2,
  'src/components/tabs/AssetTab.tsx::workflows::fk-filtered': 1,
  'src/components/tabs/AssetTab.tsx::workflows::pk-filtered': 5,
  'src/components/tabs/AssetTab.tsx::workflows::unscoped': 1,
  'src/components/ui/InvestmentTimeline.tsx::workflows::pk-filtered': 2,
  'src/components/ui/SmartStageManager.tsx::workflows::pk-filtered': 1,
  'src/components/ui/SmartStageManager.tsx::workflows::unscoped': 1,
  'src/components/workflow/modals/AccessRequestModal.tsx::workflows::pk-filtered': 1,
  'src/components/workflow/views/RunDetailPanel.tsx::workflows::pk-filtered': 1,
  'src/hooks/useAssetProcessSummary.ts::workflows::pk-filtered': 1,
  'src/hooks/useCapture.ts::workflows::pk-filtered': 1,
  'src/hooks/useCommandCenter.ts::workflows::embed': 4,
  'src/hooks/useThemeWorkflows.ts::workflows::fk-filtered': 1,
  'src/hooks/useThemeWorkflows.ts::workflows::pk-filtered': 2,
  'src/hooks/workflow/useActiveRuns.ts::workflows::unscoped': 1,
  'src/hooks/workflow/useWorkflowQueries.ts::workflows::fk-filtered': 4,
  'src/pages/WorkflowsPage_backup.tsx::workflows::pk-filtered': 2,
  'src/pages/WorkflowsPage.tsx::workflows::fk-filtered': 4,
  'src/pages/WorkflowsPage.tsx::workflows::pk-filtered': 5,
}

/**
 * RPC names the frontend calls.
 *
 * This is an INVENTORY, not a set of reviews, and the distinction is the
 * point: the scanner cannot see whether a function is SECURITY DEFINER or
 * what it checks, so nothing here is a claim that a function is safe. What it
 * buys is that a NEW name fails the gate and gets looked at instead of
 * arriving silently as the 102nd.
 *
 * Read from the live database so far, with what each one enforces:
 *
 *   set_current_org             DEFINER; requires an active membership of the
 *                               target org before writing. Does not check
 *                               expires_at, which current_org_id() then does,
 *                               so the mismatch is fail-closed.
 *   is_platform_admin           DEFINER; EXISTS over platform_admins.
 *   is_active_org_admin_of_current_org
 *                               DEFINER; membership + is_org_admin, within
 *                               current_org_id().
 *   start_morph_session         DEFINER; platform admin only, writes an
 *                               audit_events row.
 *   morph_switch_org            DEFINER; platform admin + an active morph
 *                               session + the TARGET's own membership.
 *   morph_restore_org           DEFINER; platform admin + the caller's own
 *                               active membership.
 *   end_morph_session           DEFINER; platform admin only, audited.
 *   has_unread_direct_messages  INVOKER; the caller's own RLS applies.
 *                               Added 2026-11-06, not yet applied to prod.
 *
 * The rest are inventory as of 2026-11-06 and have NOT been read. That is
 * the open half of this work, and naming it here is better than implying a
 * review that did not happen.
 */
export const REVIEWED_RPCS = new Set([
  /*
   * Read from the live database on 2026-11-09, when merging main into
   * discovery/asset-page-2 brought these call sites together.
   *
   * `run_due_workflow_rules()` and `run_workflow_rule(p_rule_id uuid)` are
   * both SECURITY DEFINER with `search_path=public, pg_temp`, EXECUTE to
   * authenticated, and both authorize before doing anything:
   *   run_due_workflow_rules  v_actor := auth.uid()      -> 28000 if null
   *                           v_org   := current_org_id() -> 42501 if null
   *   run_workflow_rule       v_actor := auth.uid()      -> 28000 if null
   *                           rule lookup joins
   *                           w.organization_id = current_org_id()
   *                                                      -> P0002 if absent,
   *                           so another org's rule id reads as "not found"
   *                           rather than running.
   */
  'run_due_workflow_rules',
  'run_workflow_rule',

  /*
   * `set_theme_contribution_audience` IS NOT IN PRODUCTION. Checked on
   * 2026-11-09: no function of that name exists in `public`.
   *
   * That is deliberate, not an oversight — its two migrations are held back
   * until the frontend that writes the new visibility vocabulary has
   * deployed, because applying them first makes production inserts fail
   * 23514. It is listed here so the gate does not block the merge on a name
   * it cannot read, and it must be RE-READ against the live database once
   * those migrations are applied. Until then the theme audience picker calls
   * an RPC that will return "function does not exist".
   */
  'set_theme_contribution_audience',

  /*
   * Organization provider API key custody. Read from the live database on
   * 2026-11-10, immediately after migration 20261110020000 applied, and
   * covered by role-context assertions rather than by this note alone:
   * supabase/tests/ai-byok-key-vault.sql, 17/17.
   *
   * Both are SECURITY DEFINER, `search_path=public`, EXECUTE revoked from
   * public and anon and granted to authenticated, and both authorize before
   * touching anything:
   *   set_org_ai_api_key    v_org := current_org_id()
   *                           -> raises 'No active organization' if null
   *                         is_active_org_admin_of_current_org()
   *                           -> raises unless the caller is an admin of
   *                              that org, so a plain member cannot store
   *                              (assertion 3) and anon cannot either
   *                              (assertion 9)
   *   clear_org_ai_api_key  the same two checks, in the same order
   *                           (assertions 16 and 17)
   *
   * Neither takes an organization id. The org is derived server-side from
   * current_org_id(), which reads users.current_organization_id and re-checks
   * an active unexpired membership, so a caller cannot name another firm's
   * org: assertions 13 and 14 pin that org B's admin writes org B only and
   * leaves org A's key untouched.
   *
   * Neither RETURNS anything. That is the point of the pair. The only
   * function that can read a key back is resolve_org_ai_config(uuid), which
   * is granted to service_role alone and is deliberately NOT in this
   * inventory, because no frontend may call it. Assertions 6, 7 and 8 pin
   * that a member, an org admin and anon all get 42501 from it.
   */
  'set_org_ai_api_key',
  'clear_org_ai_api_key',

  // Read from the live database on 2026-11-06 — see the note above.
  'current_org_id',
  'end_morph_session',
  'has_unread_direct_messages',
  'is_active_org_admin_of_current_org',
  'is_platform_admin',
  'morph_restore_org',
  'morph_switch_org',
  'set_current_org',
  'start_morph_session',

  // Inventory as of 2026-11-06. NOT read. Recorded so that the 102nd name
  // has to be looked at, not so that these 92 can be called reviewed.
  'accept_org_invite',
  'acknowledge_attention',
  'activate_template_version',
  'activate_workflow_version',
  'add_field_from_preset',
  'apply_trade_to_holdings',
  'approve_access_request',
  'approve_org_join_request',
  'approve_workflow_access_request',
  'can_invite_members',
  'can_modify_trade_stage',
  'cancel_export_job',
  'check_and_expire_user_targets',
  'copy_workflow_with_unique_name',
  'create_domain_verification',
  'create_group_conversation',
  'create_initial_template_version',
  'create_new_template_version',
  'create_org_invite',
  'create_trade_sheet',
  'create_workflow_branch',
  'create_workflow_version',
  'deactivate_org_member',
  'decision_reflections_payload',
  'decision_story_payload',
  'delete_identity_provider',
  'delete_organization',
  'delete_pilot_scenario',
  'discard_portfolio',
  'dismiss_attention',
  'dismiss_attention_with_reason',
  'ensure_default_scenarios',
  'ensure_pilot_decision_request_for_user',
  'ensure_pilot_scenario_for_user',
  'evaluate_pending_rules',
  'execute_single_automation_rule',
  'get_asset_field_history',
  'get_estimate_consensus',
  'get_export_download_url',
  'get_identity_provider_for_email',
  'get_invite_preview',
  'get_latest_list_activities',
  'get_list_activity_counts',
  'get_or_create_direct_conversation',
  'get_or_create_private_view',
  'get_or_create_trade_lab',
  'get_org_ai_config_summary',
  'get_org_invite_link',
  'get_rating_consensus',
  'get_user_expired_targets',
  'import_workflow_template',
  'increment',
  'is_portfolio_pm',
  'jsonb_set',
  'log_org_activity_event',
  'log_org_activity_events_batch',
  'mark_all_notifications_read',
  'mark_attention_read',
  'mark_conversation_read',
  'mark_messages_read',
  'mark_notification_read',
  'ops_quick_thought_activity',
  'outcomes_payload',
  'position_chart_payload',
  'provision_client_org',
  'reactivate_org_member',
  'recompute_workflow_rule_schedules',
  'record_audit_event',
  'record_investment_case_template_usage',
  'record_template_usage',
  'request_org_export',
  'resolve_entity_org',
  'restore_portfolio',
  'revoke_org_invite',
  'route_org_for_email',
  'save_asset_layout_customization',
  'seed_pilot_pipeline_demo_ideas',
  'seed_pilot_template_portfolio',
  'session_heartbeat',
  'set_contribution_audience',
  'set_message_pinned',
  'set_org_governance',
  'snooze_attention',
  'stage_pilot_scenario',
  'toggle_template_favorite',
  'undismiss_attention',
  'unsnooze_attention',
  'update_analyst_performance',
  'update_list_brief',
  'update_workflow_universe',
  'upsert_identity_provider',
  'verify_domain',
])

/**
 * Problems with the registry itself.
 *
 * A registry that cannot contradict itself is decoration, so these are the
 * ways an entry can be wrong: a table claimed both ways, a site whose table
 * has no recorded policy, a policy with no text, an evidence level that is
 * not one of the two, or a count that is not a positive integer.
 */
export function registryProblems({ orgScoped, notOrgScoped }) {
  const problems = []

  for (const [table, reason] of Object.entries(notOrgScoped)) {
    if (typeof reason !== 'string' || reason.trim().length < 40) {
      problems.push(`${table}: claimed not-org-scoped with no stated reason`)
    }
    if (orgScoped.has(table)) {
      problems.push(
        `${table}: listed in BOTH ORG_SCOPED_TABLES and ` +
          'NOT_ORG_SCOPED_BY_DESIGN — one of them is stale',
      )
    }
  }

  for (const [table, entry] of Object.entries(TABLE_POLICY)) {
    if (typeof entry.rls !== 'string' || entry.rls.trim().length < 30) {
      problems.push(
        `${table}: accepted without quoting the policy that enforces the ` +
          'boundary — that is a waiver, not a review',
      )
    }
    if (entry.evidence !== 'probed' && entry.evidence !== 'policy') {
      problems.push(`${table}: evidence must be 'probed' or 'policy'`)
    }
  }

  for (const [key, count] of Object.entries(SITES)) {
    const parts = key.split('::')
    if (parts.length !== 3) {
      problems.push(`${key}: key must be <file>::<table>::<kind>`)
      continue
    }
    const [, table] = parts
    if (!Number.isInteger(count) || count < 1) {
      problems.push(`${key}: count must be a positive integer`)
    }
    if (!TABLE_POLICY[table]) {
      problems.push(
        `${key}: no entry in TABLE_POLICY for ${table}, so this site is ` +
          'accepted with no stated policy behind it',
      )
    }
  }

  return problems
}
