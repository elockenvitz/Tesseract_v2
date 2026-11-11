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
  | "workflow" | "checklist_item";

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
}

export interface ToolResultSummary {
  status: ToolStatus;
  /** What was searched, in words. For the "no matches" sentence. */
  searched?: string;
  result_count?: number;
  sources?: ToolSourceRef[];
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
 * Found something.
 *
 * `status` is written AFTER the payload spread deliberately. A tool that
 * selects a column called `status` -- several tables have one -- would
 * otherwise relabel its own outcome, and the whole contract rests on that
 * field being set by this function and nothing else.
 */
export function toolOk(tool: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ tool, ...payload, status: "ok" as ToolStatus });
}

/**
 * Searched, matched nothing. `searched` states what was actually looked at, so
 * the model can say "no notes on AAPL match X" rather than "there are no notes".
 */
export function toolEmpty(tool: string, searched: Record<string, unknown>): string {
  return JSON.stringify({
    tool,
    status: "empty" as ToolStatus,
    searched,
    note: "The search ran and matched no records. This is an absence of MATCHES, not proof the firm holds no such records.",
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
    return { status, searched: describeSearched(p?.searched) };
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
      });
    }
    for (const t of (p.price_targets || [])) {
      if (!t?.id) continue;
      sources.push({
        kind: "price_target", id: t.id, asset_id: assetId, symbol,
        title: `${symbol} ${String(t.type || "").toUpperCase()} target${t.price != null ? ` $${t.price}` : ""}`,
        timestamp: t.created_at ?? null,
      });
    }
    for (const n of (p.recent_notes || [])) {
      if (!n?.id) continue;
      sources.push({
        kind: "note", id: n.id, asset_id: n.asset_id ?? assetId, symbol: n.symbol ?? symbol,
        title: n.title || "Untitled note", timestamp: n.updated_at ?? null,
      });
    }
  } else if (name === "search_team_notes") {
    for (const n of (p.results || [])) {
      if (!n?.id) continue;
      sources.push({
        kind: "note", id: n.id, asset_id: n.asset_id ?? null, symbol: n.symbol ?? null,
        title: n.title || "Untitled note", timestamp: n.updated_at ?? null,
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
  }

  const counted = Array.isArray(p.results)
    ? p.results.length
    : name === "get_theme" ? (p.constituents_returned ?? 0)
    : name === "get_portfolio" ? (p.holdings_returned ?? 0)
    : name === "get_decisions" ? (p.records_returned ?? sources.length)
    : name === "get_workflows" ? (p.records_returned ?? sources.length)
    : sources.length;

  return { status, searched: describeSearched(p), result_count: counted, sources };
}
