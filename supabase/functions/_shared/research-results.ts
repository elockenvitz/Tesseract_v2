/**
 * The result contract for ai-chat's research tools.
 *
 * ── Three outcomes, never two ────────────────────────────────────────────
 *
 * Every tool answer is exactly one of: it found records, it searched and
 * found none, or the search did not happen. Those are different facts and a
 * reader acting on research needs them kept apart.
 *
 * They used to collapse. Each query was written `const { data } = await ...`,
 * so a failure left `data` null, `data || []` turned that into `[]`, and the
 * model received the same `{"results":[]}` it gets for a genuine miss. It then
 * told the user there was no research -- a claim about the firm's own record
 * that the function had no basis for. `get_theme` queried a table that does
 * not exist (`asset_themes`; it is `theme_assets`) and reported "no
 * constituents" for every theme for as long as it existed, without one error
 * reaching anybody.
 *
 * So `runQuery` is the only way those tools touch the database, and it cannot
 * silently swallow a failure.
 *
 * ── What crosses the wire ────────────────────────────────────────────────
 *
 * A stage name and a fixed note. The driver's own message -- which carries
 * table names, column names, policy names and sometimes row values -- goes to
 * the logger and stays server-side. Nothing here ever returns it.
 *
 * This module is deliberately Deno-free so the unit suite can exercise it.
 */

export type ToolStatus = "ok" | "empty" | "error";

export type SourceKind =
  | "asset" | "note" | "contribution" | "price_target" | "portfolio" | "theme"
  // The decision chain. Four separate stages, four separate kinds, on purpose:
  // a recommendation is not a ruling, a ruling is not a committed trade, and a
  // committed trade is not an executed one.
  | "recommendation" | "decision_request" | "accepted_trade"
  | "decision_review" | "outcome"
  // Process.
  | "workflow" | "checklist_item"
  // An Idea Pipeline entry. Distinct from `recommendation`: the pipeline
  // measures how well understood an idea is and stops at ready-to-recommend.
  // Whether a recommendation was submitted is a `decision_requests` fact.
  | "idea";

/**
 * A record the model consulted, with enough provenance for the UI to open it.
 * `asset_id` is what makes a source a link: the asset page is where notes,
 * thesis sections and targets are read.
 */
export interface ToolSourceRef {
  kind: SourceKind;
  id: string;
  asset_id?: string | null;
  symbol?: string | null;
  title: string;
  timestamp?: string | null;
  /**
   * The RECORD's own lifecycle state, in the words the product uses: a
   * recommendation's "awaiting ruling", an idea's stage, a requirement's
   * "overdue". Never the lookup's outcome.
   *
   * The distinction is the reason this is not called `status`. `ToolStatus`
   * is whether the search ran; this is what the found row is doing. Merging
   * them is how "the lookup failed" starts rendering as "the trade was
   * rejected", and this codebase has made the reverse mistake already.
   */
  state?: string | null;
  /**
   * A short quotation from the record, so a reader can tell whether it is the
   * one they were thinking of without opening it.
   *
   * Trimmed server-side by `excerptOf`. Plain text only: a title plus a date
   * identifies a row, but it does not let anyone judge it.
   */
  excerpt?: string | null;
}

export interface ToolResultSummary {
  status: ToolStatus;
  /** What was searched, in words. For the "no matches" sentence. */
  searched?: string;
  result_count?: number;
  sources?: ToolSourceRef[];
  /**
   * How far this lookup could see, carried through to the UI.
   *
   * The declaration already reaches the MODEL inside the tool result, and the
   * system prompt tells it how to phrase an absence. The research trail is a
   * second, independent voice: it wrote "No matching records." for every
   * empty result regardless of reach, which is the same mistranslation stated
   * by the panel instead of the model. One scope, both voices.
   */
  scope?: VisibilityScope;
}

/**
 * A record's own words, cut to something a trail row can hold.
 *
 * Collapses whitespace first, because a note's body arrives with the editor's
 * newlines in it and a raw slice of that renders as a ragged block. Cuts on a
 * word boundary where one is near the limit, so the excerpt does not end
 * mid-word.
 */
