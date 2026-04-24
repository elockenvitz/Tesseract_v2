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

    const { aiConfig, platformConfig, userConfig } = await getEffectiveAIConfig(
      supabase,
      user.id,
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
    const { message, conversationHistory = [], context, purpose } = await req.json();
    if (!message || typeof message !== "string") throw new Error("Message is required");

    // ─── Rate-limit gate ───────────────────────────────────────────────
    const limits = resolveLimits(platformConfig, userConfig);
    const usage = await getCurrentUsage(supabase, user.id);
    const breach = checkLimits(limits, usage);
    if (breach) {
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
    let contextPrompt = "";
    if (context?.type && context?.id) {
      contextPrompt = await buildContextPrompt(supabase, context, user.id, aiConfig);
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
    const result = await callAIProvider(
      aiConfig.provider as AIProvider,
      aiConfig.apiKey!,
      effectiveModel,
      systemPrompt,
      conversationHistory,
      message,
      limits.maxTokensPerRequest
    );

    // Async usage log — never blocks the response.
    logUsage(supabase, user.id, { ...aiConfig, model: effectiveModel }, context, purpose, startTime, result.tokens)
      .catch(console.error);

    return new Response(
      JSON.stringify({ response: result.response, usage: result.usageRaw, model: effectiveModel }),
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
  } else if (platformConfig?.allow_byok && userConfig?.byok_enabled && userConfig?.byok_api_key) {
    aiConfig = {
      mode: "byok",
      provider: userConfig.byok_provider || "anthropic",
      model: userConfig.byok_model || "claude-3-5-sonnet-20241022",
      apiKey: userConfig.byok_api_key,
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

    let thesisBlock = "";
    if (aiConfig.includeThesis) {
      const { data: thesis } = await supabase
        .from("asset_theses")
        .select("*")
        .eq("asset_id", context.id)
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (thesis?.content) {
        thesisBlock = `\nUSER'S THESIS:\n${truncate(thesis.content, MAX_THESIS_CHARS)}\n`;
      }
    }

    let outcomesBlock = "";
    if (aiConfig.includeOutcomes) {
      const { data: outcomes } = await supabase
        .from("asset_outcomes")
        .select("*")
        .eq("asset_id", context.id)
        .eq("created_by", userId)
        .limit(MAX_OUTCOMES);

      if (outcomes?.length) {
        outcomesBlock = `\nUSER'S OUTCOMES:\n`;
        outcomes.forEach((o: any) => {
          const emoji = o.outcome_type === "bull" ? "🟢" : o.outcome_type === "bear" ? "🔴" : "⚪";
          outcomesBlock += `${emoji} ${(o.outcome_type || "base").toUpperCase()}: ${truncate(o.description || o.title, 300)}`;
          if (o.probability) outcomesBlock += ` (${o.probability}% probability)`;
          if (o.target_price) outcomesBlock += ` Target: $${o.target_price}`;
          outcomesBlock += "\n";
        });
      }
    }

    let notesBlock = "";
    if (aiConfig.includeNotes) {
      const { data: notes } = await supabase
        .from("notes")
        .select("*")
        .eq("context_type", "asset")
        .eq("context_id", context.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_NOTES);

      if (notes?.length) {
        notesBlock = `\nUSER'S RECENT NOTES:\n`;
        notes.forEach((n: any) => {
          const date = new Date(n.created_at).toLocaleDateString();
          const content = n.content || n.title || "";
          notesBlock += `• ${date}: ${truncate(content, MAX_NOTE_CHARS)}\n`;
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

interface CallResult {
  response: string;
  tokens: { input: number; output: number; cache_write: number; cache_read: number };
  usageRaw: any;
}

async function callAIProvider(
  provider: AIProvider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  message: string,
  maxTokens: number
): Promise<CallResult> {

  if (provider === "anthropic") {
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model || "claude-3-5-sonnet-20241022",
        max_tokens: maxTokens,
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
        ],
        messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Anthropic API error");
    }

    const data = await response.json();
    const u = data.usage || {};
    return {
      response: data.content[0]?.text || "",
      tokens: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cache_write: u.cache_creation_input_tokens ?? 0,
        cache_read: u.cache_read_input_tokens ?? 0,
      },
      usageRaw: u,
    };
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
        max_tokens: maxTokens
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
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Usage logging ──────────────────────────────────────────────────────

async function logUsage(
  supabase: any,
  userId: string,
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
