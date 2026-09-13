import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeAutomationRequest } from "./authorize.ts";

// Not a browser endpoint: no CORS headers, so no page on any origin can read
// a response, and no preflight is answered.

interface AutomationResult {
  rule_id: string;
  rule_name: string;
  workflow_id: string;
  workflow_name: string;
  action_taken: string;
  new_branch_id: string;
  executed_at: string;
}

interface AssetPopulationRule {
  id: string;
  workflow_id: string;
  rule_name: string;
  condition_type: string;
  action_type: string;
  action_value: any;
}

interface UniverseRule {
  id: string;
  rule_type: string;
  rule_config: any;
  combination_operator: string;
  is_active: boolean;
}

Deno.serve(async (req: Request) => {
  // Authorize before anything privileged exists. The request body and query
  // string are never read, so a caller cannot name an org, user or branch.
  const auth = authorizeAutomationRequest(
    req.method,
    req.headers,
    Deno.env.get("WORKFLOW_AUTOMATION_SECRET"),
  );
  if (!auth.ok) {
    console.warn(`[Automation] Rejected: ${auth.reason}`);
    return new Response(
      JSON.stringify({ error: auth.status === 405 ? "method not allowed" : "unauthorized" }),
      {
        headers: auth.status === 405
          ? { "Content-Type": "application/json", "Allow": "POST" }
          : { "Content-Type": "application/json" },
        status: auth.status,
      }
    );
  }

  try {
    // Create Supabase client with service role key for full access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const results: any[] = [];
    const errors: any[] = [];

    // Step 1: Execute due branch creation rules using the existing DB function
    console.log("[Automation] Checking for due branch creation rules...");

    const { data: branchResults, error: branchError } = await supabase.rpc(
      "execute_due_automation_rules"
    );

    if (branchError) {
      console.error("[Automation] Error executing branch creation rules:", branchError);
      errors.push({ type: "branch_creation", error: branchError.message });
    } else if (branchResults && branchResults.length > 0) {
      console.log(`[Automation] Created ${branchResults.length} branches`);

      for (const result of branchResults as AutomationResult[]) {
        results.push({
          type: "branch_creation",
          rule_name: result.rule_name,
          workflow_name: result.workflow_name,
          branch_id: result.new_branch_id,
          executed_at: result.executed_at,
        });

        // Step 2: For each new branch, check for asset population rules
        await populateAssetsForBranch(
          supabase,
          result.workflow_id,
          result.new_branch_id,
          results,
          errors
        );
      }
    } else {
      console.log("[Automation] No due branch creation rules found");
    }

    // Step 3: Check for any branches that were created but haven't had assets populated yet
    // (handles branches created manually or via UI)
    await checkPendingAssetPopulation(supabase, results, errors);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Automation executed successfully`,
        results,
        errors: errors.length > 0 ? errors : undefined,
        executed_at: new Date().toISOString(),
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Automation] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Unknown error occurred",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

async function populateAssetsForBranch(
  supabase: any,
  templateWorkflowId: string,
  branchId: string,
  results: any[],
  errors: any[]
) {
  console.log(`[Automation] Checking asset population for branch ${branchId}`);

  // Find asset population rules for this workflow template
  const { data: populationRules, error: rulesError } = await supabase
    .from("workflow_automation_rules")
    .select("*")
    .eq("workflow_id", templateWorkflowId)
    .eq("rule_category", "asset_population")
    .eq("condition_type", "on_branch_creation")
    .eq("is_active", true);

  if (rulesError) {
    console.error("[Automation] Error fetching population rules:", rulesError);
    errors.push({ type: "asset_population", branch_id: branchId, error: rulesError.message });
    return;
  }

  if (!populationRules || populationRules.length === 0) {
    console.log(`[Automation] No asset population rules found for template ${templateWorkflowId}`);
    return;
  }

  for (const rule of populationRules as AssetPopulationRule[]) {
    if (rule.action_type === "add_universe_assets") {
      await addUniverseAssets(supabase, branchId, rule, results, errors);
    }
  }
}

async function addUniverseAssets(
  supabase: any,
  branchId: string,
  rule: AssetPopulationRule,
  results: any[],
  errors: any[]
) {
  console.log(`[Automation] Adding universe assets to branch ${branchId}`);

  // Get universe rules for this branch
  const { data: universeRules, error: universeError } = await supabase
    .from("workflow_universe_rules")
    .select("*")
    .eq("workflow_id", branchId)
    .eq("is_active", true)
    .order("sort_order");

  if (universeError) {
    console.error("[Automation] Error fetching universe rules:", universeError);
    errors.push({ type: "universe_rules", branch_id: branchId, error: universeError.message });
    return;
  }

  if (!universeRules || universeRules.length === 0) {
    console.log(`[Automation] No universe rules found for branch ${branchId}`);
    return;
  }

  // Collect assets from all universe rules
  let assetIds = new Set<string>();

  for (const universeRule of universeRules as UniverseRule[]) {
    const ruleAssets = await getAssetsForRule(supabase, universeRule);

    if (universeRule.combination_operator === "and" && assetIds.size > 0) {
      // Intersection
      assetIds = new Set([...assetIds].filter(id => ruleAssets.has(id)));
    } else {
      // Union (default)
      ruleAssets.forEach(id => assetIds.add(id));
    }
  }

  console.log(`[Automation] Found ${assetIds.size} assets from universe rules`);

  if (assetIds.size === 0) {
    return;
  }

  // Get first stage for the branch
  const { data: stages, error: stagesError } = await supabase
    .from("workflow_stages")
    .select("stage_key")
    .eq("workflow_id", branchId)
    .order("sort_order")
    .limit(1);

  if (stagesError || !stages || stages.length === 0) {
    console.error("[Automation] Error fetching stages:", stagesError);
    errors.push({ type: "stages", branch_id: branchId, error: stagesError?.message || "No stages found" });
    return;
  }

  const firstStageKey = stages[0].stage_key;

  // Check existing progress to avoid duplicates
  const { data: existingProgress } = await supabase
    .from("asset_workflow_progress")
    .select("asset_id")
    .eq("workflow_id", branchId);

  const existingAssetIds = new Set((existingProgress || []).map((p: any) => p.asset_id));
  const newAssetIds = [...assetIds].filter(id => !existingAssetIds.has(id));

  if (newAssetIds.length === 0) {
    console.log(`[Automation] All assets already exist in branch ${branchId}`);
    return;
  }

  // Create progress records for new assets
  const progressRecords = newAssetIds.map(assetId => ({
    asset_id: assetId,
    workflow_id: branchId,
    current_stage_key: firstStageKey,
    is_started: true,
    is_completed: false,
    started_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase
    .from("asset_workflow_progress")
    .insert(progressRecords);

  if (insertError) {
    console.error("[Automation] Error inserting progress records:", insertError);
    errors.push({ type: "insert_progress", branch_id: branchId, error: insertError.message });
    return;
  }

  console.log(`[Automation] Added ${newAssetIds.length} assets to branch ${branchId}`);

  // Update the automation rule
  await supabase
    .from("workflow_automation_rules")
    .update({
      last_run_at: new Date().toISOString(),
      run_count: (rule as any).run_count ? (rule as any).run_count + 1 : 1,
    })
    .eq("id", rule.id);

  results.push({
    type: "asset_population",
    rule_name: rule.rule_name,
    branch_id: branchId,
    assets_added: newAssetIds.length,
  });
}

async function getAssetsForRule(
  supabase: any,
  rule: UniverseRule
): Promise<Set<string>> {
  const assetIds = new Set<string>();
  const config = rule.rule_config || {};

  try {
    switch (rule.rule_type) {
      case "coverage": {
        // Get assets covered by specified analysts
        const analystIds = config.analyst_user_ids || [];
        if (analystIds.length > 0) {
          const { data } = await supabase
            .from("coverage")
            .select("asset_id")
            .in("user_id", analystIds)
            .eq("is_active", true);
          (data || []).forEach((c: any) => assetIds.add(c.asset_id));
        }
        break;
      }

      case "list": {
        // Get assets from specified lists
        const listIds = config.list_ids || [];
        if (listIds.length > 0) {
          const { data } = await supabase
            .from("asset_list_items")
            .select("asset_id")
            .in("list_id", listIds);
          (data || []).forEach((item: any) => assetIds.add(item.asset_id));
        }
        break;
      }

      case "portfolio": {
        // Get assets from specified portfolios
        const portfolioIds = config.portfolio_ids || [];
        if (portfolioIds.length > 0) {
          const { data } = await supabase
            .from("portfolio_holdings")
            .select("asset_id")
            .in("portfolio_id", portfolioIds);
          (data || []).forEach((h: any) => assetIds.add(h.asset_id));
        }
        break;
      }

      case "theme": {
        // Get assets from specified themes
        const themeIds = config.theme_ids || [];
        if (themeIds.length > 0) {
          const { data } = await supabase
            .from("theme_assets")
            .select("asset_id")
            .in("theme_id", themeIds);
          (data || []).forEach((ta: any) => assetIds.add(ta.asset_id));
        }
        break;
      }

      case "sector": {
        // Get assets by sector
        const sectors = config.sectors || [];
        if (sectors.length > 0) {
          const { data } = await supabase
            .from("assets")
            .select("id")
            .in("sector", sectors);
          (data || []).forEach((a: any) => assetIds.add(a.id));
        }
        break;
      }

      case "priority": {
        // Get assets by priority level
        const priorities = config.priorities || [];
        if (priorities.length > 0) {
          const { data } = await supabase
            .from("assets")
            .select("id")
            .in("priority", priorities);
          (data || []).forEach((a: any) => assetIds.add(a.id));
        }
        break;
      }

      case "index": {
        // Get assets from specified indices (stored as lists with is_index=true or similar)
        const indexIds = config.index_ids || config.list_ids || [];
        if (indexIds.length > 0) {
          const { data } = await supabase
            .from("asset_list_items")
            .select("asset_id")
            .in("list_id", indexIds);
          (data || []).forEach((item: any) => assetIds.add(item.asset_id));
        }
        break;
      }

      case "analyst": {
        // Get assets by analyst user IDs (similar to coverage)
        const userIds = config.user_ids || config.analyst_user_ids || [];
        if (userIds.length > 0) {
          const { data } = await supabase
            .from("coverage")
            .select("asset_id")
            .in("user_id", userIds)
            .eq("is_active", true);
          (data || []).forEach((c: any) => assetIds.add(c.asset_id));
        }
        break;
      }

      default:
        console.log(`[Automation] Unknown rule type: ${rule.rule_type}`);
    }
  } catch (error) {
    console.error(`[Automation] Error processing rule type ${rule.rule_type}:`, error);
  }

  return assetIds;
}

async function checkPendingAssetPopulation(
  supabase: any,
  results: any[],
  errors: any[]
) {
  // Find recently created branches (last 24 hours) that may need asset population
  const { data: recentBranches, error } = await supabase
    .from("workflows")
    .select(`
      id,
      name,
      parent_workflow_id,
      created_at
    `)
    .not("parent_workflow_id", "is", null)
    .eq("status", "active")
    .eq("deleted", false)
    .eq("archived", false)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (error || !recentBranches) {
    return;
  }

  for (const branch of recentBranches) {
    // Check if this branch has any assets
    const { count } = await supabase
      .from("asset_workflow_progress")
      .select("*", { count: "exact", head: true })
      .eq("workflow_id", branch.id);

    if (count === 0) {
      // No assets yet, try to populate
      await populateAssetsForBranch(
        supabase,
        branch.parent_workflow_id,
        branch.id,
        results,
        errors
      );
    }
  }
}