export function excerptOf(
  text: unknown,
  limit = 180,
): string | null {
  if (typeof text !== "string") return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  /* Only honour a word boundary in the last fifth: a title with no spaces
     should still be cut at the limit rather than thrown away. */
  const body = lastSpace > limit * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[.,;:\s]+$/, "")}…`;
}

/** Section slugs to the words a person uses. */
export const SECTION_LABELS: Record<string, string> = {
  thesis:           "Thesis",
  business_model:   "Business model",
  where_different:  "Where differentiated",
  key_catalysts:    "Key catalysts",
  risks_to_thesis:  "Risks to thesis",
};

type Logger = (message: string, detail?: string) => void;

const defaultLog: Logger = (m, d) => console.error(m, d ?? "");

/**
 * Runs one query. Reports WHETHER it failed; never conflates failure with
 * emptiness, and never returns the driver's message to the caller.
 */
export async function runQuery<T>(
  tool: string,
  stage: string,
  query: PromiseLike<{ data: T | null; error: unknown }>,
  log: Logger = defaultLog,
): Promise<{ data: T | null; failed: boolean }> {
  try {
    const { data, error } = await query;
    if (error) {
      log(
        `ai-chat tool ${tool}/${stage} failed:`,
        (error as { message?: string })?.message ?? String(error),
      );
      return { data: null, failed: true };
    }
    return { data, failed: false };
  } catch (e) {
    log(`ai-chat tool ${tool}/${stage} threw:`, (e as Error)?.message ?? String(e));
    return { data: null, failed: true };
  }
}

/**
 * How much of the organization a tool's query path can actually see.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every tool runs on a caller-scoped client, so Row Level Security decides
 * what comes back. A row the caller may not read is not returned and not
 * counted: at the query level "there are none" and "there are none you may
 * see" are THE SAME OBSERVATION. Nothing in the result distinguishes them,
 * and the model was left to guess, which it did by asserting absence.
 *
 * That is not a hypothetical. `decision_requests` is readable only for
 * portfolios the caller is on the team of, and this product has two
 * portfolio-membership tables that disagree, so a PM added through one of them
 * reads ZERO pending recommendations while the desk holds several. "Nothing
 * needs your decision" is then a false statement about the firm, produced from
 * a correct query.
 *
 * The fix is NOT to look behind the policy. No definer RPC, no privileged
 * count, nothing that reveals the existence of records the caller may not
 * read. Instead each tool states what its path covers, and the model is
 * instructed to answer within that coverage.
 *
 * ── The three scopes ─────────────────────────────────────────────────────
 *
 * `organization`   The path genuinely spans the caller's active organization.
 *                  Only here may an empty result be reported as a fact about
 *                  the firm, and even then it is about the ACTIVE org, because
 *                  these policies compare against `current_org_id()`.
 *
 * `caller_visible` Org-wide except for records withheld by a sharing or
 *                  membership rule. Absence is never a fact about the firm.
 *
 * `caller`         Only what the caller owns or has been given. Says almost
 *                  nothing about the organization.
 */
export type VisibilityScope = "organization" | "caller_visible" | "caller";

export interface VisibilityDeclaration {
  scope: VisibilityScope;
  /** What this path can see, in words the model can repeat to a reader. */
  covers: string;
  /** What it cannot. Null only when the scope is `organization`. */
  excludes: string | null;
}

/**
 * Per-tool visibility, read off the live SELECT policies.
 *
 * Kept as a table rather than an argument at each call site so that it is one
 * reviewable place, and so no tool can forget to declare. `toolVisibility`
 * throws on an unknown name, and a test asserts every declared tool appears
 * here: a new retrieval tool must state its reach before it can ship.
 *
 * Verified against `pg_policies` on 2026-11-11. If a policy is widened or
 * narrowed, this table is wrong until someone updates it, which is why each
 * entry records the predicate it came from.
 */
export const TOOL_VISIBILITY: Readonly<Record<string, VisibilityDeclaration>> = {
  /* assets: readable org-wide. */
  get_asset: {
    scope: "caller_visible",
    covers: "the asset record, its thesis sections, price targets and notes that you may read",
    excludes: "notes and thesis contributions restricted to an audience you are not in",
  },
  search_assets: {
    scope: "caller_visible",
    covers: "assets in your organization",
    excludes: "assets in other organizations",
  },
  /* portfolio_holdings: gated by the portfolio's own permission predicate. */
  get_portfolio: {
    scope: "caller_visible",
    covers: "portfolios you have access to, and their holdings",
    excludes: "portfolios you are not a member of, whose holdings you cannot read at all",
  },
  get_theme: {
    scope: "caller_visible",
    covers: "themes in your organization",
    excludes: "themes restricted to an audience you are not in",
  },
  search_team_notes: {
    scope: "caller_visible",
    covers: "notes and research shared with you",
    excludes: "private notes belonging to colleagues, and notes restricted to another audience",
  },
  /*
   * decision_requests: portfolio_in_current_org(portfolio_id) AND
   * (requested_by = auth.uid() OR caller is in portfolio_team).
   * accepted_trades is gated by portfolio access as well. This is the tool
   * whose empty answer has already been wrong in production.
   */
  get_decisions: {
    scope: "caller_visible",
    covers:
      "recommendations, PM rulings, committed trades and reviews on portfolios you raised or are on the team of",
    excludes:
      "the entire decision record for every portfolio you are not on the team of, including committed trades that exist and are not visible to you",
  },
  /* asset_workflow_progress: the workflow's organization_id = current_org_id(). */
  get_workflows: {
    scope: "organization",
    covers: "research processes on this asset across your organization",
    excludes: null,
  },

  /* ── New in this change ───────────────────────────────────────────────── */

  /*
   * asset_lists: created_by = auth.uid() OR user_has_list_collaboration(id).
   * Your own lists and ones explicitly shared with you. The firm may hold any
   * number of others.
   */
  get_watchlists: {
    scope: "caller",
    covers: "lists you created and lists shared with you directly",
    excludes: "every other list in the organization, including the desk's own, unless it was shared with you",
  },
  /* coverage: organization_id = current_org_id(). Genuinely org-wide. */
  get_coverage: {
    scope: "organization",
    covers: "coverage assignments across your active organization",
    excludes: null,
  },
  /*
   * trade_queue_items: unassigned ideas you created or are assigned; portfolio
   * ideas in your org that are not someone else's private.
   */
  get_idea_pipeline: {
    scope: "caller_visible",
    covers: "ideas you created or are assigned, and your organization's non-private ideas",
    excludes: "ideas colleagues marked private",
  },
  get_pending_decisions: {
    scope: "caller_visible",
    covers: "recommendations awaiting a ruling on portfolios you raised or are on the team of",
    excludes: "recommendations on every portfolio you are not on the team of",
  },
  get_outstanding_work: {
    scope: "organization",
    covers: "research processes and their open requirements across your active organization",
    excludes: null,
  },
};

/**
 * The Idea Pipeline's four canonical stages, mirrored from
 * `src/lib/ideas/stage-model.ts`.
 *
 * A mirror because an Edge Function cannot import from `src`, and a mirror
 * guarded by a drift test (`src/lib/ai/__tests__/retrieval-visibility.test.ts`)
 * rather than by hope: the stage column holds fifteen enum values accumulated
 * across three vocabularies, and the whole point of the model module is that
 * there is ONE answer to which stage an idea is at. A second, quietly
 * disagreeing copy here would put the assistant's answer at odds with the
 * screen the reader is looking at.
 *
 * The pipeline ends at `ready_to_recommend` deliberately. `deciding` was a
 * stage once, and it broke the line between how mature an idea is and what a
 * PM has done about it: ideas executed months ago still read `deciding`,
 * because the column records where the process GOT TO and nothing moves it
 * back. So it maps forward here and is never reported as a decision.
 */
export const IDEA_STAGES = [
  "exploring",
  "researching",
  "developing",
  "ready_to_recommend",
] as const;

export type IdeaStage = (typeof IDEA_STAGES)[number];

/** Legacy stage values to canonical ones. Mirrors `LEGACY_STAGE_MAP`. */
export const LEGACY_IDEA_STAGES: Readonly<Record<string, IdeaStage>> = {
  // v2 five-stage vocabulary
  aware: "exploring",
  investigate: "researching",
  deep_research: "developing",
  thesis_forming: "developing",
  ready_for_decision: "ready_to_recommend",
  // v1 vocabulary, never migrated off
  idea: "exploring",
  discussing: "developing",
  working_on: "developing",
  modeling: "developing",
  simulating: "developing",
  // The stage that should never have been a stage.
  deciding: "ready_to_recommend",
};

/** The canonical stage for any stored value. Unknown values read as earliest. */
export function toIdeaStage(raw: string | null | undefined): IdeaStage {
  if (!raw) return "exploring";
  if ((IDEA_STAGES as readonly string[]).includes(raw)) return raw as IdeaStage;
  return LEGACY_IDEA_STAGES[raw] ?? "exploring";
}

/** The words a reader sees for a stage. */
export const IDEA_STAGE_LABEL: Readonly<Record<IdeaStage, string>> = {
  exploring: "Exploring",
  researching: "Researching",
  developing: "Developing",
  ready_to_recommend: "Ready to recommend",
};

/**
 * Statuses that mean an idea is no longer live work.
 *
 * Mirrored from `src/lib/trade-status-semantics`, which owns the rule and
 * records why `outcome` outranks `status` and why neither `stage` nor
 * `visibility_tier` may answer liveness. Guarded by the same drift test.
 */
export const TERMINAL_IDEA_STATUSES: readonly string[] = [
  "approved",
  "executed",
  "rejected",
  "cancelled",
  "archived",
  "deleted",
];

/**
 * Is there open work on this idea right now?
 *
 * `outcome` outranks `status`: any non-null outcome is terminal, whatever the
 * status says. `status` is consulted only in its absence, and `stage` is never
 * consulted at all -- the stage column records where the process got to and
 * nothing moves it back, so an executed idea can still read
 * `ready_for_decision`.
 */
export function isLiveIdeaRow(
  row: { outcome?: string | null; status?: string | null } | null | undefined,
): boolean {
  if (!row) return false;
  if (row.outcome) return false;
  const status = String(row.status ?? "");
  return !TERMINAL_IDEA_STATUSES.includes(status);
}

/**
 * Rulings that count as answered, mirrored from
 * `src/lib/decisions/outcome-eligibility.ts`.
 *
 * `withdrawn` is NOT here: a retracted request was never ruled on. It is
 * excluded from the open inbox separately, at the one call site that needs it,
 * so this list keeps meaning "a PM answered".
 */
export const DECIDED_DECISION_STATUSES: readonly string[] = [
  "accepted",
  "accepted_with_modification",
  "rejected",
  "deferred",
];

/** The declaration for a tool, or a loud failure. */
export function toolVisibility(tool: string): VisibilityDeclaration {
  const found = TOOL_VISIBILITY[tool];
  if (!found) {
    throw new Error(
      `No visibility declaration for tool "${tool}". Add one to TOOL_VISIBILITY: ` +
        "a retrieval tool that does not state its reach lets the model turn an " +
        "RLS-filtered empty result into a claim about the firm.",
    );
  }
  return found;
}

/**
 * The sentence the model is told to respect when a lookup comes back empty.
 *
 * Phrased as an instruction rather than a fact, because the model's failure
 * mode here is not misreading the data, it is filling a silence.
 */
export function absenceRule(v: VisibilityDeclaration): string {
  if (v.scope === "organization") {
    return `This path covers ${v.covers}, so an empty result means there are none in your active organization. It says nothing about other organizations.`;
  }
  return `This path covers only ${v.covers}. It does NOT cover ${v.excludes}. An empty result means none are visible to you. Do not say none exist, and do not say the firm has none: say none are visible to you, and name what the path does not cover if the reader needs to know.`;
}

/**
 * Found something.
 *
 * `status` is written AFTER the payload spread deliberately. A tool that
 * selects a column called `status` -- several tables have one -- would
 * otherwise relabel its own outcome, and the whole contract rests on that
 * field being set by this function and nothing else.
 *
 * `visibility` rides along on OK results too, not just empty ones. A partial
 * answer is the more dangerous case: three ideas returned out of eleven reads
 * as a complete list unless the reach is stated.
 */
export function toolOk(tool: string, payload: Record<string, unknown>): string {
  const v = toolVisibility(tool);
  return JSON.stringify({
    tool,
    ...payload,
    visibility: { scope: v.scope, covers: v.covers, excludes: v.excludes },
    status: "ok" as ToolStatus,
  });
}

/**
 * Searched, matched nothing. `searched` states what was actually looked at, so
 * the model can say "no notes on AAPL match X" rather than "there are no notes".
 */
export function toolEmpty(tool: string, searched: Record<string, unknown>): string {
  const v = toolVisibility(tool);
  return JSON.stringify({
    tool,
    status: "empty" as ToolStatus,
    searched,
    visibility: { scope: v.scope, covers: v.covers, excludes: v.excludes },
    note: "The search ran and matched no records. This is an absence of MATCHES, not proof the firm holds no such records.",
    absence_rule: absenceRule(v),
  });
}

/** Did not search. The model must not turn this into an absence claim. */
export function toolError(tool: string, stage: string): string {
  return JSON.stringify({
    tool,
    status: "error" as ToolStatus,
    stage,
    note: "This lookup FAILED. You do not know whether matching records exist. Say the lookup failed; do not say none were found.",
  });
}

/**
 * Terms for a note search.
 *
 * The live failure this replaces: the whole query went into one ILIKE, so a
 * search for "AAPL Apple thesis risk decision" asked for notes containing that
 * exact 31-character phrase. Nothing matched, and the user was told the firm
 * had written nothing about AAPL while seven notes sat on it.
 *
 * The opposite extreme is as bad -- ORing every word returns every note
 * containing "the" -- so stopwords and fragments are dropped and the list is
 * capped. The caller tries the phrase FIRST and only falls back to these.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "was", "are", "has",
  "have", "about", "what", "which", "any", "all", "our", "their", "its",
  "into", "over", "than", "then", "they", "them", "been", "were", "would",
]);

export function buildNoteSearchTerms(query: string, max = 6): string[] {
  return [...new Set(
    String(query || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )].slice(0, max);
}

/** Escapes a value for a PostgREST ilike pattern. */
export function escapeLike(s: string): string {
  return String(s).replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, " ");
}

// ─── People ──────────────────────────────────────────────────────────────

export interface PersonRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

/**
 * A name for a user id, or null.
 *
 * Returns null rather than the raw uuid when the id cannot be resolved. A uuid
 * printed where a person's name belongs reads as data corruption to the reader
 * and gives the model something to mistake for an identifier it can cite.
 */
export function personLabel(
  id: string | null | undefined,
  people: Map<string, PersonRow>,
): string | null {
  if (!id) return null;
  const p = people.get(id);
  if (!p) return null;
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || null;
}

export function peopleMap(rows: PersonRow[] | null | undefined): Map<string, PersonRow> {
  return new Map((rows || []).filter((r) => r?.id).map((r) => [r.id, r]));
}

// ─── Workflow stages ─────────────────────────────────────────────────────

export interface StageRow {
  id: string;
  workflow_id: string;
  stage_key: string | null;
  stage_label: string | null;
  sort_order?: number | null;
}

/**
 * Resolve a stage reference to its label.
 *
 * `asset_checklist_items.stage_id` and `asset_workflow_progress`'s
 * `current_stage_key` are both TEXT, and production holds BOTH conventions:
 * measured 2026-11-11, 129 of 141 checklist rows hold a `stage_key`, 10 hold a
 * `workflow_stages.id` uuid, and 2 hold neither; 364 of 874 progress rows name
 * a stage that does not exist in their workflow.
 *
 * So this tries both conventions, scoped to the workflow, and returns null when
 * neither matches. Null means "this stage reference does not resolve", which
 * the caller reports as such. Guessing a label here -- picking the first stage,
 * or echoing the raw key as though it were a name -- would invent process state
 * that nobody recorded.
 */
export function resolveStageLabel(
  stageRef: string | null | undefined,
  workflowId: string | null | undefined,
  stages: StageRow[],
): { label: string | null; resolved: boolean } {
  if (!stageRef) return { label: null, resolved: false };
  const inWorkflow = stages.filter((s) => !workflowId || s.workflow_id === workflowId);
  const hit =
    inWorkflow.find((s) => s.stage_key === stageRef) ??
    inWorkflow.find((s) => s.id === stageRef);
  if (!hit) return { label: null, resolved: false };
  return { label: hit.stage_label || hit.stage_key || null, resolved: true };
}

// ─── Checklist requirements ──────────────────────────────────────────────

export interface ChecklistRow {
  id: string;
  workflow_id?: string | null;
  stage_id?: string | null;
  item_text?: string | null;
  status?: string | null;
  completed?: boolean | null;
  item_type?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface ChecklistBuckets {
  total: number;
  open: number;
  completed: number;
  not_applicable: number;
  /** Open requirements only, bounded. The point of the tool is what REMAINS. */
  open_items: ChecklistRow[];
  open_items_truncated: boolean;
}

/**
 * Split requirements into done / open / not-applicable.
 *
 * `status` is the authority, not the older `completed` boolean. Both exist on
 * the table; measured 2026-11-11 they agree on all 141 rows, but `status` also
 * carries `na`, which the boolean cannot express -- and a requirement marked
 * not-applicable is neither outstanding work nor a completed check. Collapsing
 * it into either one misstates what remains.
 */
export function bucketChecklist(
  rows: ChecklistRow[] | null | undefined,
  maxOpen = 20,
): ChecklistBuckets {
  const all = (rows || []).filter((r) => r?.id);
  const statusOf = (r: ChecklistRow): "completed" | "na" | "open" => {
    if (r.status === "completed") return "completed";
    if (r.status === "na") return "na";
    if (!r.status && r.completed === true) return "completed";
    return "open";
  };
  const open = all.filter((r) => statusOf(r) === "open");
  return {
    total: all.length,
    open: open.length,
    completed: all.filter((r) => statusOf(r) === "completed").length,
    not_applicable: all.filter((r) => statusOf(r) === "na").length,
    open_items: open.slice(0, maxOpen),
    open_items_truncated: open.length > maxOpen,
  };
}

/**
 * Turn a tool's JSON into what the BROWSER is told.
 *
 * Deliberately not the tool's JSON. The panel needs to say what was consulted
 * and offer a way in: a status, a count, and records with ids. No excerpts, no
 * reasoning text, no driver messages.
 *
 * `result_summary` used to be `truncate(result, 160)` -- the raw JSON, cut
 * mid-structure -- which is how `{"results":[]}` became the user-visible
 * account of a search.
 *
 * Unparseable JSON is an ERROR, not an empty result: the same rule the tools
 * follow, for the same reason.
 */
export function summarizeToolResult(
  name: string,
  raw: string,
  log: Logger = defaultLog,
): ToolResultSummary {
  let p: Record<string, any>;
  try {
    p = JSON.parse(raw);
  } catch {
    log(`ai-chat: tool ${name} returned unparseable JSON`);
    return { status: "error" };
  }
  const status: ToolStatus =
    p?.status === "ok" || p?.status === "empty" ? p.status : "error";

  /*
   * The reach, for the UI's sentence.
   *
   * Read from the local table rather than the payload. The payload's copy is
   * what the model sees and could in principle come from an older deploy,
   * while `TOOL_VISIBILITY` is the version this code was reviewed against. An
   * unknown tool gets no scope rather than a thrown error: this function runs
   * on every answer, and a tool the client has not learned about yet must not
   * lose the reader their whole trail.
   */
  const scope: VisibilityScope | undefined = TOOL_VISIBILITY[name]?.scope;

  const describeSearched = (s: any): string | undefined => {
    if (!s || typeof s !== "object") return undefined;
    if (s.scope && s.query) return `"${s.query}" in ${s.scope}`;
    if (s.query) return `"${s.query}"`;
    // The asset-scoped tools name the scope instead of a query, and the scope
    // is the honest part: "decisions on AAPL visible to you" is a claim this
    // function can stand behind, where "AAPL" alone invites "there are none".
    if (s.symbol && s.scope) return `${s.symbol} in ${s.scope}`;
    if (s.symbol) return String(s.symbol);
    if (s.name_or_id) return String(s.name_or_id);
    return undefined;
  };

  if (status !== "ok") {
    /* An error carries no scope: the lookup never ran, so there is no reach to
       declare and nothing it can say about absence. An empty one does. */
    return status === "empty"
      ? { status, searched: describeSearched(p?.searched), scope }
      : { status, searched: describeSearched(p?.searched) };
  }

  const sources: ToolSourceRef[] = [];
  const assetId: string | null = p.asset_id ?? null;
  const symbol: string | null = p.symbol ?? null;

  if (name === "get_asset") {
    if (assetId) {
      sources.push({ kind: "asset", id: assetId, asset_id: assetId, symbol, title: `${symbol} overview` });
    }
    for (const [sec, v] of Object.entries(p.sections || {})) {
      const sv = v as { id?: string; updated_at?: string | null };
      if (!sv?.id) continue;
      sources.push({
        kind: "contribution", id: sv.id, asset_id: assetId, symbol,
        // The separator is a middle dot, not an em dash: these titles render
        // in the Research panel, and em dashes are barred from app copy.
        title: `${symbol} · ${SECTION_LABELS[sec] || sec}`, timestamp: sv.updated_at ?? null,
        /* The payload already carries the section text for the model. Reusing
           it costs no query, and "AAPL · Thesis" alone tells a reader nothing
           about whether it is the thesis they remember. */
        excerpt: excerptOf((v as { text?: string }).text),
      });
    }
    for (const t of (p.price_targets || [])) {
      if (!t?.id) continue;
      sources.push({
        kind: "price_target", id: t.id, asset_id: assetId, symbol,
        title: `${symbol} ${String(t.type || "").toUpperCase()} target${t.price != null ? ` $${t.price}` : ""}`,
        timestamp: t.created_at ?? null,
        /* The reasoning, which is the part that makes a target reviewable. */
        excerpt: excerptOf(t.reasoning),
      });
    }
    for (const n of (p.recent_notes || [])) {
      if (!n?.id) continue;
      sources.push({
        kind: "note", id: n.id, asset_id: n.asset_id ?? assetId, symbol: n.symbol ?? symbol,
        title: n.title || "Untitled note", timestamp: n.updated_at ?? null,
        /* Already truncated by the `content_excerpt` computed column, which
           exists because selecting `content` pulled a two-million-character
           note on every AAPL lookup. Trimmed again for line length only. */
        excerpt: excerptOf(n.excerpt),
      });
    }
  } else if (name === "search_team_notes") {
    for (const n of (p.results || [])) {
      if (!n?.id) continue;
      sources.push({
        kind: "note", id: n.id, asset_id: n.asset_id ?? null, symbol: n.symbol ?? null,
        title: n.title || "Untitled note", timestamp: n.updated_at ?? null,
        /* A search result especially: the title is why it matched at best, and
           often not even that, since the query also matches the body. */
        excerpt: excerptOf(n.excerpt),
      });
    }
  } else if (name === "search_assets") {
    for (const a of (p.results || [])) {
      if (!a?.asset_id) continue;
      sources.push({
        kind: "asset", id: a.asset_id, asset_id: a.asset_id, symbol: a.symbol,
        title: `${a.symbol}${a.company ? ` · ${a.company}` : ""}`,
      });
    }
  } else if (name === "get_portfolio") {
    if (p.portfolio_id) {
      sources.push({ kind: "portfolio", id: p.portfolio_id, title: p.name || "Portfolio", timestamp: p.updated_at ?? null });
    }
  } else if (name === "get_theme") {
    if (p.theme_id) {
      sources.push({ kind: "theme", id: p.theme_id, title: p.name || "Theme", timestamp: p.updated_at ?? null });
    }
  } else if (name === "get_decisions") {
    /*
     * Four stages, four kinds, in the order they happen. The reader must be
     * able to see from the trail alone that a recommendation and a committed
     * trade are different records, because the sentence "we decided to buy
     * AAPL" is true of a PM ruling and false of an unexecuted Trade Book row.
     */
    for (const r of (p.recommendations || [])) {
      if (!r?.id) continue;
      sources.push({
        kind: "recommendation", id: r.id, asset_id: assetId, symbol,
        title: `${symbol} ${String(r.action || "").toUpperCase()} recommendation (${r.queue_status || "unknown"})`.replace(/\s+/g, " "),
        timestamp: r.created_at ?? null,
      });
    }
    for (const d of (p.pm_rulings || [])) {
      if (!d?.id) continue;
      sources.push({
        kind: "decision_request", id: d.id, asset_id: assetId, symbol,
        title: `${symbol} PM ruling: ${d.status || "unknown"}`,
        timestamp: d.reviewed_at ?? d.created_at ?? null,
      });
    }
    for (const t of (p.committed_trades || [])) {
      if (!t?.id) continue;
      const exec = t.execution_status ? `, execution ${t.execution_status}` : "";
      sources.push({
        kind: "accepted_trade", id: t.id, asset_id: assetId, symbol,
        title: `${symbol} ${String(t.action || "").toUpperCase()} committed trade${exec}`,
        timestamp: t.created_at ?? null,
      });
    }
    for (const r of (p.decision_reviews || [])) {
      if (!r?.id) continue;
      sources.push({
        kind: "decision_review", id: r.id, asset_id: assetId, symbol,
        title: `${symbol} decision review${r.decision_quality ? `: ${r.decision_quality}` : ""}`,
        timestamp: r.reviewed_at ?? null,
      });
    }
    for (const o of (p.price_target_outcomes || [])) {
      if (!o?.id) continue;
      sources.push({
        kind: "outcome", id: o.id, asset_id: assetId, symbol,
        title: `${symbol} ${String(o.scenario_type || "").toUpperCase()} target outcome: ${o.status || "unknown"}`.replace(/\s+/g, " "),
        timestamp: o.evaluated_at ?? o.created_at ?? null,
      });
    }
  } else if (name === "get_workflows") {
    for (const w of (p.workflows || [])) {
      if (!w?.workflow_id) continue;
      const at = w.current_stage_label ? ` at ${w.current_stage_label}` : "";
      sources.push({
        kind: "workflow", id: w.workflow_id, asset_id: assetId, symbol,
        title: `${w.name || "Workflow"}${at}`,
        timestamp: w.updated_at ?? null,
      });
      for (const it of (w.open_requirements || [])) {
        if (!it?.id) continue;
        sources.push({
          kind: "checklist_item", id: it.id, asset_id: assetId, symbol,
          title: it.requirement || "Untitled requirement",
          timestamp: it.updated_at ?? it.created_at ?? null,
        });
      }
    }

  /* ── The cross-asset tools ───────────────────────────────────────────────
   *
   * These return records about MANY assets, so each source carries its own
   * `asset_id` and `symbol` rather than inheriting the one asset the
   * single-name tools looked up. Without that the links all point at whatever
   * asset happened to be first.
   */
  } else if (name === "get_watchlists") {
    for (const l of (p.lists || [])) {
      for (const a of (l.assets || [])) {
        if (!a?.asset_id) continue;
        sources.push({
          kind: "asset", id: a.asset_id, asset_id: a.asset_id, symbol: a.symbol ?? null,
          title: `${a.symbol || a.company || "Asset"} on ${l.name || "a list"}`,
          timestamp: a.added_at ?? null,
        });
      }
    }
  } else if (name === "get_coverage") {
    for (const c of (p.assignments || [])) {
      if (!c?.asset_id) continue;
      const by = c.analyst ? ` covered by ${c.analyst}` : "";
      sources.push({
        kind: "asset", id: c.asset_id, asset_id: c.asset_id, symbol: c.symbol ?? null,
        title: `${c.symbol || c.company || "Asset"}${by}`,
        timestamp: c.since ?? null,
      });
    }
  } else if (name === "get_idea_pipeline") {
    for (const g of (p.by_stage || [])) {
      for (const i of (g.ideas || [])) {
        if (!i?.idea_id) continue;
        const act = i.action ? `${String(i.action).toUpperCase()} ` : "";
        sources.push({
          kind: "idea", id: i.idea_id, asset_id: i.asset_id ?? null, symbol: i.symbol ?? null,
          title: `${act}${i.symbol || i.company || "idea"} at ${g.stage_label}`,
          timestamp: i.created_at ?? null,
        });
      }
    }
  } else if (name === "get_pending_decisions") {
    for (const r of (p.requests || [])) {
      if (!r?.decision_request_id) continue;
      const act = r.proposed_action ? `${String(r.proposed_action).toUpperCase()} ` : "";
      const wait = typeof r.waiting_days === "number" ? `, waiting ${r.waiting_days}d` : "";
      sources.push({
        kind: "decision_request", id: r.decision_request_id,
        asset_id: r.asset_id ?? null, symbol: r.symbol ?? null,
        title: `${act}${r.symbol || r.company || "request"} awaiting a ruling${wait}`,
        timestamp: r.raised_at ?? null,
      });
    }
  } else if (name === "get_outstanding_work") {
    for (const w of (p.work || [])) {
      if (w?.workflow_id && w?.asset_id) {
        const at = w.current_stage_label ? ` at ${w.current_stage_label}` : "";
        sources.push({
          kind: "workflow", id: w.workflow_id, asset_id: w.asset_id, symbol: w.symbol ?? null,
          title: `${w.symbol ? `${w.symbol}: ` : ""}${w.workflow || "Workflow"}${at}`,
          timestamp: w.updated_at ?? null,
        });
      }
      for (const it of (w.open_requirements || [])) {
        if (!it?.id) continue;
        sources.push({
          kind: "checklist_item", id: it.id, asset_id: w.asset_id ?? null, symbol: w.symbol ?? null,
          title: `${w.symbol ? `${w.symbol}: ` : ""}${it.requirement || "Untitled requirement"}`,
          timestamp: it.due_date ?? null,
          /*
           * Read, not recomputed. The handler already decided this against
           * the server's own date, and a second comparison here would be a
           * second place for "overdue" to mean something slightly different.
           * A row with no due date is open, never overdue, which is the
           * absent-field case this product has got wrong before.
           */
          state: it.is_overdue === true ? "overdue" : "open",
        });
      }
    }
  }

  const counted = Array.isArray(p.results)
    ? p.results.length
    : name === "get_theme" ? (p.constituents_returned ?? 0)
    : name === "get_portfolio" ? (p.holdings_returned ?? 0)
    : typeof p.records_returned === "number" ? p.records_returned
    : sources.length;

  /* `scope` rides on OK too, not just empty. A partial answer is the more
     dangerous case: 18 of 84 returned reads as the whole list unless the
     trail says whose 18 they are. */
  return { status, searched: describeSearched(p), result_count: counted, sources, scope };
}
