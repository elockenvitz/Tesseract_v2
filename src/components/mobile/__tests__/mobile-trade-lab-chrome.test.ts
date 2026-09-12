/**
 * Trade Lab on a phone says where recommendations are.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * There WAS an inline Ideas button in the header, and the container it sat in
 * carries `hidden` on a phone — so it rendered into nothing. The only route to
 * recommendations was an unlabelled overflow sheet, while the local tutorial
 * told the reader to go and review one and pointed them "on the left", which
 * is a fact about a desktop layout rather than about the product.
 *
 * Adding a position had the opposite problem: a floating button over the
 * bottom-right of the table, with no label, no neighbours and nothing saying
 * what it adds, sitting on top of the rows it was meant to extend.
 *
 * These read source. The claims are about which container a control renders
 * into and which component opens which panel, and a render of a 7,000-line
 * page cannot show either clearly.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const page = src('pages/SimulationPage.tsx')
const list = src('components/mobile/trade-lab/MobileSimulationList.tsx')
const banner = src('components/pilot/PilotTradeLabIntroBanner.tsx')

describe('recommendations have a named control', () => {
  /**
   * Named, and deliberately not the loudest thing on the surface. It shared a
   * band with a second, equally large control while the tutorial was already
   * asking for the same thing one line above.
   */
  it('is labelled, not an icon', () => {
    expect(page).toContain('data-slot="mobile-lab-ideas"')
    const row = page.slice(page.indexOf('data-slot="mobile-lab-ideas"'), page.indexOf('data-slot="mobile-lab-add"'))
    expect(row).toContain('Ideas')
    expect(row).toContain('<Layers')
  })

  /** The canonical panel, the same one the desktop rail opens. */
  it('opens the panel that already exists', () => {
    const row = page.slice(page.indexOf('data-slot="mobile-lab-ideas"'))
    expect(row.slice(0, 300)).toContain('setShowIdeasPanel(true)')
  })

  it('carries a count when there is something to review', () => {
    const row = page.slice(page.indexOf('data-slot="mobile-lab-ideas"'))
    expect(row.slice(0, 900)).toContain('filteredItems.proposals.length + filteredItems.ideas.length')
  })

  /** One route in, not two. The dead inline button is gone. */
  it('leaves no second pathway behind the old hidden button', () => {
    expect(page).not.toMatch(/<Layers className="h-4 w-4" \/>\s*\n\s*Ideas\s*\n/)
  })
})

describe('adding a position', () => {
  it('has no floating button', () => {
    expect(list).not.toContain('absolute bottom-5 right-5')
    expect(list).not.toContain('rounded-full bg-primary-600')
  })

  /** Compact and secondary, but still named to anything that reads labels. */
  it('is a control in the utility row instead', () => {
    expect(page).toContain('data-slot="mobile-lab-add"')
    const row = page.slice(page.indexOf('data-slot="mobile-lab-add"'))
    expect(row.slice(0, 400)).toContain('aria-label="Add trade"')
  })

  /** Same sheet, same handler — only who opens it moved. */
  it('opens the same sheet through the same handler', () => {
    expect(list).toContain('<MobileAddPositionSheet')
    expect(list).toContain('const addOpen = controlledAddOpen ?? ownAddOpen')
    expect(page).toContain('addOpen={mobileAddOpen}')
    expect(page).toContain('onAddOpenChange={setMobileAddOpen}')
  })

  /** A caller with nowhere to put a button still gets a working sheet. */
  it('stays uncontrolled when a caller says nothing', () => {
    expect(list).toContain('addOpen?: boolean')
    expect(list).toContain('onAddOpenChange?: (open: boolean) => void')
  })
})

describe('the local Trade Lab tutorial', () => {
  /**
   * "On the left" is a fact about a desktop layout, not about the product.
   * Asserted against the step copy rather than the file, which still explains
   * in a comment what the copy used to say.
   */
  it('names the control rather than a side of a screen', () => {
    const hints = [...banner.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints.length).toBeGreaterThan(0)
    for (const hint of hints) expect(hint).not.toMatch(/on the (left|right)/)
    expect(hints[0]).toContain('Open Ideas & recommendations')
  })

  /** Completion is untouched: the same three flags, read the same way. */
  it('changes no completion condition', () => {
    for (const flag of ['step1', 'step2', 'step3']) expect(banner).toContain(`done: ${flag}`)
  })
})

describe('the portfolio identity is compact', () => {
  it('no longer claims a 200px floor on a phone', () => {
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    const classes = trigger.slice(0, 800)
    expect(classes).toContain('max-w-[40vw]')
    expect(classes).toContain('sm:min-w-[200px]')
    expect(classes).not.toContain('w-full sm:w-auto sm:min-w-[200px]')
  })

  /** Same dropdown, same truncation, same semantics. */
  it('keeps the dropdown and the truncation', () => {
    expect(page).toContain('portfolioDropdownOpen && (')
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 1200)).toContain('truncate')
  })
})

/*
 * ── One interface, not five toolbars ───────────────────────────────────────
 *
 * The teaching band, the portfolio, a full-width pair of actions and the mode
 * switch were four bands before a single holding, and the measure switch made
 * five before the first number. Everything was individually legible and the
 * stack was not.
 */
