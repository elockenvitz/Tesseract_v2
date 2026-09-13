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
const drawer = src('components/mobile/trade-lab/MobileIdeasDrawer.tsx')
const modal = src('components/trading/TradeIdeaDetailModal.tsx')
const css = src('index.css')
const fundamentals = src('components/trading/PortfolioFundamentalsCard.tsx')
const sector = src('components/trading/SectorExposureChart.tsx')
const holdings = src('components/trading/HoldingsComparison.tsx')

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
    expect(row.slice(0, 1400)).toContain('filteredItems.proposals.length + filteredItems.ideas.length')
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
    const classes = trigger.slice(0, 1400)
    expect(classes).toContain('max-w-[40vw]')
    expect(classes).toContain('sm:min-w-[200px]')
    expect(classes).not.toContain('w-full sm:w-auto sm:min-w-[200px]')
  })

  /** Same dropdown, same truncation, same semantics. */
  it('keeps the dropdown and the truncation', () => {
    expect(page).toContain('portfolioDropdownOpen && (')
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 1800)).toContain('truncate')
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

  /**
   * The mode switch is the primary control, and is sized like it — taller
   * than the utilities above it and the measure switch below, both of which
   * are 32px. It came down from 44 because the chrome above the table was
   * still costing more of the screen than the table got.
   */
  it('gives Simulation / Impact / Trades the tallest band', () => {
    const toggle = page.slice(page.indexOf("onClick={() => setImpactView('simulation')}") - 1100)
    expect(toggle.slice(0, 1100)).toContain('h-10 sm:h-auto')

    /*
     * Its segments are buttons, so the global phone rule would give each one
     * min-height:44px and burst them out of the 40px pill meant to contain
     * them. They opt out; the band is the hit area.
     */
    const segments = [...page.matchAll(/flex-1 sm:flex-none flex items-center justify-center gap-1\.5 px-3 h-full[^"]*/g)]
    expect(segments.length).toBe(3)
    for (const s of segments) expect(s[0]).toContain('no-touch-target')

    // The claim is the ordering, not the number: every other control in the
    // cluster must be shorter than the band that navigates between modes.
    const top = page.slice(page.indexOf('{/* Top row: Portfolio selector and actions */}'))
    const band = top.slice(0, top.indexOf('{/* View Tabs Row */}'))
    for (const utility of ['mobile-lab-ideas', 'mobile-lab-add']) {
      const control = band.slice(band.indexOf(`data-slot="${utility}"`))
      expect(control.slice(0, 800)).toContain('h-8')
    }
    expect(list).toContain("'flex-1 h-8 rounded-md text-[12px] font-semibold")
  })

  /**
   * Everything to the right of it is shrink-0 and the portfolio button is the
   * only flexible thing in the row, so "Saved about an hour ago" — 130-odd
   * pixels of prose about finished work — came straight out of the name that
   * says which book you are trading.
   */
  it('does not spend the row on a sentence about a finished save', () => {
    const top = page.slice(page.indexOf('{/* Workbench Status Indicator'))
    const indicator = top.slice(0, top.indexOf('{/* Save Snapshot'))
    expect(indicator).toContain('!workbenchSaving && !isMobileViewport && (')
    expect(indicator).toContain('formatDistanceToNow(workbenchLastSaved')
    // The states that are about work in progress stay — they are two words.
    expect(indicator).toContain('Unsaved')
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
    expect(hints[0]).toBe('Open Ideas & recommendations, pick one, and tap Add to simulation.')
  })

  /**
   * "Review a recommendation" named an action that did not satisfy the step.
   * Reading one and closing it again left the step open — correctly, because
   * the step is about the simulation — so the title said the wrong thing
   * about work the reader had genuinely done.
   */
  it('names the action that actually completes the step', () => {
    const titles = [...banner.matchAll(/title: '([^']*)'/g)].map(m => m[1])
    expect(titles[0]).toBe('Add a recommendation')
    expect(titles[0]).not.toMatch(/review|read|look/i)
    // And the hint names the control the phone actually renders.
    const hints = [...banner.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints[0]).toContain('Add to simulation')
    expect(drawer).toContain('Add to simulation')
  })

  /**
   * Step 2's only dispatch was HoldingsSimulationTable's promote checkbox,
   * and a phone never renders that table — MobileSimulationList has no
   * promote selection — so the step was uncompletable on a phone and the
   * pilot stalled between adding a trade and being told to execute it. The
   * predicate also said "pick the row you want to execute", which is not
   * what setting a size is.
   */
  it('names, and watches for, the act of sizing a trade', () => {
    const titles = [...banner.matchAll(/title: '([^']*)'/g)].map(m => m[1])
    expect(titles[1]).toBe('Size the trade')
    const hints = [...banner.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints[1]).toBe('Tap the trade row and set its weight or shares.')

    // The predicate now lives on the sizing path both surfaces share.
    const sizing = page.slice(page.indexOf('const handleVariantSizingUpdate'))
    const head = sizing.slice(0, sizing.indexOf('// Temp variants'))
    expect(head).toContain("updates.sizingInput !== undefined && updates.sizingInput !== ''")
    expect(head).toContain('pilot-tradelab:rec-sized')

    // And the phone's sizing sheet reaches it through that same prop.
    expect(list).toContain('onUpdateVariant(editingRow.variant.id, { sizingInput })')
    expect(page).toContain('onUpdateVariant={handleVariantSizingUpdate}')
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

/*
 * ── A recommendation you can actually add ──────────────────────────────────
 *
 * A trade_queue_item that carries a proposal is filed under `proposals` and
 * excluded from `ideas`, so on a phone the pilot's seeded recommendation
 * appeared only in the Recommendations tab — where every row was one button
 * whose sole action was "open the detail modal". The apply/unapply logic
 * existed, but inside the desktop row's own render closure, unreachable.
 *
 * So the first tutorial step asked for an add that the surface could not do.
 */
describe('adding a recommendation from a phone', () => {
  it('has a named action on the row, not just a way in to reading it', () => {
    expect(drawer).toContain('data-slot="mobile-rec-add"')
    const action = drawer.slice(drawer.lastIndexOf('<button', drawer.indexOf('data-slot="mobile-rec-add"')))
    const button = action.slice(0, action.indexOf('</button>'))
    expect(button).toContain("added ? 'Added — tap to remove' : 'Add to simulation'")
    expect(button).toContain('onClick={onToggle}')
  })

  /** Reading and adding are separate intentions, so separate targets. */
  it('keeps opening the detail on a different target from adding', () => {
    const row = drawer.slice(drawer.indexOf('function ProposalRow'))
    expect(row).toContain('onClick={onOpen}')
    expect(row).toContain('onClick={onToggle}')
  })

  /**
   * Opening a detail dismisses the full-screen list, and closing it used to
   * land you back in the lab with the list gone — so deciding to add the
   * thing you had just finished reading cost two taps to find again. Reading
   * is a detour from the list, not an exit from it.
   */
  it('puts the list back when the detail is closed', () => {
    expect(page).toContain('setReopenIdeasAfterDetail(true)')
    const close = page.slice(page.indexOf('onClose={() => {\n            setSelectedTradeId(null)'))
    const body = close.slice(0, 500)
    expect(body).toContain('if (reopenIdeasAfterDetail) {')
    expect(body).toContain('setShowIdeasPanel(true)')
    expect(body).toContain('setReopenIdeasAfterDetail(false)')
  })

  /**
   * The same path the desktop checkbox runs — one apply/unapply, lifted to
   * page level so both surfaces call it. A second implementation would be a
   * second set of optimistic overrides to keep in step.
   */
  it('runs the same apply path the desktop checkbox does', () => {
    expect(page).toContain('const toggleProposalInSimulation = useCallback((proposalItem: ProposalItem)')
    expect(page).toContain('onToggleProposal={(p) => toggleProposalInSimulation(p)}')
    // The desktop row delegates rather than keeping its own copy.
    const desktop = page.slice(page.indexOf('const handleAddProposal'))
    expect(desktop.slice(0, 300)).toContain('toggleProposalInSimulation(proposalItem)')
    expect(desktop.slice(0, 300)).not.toContain('importTradeMutation.mutate')
  })

  /**
   * Step 1 is "add a recommendation to the simulation" and now only an add
   * fires it. Expanding a card, opening a detail modal and toggling a pair
   * open all used to dispatch it, which ticked the step off for someone who
   * had only looked.
   */
  it('ticks step one from the add, and from nothing else', () => {
    const dispatches = [...page.matchAll(/dispatchEvent\(new CustomEvent\('pilot-tradelab:rec-reviewed'\)\)/g)]
    // Two adds: an idea's checkbox and a recommendation's apply path.
    expect(dispatches.length).toBe(2)

    const addAsset = page.slice(page.indexOf('const handleAddAsset = useCallback'))
    expect(addAsset.slice(0, 900)).toContain('pilot-tradelab:rec-reviewed')

    const toggle = page.slice(page.indexOf('const toggleProposalInSimulation'))
    expect(toggle.slice(0, toggle.indexOf('// Per-asset exclusivity'))).toContain('pilot-tradelab:rec-reviewed')

    // The reading paths are silent.
    for (const reader of ['const toggleExpand = (e: React.MouseEvent)', 'const toggleProposalExpand = (e: React.MouseEvent)']) {
      const fn = page.slice(page.indexOf(reader))
      expect(fn.slice(0, 400)).not.toContain('pilot-tradelab:rec-reviewed')
    }
  })
})

/*
 * ── The detail is a screen, not a shrunken dialog ──────────────────────────
 *
 * It opened as a max-w-4xl window inset 16px inside a dimmed page and capped
 * at 85% of the viewport: on a phone, a desktop dialog squeezed to 358px with
 * a strip of greyed-out app above and below it doing nothing.
 */
describe('the recommendation detail on a phone', () => {
  it('takes the whole screen instead of floating in the middle of one', () => {
    const shell = modal.slice(modal.indexOf("'fixed inset-0 bg-black/50 flex z-50'"))
    const head = shell.slice(0, 600)
    expect(head).toContain("isMobile ? 'items-stretch justify-stretch' : 'items-center justify-center p-4'")
    expect(head).toContain("? 'h-full max-h-full pt-safe pb-safe'")
    expect(head).toContain(": 'rounded-xl max-w-4xl h-viewport-85 max-h-[900px]'")
  })

  /**
   * Five tabs plus badges do not fit across 390px, and a flex row that cannot
   * fit squashes its children rather than clipping them.
   */
  it('lets the five tabs scroll rather than be crushed', () => {
    const tabs = modal.slice(modal.indexOf('{/* Tabs — compact text-only'))
    expect(tabs.slice(0, 700)).toContain("isMobile && '-mx-3 px-3 overflow-x-auto scrollbar-hide'")
    expect(tabs.slice(0, 2000)).toContain('whitespace-nowrap shrink-0')
  })

  /** Desktop keeps every dimension it had. */
  it('changes nothing above phone width', () => {
    const shell = modal.slice(modal.indexOf("'fixed inset-0 bg-black/50 flex z-50'"))
    expect(shell.slice(0, 600)).toContain('h-viewport-85 max-h-[900px]')
    const header = modal.slice(modal.indexOf("'flex-shrink-0 border-b border-gray-200"))
    expect(header.slice(0, 200)).toContain("isMobile ? 'px-3 pt-2 pb-1.5' : 'p-4'")
  })
})

/*
 * ── Step 3 has a control ───────────────────────────────────────────────────
 *
 * The desktop path is: tick rows in HoldingsSimulationTable → the Execute
 * button in its bottom bar → onBulkPromote → bulkExecuteM → executeSimVariants
 * → onSuccess dispatches `pilot-tradelab:executed`. A phone renders
 * MobileSimulationList in place of that table, and it had no selection column
 * and no bottom bar — so the banner said "STEP 3 OF 3 — Execute" over a screen
 * with nothing on it that could.
 */
describe('executing from a phone', () => {
  it('has a control at all', () => {
    expect(list).toContain('data-slot="mobile-lab-execute"')
    expect(list).toContain('data-slot="mobile-lab-execute-confirm"')
  })

  /** The same mutation the desktop table drives — no second execute path. */
  it('runs the page mutation the desktop table runs', () => {
    const mobile = page.slice(page.indexOf('<MobileSimulationList'), page.indexOf('onExecute={') + 900)
    expect(mobile).toContain('bulkExecuteM.mutate({')
    expect(mobile).toContain('isExecuting={bulkExecuteM.isPending}')
    // And it carries the same payload the desktop confirm modal sends.
    for (const key of ['variantIds', 'batchName', 'batchDescription', 'reasons']) {
      expect(mobile).toContain(key)
    }
    // Exactly two call sites for the one mutation: this and onBulkPromote.
    expect([...page.matchAll(/bulkExecuteM\.mutate\(\{/g)].length).toBe(2)
  })

  /**
   * Execute is PM-only, and on the desktop that is enforced by not passing
   * the handler at all — which is what removes the control. Same gate, or a
   * non-PM gets a button the desktop would not have given them.
   */
  it('is PM-only, gated the same way', () => {
    const mobile = page.slice(page.indexOf('<MobileSimulationList'))
    expect(mobile.slice(0, 2200)).toContain('!isSharedView && selectedPortfolioId && isCurrentUserPM ?')
    // Anchored to the start of the JSX expression: `{false && onExecute …`
    // still contains the condition, and would render nothing.
    expect(list).toContain('{onExecute && !readOnly && promotable.length > 0 && (')
  })

  /**
   * Progress is not this component's to report. Step 3 fires from the
   * mutation's onSuccess, after executeSimVariants has actually committed —
   * so a failed or empty commit ticks nothing.
   */
  it('leaves step three to the mutation that really committed', () => {
    expect(list).not.toContain('pilot-tradelab:executed')
    // The bulk mutation's success handler: the dispatch sits inside the
    // `committed > 0` branch, before the else that reports a failed execute.
    const success = page.slice(page.lastIndexOf('if (committed > 0) {'))
    expect(success.indexOf('pilot-tradelab:executed')).toBeGreaterThan(-1)
    expect(success.indexOf('pilot-tradelab:executed')).toBeLessThan(success.indexOf("toast.error('Execute failed'"))
  })

  /** What it commits is what it shows, and the PM can drop any of it. */
  it('says what will commit before it commits', () => {
    expect(list).toContain("r.variant?.sizing_input && !r.isCash && r.variant?.id")
    expect(list).toContain('These commit to the Trade Book. Tap one to leave it out.')
    expect(list).toContain('onExecute(chosen.map(r => r.variant!.id)')
  })

  it('names the act in the tutorial', () => {
    const titles = [...banner.matchAll(/title: '([^']*)'/g)].map(m => m[1])
    expect(titles[2]).toBe('Execute the simulated trade')
    const hints = [...banner.matchAll(/hint: '([^']*)'/g)].map(m => m[1])
    expect(hints[2]).toContain('Execute at the bottom of the table')
  })
})

/*
 * ── Impact reads at 390px ──────────────────────────────────────────────────
 *
 * Both of these put a name on the same line as a block of fixed-width
 * figures, which at 390px left the name ~100px: "Forward P/E" rendered as
 * "Forward…", "EV/EBITDA" as "EV/EBI…", and sector names collided with the
 * numbers beside them. The fix is the row shape, not the type size.
 */
describe('impact metric labels', () => {
  it('gives the fundamentals label its own line on a phone', () => {
    expect(fundamentals).toContain('flex flex-col gap-0.5 py-1.5 text-sm md:flex-row md:items-center md:justify-between')
    // The label only truncates once it is sharing a line again.
    expect(fundamentals).toContain('min-w-0 md:truncate')
    // Column headers describe columns a stacked row does not have.
    expect(fundamentals).toContain('hidden md:flex items-center justify-between text-xs')
    // Nothing got smaller and nothing was dropped.
    expect(fundamentals).toContain('text-sm')
    expect(fundamentals).toContain('{metric.coverageCount}/{metric.coverageTotal}')
  })

  it('stops sector names colliding with their figures', () => {
    expect(sector).toContain('flex flex-col gap-0.5 md:flex-row md:items-center md:justify-between text-sm mb-1')
    expect(sector).toContain('pl-5 md:pl-0 md:ml-2')
    expect(sector).toContain("'w-16 md:w-20 text-right text-xs tabular-nums'")
  })
})

/*
 * ── Holdings Comparison fits ───────────────────────────────────────────────
 *
 * Six filter pills in a nested row that does not wrap, inside a wrapper that
 * does — about 620px of them at 390px, each inflated further by the global
 * 44px minimum.
 */
describe('holdings comparison at 390px', () => {
  it('scrolls the filters instead of overflowing the card', () => {
    expect(holdings).toContain('-mx-3 px-3 overflow-x-auto no-scrollbar md:mx-0 md:px-0 md:overflow-visible')
    expect(holdings).toContain('w-full md:flex-1 md:min-w-[200px] md:max-w-xs')
    // Every pill holds its width and its own size.
    const pills = [...holdings.matchAll(/shrink-0 no-touch-target tap-pad px-3 py-1\.5 text-xs rounded-full/g)]
    expect(pills.length).toBe(6)
  })

  it('puts the before → after weight at the top of the row hierarchy', () => {
    expect(holdings).toContain('mt-0.5 flex items-baseline gap-1.5 text-[13px] tabular-nums')
    // The sector no longer shares the line it was competing with.
    expect(holdings).not.toContain("{holding.sector && <span className=\"ml-2 text-gray-400\">{holding.sector}</span>}")
  })
})

/*
 * ── An idea is added the same way a recommendation is ──────────────────────
 *
 * The row carried a checkbox in its own column. It ran handleAddAsset /
 * handleRemoveAsset — it put the trade in the simulation and took it out
 * again — while looking exactly like the list-selection checkbox it was not.
 */
describe('adding an idea from a phone', () => {
  it('replaces the ambiguous checkbox with a named action', () => {
    expect(drawer).toContain('data-slot="mobile-idea-add"')
    // The bare tick-in-a-box column is gone.
    expect(drawer).not.toContain("'h-6 w-6 rounded-md border-2 flex items-center justify-center transition-colors'")
    expect(drawer).not.toContain('shrink-0 w-12 flex items-center justify-center border-r')
  })

  it('uses the same words as a recommendation, for the same act', () => {
    const idea = drawer.slice(drawer.lastIndexOf('<button', drawer.indexOf('data-slot="mobile-idea-add"')))
    const rec = drawer.slice(drawer.lastIndexOf('<button', drawer.indexOf('data-slot="mobile-rec-add"')))
    for (const button of [idea, rec]) {
      const body = button.slice(0, button.indexOf('</button>'))
      expect(body).toContain("added ? 'Added — tap to remove' : 'Add to simulation'")
    }
  })

  /** Same mutation path as before — only the control changed. */
  it('runs the handlers the checkbox ran', () => {
    const button = drawer.slice(drawer.lastIndexOf('<button', drawer.indexOf('data-slot="mobile-idea-add"')))
    expect(button.slice(0, button.indexOf('</button>'))).toContain('onClick={() => onToggleAsset(idea, added)}')
    expect(page).toContain('if (isAdded) handleRemoveAsset(idea.asset_id)')
    expect(page).toContain('else handleAddAsset(idea)')
  })

  /** Reading is still its own target, on both kinds of row. */
  it('keeps Details separate from add/remove', () => {
    const row = drawer.slice(drawer.indexOf('function IdeaRow'), drawer.indexOf('function PairRow'))
    expect(row).toContain('onClick={() => onOpenIdea(idea.id)}')
    expect(row).toContain('onClick={() => onToggleAsset(idea, added)}')
    expect(row).toContain('Details')
  })
})

/*
 * ── The utility row stopped overlapping ────────────────────────────────────
 *
 * Every child of the right-hand cluster is shrink-0 but the cluster itself
 * was not, so the row squeezed the box and its contents spilled out of it,
 * over the portfolio name. Separately, the global phone rule forces every
 * button to 44x44 unless it opts out — so the heights these controls asked
 * for were not the heights they got, and a min-width cannot be capped by a
 * max-width.
 */
describe('the utility row at 390px', () => {
  it('makes the action cluster rigid so the portfolio is what gives way', () => {
    const top = page.slice(page.indexOf('{/* Right side controls'))
    expect(top.slice(0, 900)).toContain('className="flex shrink-0 sm:shrink items-center gap-1.5 sm:gap-2"')
  })

  /**
   * Opting out of the 44px box, and buying the thumb back with a padded hit
   * region rather than with height. Without the opt-out these classes are
   * decoration: the global rule overrides both dimensions.
   */
  it('opts each control out of the 44px box and keeps a 44px thumb', () => {
    const top = page.slice(page.indexOf('{/* Top row: Portfolio selector and actions */}'))
    const band = top.slice(0, top.indexOf('{/* View Tabs Row */}'))
    for (const marker of ['data-slot="mobile-lab-ideas"', 'data-slot="mobile-lab-add"', 'setMobileLabMenuOpen(true)']) {
      // Slice to the element's own className, not to the first '>' — the
      // arrow functions in these handlers are full of them.
      const control = band.slice(band.lastIndexOf('<button', band.indexOf(marker)))
      const head = control.slice(0, control.indexOf('</button>'))
      expect(head).toContain('no-touch-target')
      expect(head).toContain('tap-pad')
    }
    // The portfolio trigger too — a min-width:44px cannot be capped.
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 1400)).toContain('no-touch-target tap-pad')

    // 32px drawn, 44px hit: 6px of padded region top and bottom.
    expect(css).toContain('.tap-pad::before')
    expect(css).toContain('top: -6px')
    expect(css).toContain('bottom: -6px')
  })

  it('caps the portfolio at what is left once the actions have their width', () => {
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 1400)).toContain('max-w-[40vw]')
    expect(trigger.slice(0, 1800)).toContain('truncate')
  })
})

describe('the utility row has room', () => {
  it('gives the controls back the width the portfolio was taking', () => {
    const trigger = page.slice(page.indexOf('onClick={() => setPortfolioDropdownOpen'))
    expect(trigger.slice(0, 1400)).toContain('max-w-[40vw]')
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
