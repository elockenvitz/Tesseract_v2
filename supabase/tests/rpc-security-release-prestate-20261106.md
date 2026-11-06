# Pre-release production state, captured 2026-11-06

Recovery reference for the RPC security release (migrations A, B, D, C1, C2).
Target project: `wfcebeagznzgeuyysbnt`. Read-only capture, nothing applied.

This is the drift detector. If any value below has changed by the time the
release runs, something altered these functions in between and the release
must stop. The function *bodies* are recovered from the `.sql.rollback`
companions; this file recovers the privilege and attribute state, which the
rollback files only partly restate.

## The 14 target functions that exist now

All owned by `postgres`. All `SECURITY DEFINER`. All share the identical ACL
`postgres=X/postgres authenticated=X/postgres service_role=X/postgres`, so
there are no latent `PUBLIC` grants: the `REVOKE ... FROM PUBLIC` lines in the
migrations are belt and braces, not load bearing.

`anon` holds EXECUTE on none of them.

| function | identity args | search_path | md5 of definition |
|---|---|---|---|
| activate_template_version | p_version_id uuid | (none) | d5aa7c30df10a5954cf5772141241391 |
| copy_workflow_with_unique_name | source_workflow_id uuid, suffix text, target_user_id uuid, copy_progress boolean | (none) | 28f83ea636c2d0faf3dc6f89758e3fd0 |
| create_initial_template_version | p_workflow_id uuid | (none) | 8dd4cd015c4ca7eceed0d93b444c8b12 |
| create_new_template_version | p_workflow_id uuid, p_version_name text, p_description text, p_version_type text | (none) | b69adad0125115af320e39b3da5cd9ee |
| ensure_default_scenarios | p_asset_id uuid | (none) | be527b184f6bd903b1308e933a858077 |
| ensure_pilot_decision_request_for_user | p_user_id uuid | search_path=public | b050ad259f661ae6c927e5750cd55a9d |
| evaluate_pending_rules | (none) | (none) | 79c66938106ea0489ac05592d26936fc |
| execute_single_automation_rule | p_rule_id uuid, p_user_id uuid, p_trigger_source text | (none) | 782f3b2f7305c0cf39344da69afd0683 |
| get_latest_list_activities | p_list_ids uuid[] | (none) | 1b3e2e62f5e6dddec2dba866e27b20a6 |
| get_list_activity_counts | p_user_id uuid | (none) | 09130ba37d39b892d4c28b1691b52ab0 |
| get_or_create_private_view | p_lab_id uuid, p_user_id uuid | (none) | 8d92fef7b94cded91e9ed2f02ccd47f3 |
| get_or_create_trade_lab | p_portfolio_id uuid | (none) | 0f7991a2c421e9937b36c0bcc27b130e |
| mark_conversation_read | p_conversation_id uuid, p_user_id uuid | (none) | 202405e20f769ef33f0a34fc4f011795 |
| recompute_workflow_rule_schedules | p_workflow_id uuid, p_user_id uuid | (none) | 61769730f09e3ffb3b05208e387c4fc6 |

## The 4 functions the release creates

These must NOT exist yet. Confirmed absent at capture time:

`assert_workflow_readable(uuid)`, `assert_workflow_admin(uuid)`,
`run_workflow_rule(uuid)`, `run_due_workflow_rules()`.

## Why this reproduces the expected 15 failures

The verification script's baseline is 15 FAIL. This capture accounts for every
one of them independently:

- 11 rows: of the 12 existing functions the script checks for a pinned
  `search_path`, 11 have none. The twelfth,
  `ensure_pilot_decision_request_for_user`, already has `search_path=public`
  and is the one pre-existing PASS.
- 2 rows: `get_list_activity_counts` and `get_latest_list_activities` are
  `SECURITY DEFINER` and migration B makes them `SECURITY INVOKER`.
- 2 rows: `evaluate_pending_rules` and `execute_single_automation_rule` are
  executable by `authenticated`, which is the live cross-tenant path C2
  closes. The script counts each of these twice, once under grants and once
  under scheduler reach.

## Security log state at capture

`workflow_rule_executions` holds **0 rows**. There is no execution history to
preserve and no forged-scheduler evidence to find, which also means the
absence of evidence proves nothing about historical exploitation. The Supabase
log tables (`postgres_logs`, `edge_logs`) were unreachable through the
available tooling, so in-database forensic signature checks were used instead
and came back clean across five cross-org patterns.
