import fs from 'fs'
const tok = JSON.stringify(JSON.parse(fs.readFileSync('.mcp.json','utf8'))).match(/sbp_[a-f0-9]{40,}/)[0]
const run = async sql => {
  const r = await fetch('https://api.supabase.com/v1/projects/wfcebeagznzgeuyysbnt/database/query',
    { method:'POST', headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
      body: JSON.stringify({ query: sql }) })
  try { return JSON.parse(await r.text()) } catch (e) { return String(e) }
}
console.log('the two names:', JSON.stringify(await run(
  `select id, symbol, current_symbol, company_name, asset_type, lifecycle_status
   from assets where symbol in ('SQ','ZOOM','XYZ','ZM') order by symbol`), null, 1))
console.log('\nis there history under the new tickers?', JSON.stringify(await run(
  `select symbol, count(*) rows, min(date) first, max(date) last
   from price_history_cache where symbol in ('SQ','ZOOM','XYZ','ZM') group by symbol`)))
console.log('\nhow current_symbol is used across assets:', JSON.stringify(await run(
  `select count(*) total, count(current_symbol) with_current,
          count(*) filter (where current_symbol is not null and current_symbol <> symbol) renamed
   from assets`)))
