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
import { requirePublishableKey } from "../_shared/publishable-key.ts";
import { requireSecretKey } from "../_shared/secret-key.ts";
import { authorizeVerifiedUser } from "../_shared/verified-user.ts";
import { resolveOrgForRequest } from "../_shared/attribution-org.ts";
import {
  type ToolStatus,
  type ToolSourceRef,
  SECTION_LABELS,
  runQuery,
  toolOk,
  toolEmpty,
  toolError,
  buildNoteSearchTerms,
  escapeLike,
  summarizeToolResult,
  peopleMap,
  personLabel,
  resolveStageLabel,
  bucketChecklist,
  /* The cross-asset tools: canonical idea stages, liveness, and the rulings
     that count as answered. All mirrored from `src/lib`, all drift-tested. */
  IDEA_STAGES,
  IDEA_STAGE_LABEL,
  toIdeaStage,
  isLiveIdeaRow,
  DECIDED_DECISION_STATUSES,
} from "../_shared/research-results.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

type AIProvider = 'anthropic' | 'openai' | 'google' | 'perplexity';
type Purpose    = 'chat' | 'column' | 'snippet' | 'analysis';

// ─── Pricing table (USD per 1M tokens) ────────────────────────────────────
interface ModelPricing { in: number; out: number; cache_write?: number; cache_read?: number; }

/*
 * Verified against https://platform.claude.com/docs/en/about-claude/pricing.md
 * on 2026-11-09. Every Anthropic row below is quoted from that page, including
 * the 5-minute cache-write and cache-hit columns, which are per-model and not
 * derivable from the input rate.
 *
 * Three things that check turned up, and each was a live defect:
 *
 *   1. `claude-3-5-sonnet-20241022` RETIRED 2025-10-28 and
 *      `claude-3-5-haiku-20241022` RETIRED 2026-02-19. Neither appears on the
 *      pricing page at all. The first was this function's hardcoded fallback
 *      model AND the value of `platform_ai_config.platform_model` in
 *      production, so switching platform AI on would have sent every request
 *      to a model that no longer exists. Both are gone from here and from the
 *      picker in src/hooks/useAIConfig.ts.
 *
 *   2. Opus 4.7 was priced at $15/$75. It is $5/$25. The table was
 *      over-reporting its cost by 3x, which inflates `estimated_cost`, and
 *      `monthly_budget_usd_per_user` is enforced against that number -- so the
 *      error did not just mis-report, it would have cut users off early.
 *
 *   3. The whole lineup was a generation behind, and the current generation is
 *      CHEAPER at every tier: Sonnet 5.5 is $2/$10 against Sonnet 4.6's
 *      $3/$15, Opus 5.5 is $4/$20 against Opus 4.7's $5/$25, and Haiku 5.5 is
 *      $0.10/$0.50 against Haiku 4.5's $1/$5 -- a tenth of the price for the
 *      column and snippet traffic that routing already sends to Haiku.
 *
 * Previous-generation rows are KEPT, deliberately. They are what the existing
 * org config and the nine historical `ai_usage_log` rows name, and dropping a
 * row silently re-prices history at the provider default.
 *
 * Haiku 5.5 is the one model with tiered pricing: these are the rates for
 * prompts of 100,000 tokens or fewer. Above that every number is 5x. Tesseract
 * clamps `max_tokens_per_request` to 4096 and its largest prompt is a few
 * thousand tokens, so the lower tier always applies here; if that ever stops
 * being true this row under-reports by 5x.
 */
