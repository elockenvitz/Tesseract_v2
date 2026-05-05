/**
 * ai-chat — multi-provider AI proxy for Tesseract.
 *
 * Phase A (v3):
 *   - Captures input/output/cache token counts and estimated_cost into ai_usage_log
 *   - Anthropic prompt caching on system+context block
 *
 * Phase B (v4, this file):
 *   - Enforces rate limits BEFORE calling any provider:
 *       · daily_request_limit       (from platform_ai_config, overridable per user)
 *       · daily_token_limit         (platform default / per-user override)
 *       · monthly_budget_usd        (platform default / per-user override)
 *       · max_tokens_per_request    (caps Anthropic/OpenAI/Google max_tokens)
 *   - Caps context block sizes defensively so one user with a huge thesis or
 *     100 notes can't blow up token costs.
 *   - Purpose-based model routing: optional 'purpose' in request body
 *     ('chat' | 'column' | 'snippet' | 'analysis') picks a cheaper model for
 *     cheap tasks (Haiku) while keeping the configured default for chat.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

type AIProvider = 'anthropic' | 'openai' | 'google' | 'perplexity';
type Purpose    = 'chat' | 'column' | 'snippet' | 'analysis';

// ─── Pricing table (USD per 1M tokens) ────────────────────────────────────
interface ModelPricing { in: number; out: number; cache_write?: number; cache_read?: number; }

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':               { in: 15,   out: 75,  cache_write: 18.75, cache_read: 1.50 },
  'claude-sonnet-4-6':             { in: 3,    out: 15,  cache_write: 3.75,  cache_read: 0.30 },
  'claude-haiku-4-5-20251001':     { in: 1,    out: 5,   cache_write: 1.25,  cache_read: 0.10 },
  'claude-3-5-sonnet-20241022':    { in: 3,    out: 15,  cache_write: 3.75,  cache_read: 0.30 },
  'claude-3-5-haiku-20241022':     { in: 0.80, out: 4,   cache_write: 1.00,  cache_read: 0.08 },
  'gpt-4o':                        { in: 2.50, out: 10 },
  'gpt-4o-mini':                   { in: 0.15, out: 0.60 },
  'gpt-4-turbo':                   { in: 10,   out: 30 },
  'gpt-4-turbo-preview':           { in: 10,   out: 30 },
  'gemini-1.5-pro':                { in: 1.25, out: 5 },
  'gemini-1.5-flash':              { in: 0.075, out: 0.30 },
  'llama-3.1-sonar-large-128k-online': { in: 1, out: 1 },
  'llama-3.1-sonar-small-128k-online': { in: 0.20, out: 0.20 },
};

const PROVIDER_DEFAULT_PRICING: Record<AIProvider, ModelPricing> = {
  anthropic:  { in: 3,    out: 15,  cache_write: 3.75, cache_read: 0.30 },
  openai:     { in: 2.50, out: 10 },
  google:     { in: 1.25, out: 5 },
  perplexity: { in: 1,    out: 1 },
};

function getPricing(provider: AIProvider, model: string | null | undefined): ModelPricing {
  if (model && PRICING[model]) return PRICING[model];
  return PROVIDER_DEFAULT_PRICING[provider];
}

function computeCost(
  provider: AIProvider,
  model: string | null | undefined,
  tokens: { input: number; output: number; cache_write?: number; cache_read?: number }
): number {
  const p = getPricing(provider, model);
  const cw = tokens.cache_write ?? 0;
  const cr = tokens.cache_read ?? 0;
  return (
    (tokens.input * p.in) +
    (tokens.output * p.out) +
    (cw * (p.cache_write ?? p.in)) +
    (cr * (p.cache_read ?? p.in))
  ) / 1_000_000;
}

// ─── Purpose → model routing ─────────────────────────────────────────────
// For cheap/repetitive tasks we force a Haiku-class model regardless of
// configured default, because chat-quality models cost 3-5× more for no
// quality benefit on extractions / one-shot snippets.

function pickModelForPurpose(
  provider: AIProvider,
  configuredModel: string,
  purpose: Purpose | undefined
): string {
  if (!purpose || purpose === 'chat' || purpose === 'analysis') return configuredModel;
  if (purpose === 'column' || purpose === 'snippet') {
    if (provider === 'anthropic') return 'claude-haiku-4-5-20251001';
    if (provider === 'openai')    return 'gpt-4o-mini';
    if (provider === 'google')    return 'gemini-1.5-flash';
    if (provider === 'perplexity') return 'llama-3.1-sonar-small-128k-online';
  }
  return configuredModel;
}

// ─── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const platformApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const platformOpenAIKey = Deno.env.get("OPENAI_API_KEY");
    const platformGoogleKey = Deno.env.get("GOOGLE_AI_API_KEY");
    const platformPerplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Resolve org/team for attribution. Both may be null for users with
    // no membership yet; that's fine — the log columns are nullable.
    const attribution = await resolveAttribution(supabase, user.id);

    const { aiConfig, platformConfig, userConfig } = await getEffectiveAIConfig(
      supabase,
      user.id,
      attribution.organizationId,
      { anthropic: platformApiKey, openai: platformOpenAIKey, google: platformGoogleKey, perplexity: platformPerplexityKey }
    );

    if (!aiConfig.isConfigured) {
      throw new Error(
        aiConfig.mode === "disabled"
          ? "AI features are not available."
          : "AI not configured. Please add your API key in Settings."
      );
    }

    // Parse request (before rate check so purpose can influence model choice).
    // Tags is the new shape (array of {type, id}); `context` is the old
    // single-target shape — accepted for backward compat during migration
    // and converted to a single-element tags list.
    const body = await req.json();
    const message: string = body.message;
    const conversationHistory: any[] = body.conversationHistory || [];
    const purpose: string | undefined = body.purpose;
    const tags: Array<{ type: string; id: string }> = Array.isArray(body.tags)
      ? body.tags.filter((t: any) => t && t.type && t.id)
      : (body.context && body.context.type && body.context.id
          ? [{ type: body.context.type, id: body.context.id }]
          : []);

    if (!message || typeof message !== "string") throw new Error("Message is required");

    // ─── Rate-limit gate ───────────────────────────────────────────────
    const limits = resolveLimits(platformConfig, userConfig);
    const usage = await getCurrentUsage(supabase, user.id);
    const breach = checkLimits(limits, usage);
    if (breach) {
      // Persist a notification once per user per breach kind per day.
      // Toast alone is fragile — if the breach happens during async work
      // (column generation), the user may never see it. The bell is durable.
      notifyRateLimitOncePerDay(supabase, user.id, attribution.organizationId, breach)
        .catch(console.error);

      return new Response(
        JSON.stringify({
          error: breach.message,
          code: 'rate_limit_exceeded',
          details: breach.details,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Context + system prompt ────────────────────────────────────────
    // Iterate every tag. For Anthropic we collect document blocks across
    // all tags (each tag may contribute several — thesis sections + price
    // targets + notes); for other providers we concatenate context
    // strings into the system prompt.
    let contextPrompt = "";
    let documents: SourceDocument[] = [];
    const isAnthropic = aiConfig.provider === "anthropic";

    for (const tag of tags) {
      if (isAnthropic) {
        const docs = await buildContextDocuments(supabase, tag, user.id, aiConfig);
        if (docs.length > 0) {
          documents.push(...docs);
        } else {
          // For tag types without document support (theme/portfolio so
          // far), fall back to the embedded-string context — still gives
          // the model something to work with, just no inline citations.
          const part = await buildContextPrompt(supabase, tag, user.id, aiConfig);
          if (part) contextPrompt += part + "\n";
        }
      } else {
        const part = await buildContextPrompt(supabase, tag, user.id, aiConfig);
        if (part) contextPrompt += part + "\n";
      }
    }
    const systemPrompt = buildSystemPrompt(contextPrompt);

    // ─── Pick model based on purpose ───────────────────────────────────
    const effectiveModel = pickModelForPurpose(
      aiConfig.provider as AIProvider,
      aiConfig.model!,
      purpose as Purpose | undefined
    );

    // ─── Call provider ─────────────────────────────────────────────────
    const startTime = Date.now();
    let result;
    try {
      result = await callAIProvider(
        aiConfig.provider as AIProvider,
        aiConfig.apiKey!,
        effectiveModel,
        systemPrompt,
        conversationHistory,
        message,
        limits.maxTokensPerRequest,
        user.id,
        documents,
        // Pass the user-authed supabase client so the model's tool calls
        // execute under that user's RLS — they can only see what they're
        // already entitled to. Anthropic only; other providers ignore.
        supabase,
      );
    } catch (e) {
      // 401/403/billing errors from the provider mean the org's BYOK key
      // (or platform key) is dead — notify org admins so someone fixes it.
      // Other errors (rate-limit from provider, transient) are logged but
      // not turned into notifications.
      const errMsg = (e as Error).message || '';
      if (looksLikeAuthFailure(errMsg)) {
        notifyProviderAuthFailureOncePerDay(
          supabase,
          attribution.organizationId,
          aiConfig.provider as AIProvider,
          aiConfig.mode,
          errMsg,
        ).catch(console.error);
      }
      throw e;
    }

    // Async usage log — never blocks the response. We log the FIRST tag
    // (if any) as the primary context for backwards-compatible usage
    // attribution; multi-tag conversations still get one row each.
    const primaryTag = tags[0] || null;
    const usageContext = primaryTag ? { type: primaryTag.type, id: primaryTag.id } : null;
    logUsage(supabase, user.id, attribution, { ...aiConfig, model: effectiveModel }, usageContext, purpose, startTime, result.tokens)
      .catch(console.error);

    return new Response(
      JSON.stringify({
        response:   result.response,
        usage:      result.usageRaw,
        model:      effectiveModel,
        citations:  result.citations || [],
        tool_calls: result.tool_calls || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AI Chat Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "An error occurred" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Config resolution ───────────────────────────────────────────────────

async function getEffectiveAIConfig(
  supabase: any,
  userId: string,
  organizationId: string | null,
  platformKeys: { anthropic?: string, openai?: string, google?: string, perplexity?: string }
) {
  const { data: platformConfig } = await supabase
    .from("platform_ai_config")
    .select("*")
    .single();

  const { data: userConfig } = await supabase
    .from("user_ai_config")
    .select("*")
    .eq("user_id", userId)
    .single();

  // BYOK is org-scoped: each firm has at most one config, only org admins
  // can write it, all members can use it. We resolve via the user's
  // organization_id (already computed for attribution). The api_key is no
  // longer SELECT-able from the table by non-admins — we go through a
  // SECURITY DEFINER RPC that checks active membership and returns the
  // full row including the key. This keeps the key out of any client-side
  // network response while still letting the edge function mint provider
  // calls on behalf of any active org member.
  let orgConfig: { byok_provider?: string | null; byok_api_key?: string | null;
                   byok_model?: string | null; byok_enabled?: boolean } | null = null;
  if (organizationId) {
    const { data: rows } = await supabase
      .rpc("get_org_ai_config_for_resolution", { p_org_id: organizationId });
    orgConfig = (rows && rows[0]) ? rows[0] : null;
  }

  const preferences = {
    includeThesis: userConfig?.include_thesis ?? true,
    includeOutcomes: userConfig?.include_outcomes ?? true,
    includeNotes: userConfig?.include_notes ?? true,
    includeDiscussions: userConfig?.include_discussions ?? false
  };

  let aiConfig: any;
  if (platformConfig?.platform_ai_enabled) {
    const provider = platformConfig.platform_provider || "anthropic";
    const apiKey = platformKeys[provider as keyof typeof platformKeys];
    aiConfig = {
      mode: "platform",
      provider,
      model: platformConfig.platform_model || "claude-3-5-sonnet-20241022",
      apiKey: apiKey || null,
      isConfigured: !!apiKey,
      ...preferences
    };
  } else if (platformConfig?.allow_byok && orgConfig?.byok_enabled && orgConfig?.byok_api_key) {
    // Model resolution: user preference → org default → hardcoded fallback.
    // Per-user override lets one user pick Opus while another picks Haiku
    // against the same org BYOK key.
    aiConfig = {
      mode: "byok",
      provider: orgConfig.byok_provider || "anthropic",
      model: userConfig?.preferred_model || orgConfig.byok_model || "claude-3-5-sonnet-20241022",
      apiKey: orgConfig.byok_api_key,
      isConfigured: true,
      ...preferences
    };
  } else if (platformConfig?.allow_byok) {
    aiConfig = {
      mode: "byok",
      provider: null,
      model: null,
      apiKey: null,
      isConfigured: false,
      ...preferences
    };
  } else {
    aiConfig = {
      mode: "disabled",
      provider: null,
      model: null,
      apiKey: null,
      isConfigured: false,
      ...preferences
    };
  }

  return { aiConfig, platformConfig, userConfig };
}

// ─── Rate limits ─────────────────────────────────────────────────────────

interface Limits {
  dailyRequestLimit:      number | null;  // null = unlimited
  dailyTokenLimit:        number | null;
  monthlyBudgetUsd:       number | null;
  maxTokensPerRequest:    number;
}

function resolveLimits(platformConfig: any, userConfig: any): Limits {
  const override = (key: string, fallback: number | null | undefined): number | null => {
    const val = userConfig?.[key];
    if (val !== undefined && val !== null) return val;
    return (fallback === undefined || fallback === null) ? null : fallback;
  };

  return {
    dailyRequestLimit:   override('daily_request_limit_override', platformConfig?.daily_request_limit),
    dailyTokenLimit:     override('daily_token_limit_override',   platformConfig?.daily_token_limit_per_user),
    monthlyBudgetUsd:    override('monthly_budget_usd_override',  platformConfig?.monthly_budget_usd_per_user),
    maxTokensPerRequest: platformConfig?.max_tokens_per_request ?? 4096,
  };
}

interface CurrentUsage {
  requestsToday: number;
  tokensToday:   number;
  costMtd:       number;
}

async function getCurrentUsage(supabase: any, userId: string): Promise<CurrentUsage> {
  // Single round-trip aggregating all three windows. Uses the
  // (user_id, created_at desc) index installed in the prior migration.
  const sinceDayIso   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sinceMonthIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { data: dayRows } = await supabase
    .from("ai_usage_log")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", sinceDayIso);

  const { data: monthRows } = await supabase
    .from("ai_usage_log")
    .select("estimated_cost")
    .eq("user_id", userId)
    .gte("created_at", sinceMonthIso);

  let requestsToday = 0, tokensToday = 0, costMtd = 0;
  for (const r of (dayRows || [])) {
    requestsToday += 1;
    tokensToday += (r.input_tokens || 0) + (r.output_tokens || 0);
  }
  for (const r of (monthRows || [])) {
    costMtd += Number(r.estimated_cost || 0);
  }
  return { requestsToday, tokensToday, costMtd };
}

interface Breach { message: string; details: Record<string, unknown> }

function checkLimits(limits: Limits, usage: CurrentUsage): Breach | null {
  if (limits.dailyRequestLimit !== null && usage.requestsToday >= limits.dailyRequestLimit) {
    return {
      message: `Daily request limit reached (${usage.requestsToday}/${limits.dailyRequestLimit}). Try again tomorrow or ask your admin to raise your limit.`,
      details: { kind: 'daily_request_limit', used: usage.requestsToday, limit: limits.dailyRequestLimit },
    };
  }
  if (limits.dailyTokenLimit !== null && usage.tokensToday >= limits.dailyTokenLimit) {
    return {
      message: `Daily token limit reached (${usage.tokensToday.toLocaleString()}/${limits.dailyTokenLimit.toLocaleString()} tokens). Try again tomorrow or ask your admin to raise your limit.`,
      details: { kind: 'daily_token_limit', used: usage.tokensToday, limit: limits.dailyTokenLimit },
    };
  }
  if (limits.monthlyBudgetUsd !== null && usage.costMtd >= limits.monthlyBudgetUsd) {
    return {
      message: `Monthly AI budget reached ($${usage.costMtd.toFixed(2)}/$${limits.monthlyBudgetUsd.toFixed(2)}). Resets on the 1st.`,
      details: { kind: 'monthly_budget', used: usage.costMtd, limit: limits.monthlyBudgetUsd },
    };
  }
  return null;
}

// ─── Prompt construction ────────────────────────────────────────────────

function buildSystemPrompt(contextPrompt: string): string {
  return `You are an AI investment research assistant integrated into Tesseract, a professional investment research platform.

Your role is to help investment professionals:
- Analyze investment theses and identify blind spots
- Suggest outcome scenarios with probabilities
- Summarize research notes and discussions
- Answer questions about specific investments
- Provide market context and analysis

Guidelines:
- Be concise and actionable
- Use bullet points and clear formatting
- When suggesting probabilities, explain your reasoning
- Flag risks and counterarguments proactively
- Reference the user's own notes and thesis when relevant
- Provide balanced analysis, not just confirmation

Research tools:
- You have access to tools that look up additional data — assets by ticker, portfolios by name, themes, team notes, asset search.
- Use them when the user references a company / portfolio / theme you don't already have full context on, or when comparing multiple objects would benefit the answer.
- Don't call tools for objects you already have rich context on (the user's currently-tagged objects are already provided as documents).
- Prefer specific lookups (get_asset, get_portfolio) over broad searches when you know the name. Cap yourself to the minimum set of tool calls needed.
- After calling tools, weave the findings into a single coherent answer rather than dumping raw tool output.

${contextPrompt ? `\n--- CURRENT CONTEXT ---\n${contextPrompt}\n--- END CONTEXT ---\n` : ""}

Remember: You're helping a professional investor, so be direct, substantive, and analytical.`;
}

// ─── Context building with caps ─────────────────────────────────────────

// Defensive caps: a single user's messy data shouldn't blow up token cost.
const MAX_THESIS_CHARS     = 2000;  // ~500 tokens
const MAX_OUTCOMES         = 5;
const MAX_NOTES            = 10;
const MAX_NOTE_CHARS       = 200;
const MAX_CONTEXT_CHARS    = 32000; // ~8K tokens hard ceiling

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…[truncated]";
}

// Returns the user's relevant context as a list of source documents — one
// per logical section (each thesis section, the price targets, each note).
// Only used by the Anthropic provider; documents become attachable blocks
// with citations enabled. Other providers continue to receive context as
// an embedded string in the system prompt (via buildContextPrompt).
async function buildContextDocuments(
  supabase: any,
  context: { type: string; id: string },
  userId: string,
  aiConfig: any,
): Promise<SourceDocument[]> {
  const docs: SourceDocument[] = [];

  // Currently only `asset` context has structured sub-documents worth
  // citing. Themes/portfolios fall back to no documents — model still
  // gets context via buildContextPrompt embedded in system prompt.
  if (context.type !== "asset") return docs;

  const { data: asset } = await supabase
    .from("assets").select("symbol, company_name, sector, industry").eq("id", context.id).single();

  const symbol = asset?.symbol || "asset";

  // Asset overview as a one-pager — useful for citing "$AAPL is in tech".
  if (asset) {
    const overview =
      `Asset: ${asset.symbol} - ${asset.company_name || ""}\n` +
      `Sector: ${asset.sector || "N/A"}\n` +
      `Industry: ${asset.industry || "N/A"}`;
    docs.push({ title: `${symbol} overview`, text: overview });
  }

  if (aiConfig.includeThesis) {
    const { data: contributions } = await supabase
      .from("asset_contributions")
      .select("section, content, supporting_detail")
      .eq("asset_id", context.id)
      .eq("is_archived", false)
      .in("section", ["thesis", "business_model", "where_different", "risks_to_thesis", "key_catalysts"]);

    const labelMap: Record<string, string> = {
      thesis:           "Thesis",
      business_model:   "Business model",
      where_different:  "Where differentiated",
      key_catalysts:    "Key catalysts",
      risks_to_thesis:  "Risks to thesis",
    };
    const bySection = new Map<string, any>();
    for (const c of (contributions || [])) {
      if (!bySection.has(c.section)) bySection.set(c.section, c);
    }
    for (const [sec, label] of Object.entries(labelMap)) {
      const c = bySection.get(sec);
      if (!c?.content) continue;
      const text = c.supporting_detail
        ? `${truncate(c.content, MAX_THESIS_CHARS)}\n\n${truncate(c.supporting_detail, 600)}`
        : truncate(c.content, MAX_THESIS_CHARS);
      docs.push({ title: `${symbol} — ${label}`, text });
    }
  }

  if (aiConfig.includeOutcomes) {
    const { data: targets } = await supabase
      .from("price_targets")
      .select("type, price, timeframe, reasoning")
      .eq("asset_id", context.id)
      .order("type", { ascending: true })
      .limit(MAX_OUTCOMES);

    if (targets?.length) {
      const lines = targets.map((t: any) =>
        `${(t.type || "").toUpperCase()}: $${t.price ?? "—"}` +
        (t.timeframe ? ` (${t.timeframe})` : "") +
        (t.reasoning ? ` — ${truncate(t.reasoning, 200)}` : "")
      ).join("\n");
      docs.push({ title: `${symbol} — Price targets`, text: lines });
    }
  }

  if (aiConfig.includeNotes) {
    const { data: notes } = await supabase
      .from("asset_notes")
      .select("title, content, created_at, created_by, is_shared")
      .eq("asset_id", context.id)
      .eq("is_deleted", false)
      .or(`created_by.eq.${userId},is_shared.eq.true`)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTES);

    if (notes?.length) {
      // One document per note so citations link to a specific note rather
      // than a giant blob — more useful in the UI footer.
      for (const n of notes) {
        const body = n.content || n.title || "";
        if (!body.trim()) continue;
        const date = new Date(n.created_at).toLocaleDateString();
        const owner = n.created_by === userId ? "you" : "teammate";
        const title = n.title
          ? `${symbol} note: ${n.title} (${date})`
          : `${symbol} note (${date}, by ${owner})`;
        docs.push({ title, text: truncate(body, MAX_NOTE_CHARS * 4) });
      }
    }
  }

  return docs;
}

async function buildContextPrompt(
  supabase: any,
  context: { type: string; id: string },
  userId: string,
  aiConfig: any
): Promise<string> {
  let prompt = "";

  if (context.type === "asset") {
    const { data: asset } = await supabase
      .from("assets")
      .select("*")
      .eq("id", context.id)
      .single();

    if (asset) {
      prompt += `ASSET: ${asset.symbol} - ${asset.company_name || asset.name || ""}\nSector: ${asset.sector || "N/A"}\nIndustry: ${asset.industry || "N/A"}\n`;
      if (asset.current_price) prompt += `Current Price: $${asset.current_price}\n`;
      if (asset.market_cap) prompt += `Market Cap: $${(asset.market_cap / 1e9).toFixed(1)}B\n`;
    }

    // Thesis + supporting research sections live in `asset_contributions`,
    // keyed by section ('thesis' | 'business_model' | 'risks_to_thesis' |
    // 'where_different' | 'key_catalysts'). These are org-visible team
    // research, not per-user — RLS already scopes them to the user's org.
    let thesisBlock = "";
    if (aiConfig.includeThesis) {
      const { data: contributions } = await supabase
        .from("asset_contributions")
        .select("section, content, supporting_detail, created_at")
        .eq("asset_id", context.id)
        .eq("is_archived", false)
        .in("section", ["thesis", "business_model", "where_different", "risks_to_thesis", "key_catalysts"])
        .order("section", { ascending: true });

      if (contributions?.length) {
        // Group by section — most recent wins per section. Sections render
        // in a deliberate order (thesis first, then supporting frames).
        const bySection = new Map<string, any>();
        const sectionOrder = ["thesis", "business_model", "where_different", "key_catalysts", "risks_to_thesis"];
        for (const c of contributions) {
          if (!bySection.has(c.section)) bySection.set(c.section, c);
        }
        const labelMap: Record<string, string> = {
          thesis: "THESIS",
          business_model: "BUSINESS MODEL",
          where_different: "WHERE DIFFERENTIATED",
          key_catalysts: "KEY CATALYSTS",
          risks_to_thesis: "RISKS TO THESIS",
        };
        const blocks: string[] = [];
        for (const sec of sectionOrder) {
          const c = bySection.get(sec);
          if (!c?.content) continue;
          let body = truncate(c.content, MAX_THESIS_CHARS);
          if (c.supporting_detail) {
            body += `\n  Supporting: ${truncate(c.supporting_detail, 600)}`;
          }
          blocks.push(`\n${labelMap[sec]}:\n${body}`);
        }
        if (blocks.length) {
          thesisBlock = `\nTEAM RESEARCH FOR ${asset?.symbol || "ASSET"}:${blocks.join("\n")}\n`;
        }
      }
    }

    // Outcomes are stored as price targets keyed by type ('bull'/'base'/'bear')
    // with price, timeframe, and reasoning. The asset_outcomes table referenced
    // by the prior implementation never existed.
    let outcomesBlock = "";
    if (aiConfig.includeOutcomes) {
      const { data: targets } = await supabase
        .from("price_targets")
        .select("type, price, timeframe, reasoning, created_at")
        .eq("asset_id", context.id)
        .order("type", { ascending: true })
        .limit(MAX_OUTCOMES);

      if (targets?.length) {
        outcomesBlock = `\nPRICE TARGETS:\n`;
        const emoji: Record<string, string> = { bull: "🟢", base: "⚪", bear: "🔴" };
        targets.forEach((t: any) => {
          outcomesBlock += `${emoji[t.type] || "•"} ${(t.type || "").toUpperCase()}: ` +
            `$${t.price ?? "—"}` +
            (t.timeframe ? ` (${t.timeframe})` : "") +
            (t.reasoning ? ` — ${truncate(t.reasoning, 200)}` : "") +
            "\n";
        });
      }
    }

    // Notes live in `asset_notes` (not `notes`). Pull the user's own + any
    // shared notes on this asset, most recent first.
    let notesBlock = "";
    if (aiConfig.includeNotes) {
      const { data: notes } = await supabase
        .from("asset_notes")
        .select("title, content, created_at, created_by, is_shared")
        .eq("asset_id", context.id)
        .eq("is_deleted", false)
        .or(`created_by.eq.${userId},is_shared.eq.true`)
        .order("created_at", { ascending: false })
        .limit(MAX_NOTES);

      if (notes?.length) {
        notesBlock = `\nRECENT NOTES:\n`;
        notes.forEach((n: any) => {
          const date = new Date(n.created_at).toLocaleDateString();
          const owner = n.created_by === userId ? "you" : "teammate";
          const body = n.content || n.title || "";
          notesBlock += `• ${date} (${owner}): ${truncate(body, MAX_NOTE_CHARS)}\n`;
        });
      }
    }

    // Budget-aware assembly: thesis is most important — never drop it.
    // If the total would exceed MAX_CONTEXT_CHARS, drop notes then outcomes.
    let combined = prompt + thesisBlock + outcomesBlock + notesBlock;
    if (combined.length > MAX_CONTEXT_CHARS && notesBlock) {
      combined = prompt + thesisBlock + outcomesBlock + "\n[NOTES omitted to stay within context budget]\n";
    }
    if (combined.length > MAX_CONTEXT_CHARS && outcomesBlock) {
      combined = prompt + thesisBlock + "\n[OUTCOMES and NOTES omitted to stay within context budget]\n";
    }
    if (combined.length > MAX_CONTEXT_CHARS) {
      // Last resort: truncate thesis harder.
      combined = truncate(combined, MAX_CONTEXT_CHARS);
    }
    return combined;
  }

  if (context.type === "theme") {
    const { data: theme } = await supabase
      .from("themes")
      .select("*")
      .eq("id", context.id)
      .single();

    if (theme) {
      prompt += `THEME: ${theme.name}\n`;
      if (theme.description) prompt += `Description: ${truncate(theme.description, 500)}\n`;
    }

    const { data: themeAssets } = await supabase
      .from("asset_themes")
      .select("asset:assets(symbol, company_name)")
      .eq("theme_id", context.id)
      .limit(10);

    if (themeAssets?.length) {
      prompt += `\nCONSTITUENT ASSETS:\n`;
      themeAssets.forEach((ta: any) => {
        if (ta.asset) prompt += `• ${ta.asset.symbol} - ${ta.asset.company_name || ""}\n`;
      });
    }

    return truncate(prompt, MAX_CONTEXT_CHARS);
  }

  if (context.type === "portfolio") {
    const { data: portfolio } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", context.id)
      .single();

    if (portfolio) {
      prompt += `PORTFOLIO: ${portfolio.name}\n`;
      if (portfolio.description) prompt += `Description: ${truncate(portfolio.description, 500)}\n`;
    }

    const { data: holdings } = await supabase
      .from("portfolio_holdings")
      .select("*, asset:assets(symbol, company_name)")
      .eq("portfolio_id", context.id)
      .order("weight", { ascending: false })
      .limit(10);

    if (holdings?.length) {
      prompt += `\nTOP HOLDINGS:\n`;
      holdings.forEach((h: any) => {
        if (h.asset) prompt += `• ${h.asset.symbol}: ${h.weight ? h.weight.toFixed(1) + "%" : "N/A"}\n`;
      });
    }

    return truncate(prompt, MAX_CONTEXT_CHARS);
  }

  return prompt;
}

// ─── Provider dispatch + token capture ──────────────────────────────────

interface MessageCitation {
  document_title: string;
  cited_text:     string;
}

interface ToolCall {
  name:   string;
  input:  Record<string, unknown>;
  result_summary?: string;  // short human-readable preview
}

interface CallResult {
  response:  string;
  tokens:    { input: number; output: number; cache_write: number; cache_read: number };
  usageRaw:  any;
  citations: MessageCitation[];
  tool_calls?: ToolCall[];
}

interface SourceDocument {
  title: string;
  text:  string;
}

// ─── Research tools (Anthropic tool use) ─────────────────────────────────
// The model can call these to look up data beyond the page-context the user
// is on. Kept small and well-described so the model can decide when to use
// them. Each returns concise JSON the model can keep in its context window.

const RESEARCH_TOOLS = [
  {
    name: "get_asset",
    description:
      "Look up an asset (stock/security) by its ticker symbol. Returns the asset's overview, " +
      "thesis sections (thesis, business model, key catalysts, risks, where differentiated), " +
      "price targets (bull/base/bear), and a few recent notes. Use this when the user asks about " +
      "a specific company you don't already have context on.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol like AAPL or MSFT (case-insensitive)." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "search_assets",
    description:
      "Find assets matching a query (symbol prefix, company name, or sector). Returns up to 10 " +
      "matches with symbol/company/sector/industry. Use this when the user references a company " +
      "by name without giving the ticker, or asks for assets in a sector.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text — symbol, company name, or sector." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_portfolio",
    description:
      "Look up a portfolio by name or id. Returns top holdings (up to 15) with weights and " +
      "a sector breakdown. Use this when the user asks about portfolio composition or wants " +
      "to compare an asset to a portfolio.",
    input_schema: {
      type: "object",
      properties: {
        name_or_id: { type: "string", description: "Portfolio name (case-insensitive) or its UUID." },
      },
      required: ["name_or_id"],
    },
  },
  {
    name: "get_theme",
    description:
      "Look up an investment theme by name or id. Returns the theme's description and constituent " +
      "assets. Use this when the user references a theme like 'AI infrastructure' or 'energy transition'.",
    input_schema: {
      type: "object",
      properties: {
        name_or_id: { type: "string", description: "Theme name or its UUID." },
      },
      required: ["name_or_id"],
    },
  },
  {
    name: "search_team_notes",
    description:
      "Search the team's research notes for content matching a query. Optionally scope to a " +
      "specific asset by symbol. Returns up to 10 note snippets with date and author. Use when " +
      "the user asks 'what have we written about X' or wants to find prior research.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search across note title and body." },
        asset_symbol: { type: "string", description: "Optional ticker to narrow the search." },
      },
      required: ["query"],
    },
  },
] as const;

async function executeResearchTool(
  supabase: any,
  userId: string,
  name: string,
  input: Record<string, any>,
): Promise<string> {
  try {
    if (name === "get_asset") {
      const sym = String(input.symbol || "").trim().toUpperCase();
      if (!sym) return JSON.stringify({ error: "symbol is required" });

      const { data: asset } = await supabase
        .from("assets").select("id, symbol, company_name, sector, industry, current_price, market_cap")
        .ilike("symbol", sym).maybeSingle();
      if (!asset) return JSON.stringify({ error: `No asset found for ${sym}` });

      const [contribs, targets, notes] = await Promise.all([
        supabase.from("asset_contributions").select("section, content")
          .eq("asset_id", asset.id).eq("is_archived", false)
          .in("section", ["thesis", "business_model", "where_different", "risks_to_thesis", "key_catalysts"]),
        supabase.from("price_targets").select("type, price, timeframe, reasoning")
          .eq("asset_id", asset.id).limit(5),
        supabase.from("asset_notes").select("title, content, created_at")
          .eq("asset_id", asset.id).eq("is_deleted", false)
          .or(`created_by.eq.${userId},is_shared.eq.true`)
          .order("created_at", { ascending: false }).limit(5),
      ]);

      const sections: Record<string, string> = {};
      for (const c of (contribs.data || [])) {
        if (!sections[c.section]) sections[c.section] = truncate(c.content, 1500);
      }
      return JSON.stringify({
        symbol: asset.symbol,
        company: asset.company_name,
        sector: asset.sector,
        industry: asset.industry,
        current_price: asset.current_price,
        sections,
        price_targets: (targets.data || []).map((t: any) => ({
          type: t.type, price: t.price, timeframe: t.timeframe,
          reasoning: truncate(t.reasoning, 200),
        })),
        recent_notes: (notes.data || []).map((n: any) => ({
          date: n.created_at?.slice(0, 10), title: n.title,
          excerpt: truncate(n.content, 200),
        })),
      });
    }

    if (name === "search_assets") {
      const q = String(input.query || "").trim();
      if (!q) return JSON.stringify({ error: "query is required" });
      const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const { data } = await supabase
        .from("assets").select("symbol, company_name, sector, industry")
        .or(`symbol.ilike.%${escaped}%,company_name.ilike.%${escaped}%,sector.ilike.%${escaped}%`)
        .limit(10);
      return JSON.stringify({
        results: (data || []).map((a: any) => ({
          symbol: a.symbol, company: a.company_name,
          sector: a.sector, industry: a.industry,
        })),
      });
    }

    if (name === "get_portfolio") {
      const ref = String(input.name_or_id || "").trim();
      if (!ref) return JSON.stringify({ error: "name_or_id is required" });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
      const q = supabase.from("portfolios").select("id, name, description");
      const { data: pf } = isUuid
        ? await q.eq("id", ref).maybeSingle()
        : await q.ilike("name", ref).limit(1).maybeSingle();
      if (!pf) return JSON.stringify({ error: `No portfolio found for "${ref}"` });

      const { data: holdings } = await supabase
        .from("portfolio_holdings")
        .select("weight, asset:assets(symbol, company_name, sector)")
        .eq("portfolio_id", pf.id)
        .order("weight", { ascending: false }).limit(15);

      const sectorMap: Record<string, number> = {};
      for (const h of (holdings || []) as any[]) {
        const sec = h.asset?.sector || "Unknown";
        sectorMap[sec] = (sectorMap[sec] || 0) + (Number(h.weight) || 0);
      }
      return JSON.stringify({
        name: pf.name,
        description: pf.description,
        top_holdings: (holdings || []).map((h: any) => ({
          symbol: h.asset?.symbol, company: h.asset?.company_name,
          sector: h.asset?.sector, weight_pct: h.weight,
        })),
        sector_breakdown: Object.entries(sectorMap)
          .sort((a, b) => b[1] - a[1])
          .map(([sec, w]) => ({ sector: sec, weight_pct: Number(w.toFixed(2)) })),
      });
    }

    if (name === "get_theme") {
      const ref = String(input.name_or_id || "").trim();
      if (!ref) return JSON.stringify({ error: "name_or_id is required" });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
      const q = supabase.from("themes").select("id, name, description");
      const { data: th } = isUuid
        ? await q.eq("id", ref).maybeSingle()
        : await q.ilike("name", ref).limit(1).maybeSingle();
      if (!th) return JSON.stringify({ error: `No theme found for "${ref}"` });

      const { data: constituents } = await supabase
        .from("asset_themes").select("asset:assets(symbol, company_name, sector)")
        .eq("theme_id", th.id).limit(25);

      return JSON.stringify({
        name: th.name,
        description: th.description,
        constituents: (constituents || []).map((c: any) => ({
          symbol: c.asset?.symbol, company: c.asset?.company_name, sector: c.asset?.sector,
        })),
      });
    }

    if (name === "search_team_notes") {
      const q = String(input.query || "").trim();
      const sym = String(input.asset_symbol || "").trim().toUpperCase();
      if (!q) return JSON.stringify({ error: "query is required" });
      const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");

      let assetId: string | null = null;
      if (sym) {
        const { data: a } = await supabase.from("assets").select("id").ilike("symbol", sym).maybeSingle();
        assetId = a?.id ?? null;
      }
      let qb = supabase.from("asset_notes")
        .select("title, content, created_at, asset:assets(symbol)")
        .eq("is_deleted", false)
        .or(`created_by.eq.${userId},is_shared.eq.true`)
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
        .order("created_at", { ascending: false }).limit(10);
      if (assetId) qb = qb.eq("asset_id", assetId);
      const { data } = await qb;

      return JSON.stringify({
        results: (data || []).map((n: any) => ({
          symbol: n.asset?.symbol, date: n.created_at?.slice(0, 10),
          title: n.title, excerpt: truncate(n.content, 200),
        })),
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message || "Tool execution failed" });
  }
}

// ─── Anthropic call w/ tool-use loop ────────────────────────────────────
// The model can call our research tools to fetch additional data while
// answering. We loop: send → if response has tool_use → execute → send
// back tool_results → repeat. Cap at MAX_TOOL_ITERATIONS to bound cost
// and latency.
//
// Supabase Edge Functions have a ~25s execution budget. With ~3-5s per
// Anthropic round-trip + tool exec time, 3 iterations is the safe cap.
// Going higher (we tried 5) reliably timed out the function and the
// user saw a "thinking" spinner that never resolved.
const MAX_TOOL_ITERATIONS = 3;

async function callAnthropicWithLoop(opts: {
  apiKey: string; model: string; systemPrompt: string;
  history: Array<{ role: string; content: string }>;
  message: string; maxTokens: number; userId: string;
  documents: SourceDocument[]; supabase?: any;
}): Promise<CallResult> {
  const { apiKey, model, systemPrompt, history, message, maxTokens, userId, documents, supabase } = opts;

  // Build initial user message: documents (with citations enabled) + the
  // actual question. If no documents, just a plain string.
  const initialUserContent: any = documents.length > 0
    ? [
        ...documents.map((d, i) => ({
          type: "document",
          source: { type: "text", media_type: "text/plain", data: d.text },
          title: d.title,
          ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}),
          citations: { enabled: true },
        })),
        { type: "text", text: message },
      ]
    : message;

  const messages: any[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: initialUserContent },
  ];

  let combinedText = "";
  const citations: MessageCitation[] = [];
  const citationSeen = new Set<string>();
  const tool_calls: ToolCall[] = [];
  let totals = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  let lastUsageRaw: any = {};

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const body: any = {
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: maxTokens,
      metadata: { user_id: userId },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
    };
    // Expose tools only when we have a supabase client to execute them.
    if (supabase) body.tools = RESEARCH_TOOLS;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error?.message || `Anthropic API error (HTTP ${response.status})`);
    }

    const data = await response.json();
    const u = data.usage || {};
    lastUsageRaw = u;
    totals.input       += u.input_tokens ?? 0;
    totals.output      += u.output_tokens ?? 0;
    totals.cache_write += u.cache_creation_input_tokens ?? 0;
    totals.cache_read  += u.cache_read_input_tokens ?? 0;

    // Walk the content blocks once: collect text + citations + tool_use.
    const toolUseBlocks: any[] = [];
    for (const block of (data.content || [])) {
      if (block.type === "text") {
        combinedText += block.text || "";
        if (Array.isArray(block.citations)) {
          for (const c of block.citations) {
            const docTitle = documents[c.document_index]?.title || "Source";
            const citedText = String(c.cited_text || "").trim();
            if (!citedText) continue;
            const key = docTitle + "::" + citedText.slice(0, 200);
            if (citationSeen.has(key)) continue;
            citationSeen.add(key);
            citations.push({ document_title: docTitle, cited_text: citedText });
          }
        }
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    // No tool calls and not asking to continue — we're done.
    if (data.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      break;
    }

    // If we're about to enter the LAST iteration, the model can call tools
    // again but won't get to use the results. Skip the redundant round-trip
    // and break with what we have plus a hint to the user.
    if (iter === MAX_TOOL_ITERATIONS - 1) {
      if (!combinedText) {
        combinedText = "I started looking up additional context but ran out of time. Try a more specific question, or open the asset/portfolio directly.";
      }
      break;
    }

    // Execute each tool call, then push the assistant message + a user
    // message with all tool_results back into the conversation.
    messages.push({ role: "assistant", content: data.content });

    const toolResults: any[] = [];
    for (const tu of toolUseBlocks) {
      const result = supabase
        ? await executeResearchTool(supabase, userId, tu.name, tu.input || {})
        : JSON.stringify({ error: "Tools not available in this context." });
      // Track for client display
      tool_calls.push({
        name: tu.name,
        input: tu.input || {},
        result_summary: truncate(result, 160),
      });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
    // Loop back — model gets the tool results and can answer or call more.
  }

  // Defensive: if for any reason we exited with no text (model returned
  // only tool_use blocks every iteration, etc.), give the user something
  // back instead of an empty bubble.
  if (!combinedText) {
    combinedText = "I wasn't able to put together a response. Try rephrasing the question.";
  }

  return {
    response: combinedText,
    tokens: totals,
    usageRaw: lastUsageRaw,
    citations,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
  };
}

async function callAIProvider(
  provider:   AIProvider,
  apiKey:     string,
  model:      string,
  systemPrompt: string,
  history:    Array<{ role: string; content: string }>,
  message:    string,
  maxTokens:  number,
  userId:     string,
  // Optional source documents — when provided AND provider is Anthropic,
  // they're attached to the user message with citations enabled. Other
  // providers ignore them (their context is in the system prompt instead).
  documents:  SourceDocument[] = [],
  // Supabase client for executing tools (Anthropic only). Optional — if
  // omitted, tools are not exposed to the model.
  supabase?: any,
): Promise<CallResult> {

  if (provider === "anthropic") {
    return await callAnthropicWithLoop({
      apiKey, model, systemPrompt, history, message, maxTokens, userId,
      documents, supabase,
    });
  }

  if (provider === "openai") {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "gpt-4-turbo-preview",
        messages,
        max_tokens: maxTokens,
        // Opaque per-user identifier for OpenAI abuse monitoring.
        user: userId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "OpenAI API error");
    }

    const data = await response.json();
    const u = data.usage || {};
    return {
      response: data.choices[0]?.message?.content || "",
      tokens: {
        input: u.prompt_tokens ?? 0,
        output: u.completion_tokens ?? 0,
        cache_write: 0,
        cache_read: u.prompt_tokens_details?.cached_tokens ?? 0,
      },
      usageRaw: u,
      citations: [],
    };
  }

  if (provider === "google") {
    const contents = [
      { role: "user", parts: [{ text: `System instructions: ${systemPrompt}` }] },
      { role: "model", parts: [{ text: "Understood. I'll act as your investment research assistant." }] },
      ...history.flatMap(m => [{
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }]),
      { role: "user", parts: [{ text: message }] }
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-pro"}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Google AI API error");
    }

    const data = await response.json();
    const u = data.usageMetadata || {};
    return {
      response: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      tokens: {
        input: u.promptTokenCount ?? 0,
        output: u.candidatesTokenCount ?? 0,
        cache_write: 0,
        cache_read: u.cachedContentTokenCount ?? 0,
      },
      usageRaw: u,
      citations: [],
    };
  }

  if (provider === "perplexity") {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "llama-3.1-sonar-large-128k-online",
        messages,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Perplexity API error");
    }

    const data = await response.json();
    const u = data.usage || {};
    return {
      response: data.choices[0]?.message?.content || "",
      tokens: {
        input: u.prompt_tokens ?? 0,
        output: u.completion_tokens ?? 0,
        cache_write: 0,
        cache_read: 0,
      },
      usageRaw: u,
      citations: [],
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Usage logging ──────────────────────────────────────────────────────

async function logUsage(
  supabase: any,
  userId: string,
  attribution: Attribution,
  aiConfig: any,
  context: any,
  purpose: string | undefined,
  startTime: number,
  tokens: { input: number; output: number; cache_write: number; cache_read: number }
) {
  try {
    const cost = computeCost(aiConfig.provider, aiConfig.model, tokens);
    await supabase.from("ai_usage_log").insert({
      user_id: userId,
      organization_id: attribution.organizationId,
      team_id: attribution.teamId,
      mode: aiConfig.mode,
      provider: aiConfig.provider,
      model: aiConfig.model,
      context_type: context?.type || null,
      context_id: context?.id || null,
      purpose: purpose || null,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_write_tokens: tokens.cache_write,
      cache_read_tokens: tokens.cache_read,
      estimated_cost: cost,
      response_time_ms: Date.now() - startTime
    });
  } catch (e) {
    console.error("Failed to log AI usage:", e);
  }
}

// ─── Attribution ────────────────────────────────────────────────────────
// Resolves the org and (optional) team a user belongs to, so usage can be
// rolled up by firm and by pod/team for billing reports. Pods are modelled
// as `teams` in Tesseract; not every user has a team, so team_id is
// optional. If a user belongs to multiple orgs/teams we pick the most
// recently-joined active one — the firm can refine this later (e.g. an
// explicit "active org" picker) without changing the usage table.

interface Attribution {
  organizationId: string | null;
  teamId:         string | null;
}

async function resolveAttribution(supabase: any, userId: string): Promise<Attribution> {
  try {
    const { data: orgRow } = await supabase
      .from("organization_memberships")
      .select("organization_id, joined_at, status")
      .eq("user_id", userId)
      .is("suspended_at", null)
      .order("joined_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const { data: teamRow } = await supabase
      .from("team_memberships")
      .select("team_id, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    return {
      organizationId: orgRow?.organization_id ?? null,
      teamId:         teamRow?.team_id        ?? null,
    };
  } catch (e) {
    // Attribution failure must not block AI requests — log and degrade.
    console.error("resolveAttribution failed:", e);
    return { organizationId: null, teamId: null };
  }
}

// ─── Failure notifications (rate-limit + provider auth) ──────────────────
// Once-per-day dedup so users / admins don't get spammed when a broken key
// or sustained limit-hit produces hundreds of failed requests in a row.

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function notifyRateLimitOncePerDay(
  supabase: any,
  userId: string,
  organizationId: string | null,
  breach: { message: string; details: Record<string, unknown> }
): Promise<void> {
  const kind = String((breach.details as any)?.kind || 'rate_limit');
  // Have we already notified this user about THIS kind of breach today?
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "ai_rate_limit_hit")
    .eq("context_data->>kind", kind)
    .gte("created_at", startOfTodayIso())
    .limit(1)
    .maybeSingle();

  if (existing) return;

  await supabase.from("notifications").insert({
    user_id: userId,
    type: "ai_rate_limit_hit",
    title: "AI request limit reached",
    message: breach.message,
    context_type: "ai_usage",
    context_id: null,
    context_data: {
      kind,
      details: breach.details,
      organization_id: organizationId,
    },
    is_read: false,
  });
}

function looksLikeAuthFailure(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return (
    m.includes("invalid api key") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("api key") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("billing") ||
    m.includes("quota") ||
    m.includes("insufficient_quota")
  );
}

async function notifyProviderAuthFailureOncePerDay(
  supabase: any,
  organizationId: string | null,
  provider: AIProvider,
  mode: string,
  errMsg: string
): Promise<void> {
  if (!organizationId) return;  // no org means no admins to notify

  // Find active org admins to notify.
  const { data: admins } = await supabase
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .eq("is_org_admin", true);

  if (!admins || admins.length === 0) return;

  const adminIds: string[] = admins.map((a: any) => a.user_id);
  const sinceIso = startOfTodayIso();

  // Have we already sent a provider-auth notification to ANY of these
  // admins today? If yes, skip — once per day per org is enough.
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .in("user_id", adminIds)
    .eq("type", "ai_provider_error")
    .eq("context_data->>organization_id", organizationId)
    .gte("created_at", sinceIso)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const title = "AI provider key issue: " + provider;
  const msg =
    "An AI request failed with what looks like an authentication or billing problem (" +
    provider + ", mode: " + mode + "). " +
    "Check the organization's API key in Settings → AI Configuration.";

  const rows = adminIds.map((id) => ({
    user_id: id,
    type: "ai_provider_error",
    title,
    message: msg,
    context_type: "ai_config",
    context_id: null,
    context_data: {
      provider,
      mode,
      organization_id: organizationId,
      error_excerpt: errMsg.slice(0, 200),
    },
    is_read: false,
  }));

  await supabase.from("notifications").insert(rows);
}
