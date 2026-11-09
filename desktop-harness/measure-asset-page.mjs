/**
 * Measurement pass for Increment 2D.
 *
 * Measures before changing anything, so the refinements are answers to
 * numbers rather than taste. Reports and never asserts — this is the
 * instrument, not the gate.
 *
 *   node desktop-harness/measure-asset-page.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const browser = await chromium.launch()

const out = (label, v) => console.log(`  ${label.padEnd(46)} ${v}`)

// ─── Desktop Decision Memory density ──────────────────────────────────────
console.log('\nDESKTOP — Decision Memory timeline @1440')
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}?surface=decision-timeline&h=3000`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness="decision-timeline"]')
  await page.waitForTimeout
    ? await page.waitForTimeout(300) : null

  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-harness] button')]
      .filter(b => b.querySelector('span'))
    const heights = rows.map(r => Math.round(r.getBoundingClientRect().height)).filter(h => h > 20)
    const card = document.querySelector('[data-harness] > div')
    // Empty vertical space: how much of each row is padding rather than text.
    const sample = rows.find(r => /EXECUTED/i.test(r.innerText))
    let textH = null, rowH = null
    if (sample) {
      rowH = Math.round(sample.getBoundingClientRect().height)
      const spans = [...sample.querySelectorAll('span,p')]
      const top = Math.min(...spans.map(s => s.getBoundingClientRect().top))
      const bot = Math.max(...spans.map(s => s.getBoundingClientRect().bottom))
      textH = Math.round(bot - top)
    }
    return {
      rowCount: heights.length,
      medianRow: heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? null,
      minRow: heights[0] ?? null,
      maxRow: heights[heights.length - 1] ?? null,
      cardH: card ? Math.round(card.getBoundingClientRect().height) : null,
      sampleRowH: rowH,
      sampleTextH: textH,
      chrome: rowH && textH ? rowH - textH : null,
    }
  })
  out('rows rendered', m.rowCount)
  out('row height median / min / max', `${m.medianRow} / ${m.minRow} / ${m.maxRow}px`)
  out('full card height', `${m.cardH}px`)
  out('sample row: height vs text height', `${m.sampleRowH}px vs ${m.sampleTextH}px`)
  out('sample row: vertical chrome (padding)', `${m.chrome}px`)

  // How far down the page is the first EXECUTED row? A reader scanning for
  // "did it happen" should not have to scroll for it.
  const firstExec = await page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-harness] button')]
      .find(b => /EXECUTED/i.test(b.innerText))
    return r ? Math.round(r.getBoundingClientRect().top) : null
  })
  out('first EXECUTED row offset from top', `${firstExec}px`)
  await page.close()
}

// ─── Desktop Snapshot ─────────────────────────────────────────────────────
console.log('\nDESKTOP — network behaviour')
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const reqs = []
  page.on('request', r => reqs.push(r.url()))
  await page.goto(`${base}?surface=decision-timeline&h=3000`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const supabase = reqs.filter(u => /supabase|rest\/v1/.test(u))
  out('total requests', reqs.length)
  out('supabase requests (harness: should be 0)', supabase.length)
  await page.close()
}

// ─── Mobile ───────────────────────────────────────────────────────────────
for (const [w, h, name] of [[375, 667, 'iPhone SE'], [390, 844, 'iPhone 14']]) {
  console.log(`\nMOBILE — ${name} ${w}x${h}`)
  const page = await browser.newPage({
    viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  })
  await page.goto(`${base}?surface=mobile-asset&vh=${h}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')
  await page.waitForTimeout(300)

  const m = await page.evaluate(() => {
    const snap = document.querySelector('[data-testid="mobile-snapshot"]')
    const bands = ['position', 'belief', 'active', 'memory'].map(k => {
      const el = document.querySelector(`[data-testid="mobile-band-${k}"]`)
      return { k, h: el ? Math.round(el.getBoundingClientRect().height) : null,
               top: el ? Math.round(el.getBoundingClientRect().top) : null }
    })
    const frame = document.querySelector('[data-harness="mobile-asset"]')
    const scroller = frame?.querySelector('.overflow-y-auto')
    return {
      snapshotH: snap ? Math.round(snap.getBoundingClientRect().height) : null,
      bands,
      viewportH: window.innerHeight,
      scrollH: scroller ? scroller.scrollHeight : null,
      clientH: scroller ? scroller.clientHeight : null,
    }
  })
  out('snapshot total height', `${m.snapshotH}px`)
  for (const b of m.bands) out(`  band ${b.k}`, `${b.h}px (top ${b.top}px)`)
  out('scroller content / visible', `${m.scrollH} / ${m.clientH}px`)
  out('screens of scrolling', m.scrollH && m.clientH ? (m.scrollH / m.clientH).toFixed(2) : '—')

  // Is Decision Memory reachable without scrolling past two screens?
  const memTop = m.bands.find(b => b.k === 'memory')?.top ?? null
  out('Decision Memory first pixel', memTop != null ? `${memTop}px (viewport ${m.viewportH}px)` : '—')
  await page.close()
}

await browser.close()
console.log('')
