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
 *
 * AI System V2 (this revision):
 *   - Phase timing on every request, returned as `timings` and logged, so
 *     latency is measured rather than guessed. Nothing is optimised blind.
 *   - Pre-flight fan-out: attribution, config and usage are three independent
 *     reads and now run concurrently instead of five serial round-trips.
 *   - Response-size policy: the client resolves a verbosity
 *     ('brief' | 'standard' | 'deep') deterministically and sends it; this
 *     function owns the directive text and the max_tokens ceiling for each.
 *     Brief is the default, and depth is something the user asks for.
 *   - Structured recommendations: when `structured: true`, the model is told
 *     the closed Tesseract action vocabulary and appends one fenced block the
 *     client parses into buttons. The vocabulary here is mirrored from
 *     src/lib/ai/actions.ts and a unit test fails if the two drift.
 *   - Split system prompt: the stable half (role, vocabulary, contract) is
 *     one cache breakpoint; verbosity and context follow it uncached, so a
 *     change of verbosity no longer invalidates the whole prefix.
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

  // Phase timing. Every await that can take a network hop is fenced, so the
  // breakdown in the response is measured rather than inferred. Costs one
  // Date.now() per phase and is always on — latency you only measure when you
  // go looking for it is latency you find out about from users.
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const mark = (phase: string, from: number) => { timings[phase] = Date.now() - from; };
  async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try { return await fn(); } finally { mark(name, start); }
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

    // Body first: it needs no network, and having `purpose` early lets the
    // pre-flight fan-out below start with everything it needs.
    // Tags is the new shape (array of {type, id}); `context` is the old
    // single-target shape — accepted for backward compat during migration
    // and converted to a single-element tags list.
    const body = await req.json();
    const message: string = body.message;
    const conversationHistory: any[] = body.conversationHistory || [];
    const purpose: string | undefined = body.purpose;
    const verbosity: Verbosity = normalizeVerbosity(body.verbosity);
    // Structured recommendations are opt-in per request, so every existing
    // caller — the column generator, the inline editor, the smart input —
    // keeps getting exactly the prose response it gets today.
    const structured: boolean = body.structured === true;
    // Opt-in, like `structured`. Every caller that does not ask for a stream
    // keeps receiving exactly the JSON body it receives today.
    const wantsStream: boolean = body.stream === true;
    const maxActions: number = clampInt(body.maxActions, 1, 5, 3);
    const maxEvidence: number = clampInt(body.maxEvidence, 1, 8, 3);
    const tags: Array<{ type: string; id: string }> = Array.isArray(body.tags)
      ? body.tags.filter((t: any) => t && t.type && t.id)
      : (body.context && body.context.type && body.context.id
          ? [{ type: body.context.type, id: body.context.id }]
          : []);

    if (!message || typeof message !== "string") throw new Error("Message is required");

    const { data: { user }, error: authError } = await phase("auth", () => supabase.auth.getUser());
    if (authError || !user) throw new Error("Unauthorized");

    // ─── Pre-flight fan-out ────────────────────────────────────────────
    // Attribution, config and usage were five serial round-trips against the
    // same database, and none of the three needs another's answer. The one
    // real dependency — org config keys off the org id — stays inside
    // getEffectiveAIConfig, which is why attribution is awaited first and the
    // other two run alongside it.
    const attribution = await phase("attribution", () => resolveAttribution(supabase, user.id));

    const [configResult, usage] = await phase("preflight", () => Promise.all([
      getEffectiveAIConfig(
        supabase,
        user.id,
        attribution.organizationId,
        { anthropic: platformApiKey, openai: platformOpenAIKey, google: platformGoogleKey, perplexity: platformPerplexityKey }
      ),
      getCurrentUsage(supabase, user.id),
    ]));
    const { aiConfig, platformConfig, userConfig } = configResult;

    if (!aiConfig.isConfigured) {
      throw new Error(
        aiConfig.mode === "disabled"
          ? "AI features are not available."
          : "AI not configured. Please add your API key in Settings."
      );
    }

    // ─── Rate-limit gate ───────────────────────────────────────────────
    const limits = resolveLimits(platformConfig, userConfig);
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

    // Tags are independent of one another, so a two-tag conversation used to
    // pay for eight serial round-trips where four would do. Fan out.
    await phase("context", async () => {
      const parts = await Promise.all(tags.map(async (tag) => {
        if (isAnthropic) {
          const docs = await buildContextDocuments(supabase, tag, user.id, aiConfig);
          if (docs.length > 0) return { docs, text: "" };
          // For tag types without document support (theme/portfolio so
          // far), fall back to the embedded-string context — still gives
          // the model something to work with, just no inline citations.
          const part = await buildContextPrompt(supabase, tag, user.id, aiConfig);
          return { docs: [] as SourceDocument[], text: part ? part + "\n" : "" };
        }
        const part = await buildContextPrompt(supabase, tag, user.id, aiConfig);
        return { docs: [] as SourceDocument[], text: part ? part + "\n" : "" };
      }));
      for (const p of parts) {
        documents.push(...p.docs);
        contextPrompt += p.text;
      }
    });

    // The document path never had a total ceiling — MAX_CONTEXT_CHARS is
    // applied inside buildContextPrompt only, which is the branch Anthropic
    // does not take. Five thesis sections plus ten notes is ~5.5K tokens for
    // ONE tag, and nothing stopped four tags from sending four times that.
    const trimmed = capDocuments(documents);
    documents = trimmed.documents;

    const stableSystem = buildStableSystemPrompt({
      structured,
      maxActions,
      maxEvidence,
      allowDeep: verbosity === "deep",
    });
    const variableSystem = buildVariableSystemPrompt(verbosity, contextPrompt);
    const systemPrompt = `${stableSystem}\n\n${variableSystem}`;

    // ─── Pick model based on purpose ───────────────────────────────────
    const effectiveModel = pickModelForPurpose(
      aiConfig.provider as AIProvider,
      aiConfig.model!,
      purpose as Purpose | undefined
    );

    // The response-size policy is a ceiling, not a suggestion. Clamped by the
    // platform limit so a client cannot ask for more than the org allows.
    const effectiveMaxTokens = Math.min(
      VERBOSITY_MAX_TOKENS[verbosity],
      limits.maxTokensPerRequest,
    );

    timings.context_documents = documents.length;
    timings.context_chars =
      documents.reduce((n, d) => n + d.text.length + d.title.length, 0) + contextPrompt.length;
    timings.prompt_chars = systemPrompt.length;
    timings.history_chars = conversationHistory.reduce(
      (n: number, m: any) => n + String(m?.content ?? "").length, 0);
    timings.context_dropped = trimmed.dropped;

    // ─── Streamed response ─────────────────────────────────────────────
    //
    // The pre-model work above deliberately stays OUTSIDE the stream. A rate
    // limit is a 429 and a missing key is a 400 — status codes every existing
    // caller already handles — and burying them in an SSE frame would make a
    // configuration error look like a successful empty answer. Once the model
    // call begins, everything that follows is a stream event.
    //
    // Non-Anthropic providers take this path too. They cannot produce
    // incremental text, so the whole answer arrives as one delta; the client
    // gets one code path either way and learns from `streamed` in the meta
    // event whether the prose actually arrived in pieces.
    if (wantsStream) {
      const startTime = Date.now();
      const canStream = aiConfig.provider === "anthropic";
      const encoder = new TextEncoder();

      const sse = new ReadableStream({
        async start(controller) {
          const send = (type: string, payload: Record<string, unknown>) => {
            try {
              controller.enqueue(encoder.encode(
                `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`,
              ));
            } catch {
              // The reader went away — a closed pane, a cancelled request.
              // Nothing to recover; the loop below finishes and closes.
            }
          };

          send("meta", {
            model: effectiveModel,
            verbosity,
            streamed: canStream,
            timings: { ...timings },
          });
          // Grounded: context assembly genuinely happened before this point.
          send("status", { phase: "context" });

          const modelStart = Date.now();
          try {
            const result = await callAIProvider(
              aiConfig.provider as AIProvider,
              aiConfig.apiKey!,
              effectiveModel,
              systemPrompt,
              conversationHistory,
              message,
              effectiveMaxTokens,
              user.id,
              documents,
              supabase,
              { stableSystem, variableSystem },
              canStream
                ? {
                    onText: (text) => send("delta", { text }),
                    onTool: (name, iteration) => send("status", { tool: name, iteration }),
                    onFirstDelta: () => {
                      timings.provider_first_delta = Date.now() - modelStart;
                    },
                  }
                : undefined,
            );

            timings.model = Date.now() - modelStart;

            // A provider that could not stream still owes the reader the
            // answer. One delta, then the same terminal event.
            if (!canStream && result.response) {
              send("delta", { text: result.response });
            }

            const primaryTag = tags[0] || null;
            logUsage(
              supabase, user.id, attribution, { ...aiConfig, model: effectiveModel },
              primaryTag ? { type: primaryTag.type, id: primaryTag.id } : null,
              purpose, startTime, result.tokens,
            ).catch(console.error);

            timings.total = Date.now() - t0;
            timings.output_chars = result.response.length;
            timings.tool_iterations = result.tool_calls?.length ?? 0;
            console.log("ai-chat timings", JSON.stringify({
              purpose: purpose ?? "chat", verbosity, structured, streamed: canStream,
              provider: aiConfig.provider, model: effectiveModel, tags: tags.length, ...timings,
            }));

            send("final", {
              raw: result.response,
              model: effectiveModel,
              citations: result.citations || [],
              tool_calls: result.tool_calls || [],
              usage: result.usageRaw ?? {},
              timings: { ...timings },
            });
          } catch (e) {
            const errMsg = (e as Error).message || "";
            if (looksLikeAuthFailure(errMsg)) {
              notifyProviderAuthFailureOncePerDay(
                supabase, attribution.organizationId,
                aiConfig.provider as AIProvider, aiConfig.mode, errMsg,
              ).catch(console.error);
            }
            console.error("AI Chat stream error:", errMsg, JSON.stringify(timings));
            // Terminal: no `final` follows. The client keeps whatever prose
            // already arrived and derives no actions from it.
            send("error", { message: errMsg || "The AI request failed.", recoverable: false });
          } finally {
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });

      return new Response(sse, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          // Stops an intermediary from buffering the whole body and undoing
          // the entire point of this branch.
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ─── Call provider ─────────────────────────────────────────────────
    const startTime = Date.now();
    let result;
    try {
      result = await phase("model", () => callAIProvider(
        aiConfig.provider as AIProvider,
        aiConfig.apiKey!,
        effectiveModel,
        systemPrompt,
        conversationHistory,
        message,
        effectiveMaxTokens,
        user.id,
        documents,
        // Pass the user-authed supabase client so the model's tool calls
        // execute under that user's RLS — they can only see what they're
        // already entitled to. Anthropic only; other providers ignore.
        supabase,
        { stableSystem, variableSystem },
      ));
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

    timings.total = Date.now() - t0;
    timings.output_chars = result.response.length;
    timings.tool_iterations = result.tool_calls?.length ?? 0;
    // One structured line per request. Cheap, greppable in the function log,
    // and the only way a latency regression shows up before a user reports it.
    console.log("ai-chat timings", JSON.stringify({
      purpose: purpose ?? "chat", verbosity, structured, provider: aiConfig.provider,
      model: effectiveModel, tags: tags.length, ...timings,
    }));

    return new Response(
      JSON.stringify({
        response:   result.response,
        usage:      result.usageRaw,
        model:      effectiveModel,
        citations:  result.citations || [],
        tool_calls: result.tool_calls || [],
        // Additive. Existing clients ignore these; the AI pane uses them to
        // show what it was given and how long each phase took.
        verbosity,
        timings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AI Chat Error:", error, JSON.stringify(timings));
    return new Response(
      JSON.stringify({ error: (error as Error).message || "An error occurred" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/** Bounded integer from an untrusted body field. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

// ─── Config resolution ───────────────────────────────────────────────────

async function getEffectiveAIConfig(
  supabase: any,
  userId: string,
  organizationId: string | null,
  platformKeys: { anthropic?: string, openai?: string, google?: string, perplexity?: string }
) {
  // Independent reads. Serial cost two round-trips for no reason; the only
  // real dependency is the org config below, which needs the org id.
  const [{ data: platformConfig }, { data: userConfig }] = await Promise.all([
    supabase.from("platform_ai_config").select("*").single(),
    supabase.from("user_ai_config").select("*").eq("user_id", userId).single(),
  ]);

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

  // Two windows over the same table, neither depending on the other. The
  // comment above claimed a single round-trip; it was two, in series.
  const [{ data: dayRows }, { data: monthRows }] = await Promise.all([
    supabase
      .from("ai_usage_log")
      .select("input_tokens, output_tokens")
      .eq("user_id", userId)
      .gte("created_at", sinceDayIso),
    supabase
      .from("ai_usage_log")
      .select("estimated_cost")
      .eq("user_id", userId)
      .gte("created_at", sinceMonthIso),
  ]);

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

type Verbosity = 'brief' | 'standard' | 'deep';

const DEFAULT_VERBOSITY: Verbosity = 'brief';

function normalizeVerbosity(value: unknown): Verbosity {
  return value === 'brief' || value === 'standard' || value === 'deep'
    ? value
    : DEFAULT_VERBOSITY;
}

/**
 * Hard ceilings per verbosity.
 *
 * Clamped against the platform's max_tokens_per_request, never above it. The
 * old behaviour — 4096 for every request regardless of what was asked — is
 * why a "is this still a buy" question could come back as eight paragraphs.
 */
const VERBOSITY_MAX_TOKENS: Record<Verbosity, number> = {
  brief:    700,
  standard: 1200,
  deep:     4096,
};

/**
 * The directive text for each verbosity.
 *
 * Keyed by the same union the client resolves. `src/lib/ai/response-policy.ts`
 * owns WHICH verbosity a message gets; this owns what that means in words.
 * A unit test asserts every verbosity in that union has an entry here.
 */
const VERBOSITY_DIRECTIVE: Record<Verbosity, string> = {
  brief: `LENGTH — BRIEF (default)
Answer in this shape, in this order:
1. The judgment. One sentence. Lead with it; never restate the question first.
2. The evidence. At most three lines, each a specific fact from the context.
3. The recommended next steps, when there are any.

Hard rules:
- Under 150 words of prose. Under 600 characters is typical and good.
- No preamble, no summary of what you are about to say, no closing offer of
  further help. The reader is a professional investor at work.
- No headings unless the answer genuinely has two subjects.
- If you do not know, say what would settle it. Do not fill the space.`,

  standard: `LENGTH — STANDARD
Lead with the judgment in one sentence, then the reasoning, then the
recommended next steps. Under 300 words. No preamble and no closing offer of
further help. Use a heading only when the answer has more than one subject.`,

  deep: `LENGTH — DEEP (the user explicitly asked for depth)
Still lead with the judgment in one sentence, so the answer is useful before
it is finished. Then develop it properly: the evidence, the counter-case, what
would change your mind. Headings and structure are welcome here. Do not pad —
depth means more substance, not more words around the same substance.`,
};

/**
 * The Tesseract action vocabulary, as the model sees it.
 *
 * MIRRORED from `src/lib/ai/actions.ts` (ACTION_SPECS). That file is the
 * source of truth: it is what validates the model's output, and an id present
 * here but absent there produces a recommendation the client silently drops.
 * `src/lib/ai/__tests__/prompt-drift.test.ts` reads this file and fails on any
 * divergence, so the two cannot separate quietly.
 */
const ACTION_VOCABULARY = `NAVIGATION
- open_asset (target: asset) — The reader should look at the whole asset — case, position, decisions, activity.
- open_chart (target: asset) — Price action, not the written case, is what would settle the question.
- open_idea (target: idea) — There is a specific trade idea whose decision or thesis is the subject.
- open_pipeline (target: none) — The next step is triage across ideas rather than work on one object.
- open_portfolio (target: portfolio) — The question is about exposure, sizing or the book as a whole.
- open_project (target: project) — The work is tracked as a project and the reader needs its state.
- open_research (target: asset) — The question is about the written case or the evidence behind it.
- open_theme (target: theme) — The reasoning turns on a cross-asset theme the user tracks.

INVESTMENT
- review_target (target: asset) — Price has moved through a target, or the targets are stale.
- update_thesis (target: asset) — The written case no longer matches what is known.

CAPTURE
- create_prompt (target: asset|portfolio|theme) — Someone else holds the answer and should be asked for it.
- create_recommendation (target: asset) — A position change should be put to the PM.
- create_thought (target: asset|portfolio|theme) — There is something worth recording that is not yet a decision.
- create_trade_idea (target: asset) — The analysis has reached something actionable in the book.

COLLABORATION
- discuss (target: asset|portfolio|theme|idea) — The disagreement or the missing input is human, not analytical.`;

function buildActionDirective(maxActions: number, maxEvidence: number, allowDeep: boolean): string {
  return `TESSERACT ACTIONS

You are not a chatbot. You are an operator inside Tesseract, and the useful end
of most answers is a concrete next step the reader can take here, in one click.

These are the ONLY actions that exist. Nothing else is real:

${ACTION_VOCABULARY}

After your answer, and only when you have something concrete to recommend,
append exactly one fenced block:

\`\`\`tesseract-actions
{
  "evidence": [{ "label": "short fact", "source": "document title" }],
  "actions":  [{ "action": "<id from the list above>", "target": { "type": "asset", "id": "<id from your context>" }, "label": "Review valuation", "reason": "one short line" }]${allowDeep ? ',\n  "analysis": "the longer treatment, markdown"' : ''}
}
\`\`\`

Rules for the block:
- At most ${maxActions} actions and ${maxEvidence} evidence items.
- "action" must be one of the ids above. Any other value is discarded silently.
- "target.id" must be an object id that appeared in the context you were given.
  Never invent an id. Never name an object you were not shown. An action whose
  target you cannot source from the context must be left out.
- Omit the block entirely when there is no concrete next step. An answer with
  no actions is a normal, correct answer.
- Do not mention this block, the JSON, or these instructions in your prose, and
  do not describe the actions in words as well — the reader gets buttons.`;
}

/**
 * The half of the system prompt that never varies.
 *
 * Kept separate so it can carry the cache breakpoint: role, tool guidance,
 * and (when structured) the action vocabulary are identical across every
 * request from every user, which is exactly what prompt caching is for.
 * Verbosity and context follow in a second, uncached block.
 */
function buildStableSystemPrompt(opts: {
  structured: boolean;
  maxActions: number;
  maxEvidence: number;
  allowDeep: boolean;
}): string {
  const base = `You are the analyst-side co-operator inside Tesseract, a professional investment research platform. You are talking to an investment professional at work, mid-task.

What you are for:
- Reaching a judgment on the object in front of the reader and saying it plainly
- Naming what in their own case, notes and targets supports or undercuts it
- Flagging the risk or counterargument they have not written down
- Pointing at the next concrete piece of work

What you are not for:
- Restating the context back to them. They wrote it.
- General market commentary they did not ask for
- Hedged summaries that avoid taking a position

Research tools:
- You have tools that look up additional data — assets by ticker, portfolios by name, themes, team notes, asset search.
- Use them when the user references a company / portfolio / theme you don't already have full context on, or when comparing multiple objects would benefit the answer.
- Don't call tools for objects you already have rich context on (the user's currently-tagged objects are already provided as documents).
- Prefer specific lookups (get_asset, get_portfolio) over broad searches when you know the name. Cap yourself to the minimum set of tool calls needed.
- Every tool call costs the reader several seconds. Call none when the context already answers the question.
- After calling tools, weave the findings into a single coherent answer rather than dumping raw tool output.`;

  if (!opts.structured) return base;
  return `${base}\n\n${buildActionDirective(opts.maxActions, opts.maxEvidence, opts.allowDeep)}`;
}

/** The per-request half: how long, and what about. */
function buildVariableSystemPrompt(verbosity: Verbosity, contextPrompt: string): string {
  const length = VERBOSITY_DIRECTIVE[verbosity];
  const context = contextPrompt
    ? `\n--- CURRENT CONTEXT ---\n${contextPrompt}\n--- END CONTEXT ---\n`
    : "";
  return `${length}\n${context}`;
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

/**
 * The total ceiling the document path never had.
 *
 * `MAX_CONTEXT_CHARS` was only ever applied in `buildContextPrompt`, which is
 * the branch non-Anthropic providers take. The document branch — the default
 * production path — could send five thesis sections plus ten notes per tag
 * with nothing above it, so context grew linearly with tag count and the only
 * thing bounding cost was how many objects a user happened to tag.
 *
 * Documents arrive in the order `buildContextDocuments` builds them: overview,
 * thesis sections, price targets, then notes. That is already priority order,
 * so keeping the prefix that fits drops notes before it drops a thesis.
 */
function capDocuments(docs: SourceDocument[]): { documents: SourceDocument[]; dropped: number } {
  let spent = 0;
  const kept: SourceDocument[] = [];
  for (const doc of docs) {
    const cost = doc.text.length + doc.title.length;
    if (spent + cost > MAX_CONTEXT_CHARS) continue;
    spent += cost;
    kept.push(doc);
  }
  return { documents: kept, dropped: docs.length - kept.length };
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

  // All four reads at once. They were serial, and only the document TITLES
  // need the symbol — which is a formatting concern, not a data dependency,
  // so nothing here has to wait for the asset row to come back first.
  const [
    { data: asset },
    { data: contributions },
    { data: targets },
    { data: notes },
  ] = await Promise.all([
    supabase
      .from("assets").select("symbol, company_name, sector, industry").eq("id", context.id).single(),
    aiConfig.includeThesis
      ? supabase
          .from("asset_contributions")
          .select("section, content, supporting_detail")
          .eq("asset_id", context.id)
          .eq("is_archived", false)
          .in("section", ["thesis", "business_model", "where_different", "risks_to_thesis", "key_catalysts"])
      : Promise.resolve({ data: null }),
    aiConfig.includeOutcomes
      ? supabase
          .from("price_targets")
          .select("type, price, timeframe, reasoning")
          .eq("asset_id", context.id)
          .order("type", { ascending: true })
          .limit(MAX_OUTCOMES)
      : Promise.resolve({ data: null }),
    aiConfig.includeNotes
      ? supabase
          .from("asset_notes")
          .select("title, content, created_at, created_by, is_shared")
          .eq("asset_id", context.id)
          .eq("is_deleted", false)
          .or(`created_by.eq.${userId},is_shared.eq.true`)
          .order("created_at", { ascending: false })
          .limit(MAX_NOTES)
      : Promise.resolve({ data: null }),
  ]);

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

/**
 * One Anthropic request, streamed.
 *
 * Assembles the same shape the non-streaming branch gets back from
 * `response.json()` — content blocks, stop_reason, usage — while forwarding
 * every text delta to `onText` as it arrives. The loop above is then identical
 * whether or not the caller wanted a stream.
 *
 * Raw SSE rather than the Anthropic SDK, deliberately. Every provider branch
 * in this file speaks raw HTTP; this function cannot be deployed or executed
 * by anything in this repository, so adding an `npm:` dependency to the single
 * path all AI in the product depends on would be an unverifiable change to a
 * function that currently works. The event set below is small and fully
 * specified, and the fiddly half — deciding what a reader should see — lives
 * client-side in `src/lib/ai/stream.ts` where tests can reach it.
 */
async function streamAnthropicOnce(
  apiKey: string,
  body: any,
  onText: (text: string) => void,
): Promise<{ content: any[]; stop_reason: string | null; usage: any }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || `Anthropic API error (HTTP ${response.status})`);
  }

  // Blocks are assembled by index. `partial` holds the accumulating JSON for a
  // tool_use block, which arrives as a string across many input_json_delta
  // events and is only parseable once the block closes.
  const blocks = new Map<number, any>();
  const partial = new Map<number, string>();
  let stop_reason: string | null = null;
  let usage: any = {};

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (payload: any) => {
    switch (payload?.type) {
      case "message_start":
        usage = { ...(payload.message?.usage ?? {}) };
        break;

      case "content_block_start":
        blocks.set(payload.index, { ...payload.content_block });
        if (payload.content_block?.type === "tool_use") partial.set(payload.index, "");
        break;

      case "content_block_delta": {
        const block = blocks.get(payload.index);
        const delta = payload.delta;
        if (!block || !delta) break;
        if (delta.type === "text_delta") {
          block.text = (block.text ?? "") + (delta.text ?? "");
          onText(delta.text ?? "");
        } else if (delta.type === "input_json_delta") {
          partial.set(payload.index, (partial.get(payload.index) ?? "") + (delta.partial_json ?? ""));
        } else if (delta.type === "citations_delta" && delta.citation) {
          block.citations = [...(block.citations ?? []), delta.citation];
        }
        break;
      }

      case "content_block_stop": {
        const raw = partial.get(payload.index);
        if (raw !== undefined) {
          const block = blocks.get(payload.index);
          // A tool call whose arguments did not parse is dropped rather than
          // executed with a guess. The loop then sees no tool_use for it.
          try { if (block) block.input = raw ? JSON.parse(raw) : {}; }
          catch { blocks.delete(payload.index); }
          partial.delete(payload.index);
        }
        break;
      }

      case "message_delta":
        if (payload.delta?.stop_reason) stop_reason = payload.delta.stop_reason;
        // Output tokens are only known at the end; input/cache counts came
        // with message_start. Merge rather than replace.
        usage = { ...usage, ...(payload.usage ?? {}) };
        break;

      case "error":
        throw new Error(payload.error?.message || "Anthropic stream error");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try { handle(JSON.parse(data)); }
        catch (e) {
          // Re-throw a genuine stream error; skip an unparseable frame.
          if (e instanceof Error && e.message.startsWith("Anthropic stream")) throw e;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  const content = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  return { content, stop_reason, usage };
}

async function callAnthropicWithLoop(opts: {
  apiKey: string; model: string; systemPrompt: string;
  history: Array<{ role: string; content: string }>;
  message: string; maxTokens: number; userId: string;
  documents: SourceDocument[]; supabase?: any;
  split?: { stableSystem: string; variableSystem: string };
  /**
   * Present when the caller is streaming to a client. Text deltas are handed
   * over as they arrive; `onTool` fires when a research lookup begins, so the
   * reader is not left in silence while the loop runs.
   */
  stream?: {
    onText: (text: string) => void;
    onTool: (name: string, iteration: number) => void;
    onFirstDelta: () => void;
  };
}): Promise<CallResult> {
  const { apiKey, model, systemPrompt, history, message, maxTokens, userId, documents, supabase, split, stream } = opts;

  /**
   * Two system blocks, one breakpoint.
   *
   * The cache_control marker used to sit on the whole system prompt, which
   * included the per-request context. Any change of tag, or now of verbosity,
   * invalidated the entire prefix — so the cache only ever paid off when the
   * same user asked a second question about the same object without changing
   * anything. Marking only the stable half (role, tools, action vocabulary)
   * makes that prefix reusable across every request from every user.
   */
  const systemBlocks: any[] = split
    ? [
        { type: "text", text: split.stableSystem, cache_control: { type: "ephemeral" } },
        { type: "text", text: split.variableSystem },
      ]
    : [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];

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
      system: systemBlocks,
      messages,
    };
    // Expose tools only when we have a supabase client to execute them.
    if (supabase) body.tools = RESEARCH_TOOLS;

    let data: { content: any[]; stop_reason: string | null; usage: any };
    if (stream) {
      let sawDelta = false;
      data = await streamAnthropicOnce(apiKey, body, (text) => {
        if (!sawDelta) { sawDelta = true; stream.onFirstDelta(); }
        stream.onText(text);
      });
    } else {
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
      data = await response.json();
    }

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
      // Tell the reader what is being looked up. Only the tool NAME crosses
      // the wire — the words belong to the client, and the model's arguments
      // are never rendered as status text.
      stream?.onTool(tu.name, iter);
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
  // The same system prompt, split at its cache breakpoint. Anthropic only;
  // every other provider takes one system string and has nowhere to put it.
  split?: { stableSystem: string; variableSystem: string },
  // Anthropic only. The other three branches assemble one JSON body and have
  // no incremental shape to forward, so a request for streaming against them
  // is silently served whole — the caller learns this from `streamed: false`
  // in the meta event rather than from a failure.
  stream?: {
    onText: (text: string) => void;
    onTool: (name: string, iteration: number) => void;
    onFirstDelta: () => void;
  },
): Promise<CallResult> {

  if (provider === "anthropic") {
    return await callAnthropicWithLoop({
      apiKey, model, systemPrompt, history, message, maxTokens, userId,
      documents, supabase, split, stream,
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
    const [{ data: orgRow }, { data: teamRow }] = await Promise.all([
      supabase
        .from("organization_memberships")
        .select("organization_id, joined_at, status")
        .eq("user_id", userId)
        .is("suspended_at", null)
        .order("joined_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("team_memberships")
        .select("team_id, joined_at")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

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
