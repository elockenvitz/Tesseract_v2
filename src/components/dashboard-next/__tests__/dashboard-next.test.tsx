import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { StartHereBand } from '../StartHereBand'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

/**
 * The Dashboard rebuilt as the feed, in its own tab.
 *
 * Two things are worth guarding and they are different in kind.
 *
 * The BAND is behavioural: it is the only genuinely new surface, and the thing
 * that could go wrong in a reader's hands is it stating an instruction that
 * the card below it does not support, or capping wrong and burying the second
 * and third. Rendered against cards from the real builder, so a change to the
 * card contract reaches these cases.
 *
 * The ISOLATION is source-pinned, because it is a claim about what imports
 * what. The whole justification for a second shell is that the Dashboard and
 * Ideas tabs cannot be affected by it; no render can observe that, and a
 * rendering test that passed would prove nothing about the file that does not
 * import this directory.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/** Four, so the cap at three is observable rather than incidental. */
const SYMBOLS = ['MSFT', 'AMZN', 'JNJ', 'NVDA']

const ENTRIES: AttentionEntry[] = SYMBOLS.map((symbol, i) => ({
  key: `k${i}`,
  card: unwrap(buildActiveRiskCard({
    assetId: `a${i}`, symbol, companyName: `${symbol} Inc.`,
    weightPct: 6.2 + i, benchmarkWeightPct: 3.1,
    portfolioId: 'p1', portfolioName: 'Core Equity',
    /* Relative, for the reason the SignalCardView suite records: a pinned
       date crosses a formatter band and fails on a day nobody chose. */
    asOf: new Date(Date.now() - 16 * 86_400_000).toISOString(),
  })),
  item: null,
  input: null,
  family: 'conviction',
  source: null,
}))

describe('Start here', () => {
  it('states the card\'s own action and the card\'s own reason', () => {
    render(<StartHereBand entries={ENTRIES} onOpen={() => {}} />)

    const card = ENTRIES[0].card
    /*
     * Scoped to the ROW, not the band. Several cards of one family share a
     * primary label, so a document-wide text query either matches three
     * elements or, worse, matches a different row's and still passes.
     *
     * Both expected strings are read off the card rather than written out:
     * hard-coding the verb would let the band invent one of its own and go
     * on passing.
     */
    const row = screen.getAllByRole('listitem')[0]
    expect(row.textContent).toContain(card.actions.primary.label)
    expect(row.textContent).toContain(`Because ${card.headline}.`)
    expect(row.textContent).toContain('MSFT')
  })

  it('shows three instructions, not the whole feed', () => {
    render(<StartHereBand entries={ENTRIES} onOpen={() => {}} />)
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(3)
    /* The fourth entry is in the list and must not be in the band. */
    expect(screen.queryByText(new RegExp(`Because ${ENTRIES[3].card.headline}`))).toBeNull()
  })

  it('opens the entry the row was derived from', () => {
    const onOpen = vi.fn()
    render(<StartHereBand entries={ENTRIES} onOpen={onOpen} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1])
    /*
     * The ENTRY, not an id or a symbol. The shell routes on `entry.family`
     * and `entry.card.actions`, so a band that handed back only a key would
     * force a second lookup and a second chance to route differently than
     * the card click does.
     */
    expect(onOpen).toHaveBeenCalledWith(ENTRIES[1])
  })

  it('renders nothing when the feed is empty', () => {
    const { container } = render(<StartHereBand entries={[]} onOpen={() => {}} />)
    /* An empty band with a heading would be a surface telling the reader to
       start with nothing. */
    expect(container.firstChild).toBeNull()
  })

  it('reads the feed it is given and queries nothing', () => {
    /*
     * The band is a PROJECTION. The defect it exists to avoid is a second
     * producer of "what to do next" that can disagree with the cards under
     * it, and the shape that defect takes is a hook of its own.
     */
    const band = src('components/dashboard-next/StartHereBand.tsx')
    /*
     * The band's own `useState` for the collapse is fine and the first
     * version of this case banned it by accident, with a `use[A-Z]` regex
     * that could not tell a disclosure toggle from a query. What must not
     * appear is a DATA source: a hook out of `hooks/`, React Query, or the
     * client itself.
     */
    /* A `import type` from `hooks/` is the entry SHAPE and carries no
       runtime; a value import from there is a producer. */
    expect(band).not.toMatch(/import\s+(?!type\b)[^;\n]*from '[^']*\/hooks\//)
    expect(band).not.toContain('useQuery')
    expect(band).not.toContain('supabase')
  })
})

describe('the trial tab is isolated', () => {
  it('is not imported by the Dashboard or the Ideas application', () => {
    /*
     * The promise made to the reader is that trying this cannot damage the
     * two surfaces they rely on. These are the two shells those tabs mount.
     */
    for (const f of ['components/ideas-app/IdeasApp.tsx', 'components/dashboard/DashboardShell.tsx']) {
      expect(src(f)).not.toContain('dashboard-next')
    }
  })

  it('leaves the Ideas feed exactly as it was', () => {
    /*
     * `lead` is the one shared component this change touched. It is optional
     * and `IdeasApp` must pass nothing, or the Ideas application has grown a
     * band it never asked for.
     */
    expect(src('components/ideas-app/IdeasApp.tsx')).not.toContain('lead=')
    expect(src('components/ideas-app/IdeasApp.tsx')).not.toContain('StartHereBand')
  })

  it('has exactly one door, and it is not a lens', () => {
    const header = src('components/layout/Header.tsx')
    const group = header.slice(header.indexOf('>Decision OS<'))
    const launcher = group.slice(0, group.indexOf(']'))
    /*
     * One entry, so this is a surface rather than the duplicate door the
     * convergence suite removed for Research, Portfolio and Decisions.
     */
    expect(launcher.match(/type: 'dashboard-next'/g)).toHaveLength(1)
    /* And the tab it opens still renders, from one place. */
    const page = src('pages/DashboardPage.tsx')
    expect(page.match(/case 'dashboard-next':/g)).toHaveLength(1)
    expect(page).toContain('<DashboardNext />')
  })

  it('keeps the Dashboard and Ideas entries it was added beside', () => {
    const header = src('components/layout/Header.tsx')
    const group = header.slice(header.indexOf('>Decision OS<'))
    const launcher = group.slice(0, group.indexOf(']'))
    expect(launcher).toContain("type: 'today'")
    expect(launcher).toContain("type: 'ideas'")
  })
})