describe('the bands above the table', () => {
  it('puts the portfolio, the two actions and the overflow on one row', () => {
    const top = page.slice(page.indexOf('{/* Top row: Portfolio selector and actions */}'))
    const band = top.slice(0, top.indexOf('{/* View Tabs Row */}'))
    for (const slot of ['mobile-lab-ideas', 'mobile-lab-add', 'setMobileLabMenuOpen(true)']) {
      expect(band).toContain(slot)
    }
    expect(band).toContain('setPortfolioDropdownOpen')
  })

  /** The lab beaker and its divider cost a row that had none to spare. */
  it('drops the decorative icon and rule on a phone', () => {
    expect(page).toContain('<Beaker className="hidden sm:block')
    expect(page).toContain('className="hidden sm:inline text-gray-300 dark:text-gray-600">|')
  })

  /** The mode switch is the primary control, and is sized like it. */
  it('gives Simulation / Impact / Trades the tallest band', () => {
    const toggle = page.slice(page.indexOf("onClick={() => setImpactView('simulation')}") - 900)
    expect(toggle.slice(0, 900)).toContain('h-11 sm:h-auto')
  })
})

describe('the local tutorial', () => {
  const banner = src('components/pilot/PilotTradeLabIntroBanner.tsx')
  const shell = src('components/pilot/PilotStepsBanner.tsx')

  /** Local product teaching, like Pipeline basics — not the pilot mission. */
  it('calls itself what it teaches', () => {
    expect(banner).toContain('label="Trade Lab basics"')
  })

  /**
   * The tutorial explains and the app control acts.
   *
   * It carried its own recommendations button, which put a second large
   * control for the same action one line above the one in the toolbar — the
   * reader had two things to choose between for one job. It points instead,
   * and the surface emphasises its own control for as long as the step needs.
   */
  it('carries no control of its own', () => {
    const steps = banner.slice(banner.indexOf('steps={['))
    expect(steps).not.toContain('onClick:')
    expect(steps).not.toContain('ctaLabel')
    expect(banner).not.toContain('onOpenIdeas')
  })

  it('points at the control that exists', () => {
    const hints = [...banner.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints[0]).toBe('Open Ideas & recommendations and add one to the simulation.')
  })

  /** Reported from the flags the banner already watches, not a second model. */
  it('tells the surface which step is being taught', () => {
    expect(banner).toContain('onCurrentStepChange')
    expect(banner).toContain('const step = dismissed ? null : !step1 ? 1 : !step2 ? 2 : !step3 ? 3 : null')
    expect(page).toContain('onCurrentStepChange={setLabBasicsStep}')
  })

  /**
   * Once a step is behind them the reader has seen the pattern, and a module
   * that keeps spending a line on instructions keeps costing the surface it
   * is teaching.
   */
  it('drops the instruction line once a step is done', () => {
    expect(shell).toContain('{!steps.some(s => s.done) && (')
  })

  /** Completion is untouched: the same three flags, read the same way. */
  it('changes no completion fact', () => {
    for (const flag of ['step1', 'step2', 'step3']) expect(banner).toContain(`done: ${flag}`)
  })
})

/*
 * ── One control, emphasised while it is the answer ─────────────────────────
 *
 * Two large recommendation controls stood one line apart: the tutorial's and
 * the toolbar's. There is one now, and the tutorial makes it obvious rather
 * than competing with it.
 */
describe('the single recommendations control', () => {
  it('wears the emphasis only while step one is being taught', () => {
    const row = page.slice(page.indexOf('data-slot="mobile-lab-ideas"'))
    const control = row.slice(0, 1400)
    expect(control).toContain("data-emphasised={labBasicsStep === 1 ? 'true' : 'false'}")
    expect(control).toContain('ring-2 ring-amber-300/60')
    // Still the canonical path, emphasised or not.
    expect(control).toContain('setShowIdeasPanel(true)')
  })

  /** The same action in two places, and this was the hidden one. */
  it('is not repeated inside the overflow sheet', () => {
    const sheet = page.slice(page.indexOf('open={mobileLabMenuOpen}'))
    // The comment explaining the removal still says the words; the control
    // that opened the panel is what must be gone.
    expect(sheet.slice(0, 3000)).not.toContain('setShowIdeasPanel(true)')
  })

  /**
   * What the sheet still holds is what the row has no space for, and none of
   * it is reachable elsewhere on a phone.
   */
  it('leaves the sheet holding only what the row cannot', () => {
    const sheet = page.slice(page.indexOf('open={mobileLabMenuOpen}'))
    const body = sheet.slice(0, 3000)
    for (const entry of ['Workspace', 'Snapshots', 'Save snapshot']) {
      expect(body).toContain(entry)
    }
  })
})

describe('the utility row has room', () => {
  it('gives the controls back the width the portfolio was taking', () => {
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 800)).toContain('max-w-[40vw]')
  })

  /**
   * A bare glyph beside a holdings table is a control with no name. Matched
   * on the visible child rather than the whole element, because the aria
   * label contains the word too and would pass an unlabelled button.
   */
  it('says what Add does, visibly', () => {
    const add = page.slice(page.indexOf('data-slot="mobile-lab-add"'))
    const button = add.slice(0, add.indexOf('</button>'))
    // A line of its own that is just the word: the aria label contains it
    // too, and matching anywhere in the element would pass a bare glyph.
    const lines = button.split('\n').map(l => l.trim())
    expect(lines).toContain('Add')
    expect(button).toContain('aria-label="Add trade"')
  })
})
