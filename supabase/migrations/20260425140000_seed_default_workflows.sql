-- ============================================================================
-- Seed default analyst workflows ("processes") for every org.
--
-- Three pre-canned templates that cover the natural analyst cadence:
--   1. Earnings Prep         — quarterly, per-asset
--   2. New Idea Diligence    — one-time, per-asset
--   3. Quarterly Position Review — every 90 days, per-asset
--
-- These give pilot users something useful to start from for the
-- "Build or schedule a workflow" Get Started step. Idempotent via
-- (organization_id, name) match: re-running won't create duplicates.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_workflows_for_org(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workflow_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required';
  END IF;

  -- ----------------- 1. Earnings Prep -----------------
  IF NOT EXISTS (
    SELECT 1 FROM workflows
    WHERE organization_id = p_org_id AND name = 'Earnings Prep'
      AND COALESCE(deleted, false) = false
  ) THEN
    INSERT INTO workflows (
      organization_id, name, description, color, is_public,
      cadence_timeframe, cadence_days, scope_type
    ) VALUES (
      p_org_id, 'Earnings Prep',
      'Run before each earnings call: prep, listen, update model, decide.',
      '#6366f1', true, 'quarterly', 90, 'asset'
    ) RETURNING id INTO v_workflow_id;

    INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, sort_order, checklist_items) VALUES
      (v_workflow_id, 'pre_call_setup', 'Pre-call setup',
       'Frame what you''re watching for before the call.', 0,
       '[
         {"text":"Read latest sell-side previews","item_type":"thinking"},
         {"text":"Note consensus EPS / revenue","item_type":"operational"},
         {"text":"Refresh price targets","item_type":"thinking"},
         {"text":"Flag KPIs to watch","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'listen_or_read', 'Listen / read transcript',
       'Capture what changed live, before consensus repackages it.', 1,
       '[
         {"text":"Capture mgmt tone change","item_type":"thinking"},
         {"text":"Capture surprise data points","item_type":"thinking"},
         {"text":"Flag any guidance shift","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'update_model_thesis', 'Update model & thesis',
       'Translate the print into the model and the written thesis.', 2,
       '[
         {"text":"Roll estimates","item_type":"operational"},
         {"text":"Adjust price targets","item_type":"thinking"},
         {"text":"Note thesis-validating or thesis-breaking points","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'decide_document', 'Decide & document',
       'Land on an action and write it down.', 3,
       '[
         {"text":"Hold / add / trim / exit","item_type":"thinking"},
         {"text":"Write 2-line takeaway in the asset''s thesis or risks field","item_type":"operational"}
       ]'::jsonb);
  END IF;

  -- ----------------- 2. New Idea Diligence -----------------
  IF NOT EXISTS (
    SELECT 1 FROM workflows
    WHERE organization_id = p_org_id AND name = 'New Idea Diligence'
      AND COALESCE(deleted, false) = false
  ) THEN
    INSERT INTO workflows (
      organization_id, name, description, color, is_public,
      cadence_timeframe, scope_type
    ) VALUES (
      p_org_id, 'New Idea Diligence',
      'One-time vetting flow for a new ticker entering the pipeline.',
      '#10b981', true, NULL, 'asset'
    ) RETURNING id INTO v_workflow_id;

    INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, sort_order, checklist_items) VALUES
      (v_workflow_id, 'frame_idea', 'Frame the idea',
       'Force a written articulation before doing any work.', 0,
       '[
         {"text":"Bull case","item_type":"thinking"},
         {"text":"Bear case","item_type":"thinking"},
         {"text":"Where we differ from consensus","item_type":"thinking"},
         {"text":"Position sizing intent","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'quant_pass', 'Quantitative pass',
       'Get the numbers under your belt.', 1,
       '[
         {"text":"Pull last 3 yrs financials","item_type":"operational"},
         {"text":"Build basic forecast","item_type":"operational"},
         {"text":"Set initial price targets (bull/base/bear)","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'qual_pass', 'Qualitative pass',
       'The non-numbers stuff that drives the multiple.', 2,
       '[
         {"text":"Management quality","item_type":"thinking"},
         {"text":"Moat / competitive position","item_type":"thinking"},
         {"text":"Industry tailwind / headwind","item_type":"thinking"},
         {"text":"Catalysts in next 6 months","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'risks_gotchas', 'Risks & gotchas',
       'Pre-mortem the thesis before you commit capital.', 3,
       '[
         {"text":"Top 3 risks","item_type":"thinking"},
         {"text":"What invalidates the thesis","item_type":"thinking"},
         {"text":"Liquidity / position-size constraint","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'decision', 'Decision',
       'Commit the conclusion in writing.', 4,
       '[
         {"text":"Approve / Reject / Defer","item_type":"thinking"},
         {"text":"If approve: set conviction + sizing + entry plan","item_type":"thinking"}
       ]'::jsonb);
  END IF;

  -- ----------------- 3. Quarterly Position Review -----------------
  IF NOT EXISTS (
    SELECT 1 FROM workflows
    WHERE organization_id = p_org_id AND name = 'Quarterly Position Review'
      AND COALESCE(deleted, false) = false
  ) THEN
    INSERT INTO workflows (
      organization_id, name, description, color, is_public,
      cadence_timeframe, cadence_days, scope_type
    ) VALUES (
      p_org_id, 'Quarterly Position Review',
      'Every 90 days, re-test the thesis on each held position.',
      '#f59e0b', true, 'quarterly', 90, 'asset'
    ) RETURNING id INTO v_workflow_id;

    INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, sort_order, checklist_items) VALUES
      (v_workflow_id, 'reread_thesis', 'Re-read the thesis',
       'Anchor on what you originally believed.', 0,
       '[
         {"text":"Open prior thesis note","item_type":"operational"},
         {"text":"Confirm or note drift","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'check_vs_reality', 'Check vs reality',
       'Test the thesis against what actually happened.', 1,
       '[
         {"text":"YTD return vs benchmark","item_type":"operational"},
         {"text":"Has any of the bull case played out?","item_type":"thinking"},
         {"text":"Have any of the risks materialized?","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'rate_resize', 'Rate & resize',
       'Update conviction and sizing in light of new info.', 2,
       '[
         {"text":"Rating still valid?","item_type":"thinking"},
         {"text":"Position size still right?","item_type":"thinking"},
         {"text":"New bull/bear cases needed?","item_type":"thinking"}
       ]'::jsonb),
      (v_workflow_id, 'action', 'Action',
       'Land on a decision; schedule the next checkpoint.', 3,
       '[
         {"text":"Hold / Add / Trim","item_type":"thinking"},
         {"text":"Schedule next checkpoint or trigger event","item_type":"operational"}
       ]'::jsonb);
  END IF;
END;
$function$;

-- Backfill existing orgs (pilot + non-pilot).
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations
  LOOP
    PERFORM seed_default_workflows_for_org(v_org.id);
  END LOOP;
END $$;
