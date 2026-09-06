import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
await p.goto(`${base}?surface=dashboard&lens=ideas&h=2600`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="idea-tile"]')
await p.waitForTimeout(400)

const card = t => p.locator('[data-testid="idea-tile"]').filter({ hasText: t }).first()
const checks = [
  ['PFE',  'target',   ['part-spot', 'part-target']],
  ['XOM',  'exposure', ['part-held-in-book', 'part-rank']],
  ['LLY',  'range',    ['case-bear', 'case-bull']],
  ['NVDA', 'since',    []],
]
for (const [sym, kind, parts] of checks) {
  const c = card(sym)
  if (!(await c.count())) { console.log(`${sym}: absent`); continue }
  const before = await c.locator('[data-testid="part-readout"],[data-testid="case-readout"]').count()
  const out = []
  for (const part of parts) {
    const el = c.locator(`[data-testid="${part}"]`).first()
    if (!(await el.count())) { out.push(`${part}=MISSING`); continue }
    await el.hover(); await p.waitForTimeout(140)
    const txt = await c.locator('[data-testid="part-readout"],[data-testid="case-readout"]').first()
      .innerText().catch(() => '(none)')
    out.push(`${part.replace('part-','')} -> ${JSON.stringify(txt.replace(/\n/g,' '))}`)
  }
  await p.mouse.move(5, 5); await p.waitForTimeout(180)
  const after = await c.locator('[data-testid="part-readout"],[data-testid="case-readout"]').count()
  console.log(`${sym.padEnd(5)} [${kind}] resting=${before === 0 ? 'calm' : 'BUSY'} restored=${after === 0}`)
  for (const o of out) console.log('        ', o)
}
if (errs.length) console.log('ERRORS:', errs.slice(0, 3))
await b.close()
