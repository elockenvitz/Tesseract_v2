/**
 * The decision confirmation modal survives its own arrival.
 *
 * ── The production crash ─────────────────────────────────────────────────
 *
 * 2026-10-05 18:03:24Z, Trade Lab. A bulk execute succeeded — accepted trade
 * complete/matched, holdings 10,500 → 11,010, one execution event — and nine
 * seconds later the page died with React #310, "Rendered more hooks than
 * during the previous render", in a `useMemo` inside the SimulationPage
 * chunk.
 *
 * ── Why it happened ──────────────────────────────────────────────────────
 *
 * This component renders nothing until it has a record:
 *
 *     if (!record || record.decisions.length === 0) return null
 *
 * Two `useMemo` calls sit deliberately ABOVE that guard, with a comment
 * explaining that putting them below would trip React. A third —
 * `pendingExecution` — was later added BELOW it. So the modal ran N hooks
 * while idle and N+1 the moment a decision arrived.
 *
 * A bulk execute is precisely the transition that flips the guard: the modal
 * is mounted with `record = null` for the whole session and receives its
 * record only when an execution succeeds. The crash was therefore not
 * incidental to executing — executing is the only thing that triggers it.
 *
 * ── What this test does ──────────────────────────────────────────────────
 *
 * Renders the real component with `record = null`, then re-renders the SAME
 * element tree with a populated record — the production transition — and
 * asserts React does not throw. On the old implementation this throws
 * "Rendered more hooks than during the previous render".
 *
 * A test that merely rendered the populated state would pass against the
 * bug: the hook counts only disagree ACROSS a transition.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }))
vi.mock('../../../lib/pilot/telemetry', () => ({ logPilotEvent: vi.fn() }))

import { DecisionConfirmationModal, type DecisionRecord } from '../DecisionConfirmationModal'

/** The AAPL leg exactly as the production bulk execute produced it. */
const executedRecord: DecisionRecord = {
  portfolioName: 'Quick Quest Core',
  portfolioId: 'pf-1',
  // The component formats this; omitting it throws "Invalid time value"
  // before the hook order is ever exercised.
  recordedAt: '2026-10-05T18:03:13.436Z',
  batchId: '7373d5ce-741e-4e79-9c48-c81d8cc814bb',
  batchName: '1 add · 10/05/2026',
  batchDescription: null,
  decisions: [
    {
      tradeId: '3b079b03-38bb-43ab-9259-9d5bc2cdd83c',
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      action: 'add',
      deltaWeight: 0.25,
      targetWeight: 5.14,
      deltaShares: 510,
      notional: 86955,
      priceAtAcceptance: 170.5,
      sizingInput: '5.14',
      acceptanceNote: null,
      executionStatus: 'complete',
    },
  ],
} as unknown as DecisionRecord

/** The same leg, but execution did not complete — exercises `pendingExecution`. */
const unexecutedRecord: DecisionRecord = {
  ...(executedRecord as unknown as Record<string, unknown>),
  decisions: [
    {
      ...(executedRecord.decisions[0] as unknown as Record<string, unknown>),
      executionStatus: 'not_started',
    },
  ],
} as unknown as DecisionRecord

const props = { onClose: vi.fn(), onViewTradeBook: vi.fn() }

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // React logs the hook-order error before throwing; keep the output clean
  // while still letting the throw surface.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('the modal appearing after a successful execute', () => {
  it('does not throw when a record arrives on a mounted modal', () => {
    // Mounted idle, exactly as Trade Lab keeps it for the whole session.
    const { rerender } = render(
      <DecisionConfirmationModal record={null} {...props} />,
    )
    // The bulk execute lands. Same element type, same position — a RE-RENDER,
    // not a remount, which is what makes the hook counts comparable.
    expect(() =>
      rerender(<DecisionConfirmationModal record={executedRecord} {...props} />),
    ).not.toThrow()
  })

  it('renders the executed decision once it arrives', () => {
    const { rerender } = render(
      <DecisionConfirmationModal record={null} {...props} />,
    )
    rerender(<DecisionConfirmationModal record={executedRecord} {...props} />)
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  })

  it('survives the record going away again', () => {
    // Closing the modal sets `record` back to null — the same boundary in
    // reverse, which is React #300 rather than #310.
    const { rerender } = render(
      <DecisionConfirmationModal record={executedRecord} {...props} />,
    )
    expect(() =>
      rerender(<DecisionConfirmationModal record={null} {...props} />),
    ).not.toThrow()
  })

  it('survives repeated open/close cycles', () => {
    const { rerender } = render(
      <DecisionConfirmationModal record={null} {...props} />,
    )
    expect(() => {
      for (let i = 0; i < 3; i++) {
        rerender(<DecisionConfirmationModal record={executedRecord} {...props} />)
        rerender(<DecisionConfirmationModal record={null} {...props} />)
      }
    }).not.toThrow()
  })

  it('still reports a decision that committed without executing', () => {
    // The branch `pendingExecution` exists for. Moving the hook must not
    // change what it computes.
    const { rerender } = render(
      <DecisionConfirmationModal record={null} {...props} />,
    )
    rerender(<DecisionConfirmationModal record={unexecutedRecord} {...props} />)
    // Both the banner and the section label fire for an unexecuted leg, so
    // this counts rather than demanding exactly one.
    expect(
      screen.getAllByText(/could not be executed|What was decided/i).length,
    ).toBeGreaterThan(0)
  })

  it('says executed, not pending, when the leg completed', () => {
    const { rerender } = render(
      <DecisionConfirmationModal record={null} {...props} />,
    )
    rerender(<DecisionConfirmationModal record={executedRecord} {...props} />)
    expect(screen.queryByText(/could not be executed/i)).not.toBeInTheDocument()
  })
})

describe('every hook sits above the early return', () => {
  /*
   * The structural rule, stated once. The file already carried a comment
   * saying why, and a later edit added a hook below the guard anyway — so
   * the rule is asserted rather than described.
   */
  it('no hook is called after the null-record guard', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../DecisionConfirmationModal.tsx'), 'utf8')
    const guard = src.indexOf('if (!record || record.decisions.length === 0) return null')
    expect(guard).toBeGreaterThan(0)
    const after = src.slice(guard)
    // Comments may discuss hooks; only real calls count.
    const code = after
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/\buse(Memo|State|Effect|Callback|Ref|Context)\s*\(/)
  })
})
