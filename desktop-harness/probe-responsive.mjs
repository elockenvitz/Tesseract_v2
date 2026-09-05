/** Does the portal + workbench survive the desktop widths we claim to support? */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
mkdirSync('.shots', { recursive: true })
const b = await chromium.launch()
for (const [w, h] of [[1024,768],[1366,768],[1440,900],[1920,1080],[2560,1440]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${base}?surface=dashboard&h=1500`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="today-tile"]')
  await p.waitForTimeout(300)
  const dash = p.locator('[data-testid="today-tile"]').filter({ hasText: 'DASH' }).first()
  await dash.locator('[data-testid="claim-portal"]').click()
  await p.waitForSelector('[data-testid="research-detail"]')
  await p.waitForTimeout(400)
  await p.screenshot({ path: `.shots/RESP-workbench-${w}.png` })
  const r = await p.evaluate(() => {
    const doc = document.documentElement
    const surface = document.querySelector('[data-testid="work-surface"]')
    const rail = document.querySelector('[data-testid="work-rail"]')
    const back = document.querySelector('[data-testid="workspace-back"]')
    const chart = document.querySelector('[data-testid="work-surface"] svg')
    const clipped = [...(surface?.querySelectorAll('button') ?? [])].some(el => {
      const b = el.getBoundingClientRect()
      return b.right > window.innerWidth + 1 || b.left < -1
    })
    return {
      hOverflow: doc.scrollWidth > window.innerWidth + 1,
      railVisible: rail ? getComputedStyle(rail).display !== 'none' : false,
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
      backReachable: !!back && back.getBoundingClientRect().width > 0,
      chartW: chart ? Math.round(chart.getBoundingClientRect().width) : 0,
      clippedControls: clipped,
    }
  })
  console.log(`${String(w).padStart(4)}x${h}  overflow=${r.hOverflow}  rail=${r.railVisible ? r.railW + 'px' : 'collapsed'}  back=${r.backReachable}  chart=${r.chartW}px  clipped=${r.clippedControls}`)
  await p.close()
}
await b.close()
