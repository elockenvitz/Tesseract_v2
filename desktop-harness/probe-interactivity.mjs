/**
 * Classify every visible element inside the Dashboard cards.
 *
 * DEAD         no listener, no cursor affordance, not focusable
 * INSPECTABLE  responds to hover only
 * ACTIONABLE   a real control (button/link/role) that does something
 * NAVIGATES    a control whose job is to leave for another surface
 */
import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto(`${base}?surface=dashboard&h=1400`, { waitUntil: 'networkidle' })
await p.waitForSelector('[data-testid="today-tile"]')
await p.waitForTimeout(400)

const out = await p.evaluate(() => {
  const rows = []
  for (const tile of document.querySelectorAll('[data-testid="today-tile"]')) {
    const sym = tile.querySelector('span.font-black')?.textContent?.trim() ?? '?'
    const seen = new Set()
    // The named parts of a card we care about, in reading order.
    const parts = [
      ['ticker', tile.querySelector('span.font-black')],
      ['state pill', tile.querySelector('.rounded-full + .rounded-full, [class*="uppercase"]')],
      ['claim', tile.querySelector('p')],
      ['metric strip', tile.querySelector('[class*="rounded-lg"][class*="bg-gray-100"]')],
      ['visual', tile.querySelector('[data-archetype]') ?? tile.querySelector('svg')?.closest('div')],
      ['book label', [...tile.querySelectorAll('span')].find(s => /Global Equity|Income/.test(s.textContent ?? ''))],
    ]
    for (const [name, el] of parts) {
      if (!el || seen.has(el)) continue
      seen.add(el)
      const cs = getComputedStyle(el)
      const focusable = el.matches('a,button,[tabindex]:not([tabindex="-1"]),input,select')
      const isControl = !!el.closest('button,a,[role="button"]')
      rows.push({
        tile: sym, part: name,
        tag: el.tagName.toLowerCase(),
        cursor: cs.cursor,
        focusable,
        insideControl: isControl,
        verdict: isControl || focusable ? 'ACTIONABLE'
          : cs.cursor === 'pointer' ? 'INSPECTABLE?' : 'DEAD',
      })
    }
    // Every real control in the tile.
    const controls = [...tile.querySelectorAll('button,a,[role="button"]')]
      .map(c => (c.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 26) || '(icon)')
    rows.push({ tile: sym, part: `-- controls (${controls.length})`, tag: '', cursor: '', focusable: '', insideControl: '', verdict: controls.join(' / ') })
  }
  return rows
})

console.log('\n=== card interactivity, before ===')
for (const r of out) {
  if (String(r.part).startsWith('--')) { console.log(`  ${r.tile.padEnd(6)} ${r.part}: ${r.verdict}`); continue }
  console.log(`  ${r.tile.padEnd(6)} ${String(r.part).padEnd(14)} ${String(r.tag).padEnd(5)} cursor=${String(r.cursor).padEnd(8)} ${r.verdict}`)
}
await b.close()