const PRICING: Record<string, ModelPricing> = {
  // Current generation.
  'claude-opus-5-5':               { in: 4,    out: 20,  cache_write: 5,     cache_read: 0.20 },
  'claude-sonnet-5-5':            { in: 2,    out: 10,  cache_write: 2.50,  cache_read: 0.10 },
  'claude-haiku-5-5':              { in: 0.10, out: 0.50, cache_write: 0.125, cache_read: 0.01 },
  // Previous generation, still served and still named by existing config.
  'claude-opus-4-7':               { in: 5,    out: 25,  cache_write: 6.25,  cache_read: 0.50 },
  'claude-sonnet-4-6':             { in: 3,    out: 15,  cache_write: 3.75,  cache_read: 0.30 },
  'claude-haiku-4-5-20251001':     { in: 1,    out: 5,   cache_write: 1.25,  cache_read: 0.10 },
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

/*
 * The model used when nothing else names one.
 *
 * This replaces `"claude-3-5-sonnet-20241022"` written inline in four places,
 * which was a model retired on 2025-10-28. One constant means the next
 * generation is one edit, and it means a stale default cannot survive in a
 * branch nobody reads. Sonnet is the right tier for a default: current, the
 * cheapest of the three general models, and the one the picker recommends.
 */
const DEFAULT_MODEL: Record<AIProvider, string> = {
  anthropic:  'claude-sonnet-5-5',
  openai:     'gpt-4o',
  google:     'gemini-1.5-pro',
  perplexity: 'llama-3.1-sonar-large-128k-online',
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
    if (provider === 'anthropic') return 'claude-haiku-5-5';
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
    /*
     * The publishable key, not the legacy anon key.
     *
     * This client exists only to identify the caller: it carries their own
     * Authorization header and is used for auth.getUser(). It performs no
     * anon-level data access, which is exactly the role a publishable key
     * replaces. The legacy `SUPABASE_ANON_KEY` is being retired.
     *
     * `requirePublishableKey` throws a message naming the variable if it is
     * absent, malformed, or has no `default` entry — inside the handler's
     * existing try/catch, so a misconfiguration surfaces as a server error
     * about configuration rather than as a confusing 401 later. The previous
     * `?? ""` would have built a client with an empty key and failed at the
     * first request instead.
     */
    const supabasePublishableKey = requirePublishableKey((n) => Deno.env.get(n));
    const platformApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const platformOpenAIKey = Deno.env.get("OPENAI_API_KEY");
    const platformGoogleKey = Deno.env.get("GOOGLE_AI_API_KEY");
    const platformPerplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

    // Unchanged: the caller's Authorization header is forwarded, so the
    // client remains scoped to that user and RLS applies as before.
    const supabase = createClient(supabaseUrl, supabasePublishableKey, {
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

    /*
     * The shared gate, with the JWT passed EXPLICITLY.
     *
     * This used to be a bare `supabase.auth.getUser()`, which reads the auth
     * client's own session store rather than the forwarded Authorization
     * header. An Edge Function never has a session store. It worked here only
     * because this bundle's `@supabase/supabase-js@2` resolved to a version
     * that sets `hasCustomAuthorizationHeader`, while market-news and
     * market-events -- pinned to 2.39.0, which predates that flag -- answered
     * 401 to every caller for two weeks. yahoo-chart-proxy v10 then refused
     * every caller for the same reason after a redeploy moved its transitive
     * gotrue-js. See _shared/verified-user.ts for both measurements.
     *
     * In other words this function was one redeploy away from the same
     * outage, and nothing about its own source would have changed. The
     * explicit form depends on no flag, no stored session and no library
     * version.
     *
     * It also separates "you are not signed in" (401) from "this function's
     * own key is disabled" (503), which were both spelled 401 before and are
     * the reason that outage took two weeks to find.
     */
    const auth = await phase("auth", () => authorizeVerifiedUser(authHeader, supabase));
    if (!auth.ok) {
      if (auth.status === 503) console.error("ai-chat auth misconfigured:", auth.reason);
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const user = auth.user;

    // ─── Pre-flight fan-out ────────────────────────────────────────────
    // Attribution, config and usage were five serial round-trips against the
    // same database, and none of the three needs another's answer. The one
    // real dependency — org config keys off the org id — stays inside
    // getEffectiveAIConfig, which is why attribution is awaited first and the
    // other two run alongside it.
    const attribution = await phase("attribution", () => resolveAttribution(supabase, user.id));

    /*
     * The ONLY privileged client in this function, and it is constructed here
     * on purpose: after the caller is verified and after their organization
     * has been derived from server-side data. A denied request returns above
     * and never reaches this line, so it causes zero privileged side effects
     * (Standing Rule 6, "authorize BEFORE constructing any service_role
     * client").
     *
     * It exists for exactly one call: `resolve_org_ai_config`, which reads the
     * org's provider key out of `vault.secrets`. That function is granted to
     * `service_role` and to nothing else, which is the whole point -- the key
     * used to sit in a column an org admin could SELECT and behind an RPC any
     * org MEMBER could execute. Everything else in this function, including
     * every read the model's tools make, still goes through `supabase`, the
     * caller's own RLS-scoped client.
     *
     * The org id passed in is `attribution.organizationId`, never anything
     * from the request body. A client-supplied org id here would hand any
     * signed-in user any firm's key.
     */
    const adminClient = createClient(
      supabaseUrl,
      requireSecretKey((n) => Deno.env.get(n)),
      { auth: { persistSession: false } },
    );

    const [configResult, usage] = await phase("preflight", () => Promise.all([
      getEffectiveAIConfig(
        supabase,
        adminClient,
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
  /**
   * A `service_role` client, and the only thing in this function that uses
   * one. Required because `resolve_org_ai_config` is granted to service_role
   * alone; the caller's own client gets 42501 there, which is the fix.
   */
  adminClient: any,
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

  // BYOK is org-scoped: each firm has at most one config, only org admins can
  // write it, all members can use it. The org id comes from `organizationId`,
  // which the caller-scoped client derived from this verified user's active
  // organization_memberships row -- never from the request body.
  //
  // The key is not on this table at all any more; it is in vault.secrets, and
  // `resolve_org_ai_config` is the only thing that can read it back.
  //
  // That RPC does NOT check membership, and must not be described as if it
  // did. It takes an org id and returns that org's key to whoever can execute
  // it, which is `service_role` and nothing else -- revoked from public, anon
  // AND authenticated. The grant IS the authorization. The predecessor,
  // `get_org_ai_config_for_resolution`, was EXECUTE-granted to
  // `authenticated`, which is exactly how every active member of an org could
  // retrieve their firm's plaintext Anthropic key from the browser.
  //
  // So the caller check that matters happens HERE, above: authorizeVerifiedUser
  // first, then attribution, and only then the privileged client. Changing
  // that order reopens the hole even though the SQL is unchanged.
  let orgConfig: { byok_provider?: string | null; byok_api_key?: string | null;
                   byok_model?: string | null; byok_enabled?: boolean } | null = null;
  if (organizationId) {
    const { data: rows, error: resolveError } = await adminClient
      .rpc("resolve_org_ai_config", { p_org_id: organizationId });
    // A refused resolution must not read as "this org has no key": that would
    // silently fall through to the unconfigured branch and tell the user to go
    // add a key they already added. Log it and let isConfigured stay false,
    // which produces the configuration error below rather than a wrong one.
    if (resolveError) console.error("ai-chat: resolve_org_ai_config failed:", resolveError.message);
    orgConfig = (rows && rows[0]) ? rows[0] : null;
  }

  const preferences = {
    includeThesis: userConfig?.include_thesis ?? true,
    includeOutcomes: userConfig?.include_outcomes ?? true,
    includeNotes: userConfig?.include_notes ?? true,
    includeDiscussions: userConfig?.include_discussions ?? false
  };

  /*
   * ── Resolution ORDER, not a mutually exclusive ladder ─────────────────
   *
   * This used to read `if (platform_ai_enabled) ... else if (byok) ...`, and
   * that shape held two defects that only appear the day platform AI is
   * switched on:
   *
   *   1. Turning the platform flag on SILENTLY DISABLED every org's own key.
   *      An org paying for its own Anthropic account would have been moved
   *      onto the platform's bill without being asked.
   *   2. Turning the flag on with no platform key deployed produced
   *      `mode: "platform", apiKey: null, isConfigured: false` and stopped
   *      consulting BYOK at all -- so a tenant whose key worked a minute ago
   *      got "AI not configured. Please add your API key" about a key that is
   *      sitting right there. Measured as the live state on 2026-11-09: the
   *      flag is false AND no ANTHROPIC_API_KEY secret exists, so flipping
   *      the flag alone would have produced exactly this.
   *
   * So it is now an order with fallback. An org that has configured its own
   * key keeps using it; everyone else gets the platform; a platform that is
   * enabled but unconfigured falls through instead of stranding the tenant.
   * That is "platform by default, BYOK as an optional override" with no
   * second code path and nothing enabled here.
   */
  const platformProvider = platformConfig?.platform_provider || "anthropic";
  const platformKey = platformConfig?.platform_ai_enabled
    ? platformKeys[platformProvider as keyof typeof platformKeys]
    : undefined;

  let aiConfig: any;
  if (platformConfig?.allow_byok && orgConfig?.byok_enabled && orgConfig?.byok_api_key) {
    // Model resolution: user preference → org default → hardcoded fallback.
    // Per-user override lets one user pick Opus while another picks Haiku
    // against the same org BYOK key.
    aiConfig = {
      mode: "byok",
      provider: orgConfig.byok_provider || "anthropic",
      model: userConfig?.preferred_model || orgConfig.byok_model || DEFAULT_MODEL.anthropic,
      apiKey: orgConfig.byok_api_key,
      isConfigured: true,
      ...preferences
    };
  } else if (platformKey) {
    aiConfig = {
      mode: "platform",
      provider: platformProvider,
      model: userConfig?.preferred_model || platformConfig.platform_model || DEFAULT_MODEL.anthropic,
      apiKey: platformKey,
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
 * How an answer is presented.
 *
 * MIRRORED from `src/lib/ai/answer-format.ts`, which builds this exact string
 * from its own parts. That file is the source of truth and is where the
 * reasoning lives; `src/lib/ai/__tests__/answer-format.test.ts` compares the
 * two and fails on any divergence.
 *
 * It is mirrored rather than imported because an Edge Function cannot import
 * from `src`. It is a separate constant rather than inline prose because the
 * client has to be able to assert that it can RENDER what this asks for: the
 * ticker spelling here is the one `preprocessTickers` turns into a link, and
 * the signed-figure rule is the one `figures` uses to decide what gets a
 * direction colour. A quiet disagreement there produces answers that read
 * perfectly and navigate nowhere.
 *
 * It sits in the stable half of the prompt, so it is cached: it is identical
 * for every request from every user.
 */
const PRESENTATION_CONTRACT = `HOW TO WRITE THE ANSWER

Three kinds of claim, and a reader must be able to tell them apart:
- A fact from a record names the record it came from, inline: "the thesis (updated 4 Nov) says".
- Your own inference is marked as yours: "my read is", "this suggests". Never phrased as something the records state.
- What you looked for and did not find goes in a blockquote, last, one line each. Say what was searched. Never pad it, and never include it when there is nothing missing.

Figures:
- Write a change with its sign: +4.2%, -180bps. Write a level without one: 4.2%, 18.5x.
- Keep the unit you were given. Do not convert, round further or rescale a figure from a record.
- Never write a number that is not in a record or derivable from one in a stated step.
- Write a company as its ticker in the form $AAPL so the reader can open it.

Tables:
- Use a table only to compare three or more objects on the same attributes. Two objects are a sentence.
- A column must hold figures or short labels, never sentences. A table of prose is a list with extra lines.
- Keep figures in their own columns so they align for comparison down the column.

Shape. These are the forms available, not a template to fill in:
- plain prose: the default, and correct for almost every question
- a short list: three or more parallel items that are genuinely parallel
- headings: the answer has more than one subject; never on a single-subject answer
- a table: three or more objects compared on the same attributes
- a leading summary: only when the answer runs long enough that the judgment would otherwise arrive late

Do not apply a fixed skeleton to every question. An answer whose shape is the same whatever was asked carries no information in its shape.`;

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
depth means more substance, not more words around the same substance.

This is the one length where a leading summary earns its place: at this
length the judgment would otherwise arrive after the reader has already
scrolled. Two or three lines, the judgment and what rests on it, then the
body. Not a list of the sections below it: a contents page is not a summary.`,
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
- You have tools that look up additional data — assets by ticker, portfolios by name, themes, team notes, asset search, the decision record for an asset (get_decisions), and the research processes running on an asset (get_workflows).
- You also have five tools that read ACROSS assets rather than about one: get_watchlists (the reader's own lists and what is on them), get_coverage (who covers what), get_idea_pipeline (live ideas and how mature each is), get_pending_decisions (recommendations awaiting a ruling), get_outstanding_work (research processes with open requirements). Use these for "what is in my pipeline", "what is on my watchlist", "what needs a decision", "what is overdue", "what should I look at" — questions about the reader's work rather than about a company. Do not answer those from a single-asset tool, and do not say you cannot see those parts of the product.
- Use them when the user references a company / portfolio / theme you don't already have full context on, or when comparing multiple objects would benefit the answer.
- Don't call tools for objects you already have rich context on (the user's currently-tagged objects are already provided as documents).
- Prefer specific lookups (get_asset, get_portfolio) over broad searches when you know the name. Cap yourself to the minimum set of tool calls needed.
- Every tool call costs the reader several seconds. Call none when the context already answers the question.
- After calling tools, weave the findings into a single coherent answer rather than dumping raw tool output.

Every tool result carries a "status". Honour it exactly:
- status "ok" — records were returned. You may cite them. Refer only to records actually present in the result.
- status "empty" — the search RAN and matched nothing. Say that no MATCHING records were found, and say what was searched (the result's "searched" field tells you). Never widen this into "the firm has no research on X" or "nothing has been written" — you only know that this query matched nothing.
- status "error" — the search DID NOT RUN. You do not know whether records exist. Say the lookup failed and that the answer is therefore incomplete. NEVER report an error as an absence of records, and never silently omit it.

Every "ok" and "empty" result also carries a "visibility" object, and it governs what you are allowed to conclude. Every query runs AS THE READER, so records they may not read are not returned and not counted: at the data layer "there are none" and "there are none you may see" are the same observation. The result tells you which one you have.
- visibility.scope "organization" — the lookup spans the reader's active organization. Only here may an empty result be reported as a fact about the firm, and even then say "in your organization", because another organization is out of scope.
- visibility.scope "caller_visible" — organization-wide EXCEPT for records a sharing or membership rule withholds. Say "none visible to you". Never "none exist", never "the firm has none", never "there are no X".
- visibility.scope "caller" — only what the reader owns or was given. Says almost nothing about the organization. Say "none of yours".
In both of the latter two cases "visibility.excludes" names what the lookup could not see. When the reader might reasonably think the answer is complete, say what was outside it in one short clause — for example "none awaiting your ruling, though this only covers portfolios you are on the team of". An "empty" result also carries "absence_rule" spelling this out for that specific lookup; follow it. A partial "ok" result is the same trap: if visibility is not "organization", do not present the records you got as the complete set.
Never describe this as a permissions error or suggest the reader lacks access to something they asked about. It is a statement about the lookup's reach, not an accusation.

get_idea_pipeline reports MATURITY. Its four stages (exploring, researching, developing, ready_to_recommend) say how well understood an idea is and nothing else. They do NOT say whether a recommendation was submitted, whether a PM ruled, or whether anything traded — that is get_pending_decisions and get_decisions. Never report a pipeline stage as a decision or as an outcome. "stored_stage" is the raw column and may hold an older vocabulary; quote "stage_label", not "stored_stage". Honour "finished_ideas_excluded" if the reader asks about completed work: those ideas exist, they are just not live.

get_pending_decisions is the narrowest-reaching tool you have: it sees only requests the reader raised or that sit on portfolios they are on the team of. An empty result there must be reported as "nothing awaiting a ruling that is visible to you". When "idea_visible" is false the recommendation is readable but the idea behind it is not, so describe the request and say its underlying idea is not visible rather than inventing its contents.

get_decisions returns FOUR separate kinds of record and they must never be merged:
- A "recommendation" is what an analyst proposed. It is not a decision.
- A "pm_ruling" is the PM's answer to a recommendation. Its "status" is the decision: pending, under_review, needs_discussion, accepted, accepted_with_modification, rejected, deferred or withdrawn. An accepted ruling does NOT mean a trade happened.
- A "committed_trade" is a Trade Book row, the only object that represents a committed trade. Its "execution_status" says whether it was actually executed, so a committed trade at "not_started" has NOT been traded. Check "is_active" and "reverted_at" before treating one as live.
- "decision_reviews" and "price_target_outcomes" are retrospective judgements, not decisions.
Use the explicit id fields (recommendation_id, pm_ruling_id, committed_trade_id) to state how records link. Do not infer a link that is not in those fields. Zero committed_trades means none are visible to this user, never that none exist.

get_workflows reports process state. When "current_stage_unresolved" or "stage_unresolved" is true, the stored stage does not match any stage in that workflow: say the stage is unrecorded rather than naming one. Honour "open_requirements_truncated" by saying more remain than are listed.

Never state or imply that you have reviewed everything available. You have seen only what these results contain. If a question needs a record type you have no tool for (meeting notes, emails), say so plainly rather than answering from the records you do have.

${PRESENTATION_CONTRACT}`;

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
          .select("id, section, content, supporting_detail, updated_at, created_at")
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
          .select("id, title, content, created_at, updated_at, created_by, is_shared")
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
    docs.push({
      title: `${symbol} overview`, text: overview,
      kind: "asset", id: context.id, asset_id: context.id, symbol: asset.symbol,
    });
  }

  if (aiConfig.includeThesis) {
    const bySection = new Map<string, any>();
    for (const c of (contributions || [])) {
      if (!bySection.has(c.section)) bySection.set(c.section, c);
    }
    for (const [sec, label] of Object.entries(SECTION_LABELS)) {
      const c = bySection.get(sec);
      if (!c?.content) continue;
      const text = c.supporting_detail
        ? `${truncate(c.content, MAX_THESIS_CHARS)}\n\n${truncate(c.supporting_detail, 600)}`
        : truncate(c.content, MAX_THESIS_CHARS);
      docs.push({
        title: `${symbol} · ${label}`, text,
        kind: "contribution", id: c.id, asset_id: context.id, symbol: asset?.symbol ?? null,
        timestamp: c.updated_at ?? c.created_at ?? null,
      });
    }
  }

  if (aiConfig.includeOutcomes) {
    if (targets?.length) {
      const lines = targets.map((t: any) =>
        `${(t.type || "").toUpperCase()}: $${t.price ?? "—"}` +
        (t.timeframe ? ` (${t.timeframe})` : "") +
        (t.reasoning ? ` — ${truncate(t.reasoning, 200)}` : "")
      ).join("\n");
      // One document for the set: a price target is a few numbers, and the
      // reader opens the asset's targets view, not an individual row.
      docs.push({
        title: `${symbol} · Price targets`, text: lines,
        kind: "price_target", id: context.id, asset_id: context.id,
        symbol: asset?.symbol ?? null,
      });
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
        docs.push({
          title, text: truncate(body, MAX_NOTE_CHARS * 4),
          kind: "note", id: n.id, asset_id: context.id, symbol: asset?.symbol ?? null,
          timestamp: n.updated_at ?? n.created_at ?? null,
        });
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
  /** Provenance copied from the cited document, so the UI can link to it. */
  kind?:       ToolSourceRef["kind"];
  document_id?: string;
  asset_id?:   string | null;
  symbol?:     string | null;
  timestamp?:  string | null;
}

interface ToolCall {
  name:   string;
  input:  Record<string, unknown>;
  /**
   * Was this a hit, a genuine miss, or a search that never ran? The browser
   * renders three different sentences and must not guess between them.
   */
  status?: ToolStatus;
  /** What was looked at, in words, for the "no matches" case. */
  searched?: string;
  result_count?: number;
  /** The records consulted, with ids so the panel can link to them. */
  sources?: ToolSourceRef[];
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
  /*
   * Provenance, so a citation can be opened rather than only read.
   *
   * These documents are what Anthropic's citation feature cites, and a
   * citation carried only a title -- enough to print, not enough to navigate
   * to. The id travels with the document and back out through the citation.
   */
  kind?: ToolSourceRef["kind"];
  id?: string;
  asset_id?: string | null;
  symbol?: string | null;
  timestamp?: string | null;
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
  {
    name: "get_decisions",
    description:
      "Look up the decision record for one asset by ticker: analyst recommendations and the " +
      "context they were submitted with, the PM's ruling on each (pending, under review, needs " +
      "discussion, accepted, accepted with modification, rejected, deferred or withdrawn), the " +
      "committed trades in the Trade Book with their execution and reconciliation state, and any " +
      "decision reviews or price-target outcomes. These are FOUR SEPARATE STAGES and the result " +
      "keeps them separate: a recommendation is not a ruling, a ruling is not a committed trade, " +
      "and a committed trade is not an executed one. Use this when the user asks what was " +
      "decided, recommended, approved, traded or how a past decision turned out.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol like AAPL (case-insensitive)." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_workflows",
    description:
      "Look up the research processes running on one asset by ticker: each workflow the asset is " +
      "in, the stage it currently sits at, how many checklist requirements are done versus open, " +
      "the open requirements themselves, who is assigned, and any stage deadlines. Use this when " +
      "the user asks what work remains, what is outstanding, where a name is in the process, who " +
      "owns it, or what is due.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol like AAPL (case-insensitive)." },
      },
      required: ["symbol"],
    },
  },

  /* ── Cross-asset: the questions the assistant could not answer ─────────
   *
   * Everything above takes a ticker. So "what is in my pipeline", "what is on
   * my watchlists" and "what needs my decision" had no tool at all, and the
   * assistant answered them by saying it could not see those parts of the
   * product. It could not: there was nothing to call.
   *
   * Each of these runs on the same caller-scoped client as the rest, and each
   * declares its reach in `TOOL_VISIBILITY` so an empty answer is reported as
   * "none visible to you" rather than as a fact about the firm.
   */
  {
    name: "get_watchlists",
    description:
      "List the reader's own watchlists and coverage lists, and the assets on them. Returns each " +
      "list with its name, what kind of list it is, how many assets it holds, and the tickers, " +
      "plus any flagged items, assignees and due dates on those entries. Use this when the user " +
      "asks what is on their watchlist or lists, what they are tracking, or what they put on a " +
      "list. IMPORTANT: this sees only lists the reader created or that were shared with them " +
      "directly, never the organization's other lists, so an empty result means none of THEIRS, " +
      "not that the firm keeps no lists.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Optional. Only lists whose name contains this text. Omit to get all of the reader's lists.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_coverage",
    description:
      "Look up who covers which assets. With no argument, returns the reader's own coverage " +
      "assignments; with `scope` set to 'organization', the whole desk's. Each row carries the " +
      "asset, the analyst, their role, whether they are the lead, and since when. Use this when " +
      "the user asks what they cover, who covers a name, or what is on their plate. This path is " +
      "genuinely organization-wide, so an empty result does mean there are no coverage " +
      "assignments in the reader's active organization.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["mine", "organization"],
          description: "'mine' (default) for the reader's own assignments, 'organization' for the desk's.",
        },
        symbol: {
          type: "string",
          description: "Optional ticker, to ask who covers one name.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_idea_pipeline",
    description:
      "The Idea Pipeline: live investment ideas and how mature each one is. Returns ideas grouped " +
      "by their canonical stage (exploring, researching, developing, ready to recommend) with the " +
      "ticker, the action proposed, conviction, who owns it, how long it has sat in its stage, " +
      "and its rationale. Use this when the user asks what is in their pipeline, what they are " +
      "working on, what ideas are in flight, or what is ready to recommend. The pipeline measures " +
      "MATURITY and stops at ready-to-recommend: whether a recommendation was submitted, ruled on " +
      "or traded is a separate record, so use get_pending_decisions or get_decisions for that and " +
      "never report a pipeline stage as a decision.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["mine", "organization"],
          description:
            "'mine' (default) for ideas the reader created or is assigned, 'organization' for every idea visible to them.",
        },
        stage: {
          type: "string",
          enum: ["exploring", "researching", "developing", "ready_to_recommend"],
          description: "Optional. Only ideas at this canonical stage.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_pending_decisions",
    description:
      "Recommendations awaiting a ruling: the Decision Inbox. Returns each open request with the " +
      "asset, the portfolio, who raised it, what they proposed, how long it has been waiting, and " +
      "its current status. Use this when the user asks what needs a decision, what is awaiting " +
      "their ruling, what is in their inbox, or what is pending. IMPORTANT: this sees only " +
      "requests the reader raised or that sit on portfolios they are on the team of. An empty " +
      "result means none are visible to them, NOT that the desk has none pending.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Optional ticker, to narrow to one name." },
      },
      required: [],
    },
  },
  {
    name: "get_outstanding_work",
    description:
      "Open research work across assets, rather than on one name. Returns the research processes " +
      "that are running with open requirements, the stage each sits at, what is still open, who " +
      "is assigned and anything past its deadline. Use this when the user asks what is " +
      "outstanding, overdue or incomplete across their coverage or the desk, or what they should " +
      "pick up. For one asset, prefer get_workflows. This path is organization-wide.",
    input_schema: {
      type: "object",
      properties: {
        overdue_only: {
          type: "boolean",
          description: "Optional. Only work whose stage deadline has passed.",
        },
        limit: {
          type: "number",
          description: "Optional. How many processes to return, default 15.",
        },
      },
      required: [],
    },
  },
] as const;

/*
 * The result contract -- three outcomes, never two -- lives in
 * `_shared/research-results.ts`, with the reasoning for why a failed query
 * must never render as an empty one. It is kept out of this file so the unit
 * suite can drive it: the property that matters here is behavioural, and the
 * old shape passed every static check while telling users the firm had no
 * research.
 */
async function executeResearchTool(
  supabase: any,
  userId: string,
  name: string,
  input: Record<string, any>,
): Promise<string> {
  try {
    if (name === "get_asset") {
      const sym = String(input.symbol || "").trim().toUpperCase();
      if (!sym) return toolError("get_asset", "missing_symbol");

      const found = await runQuery<any>("get_asset", "asset",
        supabase
          .from("assets").select("id, symbol, company_name, sector, industry, current_price, market_cap")
          .ilike("symbol", sym).maybeSingle());
      if (found.failed) return toolError("get_asset", "asset");
      const asset = found.data;
      if (!asset) return toolEmpty("get_asset", { symbol: sym, looked_in: "assets" });

      const [contribs, targets, notes] = await Promise.all([
        runQuery<any[]>("get_asset", "contributions",
          supabase.from("asset_contributions").select("id, section, content, updated_at, created_at")
            .eq("asset_id", asset.id).eq("is_archived", false)
            .in("section", ["thesis", "business_model", "where_different", "risks_to_thesis", "key_catalysts"])),
        runQuery<any[]>("get_asset", "price_targets",
          supabase.from("price_targets").select("id, type, price, timeframe, reasoning, created_at")
            .eq("asset_id", asset.id).limit(5)),
        // `content_excerpt` is a COMPUTED COLUMN (migration 20261111090000):
        // Postgres truncates, we receive the excerpt. PostgREST does not allow
        // an expression in `select`, and selecting `content` pulled a
        // 2,020,708-character note on every AAPL lookup to print 400 of it.
        // A computed column is evaluated per returned row, so it sees exactly
        // the rows RLS already allowed -- it widens nothing.
        runQuery<any[]>("get_asset", "notes",
          supabase.from("asset_notes")
            .select("id, title, created_at, updated_at, is_shared, content_excerpt")
            .eq("asset_id", asset.id).eq("is_deleted", false)
            .or(`created_by.eq.${userId},is_shared.eq.true`)
            .order("created_at", { ascending: false }).limit(5)),
      ]);

      // Any failed stage makes the whole answer untrustworthy. Naming the
      // stage beats returning three quarters of an answer as if it were whole.
      const badStage = contribs.failed ? "contributions"
        : targets.failed ? "price_targets"
        : notes.failed ? "notes"
        : null;
      if (badStage) return toolError("get_asset", badStage);

      const sections: Record<string, { id: string; text: string; updated_at: string | null }> = {};
      for (const c of (contribs.data || [])) {
        if (!sections[c.section]) {
          sections[c.section] = {
            id: c.id,
            text: truncate(c.content, 1500),
            updated_at: c.updated_at ?? c.created_at ?? null,
          };
        }
      }
      return toolOk("get_asset", {
        asset_id: asset.id,
        symbol: asset.symbol,
        company: asset.company_name,
        sector: asset.sector,
        industry: asset.industry,
        current_price: asset.current_price,
        sections,
        price_targets: (targets.data || []).map((t: any) => ({
          id: t.id, type: t.type, price: t.price, timeframe: t.timeframe,
          reasoning: truncate(t.reasoning, 200), created_at: t.created_at ?? null,
        })),
        recent_notes: (notes.data || []).map((n: any) => ({
          id: n.id, asset_id: asset.id, symbol: asset.symbol,
          date: n.created_at?.slice(0, 10), title: n.title,
          excerpt: n.content_excerpt ?? "", is_shared: !!n.is_shared,
          updated_at: n.updated_at ?? n.created_at ?? null,
        })),
      });
    }

    if (name === "search_assets") {
      const q = String(input.query || "").trim();
      if (!q) return toolError("search_assets", "missing_query");
      const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const got = await runQuery<any[]>("search_assets", "search",
        supabase
          .from("assets").select("id, symbol, company_name, sector, industry")
          .or(`symbol.ilike.%${escaped}%,company_name.ilike.%${escaped}%,sector.ilike.%${escaped}%`)
          .limit(10));
      if (got.failed) return toolError("search_assets", "search");
      const rows = got.data || [];
      if (rows.length === 0) return toolEmpty("search_assets", { query: q, looked_in: "assets" });
      return toolOk("search_assets", {
        query: q,
        results: rows.map((a: any) => ({
          asset_id: a.id, symbol: a.symbol, company: a.company_name,
          sector: a.sector, industry: a.industry,
        })),
      });
    }

    if (name === "get_portfolio") {
      const ref = String(input.name_or_id || "").trim();
      if (!ref) return toolError("get_portfolio", "missing_name_or_id");
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
      const q = supabase.from("portfolios").select("id, name, description, updated_at, created_at");
      const found = await runQuery<any>("get_portfolio", "portfolio",
        isUuid ? q.eq("id", ref).maybeSingle() : q.ilike("name", ref).limit(1).maybeSingle());
      if (found.failed) return toolError("get_portfolio", "portfolio");
      const pf = found.data;
      if (!pf) return toolEmpty("get_portfolio", { name_or_id: ref, looked_in: "portfolios" });

      const held = await runQuery<any[]>("get_portfolio", "holdings",
        supabase
          .from("portfolio_holdings")
          .select("id, weight, asset:assets(id, symbol, company_name, sector)")
          .eq("portfolio_id", pf.id)
          .order("weight", { ascending: false }).limit(15));
      if (held.failed) return toolError("get_portfolio", "holdings");
      const holdings = held.data || [];

      const sectorMap: Record<string, number> = {};
      for (const h of holdings as any[]) {
        const sec = h.asset?.sector || "Unknown";
        sectorMap[sec] = (sectorMap[sec] || 0) + (Number(h.weight) || 0);
      }
      return toolOk("get_portfolio", {
        portfolio_id: pf.id,
        name: pf.name,
        description: pf.description,
        updated_at: pf.updated_at ?? pf.created_at ?? null,
        holdings_returned: holdings.length,
        top_holdings: holdings.map((h: any) => ({
          asset_id: h.asset?.id, symbol: h.asset?.symbol, company: h.asset?.company_name,
          sector: h.asset?.sector, weight_pct: h.weight,
        })),
        sector_breakdown: Object.entries(sectorMap)
          .sort((a, b) => b[1] - a[1])
          .map(([sec, w]) => ({ sector: sec, weight_pct: Number(w.toFixed(2)) })),
      });
    }

    if (name === "get_theme") {
      const ref = String(input.name_or_id || "").trim();
      if (!ref) return toolError("get_theme", "missing_name_or_id");
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
      const q = supabase.from("themes").select("id, name, description, updated_at, created_at");
      const found = await runQuery<any>("get_theme", "theme",
        isUuid ? q.eq("id", ref).maybeSingle() : q.ilike("name", ref).limit(1).maybeSingle());
      if (found.failed) return toolError("get_theme", "theme");
      const th = found.data;
      if (!th) return toolEmpty("get_theme", { name_or_id: ref, looked_in: "themes" });

      // `theme_assets`, not `asset_themes`. The latter does not exist
      // (`to_regclass` returns NULL), and because the error was discarded this
      // tool reported "no constituents" for every theme ever looked up while
      // 20 rows sat in the real table.
      const members = await runQuery<any[]>("get_theme", "constituents",
        supabase
          .from("theme_assets").select("id, asset:assets(id, symbol, company_name, sector)")
          .eq("theme_id", th.id).limit(25));
      if (members.failed) return toolError("get_theme", "constituents");
      const constituents = members.data || [];

      return toolOk("get_theme", {
        theme_id: th.id,
        name: th.name,
        description: th.description,
        updated_at: th.updated_at ?? th.created_at ?? null,
        constituents_returned: constituents.length,
        constituents: constituents.map((c: any) => ({
          asset_id: c.asset?.id, symbol: c.asset?.symbol,
          company: c.asset?.company_name, sector: c.asset?.sector,
        })),
      });
    }

    if (name === "search_team_notes") {
      const q = String(input.query || "").trim();
      const sym = String(input.asset_symbol || "").trim().toUpperCase();
      if (!q) return toolError("search_team_notes", "missing_query");

      /*
       * ── Why this is not one ILIKE ────────────────────────────────────────
       *
       * It used to be: `title.ilike.%<the entire query>%`. The model writes
       * keyword-ish queries, so the live failure was a search for
       * "AAPL Apple thesis risk decision" asking for notes containing that
       * exact 31-character phrase. Zero notes matched; the user was told the
       * firm had written nothing about AAPL while seven notes sat on it.
       *
       * The opposite extreme is as bad: ORing every word returns every note
       * containing "the". So: try the PHRASE first, which is precise and is
       * what a quoted search should do, and only fall back to terms. Terms
       * are stopword-filtered, deduped, and capped by `buildNoteSearchTerms`
       * (tested in `_shared/research-results.ts`), and each row reports WHICH
       * terms it matched so the model can weigh relevance rather than treat
       * ten loose hits as ten findings.
       */
      const terms = buildNoteSearchTerms(q);

      let assetId: string | null = null;
      if (sym) {
        const a = await runQuery<any>("search_team_notes", "asset_scope",
          supabase.from("assets").select("id").ilike("symbol", sym).maybeSingle());
        if (a.failed) return toolError("search_team_notes", "asset_scope");
        assetId = a.data?.id ?? null;
        // A symbol that resolves to nothing is an empty scope, not a reason to
        // silently search every asset -- that would answer a different question.
        if (!assetId) return toolEmpty("search_team_notes", { query: q, asset_symbol: sym, looked_in: "assets" });
      }

      // Visibility stays exactly as it was: own notes, plus notes explicitly
      // shared. RLS scopes the organization on top of this; the two or= params
      // are ANDed by PostgREST, so neither replaces the other.
      const base = () => {
        let qb = supabase.from("asset_notes")
          .select("id, asset_id, title, created_at, updated_at, is_shared, content_excerpt, asset:assets(id, symbol)")
          .eq("is_deleted", false)
          .or(`created_by.eq.${userId},is_shared.eq.true`);
        if (assetId) qb = qb.eq("asset_id", assetId);
        return qb.order("created_at", { ascending: false }).limit(10);
      };

      const phrase = escapeLike(q);
      const byPhrase = await runQuery<any[]>("search_team_notes", "phrase",
        base().or(`title.ilike.%${phrase}%,content.ilike.%${phrase}%`));
      if (byPhrase.failed) return toolError("search_team_notes", "phrase");

      let rows = byPhrase.data || [];
      let strategy: "phrase" | "terms" = "phrase";

      if (rows.length === 0 && terms.length > 0) {
        const clause = terms
          .map((t) => `title.ilike.%${escapeLike(t)}%,content.ilike.%${escapeLike(t)}%`)
          .join(",");
        const byTerms = await runQuery<any[]>("search_team_notes", "terms", base().or(clause));
        if (byTerms.failed) return toolError("search_team_notes", "terms");
        rows = byTerms.data || [];
        strategy = "terms";
      }

      const searched = {
        query: q,
        ...(sym ? { asset_symbol: sym } : {}),
        terms_used: strategy === "terms" ? terms : [q],
        scope: assetId ? `notes on ${sym}` : "all notes visible to you",
      };
      if (rows.length === 0) return toolEmpty("search_team_notes", searched);

      return toolOk("search_team_notes", {
        ...searched,
        match_strategy: strategy,
        results_returned: rows.length,
        results: rows.map((n: any) => {
          const hay = `${n.title ?? ""} ${n.content_excerpt ?? ""}`.toLowerCase();
          return {
            id: n.id,
            asset_id: n.asset_id ?? n.asset?.id ?? null,
            symbol: n.asset?.symbol ?? null,
            date: n.created_at?.slice(0, 10),
            updated_at: n.updated_at ?? n.created_at ?? null,
            title: n.title,
            excerpt: n.content_excerpt ?? "",
            is_shared: !!n.is_shared,
            // Which of the terms actually appear in what we returned. A row
            // matching one loose term is not the same evidence as one matching
            // four, and only the model can judge that -- so tell it.
            matched_terms: strategy === "terms" ? terms.filter((t) => hay.includes(t)) : [q],
          };
        }),
      });
    }

    /*
     * ── get_decisions ────────────────────────────────────────────────────
     *
     * The decision chain, kept in four pieces because it IS four pieces:
     *
     *   trade_queue_items   an analyst's recommendation, with its rationale
     *          |            and the stage it reached
     *          v
     *   decision_requests   the formal ask put to the PM, and the PM's ruling
     *          |            (pending / under_review / needs_discussion /
     *          |             accepted / accepted_with_modification /
     *          |             rejected / deferred / withdrawn)
     *          v
     *   accepted_trades     the committed Trade Book row -- the ONLY object
     *          |            that represents a committed trade -- carrying its
     *          |            own execution_status and reconciliation_status
     *          v
     *   decision_reviews    how it was judged afterwards, keyed by the
     *   price_target_...    recommendation id; outcomes keyed by the asset
     *
     * Collapsing these is the error this tool exists to prevent. "We decided
     * to buy AAPL" is true of an accepted PM ruling and false of a Trade Book
     * row still at execution_status 'not_started'. The payload therefore uses
     * four named arrays and never a merged "decisions" list, and every row
     * carries the foreign ids so the model can state the links rather than
     * assume them.
     *
     * One honesty limit, stated in `searched` and unavoidable from inside the
     * caller's own client: `accepted_trades` is readable only to portfolio
     * members, so zero rows means "none visible to you", never "none exist".
     * Measured on AAPL 2026-11-11: 6 rows exist, this caller can read 0.
     */
    if (name === "get_decisions") {
      const sym = String(input.symbol || "").trim().toUpperCase();
      if (!sym) return toolError("get_decisions", "missing_symbol");

      const found = await runQuery<any>("get_decisions", "asset",
        supabase.from("assets").select("id, symbol, company_name")
          .ilike("symbol", sym).maybeSingle());
      if (found.failed) return toolError("get_decisions", "asset");
      const asset = found.data;
      if (!asset) return toolEmpty("get_decisions", { symbol: sym, looked_in: "assets" });

      // Stage 1 first: the PM rulings and the reviews are keyed by the
      // recommendation ids, so they cannot be fetched until these are known.
      const recs = await runQuery<any[]>("get_decisions", "recommendations",
        supabase.from("trade_queue_items")
          .select(
            "id, portfolio_id, action, proposed_shares, proposed_weight, target_price, urgency, " +
            "status, stage, outcome, outcome_at, outcome_note, rationale, thesis_text, conviction, " +
            "time_horizon, created_by, created_at, updated_at, decided_at, decided_by, deferred_until, " +
            "portfolio:portfolios(id, name)",
          )
          .eq("asset_id", asset.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(12));
      if (recs.failed) return toolError("get_decisions", "recommendations");
      const recRows = recs.data || [];
      const recIds = recRows.map((r: any) => r.id).filter(Boolean);

      const [rulings, trades, reviews, outcomes] = await Promise.all([
        recIds.length
          ? runQuery<any[]>("get_decisions", "pm_rulings",
              supabase.from("decision_requests")
                .select(
                  "id, trade_queue_item_id, portfolio_id, status, urgency, context_note, " +
                  "decision_note, requested_by, reviewed_by, reviewed_at, created_at, " +
                  "deferred_until, sizing_weight, sizing_shares, sizing_mode, accepted_trade_id",
                )
                .in("trade_queue_item_id", recIds)
                .order("created_at", { ascending: false })
                .limit(20))
          : Promise.resolve({ data: [] as any[], failed: false }),
        runQuery<any[]>("get_decisions", "committed_trades",
          supabase.from("accepted_trades")
            .select(
              "id, portfolio_id, action, target_weight, delta_weight, delta_shares, notional_value, " +
              "price_at_acceptance, source, decision_request_id, trade_queue_item_id, accepted_by, " +
              "acceptance_note, execution_status, execution_completed_at, executed_by, " +
              "reconciliation_status, reconciled_at, is_active, reverted_at, revert_reason, " +
              "corrects_accepted_trade_id, created_at, portfolio:portfolios(id, name)",
            )
            .eq("asset_id", asset.id)
            .order("created_at", { ascending: false })
            .limit(12)),
        recIds.length
          ? runQuery<any[]>("get_decisions", "decision_reviews",
              supabase.from("decision_reviews")
                .select("id, decision_id, decision_quality, thesis_played_out, sizing_quality, " +
                        "process_note, reviewed_by, reviewed_at")
                .in("decision_id", recIds)
                .limit(20))
          : Promise.resolve({ data: [] as any[], failed: false }),
        runQuery<any[]>("get_decisions", "price_target_outcomes",
          supabase.from("price_target_outcomes")
            .select("id, price_target_id, scenario_type, target_price, target_date, status, " +
                    "hit_date, hit_price, accuracy_pct, days_to_hit, evaluated_at, created_at")
            .eq("asset_id", asset.id)
            .order("created_at", { ascending: false })
            .limit(10)),
      ]);

      const badStage = rulings.failed ? "pm_rulings"
        : trades.failed ? "committed_trades"
        : reviews.failed ? "decision_reviews"
        : outcomes.failed ? "price_target_outcomes"
        : null;
      if (badStage) return toolError("get_decisions", badStage);

      const rulingRows = rulings.data || [];
      const tradeRows = trades.data || [];
      const reviewRows = reviews.data || [];
      const outcomeRows = outcomes.data || [];

      // One name lookup for every person referenced by the rows above. Only
      // ids already present in rows the caller could read are resolved, so
      // this reveals nothing the caller could not already see.
      const personIds = [...new Set([
        ...recRows.flatMap((r: any) => [r.created_by, r.decided_by]),
        ...rulingRows.flatMap((d: any) => [d.requested_by, d.reviewed_by]),
        ...tradeRows.flatMap((t: any) => [t.accepted_by, t.executed_by]),
        ...reviewRows.map((r: any) => r.reviewed_by),
      ].filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_decisions", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_decisions", "people");
      const who = peopleMap(people.data);

      const searched = {
        symbol: sym,
        scope:
          "recommendations and PM rulings you can see, committed trades in portfolios you are a " +
          "member of, plus reviews and price-target outcomes on this asset",
      };

      const total = recRows.length + rulingRows.length + tradeRows.length
        + reviewRows.length + outcomeRows.length;
      if (total === 0) return toolEmpty("get_decisions", searched);

      return toolOk("get_decisions", {
        ...searched,
        asset_id: asset.id,
        company: asset.company_name,
        records_returned: total,
        /*
         * Said to the model in words, because a field it can ignore is a field
         * it will ignore, and this is the distinction the whole tool is for.
         */
        stage_separation:
          "These are four different kinds of record and must not be merged. A recommendation is an " +
          "analyst's proposal. A pm_ruling is the PM's answer to it. A committed_trade is a Trade " +
          "Book row and the ONLY object representing a committed trade; its execution_status says " +
          "whether it was actually executed, so a committed trade with execution_status " +
          "'not_started' has NOT been traded. decision_reviews and price_target_outcomes are " +
          "retrospective judgements, not decisions.",
        counts: {
          recommendations: recRows.length,
          pm_rulings: rulingRows.length,
          committed_trades: tradeRows.length,
          decision_reviews: reviewRows.length,
          price_target_outcomes: outcomeRows.length,
        },
        recommendations: recRows.map((r: any) => ({
          id: r.id,
          action: r.action,
          // Two different fields with overlapping vocabularies, named apart so
          // the model cannot report one as the other. `decision_outcome` is
          // deliberately absent: it is NULL on all 241 production rows.
          queue_status: r.status ?? null,
          pipeline_stage: r.stage ?? null,
          lifecycle_outcome: r.outcome ?? null,
          outcome_note: r.outcome_note ?? null,
          outcome_at: r.outcome_at ?? null,
          proposed_shares: r.proposed_shares ?? null,
          proposed_weight: r.proposed_weight ?? null,
          target_price: r.target_price ?? null,
          urgency: r.urgency ?? null,
          conviction: r.conviction ?? null,
          time_horizon: r.time_horizon ?? null,
          // The submission context the user asked for: why it was proposed.
          rationale: truncate(r.rationale || "", 600) || null,
          thesis: truncate(r.thesis_text || "", 600) || null,
          portfolio_id: r.portfolio_id ?? null,
          portfolio: r.portfolio?.name ?? null,
          submitted_by: personLabel(r.created_by, who),
          created_at: r.created_at ?? null,
          updated_at: r.updated_at ?? null,
          decided_by: personLabel(r.decided_by, who),
          decided_at: r.decided_at ?? null,
          deferred_until: r.deferred_until ?? null,
        })),
        pm_rulings: rulingRows.map((d: any) => ({
          id: d.id,
          // The links, explicit, so the model states them instead of guessing.
          recommendation_id: d.trade_queue_item_id ?? null,
          committed_trade_id: d.accepted_trade_id ?? null,
          status: d.status ?? null,
          urgency: d.urgency ?? null,
          submitted_context: truncate(d.context_note || "", 500) || null,
          decision_note: truncate(d.decision_note || "", 500) || null,
          requested_by: personLabel(d.requested_by, who),
          ruled_by: personLabel(d.reviewed_by, who),
          reviewed_at: d.reviewed_at ?? null,
          created_at: d.created_at ?? null,
          deferred_until: d.deferred_until ?? null,
          sizing_mode: d.sizing_mode ?? null,
          sizing_weight: d.sizing_weight ?? null,
          sizing_shares: d.sizing_shares ?? null,
          portfolio_id: d.portfolio_id ?? null,
        })),
        committed_trades: tradeRows.map((t: any) => ({
          id: t.id,
          recommendation_id: t.trade_queue_item_id ?? null,
          pm_ruling_id: t.decision_request_id ?? null,
          corrects_trade_id: t.corrects_accepted_trade_id ?? null,
          action: t.action,
          target_weight: t.target_weight ?? null,
          delta_weight: t.delta_weight ?? null,
          delta_shares: t.delta_shares ?? null,
          notional_value: t.notional_value ?? null,
          price_at_acceptance: t.price_at_acceptance ?? null,
          source: t.source ?? null,
          portfolio_id: t.portfolio_id ?? null,
          portfolio: t.portfolio?.name ?? null,
          accepted_by: personLabel(t.accepted_by, who),
          acceptance_note: truncate(t.acceptance_note || "", 400) || null,
          created_at: t.created_at ?? null,
          // Execution evidence, which is NOT the same fact as acceptance.
          execution_status: t.execution_status ?? null,
          execution_completed_at: t.execution_completed_at ?? null,
          executed_by: personLabel(t.executed_by, who),
          reconciliation_status: t.reconciliation_status ?? null,
          reconciled_at: t.reconciled_at ?? null,
          // A reverted or inactive row is still a record, but it is not a live
          // commitment. Flagged rather than filtered, so the history survives.
          is_active: t.is_active !== false,
          reverted_at: t.reverted_at ?? null,
          revert_reason: t.revert_reason ?? null,
        })),
        decision_reviews: reviewRows.map((r: any) => ({
          id: r.id,
          recommendation_id: r.decision_id ?? null,
          decision_quality: r.decision_quality ?? null,
          thesis_played_out: r.thesis_played_out ?? null,
          sizing_quality: r.sizing_quality ?? null,
          process_note: truncate(r.process_note || "", 500) || null,
          reviewed_by: personLabel(r.reviewed_by, who),
          reviewed_at: r.reviewed_at ?? null,
        })),
        price_target_outcomes: outcomeRows.map((o: any) => ({
          id: o.id,
          price_target_id: o.price_target_id ?? null,
          scenario_type: o.scenario_type ?? null,
          target_price: o.target_price ?? null,
          target_date: o.target_date ?? null,
          status: o.status ?? null,
          hit_date: o.hit_date ?? null,
          hit_price: o.hit_price ?? null,
          accuracy_pct: o.accuracy_pct ?? null,
          days_to_hit: o.days_to_hit ?? null,
          evaluated_at: o.evaluated_at ?? null,
          created_at: o.created_at ?? null,
        })),
      });
    }

    /*
     * ── get_workflows ────────────────────────────────────────────────────
     *
     * What process is running on this name and what is still open.
     *
     * The stage reference is the trap. `asset_workflow_progress`'s
     * `current_stage_key` and `asset_checklist_items.stage_id` are both TEXT,
     * and production holds both conventions plus values that resolve to
     * nothing: measured 2026-11-11, 364 of 874 progress rows name a stage that
     * does not exist in their own workflow. `resolveStageLabel` tries both and
     * returns null rather than guessing, and an unresolved stage is reported as
     * unresolved. Echoing the raw key as a stage name would invent process
     * state nobody recorded.
     *
     * Visibility needs no work here: `workflows`' own SELECT policy already
     * requires the current org AND (public OR creator OR explicit access), and
     * the stage, progress, checklist, assignment and deadline tables all scope
     * through either that workflow or `current_org_id()`. The caller-scoped
     * client is what makes that apply, which is why this never touches the
     * service-role client.
     */
    if (name === "get_workflows") {
      const sym = String(input.symbol || "").trim().toUpperCase();
      if (!sym) return toolError("get_workflows", "missing_symbol");

      const found = await runQuery<any>("get_workflows", "asset",
        supabase.from("assets").select("id, symbol, company_name")
          .ilike("symbol", sym).maybeSingle());
      if (found.failed) return toolError("get_workflows", "asset");
      const asset = found.data;
      if (!asset) return toolEmpty("get_workflows", { symbol: sym, looked_in: "assets" });

      const progress = await runQuery<any[]>("get_workflows", "progress",
        supabase.from("asset_workflow_progress")
          .select(
            "id, workflow_id, current_stage_key, is_started, is_completed, started_at, " +
            "completed_at, updated_at, started_by, completed_by, " +
            "workflow:workflows(id, name, description, status, is_public, archived, deleted)",
          )
          .eq("asset_id", asset.id)
          .order("updated_at", { ascending: false })
          .limit(12));
      if (progress.failed) return toolError("get_workflows", "progress");

      // An archived or soft-deleted workflow is not current work. Dropped
      // here rather than in the query because the flags live on the embedded
      // row, and counted so the drop is visible instead of silent.
      const allProgress = progress.data || [];
      const progressRows = allProgress.filter(
        (p: any) => p.workflow && p.workflow.deleted !== true && p.workflow.archived !== true,
      );
      const workflowIds = [...new Set(progressRows.map((p: any) => p.workflow_id).filter(Boolean))];

      const [stages, checklist, assignments, deadlines] = await Promise.all([
        workflowIds.length
          ? runQuery<any[]>("get_workflows", "stages",
              supabase.from("workflow_stages")
                .select("id, workflow_id, stage_key, stage_label, sort_order, standard_deadline_days, completion_criteria")
                .in("workflow_id", workflowIds)
                .order("sort_order", { ascending: true }))
          : Promise.resolve({ data: [] as any[], failed: false }),
        runQuery<any[]>("get_workflows", "requirements",
          supabase.from("asset_checklist_items")
            .select("id, workflow_id, stage_id, item_text, status, completed, item_type, " +
                    "assignee_id, due_date, completed_at, completed_by, takeaway, created_at, updated_at")
            .eq("asset_id", asset.id)
            .order("sort_order", { ascending: true })
            .limit(120)),
        runQuery<any[]>("get_workflows", "assignments",
          supabase.from("stage_assignments")
            .select("id, workflow_id, stage_id, assigned_user_id, assigned_by, assigned_at, due_date, notes")
            .eq("asset_id", asset.id)
            .limit(30)),
        runQuery<any[]>("get_workflows", "deadlines",
          supabase.from("asset_stage_deadlines")
            .select("id, workflow_id, stage_id, deadline_date, notes, set_by, updated_at")
            .eq("asset_id", asset.id)
            .limit(30)),
      ]);

      const badStage = stages.failed ? "stages"
        : checklist.failed ? "requirements"
        : assignments.failed ? "assignments"
        : deadlines.failed ? "deadlines"
        : null;
      if (badStage) return toolError("get_workflows", badStage);

      const stageRows = (stages.data || []) as any[];
      const checklistRows = (checklist.data || []) as any[];
      const assignmentRows = (assignments.data || []) as any[];
      const deadlineRows = (deadlines.data || []) as any[];

      const personIds = [...new Set([
        ...checklistRows.map((c: any) => c.assignee_id),
        ...checklistRows.map((c: any) => c.completed_by),
        ...assignmentRows.flatMap((a: any) => [a.assigned_user_id, a.assigned_by]),
        ...progressRows.flatMap((p: any) => [p.started_by, p.completed_by]),
        ...deadlineRows.map((d: any) => d.set_by),
      ].filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_workflows", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_workflows", "people");
      const who = peopleMap(people.data);

      const searched = {
        symbol: sym,
        scope: "workflows on this asset that you have access to, with their stages, requirements, assignments and deadlines",
      };
      if (progressRows.length === 0) {
        return toolEmpty("get_workflows", {
          ...searched,
          ...(allProgress.length > progressRows.length
            ? { note_archived_excluded: allProgress.length - progressRows.length }
            : {}),
        });
      }

      const labelFor = (ref: string | null, wf: string | null) => resolveStageLabel(ref, wf, stageRows);

      const workflows = progressRows.map((p: any) => {
        const wfId = p.workflow_id;
        const mine = checklistRows.filter((c: any) => c.workflow_id === wfId);
        const buckets = bucketChecklist(mine, 15);
        const cur = labelFor(p.current_stage_key, wfId);
        return {
          workflow_id: wfId,
          name: p.workflow?.name ?? null,
          description: truncate(p.workflow?.description || "", 300) || null,
          workflow_status: p.workflow?.status ?? null,
          is_started: p.is_started === true,
          is_completed: p.is_completed === true,
          started_at: p.started_at ?? null,
          started_by: personLabel(p.started_by, who),
          completed_at: p.completed_at ?? null,
          updated_at: p.updated_at ?? null,
          current_stage_key: p.current_stage_key ?? null,
          current_stage_label: cur.label,
          // Honest about the drift rather than papering over it.
          current_stage_unresolved: Boolean(p.current_stage_key) && !cur.resolved,
          stages: stageRows
            .filter((s: any) => s.workflow_id === wfId)
            .map((s: any) => ({ key: s.stage_key, label: s.stage_label, order: s.sort_order })),
          requirement_counts: {
            total: buckets.total,
            open: buckets.open,
            completed: buckets.completed,
            not_applicable: buckets.not_applicable,
          },
          open_requirements_truncated: buckets.open_items_truncated,
          open_requirements: buckets.open_items.map((c: any) => {
            const st = labelFor(c.stage_id, wfId);
            return {
              id: c.id,
              requirement: truncate(c.item_text || "", 300) || null,
              requirement_type: c.item_type ?? null,
              stage_label: st.label,
              stage_unresolved: Boolean(c.stage_id) && !st.resolved,
              assigned_to: personLabel(c.assignee_id, who),
              due_date: c.due_date ?? null,
              created_at: c.created_at ?? null,
              updated_at: c.updated_at ?? null,
            };
          }),
          // Historical completion, enough to explain the current state.
          recently_completed: mine
            .filter((c: any) => c.status === "completed" && c.completed_at)
            .sort((a: any, b: any) => String(b.completed_at).localeCompare(String(a.completed_at)))
            .slice(0, 5)
            .map((c: any) => ({
              id: c.id,
              requirement: truncate(c.item_text || "", 200) || null,
              takeaway: truncate(c.takeaway || "", 300) || null,
              completed_by: personLabel(c.completed_by, who),
              completed_at: c.completed_at,
            })),
          assignments: assignmentRows
            .filter((a: any) => a.workflow_id === wfId)
            .map((a: any) => ({
              id: a.id,
              stage_label: labelFor(a.stage_id, wfId).label,
              assigned_to: personLabel(a.assigned_user_id, who),
              assigned_by: personLabel(a.assigned_by, who),
              assigned_at: a.assigned_at ?? null,
              due_date: a.due_date ?? null,
              notes: truncate(a.notes || "", 200) || null,
            })),
          deadlines: deadlineRows
            .filter((d: any) => d.workflow_id === wfId)
            .map((d: any) => ({
              id: d.id,
              stage_label: labelFor(d.stage_id, wfId).label,
              deadline_date: d.deadline_date ?? null,
              set_by: personLabel(d.set_by, who),
              notes: truncate(d.notes || "", 200) || null,
            })),
        };
      });

      const openTotal = workflows.reduce((n, w) => n + w.requirement_counts.open, 0);

      return toolOk("get_workflows", {
        ...searched,
        asset_id: asset.id,
        company: asset.company_name,
        records_returned: workflows.length,
        workflows_returned: workflows.length,
        open_requirements_total: openTotal,
        ...(allProgress.length > progressRows.length
          ? { archived_or_deleted_workflows_excluded: allProgress.length - progressRows.length }
          : {}),
        // Requirements with no workflow_id belong to no process here, so they
        // are counted and not silently folded into one.
        unassigned_requirements: checklistRows.filter((c: any) => !c.workflow_id).length,
        workflows,
      });
    }

    /* ── get_watchlists ──────────────────────────────────────────────────
     *
     * The reader's own lists. `asset_lists` is readable only when
     * `created_by = auth.uid()` or a collaboration row exists, so this path
     * cannot see the desk's lists and must never say the firm keeps none.
     */
    if (name === "get_watchlists") {
      const nameFilter = String(input.name || "").trim();

      let listQuery = supabase.from("asset_lists")
        .select("id, name, description, list_type, lifecycle, deadline, brief, " +
                "content_mode, is_default, created_at, updated_at, created_by, portfolio_id")
        .order("updated_at", { ascending: false })
        .limit(40);
      if (nameFilter) listQuery = listQuery.ilike("name", `%${escapeLike(nameFilter)}%`);

      const lists = await runQuery<any[]>("get_watchlists", "lists", listQuery);
      if (lists.failed) return toolError("get_watchlists", "lists");
      const listRows = (lists.data || []) as any[];

      const searched = {
        scope: "lists you created or that were shared with you",
        ...(nameFilter ? { query: nameFilter } : {}),
      };
      if (listRows.length === 0) return toolEmpty("get_watchlists", searched);

      const listIds = listRows.map((l: any) => l.id);
      const items = await runQuery<any[]>("get_watchlists", "items",
        supabase.from("asset_list_items")
          .select("id, list_id, asset_id, added_at, notes, is_flagged, due_date, " +
                  "assignee_id, list_category, assets:asset_id(id, symbol, company_name)")
          .in("list_id", listIds)
          .order("added_at", { ascending: false })
          .limit(400));
      if (items.failed) return toolError("get_watchlists", "items");
      const itemRows = (items.data || []) as any[];

      const personIds = [...new Set(itemRows.map((i: any) => i.assignee_id).filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_watchlists", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_watchlists", "people");
      const who = peopleMap(people.data);

      /* A cap on the ENTRIES, reported per list, so "12 of 40 shown" is a
         fact the model can state rather than a silent truncation. */
      const PER_LIST = 40;
      const listsOut = listRows.map((l: any) => {
        const mine = itemRows.filter((i: any) => i.list_id === l.id);
        const shown = mine.slice(0, PER_LIST);
        return {
          list_id: l.id,
          name: l.name ?? null,
          description: truncate(l.description || "", 240) || null,
          list_type: l.list_type ?? null,
          lifecycle: l.lifecycle ?? null,
          deadline: l.deadline ?? null,
          is_default: l.is_default === true,
          updated_at: l.updated_at ?? null,
          assets_on_list: mine.length,
          assets_shown: shown.length,
          assets_truncated: mine.length > shown.length,
          flagged_count: mine.filter((i: any) => i.is_flagged === true).length,
          assets: shown.map((i: any) => ({
            entry_id: i.id,
            asset_id: i.asset_id ?? null,
            symbol: i.assets?.symbol ?? null,
            company: i.assets?.company_name ?? null,
            added_at: i.added_at ?? null,
            is_flagged: i.is_flagged === true,
            due_date: i.due_date ?? null,
            assigned_to: personLabel(i.assignee_id, who),
            category: i.list_category ?? null,
            note: truncate(i.notes || "", 200) || null,
          })),
        };
      });

      return toolOk("get_watchlists", {
        ...searched,
        records_returned: listsOut.length,
        lists_returned: listsOut.length,
        assets_across_lists: itemRows.length,
        /* Distinct names, since the same ticker sits on several lists. */
        distinct_assets: new Set(itemRows.map((i: any) => i.asset_id).filter(Boolean)).size,
        lists: listsOut,
      });
    }

    /* ── get_coverage ────────────────────────────────────────────────────
     *
     * `coverage` SELECT is `organization_id = current_org_id()`, so this one
     * genuinely spans the active organization and an empty result IS a fact
     * about it. The 'mine' default still narrows to the caller, which is a
     * filter, not a visibility limit -- so the scope sentence has to say which
     * of the two produced the emptiness.
     */
    if (name === "get_coverage") {
      const scope = input.scope === "organization" ? "organization" : "mine";
      const sym = String(input.symbol || "").trim().toUpperCase();

      let assetId: string | null = null;
      let assetLabel: string | null = null;
      if (sym) {
        const found = await runQuery<any>("get_coverage", "asset",
          supabase.from("assets").select("id, symbol, company_name")
            .ilike("symbol", sym).maybeSingle());
        if (found.failed) return toolError("get_coverage", "asset");
        if (!found.data) {
          return toolEmpty("get_coverage", { symbol: sym, looked_in: "assets" });
        }
        assetId = found.data.id;
        assetLabel = found.data.company_name ?? null;
      }

      let q = supabase.from("coverage")
        .select("id, asset_id, user_id, analyst_name, role, is_lead, coverage_scope, " +
                "start_date, end_date, is_active, notes, portfolio_id, updated_at, " +
                "assets:asset_id(id, symbol, company_name)")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (scope === "mine") q = q.eq("user_id", userId);
      if (assetId) q = q.eq("asset_id", assetId);

      const cov = await runQuery<any[]>("get_coverage", "coverage", q);
      if (cov.failed) return toolError("get_coverage", "coverage");
      const rows = (cov.data || []) as any[];

      const searched = {
        scope: scope === "mine"
          ? "your own active coverage assignments in your active organization"
          : "all active coverage assignments in your active organization",
        ...(sym ? { symbol: sym } : {}),
      };
      if (rows.length === 0) return toolEmpty("get_coverage", searched);

      const personIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_coverage", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_coverage", "people");
      const who = peopleMap(people.data);

      return toolOk("get_coverage", {
        ...searched,
        ...(assetLabel ? { company: assetLabel } : {}),
        records_returned: rows.length,
        distinct_assets: new Set(rows.map((r: any) => r.asset_id).filter(Boolean)).size,
        distinct_analysts: personIds.length,
        assignments: rows.map((r: any) => ({
          coverage_id: r.id,
          asset_id: r.asset_id ?? null,
          symbol: r.assets?.symbol ?? null,
          company: r.assets?.company_name ?? null,
          /* `analyst_name` is a free-text fallback some rows carry instead of
             a user id. Preferred only when the id resolves to nothing, so a
             real account always wins over a typed name. */
          analyst: personLabel(r.user_id, who) ?? (r.analyst_name || null),
          is_you: r.user_id === userId,
          role: r.role ?? null,
          is_lead: r.is_lead === true,
          coverage_scope: r.coverage_scope ?? null,
          since: r.start_date ?? null,
          notes: truncate(r.notes || "", 200) || null,
        })),
      });
    }

    /* ── get_idea_pipeline ───────────────────────────────────────────────
     *
     * Live ideas only, and liveness is answered by outcome-then-status, never
     * by stage: the stage column records where a process got to and nothing
     * moves it back, so an executed idea can still read `ready_for_decision`.
     */
    if (name === "get_idea_pipeline") {
      const scope = input.scope === "organization" ? "organization" : "mine";
      const wantStage = typeof input.stage === "string" ? toIdeaStage(input.stage) : null;

      let q = supabase.from("trade_queue_items")
        .select("id, asset_id, portfolio_id, action, status, outcome, stage, " +
                "stage_changed_at, conviction, time_horizon, target_price, urgency, " +
                "rationale, thesis_text, created_at, updated_at, created_by, assigned_to, " +
                "research_depth, catalyst_clarity, " +
                "assets:asset_id(id, symbol, company_name), portfolios:portfolio_id(id, name)")
        .is("deleted_at", null)
        .eq("visibility_tier", "active")
        .order("stage_changed_at", { ascending: true, nullsFirst: false })
        .limit(250);
      if (scope === "mine") q = q.or(`created_by.eq.${userId},assigned_to.eq.${userId}`);

      const got = await runQuery<any[]>("get_idea_pipeline", "ideas", q);
      if (got.failed) return toolError("get_idea_pipeline", "ideas");

      const all = (got.data || []) as any[];
      /* Terminal ideas are history, not pipeline. Counted, so the drop is a
         reportable fact rather than a silent filter. */
      const live = all.filter((r: any) => isLiveIdeaRow(r));
      const staged = live.map((r: any) => ({ row: r, stage: toIdeaStage(r.stage) }));
      const inScope = wantStage ? staged.filter((s) => s.stage === wantStage) : staged;

      const searched = {
        scope: scope === "mine"
          ? "live ideas you created or are assigned"
          : "every live idea visible to you in your organization",
        ...(wantStage ? { stage: IDEA_STAGE_LABEL[wantStage] } : {}),
      };
      if (inScope.length === 0) {
        return toolEmpty("get_idea_pipeline", {
          ...searched,
          ...(all.length > live.length ? { finished_ideas_excluded: all.length - live.length } : {}),
        });
      }

      const personIds = [...new Set(inScope.flatMap((s) => [s.row.created_by, s.row.assigned_to]).filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_idea_pipeline", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_idea_pipeline", "people");
      const who = peopleMap(people.data);

      const now = Date.now();
      const daysSince = (iso: string | null): number | null => {
        if (!iso) return null;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
      };

      const byStage = IDEA_STAGES.map((st) => {
        const mine = inScope.filter((s) => s.stage === st);
        return {
          stage: st,
          stage_label: IDEA_STAGE_LABEL[st],
          count: mine.length,
          ideas: mine.slice(0, 25).map((s) => ({
            idea_id: s.row.id,
            asset_id: s.row.asset_id ?? null,
            symbol: s.row.assets?.symbol ?? null,
            company: s.row.assets?.company_name ?? null,
            portfolio: s.row.portfolios?.name ?? null,
            action: s.row.action ?? null,
            conviction: s.row.conviction ?? null,
            time_horizon: s.row.time_horizon ?? null,
            target_price: s.row.target_price ?? null,
            urgency: s.row.urgency ?? null,
            owner: personLabel(s.row.created_by, who),
            assigned_to: personLabel(s.row.assigned_to, who),
            is_yours: s.row.created_by === userId || s.row.assigned_to === userId,
            days_in_stage: daysSince(s.row.stage_changed_at ?? s.row.created_at ?? null),
            /* The stored value, alongside the canonical one, because fifteen
               enum values across three vocabularies map into four and a
               reader comparing with a screen deserves to see both. */
            stored_stage: s.row.stage ?? null,
            rationale: truncate(s.row.rationale || s.row.thesis_text || "", 300) || null,
            created_at: s.row.created_at ?? null,
          })),
          ideas_truncated: mine.length > 25,
        };
      }).filter((g) => g.count > 0);

      return toolOk("get_idea_pipeline", {
        ...searched,
        records_returned: inScope.length,
        ideas_returned: inScope.length,
        ...(all.length > live.length ? { finished_ideas_excluded: all.length - live.length } : {}),
        /* Stated because the pipeline is the maturity axis only. */
        note_pipeline_is_maturity:
          "These stages describe how well understood each idea is. They do not say whether a recommendation was submitted, ruled on or traded; that is a decision_requests fact.",
        by_stage: byStage,
      });
    }

    /* ── get_pending_decisions ───────────────────────────────────────────
     *
     * `decision_requests` SELECT requires the caller to have raised the
     * request or to be in `portfolio_team` for its portfolio. This product
     * has two portfolio-membership tables that disagree, so a PM added
     * through the other one reads zero here while the desk holds several.
     * That is exactly why the visibility declaration is not optional.
     */
    if (name === "get_pending_decisions") {
      const sym = String(input.symbol || "").trim().toUpperCase();

      let assetId: string | null = null;
      if (sym) {
        const found = await runQuery<any>("get_pending_decisions", "asset",
          supabase.from("assets").select("id, symbol").ilike("symbol", sym).maybeSingle());
        if (found.failed) return toolError("get_pending_decisions", "asset");
        if (!found.data) return toolEmpty("get_pending_decisions", { symbol: sym, looked_in: "assets" });
        assetId = found.data.id;
      }

      /*
         Open means NOT YET ANSWERED, expressed as the complement of the
         answered statuses rather than as a list of open ones.
         `DECIDED_DECISION_STATUSES` owns which rulings count as answered, and
         `withdrawn` is retracted rather than open. Written this way round on
         purpose: an inbox defined by a positive list silently loses any status
         added later, where this way a new status shows up as open and someone
         notices.
      */
      const ANSWERED = [...DECIDED_DECISION_STATUSES, "withdrawn"];

      let q = supabase.from("decision_requests")
        .select("id, portfolio_id, requested_by, reviewed_by, status, created_at, " +
                "updated_at, urgency, context_note, decision_note, requested_action, " +
                "sizing_weight, sizing_shares, deferred_until, trade_queue_item_id, " +
                "portfolios:portfolio_id(id, name), " +
                "trade_queue_items:trade_queue_item_id(id, asset_id, action, proposed_shares, " +
                "proposed_weight, target_price, conviction, rationale, " +
                "assets:asset_id(id, symbol, company_name))")
        .not("status", "in", `(${ANSWERED.join(",")})`)
        .order("created_at", { ascending: true })
        .limit(100);

      const got = await runQuery<any[]>("get_pending_decisions", "requests", q);
      if (got.failed) return toolError("get_pending_decisions", "requests");

      let rows = (got.data || []) as any[];
      /* Filtered here rather than in the query: the asset lives on the
         embedded idea row, which PostgREST cannot filter on in this shape
         without changing the embed into an inner join and silently dropping
         requests whose idea row the caller cannot read. */
      if (assetId) rows = rows.filter((r: any) => r.trade_queue_items?.asset_id === assetId);

      const searched = {
        scope: "open recommendations on portfolios you raised or are on the team of",
        ...(sym ? { symbol: sym } : {}),
      };
      if (rows.length === 0) return toolEmpty("get_pending_decisions", searched);

      const personIds = [...new Set(rows.flatMap((r: any) => [r.requested_by, r.reviewed_by]).filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_pending_decisions", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_pending_decisions", "people");
      const who = peopleMap(people.data);

      const now = Date.now();
      const waitingDays = (iso: string | null): number | null => {
        if (!iso) return null;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
      };

      return toolOk("get_pending_decisions", {
        ...searched,
        records_returned: rows.length,
        requests_returned: rows.length,
        yours_to_answer: rows.filter((r: any) => r.reviewed_by === userId).length,
        raised_by_you: rows.filter((r: any) => r.requested_by === userId).length,
        requests: rows.map((r: any) => {
          const idea = r.trade_queue_items;
          return {
            decision_request_id: r.id,
            status: r.status ?? null,
            asset_id: idea?.asset_id ?? null,
            symbol: idea?.assets?.symbol ?? null,
            company: idea?.assets?.company_name ?? null,
            portfolio: r.portfolios?.name ?? null,
            raised_by: personLabel(r.requested_by, who),
            raised_at: r.created_at ?? null,
            waiting_days: waitingDays(r.created_at ?? null),
            reviewer: personLabel(r.reviewed_by, who),
            urgency: r.urgency ?? null,
            /* The request's own figures outrank the idea's: the submission is
               what the PM is being asked to rule on, and an analyst may have
               edited the idea since. */
            proposed_action: r.requested_action ?? idea?.action ?? null,
            proposed_shares: r.sizing_shares ?? idea?.proposed_shares ?? null,
            proposed_weight: r.sizing_weight ?? idea?.proposed_weight ?? null,
            target_price: idea?.target_price ?? null,
            conviction: idea?.conviction ?? null,
            deferred_until: r.deferred_until ?? null,
            /* The idea row may be unreadable even when the request is: the
               two tables have different policies. Say so rather than
               rendering a request about nothing. */
            idea_visible: Boolean(idea),
            context_note: truncate(r.context_note || "", 300) || null,
            decision_note: truncate(r.decision_note || "", 300) || null,
            rationale: truncate(idea?.rationale || "", 300) || null,
          };
        }),
      });
    }

    /* ── get_outstanding_work ────────────────────────────────────────────
     *
     * The cross-asset counterpart to get_workflows. `asset_workflow_progress`
     * SELECT is scoped to workflows whose organization_id is the active org,
     * so this path is genuinely organization-wide.
     */
    if (name === "get_outstanding_work") {
      const overdueOnly = input.overdue_only === true;
      const limit = Math.max(1, Math.min(40, Number(input.limit) || 15));

      const progress = await runQuery<any[]>("get_outstanding_work", "progress",
        supabase.from("asset_workflow_progress")
          .select("id, asset_id, workflow_id, current_stage_key, is_started, is_completed, " +
                  "started_at, updated_at, " +
                  "workflow:workflows(id, name, status, archived, deleted), " +
                  "assets:asset_id(id, symbol, company_name)")
          .eq("is_completed", false)
          .eq("is_started", true)
          .order("updated_at", { ascending: false })
          .limit(120));
      if (progress.failed) return toolError("get_outstanding_work", "progress");

      const allProgress = (progress.data || []) as any[];
      const rows = allProgress.filter(
        (p: any) => p.workflow && p.workflow.deleted !== true && p.workflow.archived !== true,
      );

      const searched = {
        scope: "research processes in progress across your active organization, with their open requirements",
        ...(overdueOnly ? { filter: "only work past a stage deadline" } : {}),
      };
      if (rows.length === 0) {
        return toolEmpty("get_outstanding_work", {
          ...searched,
          ...(allProgress.length > rows.length
            ? { archived_or_deleted_excluded: allProgress.length - rows.length }
            : {}),
        });
      }

      const assetIds = [...new Set(rows.map((p: any) => p.asset_id).filter(Boolean))];
      const workflowIds = [...new Set(rows.map((p: any) => p.workflow_id).filter(Boolean))];

      const [stages, checklist, deadlines] = await Promise.all([
        workflowIds.length
          ? runQuery<any[]>("get_outstanding_work", "stages",
              supabase.from("workflow_stages")
                .select("id, workflow_id, stage_key, stage_label, sort_order")
                .in("workflow_id", workflowIds)
                .order("sort_order", { ascending: true }))
          : Promise.resolve({ data: [] as any[], failed: false }),
        assetIds.length
          ? runQuery<any[]>("get_outstanding_work", "requirements",
              supabase.from("asset_checklist_items")
                .select("id, asset_id, workflow_id, stage_id, item_text, status, " +
                        "item_type, assignee_id, due_date")
                .in("asset_id", assetIds)
                .limit(600))
          : Promise.resolve({ data: [] as any[], failed: false }),
        assetIds.length
          ? runQuery<any[]>("get_outstanding_work", "deadlines",
              supabase.from("asset_stage_deadlines")
                .select("id, asset_id, workflow_id, stage_id, deadline_date")
                .in("asset_id", assetIds)
                .limit(300))
          : Promise.resolve({ data: [] as any[], failed: false }),
      ]);

      const badStage = stages.failed ? "stages"
        : checklist.failed ? "requirements"
        : deadlines.failed ? "deadlines"
        : null;
      if (badStage) return toolError("get_outstanding_work", badStage);

      const stageRows = (stages.data || []) as any[];
      const checklistRows = (checklist.data || []) as any[];
      const deadlineRows = (deadlines.data || []) as any[];

      const personIds = [...new Set(checklistRows.map((c: any) => c.assignee_id).filter(Boolean))];
      const people = personIds.length
        ? await runQuery<any[]>("get_outstanding_work", "people",
            supabase.from("users").select("id, first_name, last_name, email").in("id", personIds))
        : { data: [] as any[], failed: false };
      if (people.failed) return toolError("get_outstanding_work", "people");
      const who = peopleMap(people.data);

      const today = new Date().toISOString().slice(0, 10);

      const built = rows.map((p: any) => {
        const mine = checklistRows.filter(
          (c: any) => c.asset_id === p.asset_id && c.workflow_id === p.workflow_id,
        );
        const buckets = bucketChecklist(mine, 8);
        const cur = resolveStageLabel(p.current_stage_key, p.workflow_id, stageRows);
        const myDeadlines = deadlineRows.filter(
          (d: any) => d.asset_id === p.asset_id && d.workflow_id === p.workflow_id,
        );
        const overdue = myDeadlines.filter(
          (d: any) => d.deadline_date && String(d.deadline_date) < today,
        );
        return {
          progress_id: p.id,
          workflow_id: p.workflow_id,
          workflow: p.workflow?.name ?? null,
          asset_id: p.asset_id ?? null,
          symbol: p.assets?.symbol ?? null,
          company: p.assets?.company_name ?? null,
          current_stage_label: cur.label,
          current_stage_unresolved: Boolean(p.current_stage_key) && !cur.resolved,
          updated_at: p.updated_at ?? null,
          open_requirements_count: buckets.open,
          completed_requirements_count: buckets.completed,
          open_requirements_truncated: buckets.open_items_truncated,
          open_requirements: buckets.open_items.map((c: any) => ({
            id: c.id,
            requirement: truncate(c.item_text || "", 240) || null,
            requirement_type: c.item_type ?? null,
            stage_label: resolveStageLabel(c.stage_id, c.workflow_id, stageRows).label,
            assigned_to: personLabel(c.assignee_id, who),
            due_date: c.due_date ?? null,
            is_overdue: Boolean(c.due_date) && String(c.due_date) < today,
          })),
          overdue_stage_deadlines: overdue.map((d: any) => ({
            id: d.id,
            stage_label: resolveStageLabel(d.stage_id, d.workflow_id, stageRows).label,
            deadline_date: d.deadline_date,
          })),
          is_overdue: overdue.length > 0
            || buckets.open_items.some((c: any) => c.due_date && String(c.due_date) < today),
        };
      });

      /* Work with nothing open is in progress but not outstanding. */
      const withOpen = built.filter((w) => w.open_requirements_count > 0 || w.is_overdue);
      const filtered = overdueOnly ? withOpen.filter((w) => w.is_overdue) : withOpen;

      if (filtered.length === 0) {
        return toolEmpty("get_outstanding_work", {
          ...searched,
          processes_in_progress_with_nothing_open: built.length,
        });
      }

      /* Overdue first, then most open requirements: the order a reader asking
         "what is outstanding" is actually asking for. */
      const ordered = filtered
        .sort((a, b) =>
          (Number(b.is_overdue) - Number(a.is_overdue)) ||
          (b.open_requirements_count - a.open_requirements_count))
        .slice(0, limit);

      return toolOk("get_outstanding_work", {
        ...searched,
        records_returned: ordered.length,
        processes_returned: ordered.length,
        processes_with_open_work: filtered.length,
        processes_truncated: filtered.length > ordered.length,
        overdue_count: filtered.filter((w) => w.is_overdue).length,
        open_requirements_total: filtered.reduce((n, w) => n + w.open_requirements_count, 0),
        distinct_assets: new Set(filtered.map((w) => w.asset_id).filter(Boolean)).size,
        ...(allProgress.length > rows.length
          ? { archived_or_deleted_excluded: allProgress.length - rows.length }
          : {}),
        work: ordered,
      });
    }

    return toolError(name || "unknown", "unknown_tool");
  } catch (e) {
    // The driver's message names tables, columns and sometimes policies. It
    // belongs in the logs, not in the model's context or the browser.
    console.error(`ai-chat tool ${name} threw:`, (e as Error)?.message ?? String(e));
    return toolError(name || "unknown", "unhandled");
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
      model: model || DEFAULT_MODEL.anthropic,
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
            const doc = documents[c.document_index];
            const docTitle = doc?.title || "Source";
            const citedText = String(c.cited_text || "").trim();
            if (!citedText) continue;
            const key = docTitle + "::" + citedText.slice(0, 200);
            if (citationSeen.has(key)) continue;
            citationSeen.add(key);
            citations.push({
              document_title: docTitle,
              cited_text: citedText,
              kind: doc?.kind,
              document_id: doc?.id,
              asset_id: doc?.asset_id ?? null,
              symbol: doc?.symbol ?? null,
              timestamp: doc?.timestamp ?? null,
            });
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
      // Track for client display.
      //
      // `result_summary` used to be `truncate(result, 160)` -- the raw JSON,
      // cut mid-structure, which is how `{"results":[]}` ended up as the
      // user-visible account of a search. The client now gets the three
      // things it needs to write a sentence and draw links: the status, a
      // count, and the records' own ids. Never the raw blob.
      tool_calls.push({
        name: tu.name,
        input: tu.input || {},
        ...summarizeToolResult(tu.name, result),
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
    // The org comes from `current_org_id()` -- the same answer Settings and
    // `set_org_ai_api_key` use -- with the old newest-membership rule kept as
    // a fallback inside `resolveOrgForRequest`. Reading it any other way
    // means a user in two orgs writes the key into one and resolves from the
    // other. See _shared/attribution-org.ts for the measured failure.
    //
    // `supabase` here is the CALLER-SCOPED client, which is what makes
    // auth.uid() the verified user inside that function.
    const [organizationId, { data: teamRow }] = await Promise.all([
      resolveOrgForRequest(supabase, userId),
      supabase
        .from("team_memberships")
        .select("team_id, joined_at")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      organizationId: organizationId ?? null,
      teamId:         teamRow?.team_id ?? null,
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
