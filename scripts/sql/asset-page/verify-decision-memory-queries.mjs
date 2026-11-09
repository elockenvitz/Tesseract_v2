/**
 * Verify the Decision Memory fix against the REAL PostgREST API.
 *
 * The failure mode is an embed PostgREST cannot resolve, which it rejects
 * before RLS is ever consulted — so the broken-vs-fixed distinction is
 * provable with any key. Read-only GETs; nothing is written.
 */
import fs from 'node:fs'

const tok = JSON.parse(fs.readFileSync('C:/dev/Tesseract_v2/.mcp.json', 'utf8'))
  .mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN
const ref = 'wfcebeagznzgeuyysbnt'

/*
 * The new-style SECRET key, not the legacy service_role JWT: legacy anon and
 * service_role keys were disabled on this project on 2026-10-03 and now
 * answer 401 "Legacy API keys are disabled".
 */
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${tok}` },
})).json()
const key = keys.find(k => k.type === 'secret').api_key
const BASE = `https://${ref}.supabase.co/rest/v1`
const H = { apikey: key, Authorization: `Bearer ${key}` }

const AAPL = (await (await fetch(
  `${BASE}/assets?select=id&symbol=eq.AAPL&limit=1`, { headers: H })).json())[0].id

async function probe(label, table, select, extra = '') {
  const url = `${BASE}/${table}?select=${encodeURIComponent(select)}${extra}&limit=2`
  const r = await fetch(url, { headers: H })
  const body = await r.text()
  const okish = r.ok
  console.log(`${okish ? 'HTTP 200  ' : `HTTP ${r.status}  `} ${label}`)
  if (!okish) {
    let msg = body
    try { const j = JSON.parse(body); msg = j.message || j.hint || body } catch {}
    console.log(`            ${String(msg).slice(0, 170)}`)
  }
  return okish
}

console.log('\n── THE BUG: embeds through an auth.users FK ──')
const brokeA = await probe(
  'accepted_trades + accepted_by_user embed (what 2B shipped)',
  'accepted_trades',
  'id,action,accepted_by_user:users!accepted_trades_accepted_by_fkey(first_name,last_name)',
  `&asset_id=eq.${AAPL}`)
const brokeB = await probe(
  'decision_reviews + reviewer embed (what 2B shipped)',
  'decision_reviews',
  'id,reviewer:users!decision_reviews_reviewed_by_fkey(first_name,last_name)')

console.log('\n── THE FIX: plain columns, names resolved separately ──')
const fixedA = await probe(
  'accepted_trades, no embed',
  'accepted_trades',
  'id,action,execution_status,source,acceptance_note,target_weight,delta_weight,delta_shares,batch_id,created_at,accepted_by,portfolio:portfolio_id(id,name)',
  `&asset_id=eq.${AAPL}&is_active=is.true`)
const fixedB = await probe(
  'decision_reviews, no embed',
  'decision_reviews',
  'id,decision_id,decision_quality,process_note,created_at,reviewed_by')
const fixedC = await probe(
  'users keyed by id (the separate name lookup)',
  'users', 'id,first_name,last_name')

console.log('\n── The other embeds 2B shipped, which DO resolve ──')
const okA = await probe('decision_requests + requester + reviewer', 'decision_requests',
  'id,status,reviewed_at,decision_note,deferred_until,accepted_trade_id,requester:requested_by(first_name,last_name),reviewer:users!decision_requests_reviewed_by_fkey(first_name,last_name),portfolio:portfolio_id(id,name)')
const okB = await probe('memory_events + actor', 'memory_events',
  'id,event_type,source_field,occurred_at,actor:users!memory_events_actor_id_fkey(first_name,last_name)')
const okC = await probe('price_target_outcomes + user', 'price_target_outcomes',
  'id,status,target_price,accuracy_pct,evaluated_at,updated_at,user:users!price_target_outcomes_user_id_fkey(first_name,last_name)')
const okD = await probe('portfolio_trade_events (provenance columns)', 'portfolio_trade_events',
  'id,portfolio_id,action_type,event_date,source_type,detected_by_system,metadata,linked_trade_idea_id,portfolios:portfolio_id(id,name)')
const okE = await probe('trade_queue_items + creator + portfolio', 'trade_queue_items',
  'id,action,rationale,created_at,origin_metadata,users:created_by(first_name,last_name),portfolios:portfolio_id(id,name)')

console.log('')
const brokeAsExpected = !brokeA && !brokeB
const fixWorks = fixedA && fixedB && fixedC
const restFine = okA && okB && okC && okD && okE
console.log(`broken embeds rejected as expected: ${brokeAsExpected}`)
console.log(`fixed queries accepted:             ${fixWorks}`)
console.log(`every other 2B query accepted:      ${restFine}`)
process.exit(brokeAsExpected && fixWorks && restFine ? 0 : 1)
